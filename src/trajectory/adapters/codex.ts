import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join, relative } from "node:path"

import { z } from "zod"

import {
  type HarnessAdapter,
  type HarnessSessionRef,
  type HarnessTraceDocument,
  type HarnessTraceEvent,
  harnessCollectedStatus,
  harnessTraceDocumentSchema,
  redactHarnessDetail,
  TrajectoryAdapterError,
} from "./contract"

const codexRuntime = "codex"

const messageContentBlockSchema = z
  .object({
    type: z.string(),
    text: z.string().optional(),
  })
  .passthrough()

const rolloutPayloadSchema = z
  .object({
    // Only event_msg/response_item payloads carry a nested type; session_meta
    // and turn_context payloads are discriminated by the envelope type alone.
    type: z.string().optional(),
    id: z.string().optional(),
    session_id: z.string().optional(),
    cwd: z.string().optional(),
    originator: z.string().optional(),
    cli_version: z.string().optional(),
    model: z.string().optional(),
    message: z.string().optional(),
    role: z.string().optional(),
    content: z.array(messageContentBlockSchema).optional(),
    name: z.string().optional(),
    arguments: z.string().optional(),
    call_id: z.string().optional(),
    output: z.string().optional(),
  })
  .passthrough()

const rolloutRecordSchema = z
  .object({
    type: z.string(),
    payload: rolloutPayloadSchema.optional(),
  })
  .passthrough()

type RolloutRecord = z.infer<typeof rolloutRecordSchema>

const toolArgumentSummaryKeys = [
  "cmd",
  "command",
  "file_path",
  "path",
  "pattern",
  "query",
  "prompt",
  "url",
] as const

const summarizeFunctionArguments = (rawArguments: string | undefined): string => {
  if (rawArguments === undefined || rawArguments.trim().length === 0) {
    return ""
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(rawArguments)
  } catch {
    return rawArguments
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return rawArguments
  }
  const record = parsed as Readonly<Record<string, unknown>>
  for (const key of toolArgumentSummaryKeys) {
    const value = record[key]
    if (typeof value === "string" && value.trim().length > 0) {
      return value
    }
  }
  return rawArguments
}

const exitCodePattern = /process exited with code (\d+)/i

const functionOutputStatus = (output: string | undefined): string => {
  if (output === undefined) {
    return "ok"
  }
  const match = exitCodePattern.exec(output)
  if (match?.[1] !== undefined && match[1] !== "0") {
    return "error"
  }
  return "ok"
}

const assistantText = (record: RolloutRecord): string => {
  const blocks = record.payload?.content ?? []
  return blocks
    .filter((block) => block.type === "output_text")
    .map((block) => block.text ?? "")
    .join(" ")
    .trim()
}

const parseRolloutRecords = (sessionPath: string): readonly RolloutRecord[] => {
  const records: RolloutRecord[] = []
  const lines = readFileSync(sessionPath, "utf8").split("\n")
  for (const line of lines) {
    if (line.trim().length === 0) {
      continue
    }
    let rawRecord: unknown
    try {
      rawRecord = JSON.parse(line)
    } catch {
      // Tolerate torn tail lines from live sessions; everything else must parse.
      continue
    }
    const parsed = rolloutRecordSchema.safeParse(rawRecord)
    if (parsed.success) {
      records.push(parsed.data)
    }
  }
  return records
}

// Conversion rules (v1):
// - session_start once, from the session_meta record.
// - Each event_msg user_message opens a turn: function_enter/function_exit
//   spans mirroring the claude-code adapter's turn structure.
// - llm_call per assistant response_item message, named after the model from
//   the most recent turn_context.
// - function_call items become tool_call events; function_call_output items
//   become tool_result events named after the originating function, with
//   ok/error derived from the reported process exit code.
// - reasoning items (encrypted model reasoning), developer/user response
//   messages, and event_msg bookkeeping (token_count, task lifecycle) are
//   never exported.
const convertCodexSession = (sessionPath: string): HarnessTraceDocument => {
  if (!existsSync(sessionPath) || !statSync(sessionPath).isFile()) {
    throw new TrajectoryAdapterError("missing_session", `missing_session: ${sessionPath}`)
  }
  if (!sessionPath.endsWith(".jsonl")) {
    throw new TrajectoryAdapterError("invalid_session", `invalid_session: ${sessionPath}`)
  }
  const records = parseRolloutRecords(sessionPath)
  const sessionMeta = records.find((record) => record.type === "session_meta")
  if (sessionMeta === undefined) {
    throw new TrajectoryAdapterError(
      "invalid_session",
      `invalid_session: no session_meta record in ${sessionPath}`,
    )
  }

  const events: HarnessTraceEvent[] = []
  const emit = (kind: string, name: string, detail: string) => {
    events.push({ kind, name, detail: redactHarnessDetail(detail) })
  }

  const meta = sessionMeta.payload
  const sessionId = meta?.id ?? meta?.session_id ?? basename(sessionPath, ".jsonl")
  emit(
    "session_start",
    sessionId,
    `codex ${meta?.cli_version ?? "unknown"} cwd=${meta?.cwd ?? "unknown"} originator=${meta?.originator ?? "unknown"}`,
  )

  let turnCount = 0
  let currentModel = "codex"
  const functionNamesByCallId = new Map<string, string>()
  const closeTurn = () => {
    if (turnCount > 0) {
      emit("function_exit", `turn-${turnCount}`, "")
    }
  }

  for (const record of records) {
    const payload = record.payload
    if (payload === undefined) {
      continue
    }
    if (record.type === "turn_context") {
      if (payload.model !== undefined && payload.model.length > 0) {
        currentModel = payload.model
      }
      continue
    }
    if (record.type === "event_msg" && payload.type === "user_message") {
      closeTurn()
      turnCount += 1
      emit("function_enter", `turn-${turnCount}`, payload.message ?? "")
      continue
    }
    if (record.type !== "response_item") {
      continue
    }
    if (payload.type === "message" && payload.role === "assistant") {
      emit("llm_call", currentModel, assistantText(record))
      continue
    }
    if (payload.type === "function_call") {
      const functionName = payload.name ?? "function"
      if (payload.call_id !== undefined) {
        functionNamesByCallId.set(payload.call_id, functionName)
      }
      emit("tool_call", functionName, summarizeFunctionArguments(payload.arguments))
      continue
    }
    if (payload.type === "function_call_output") {
      const functionName = functionNamesByCallId.get(payload.call_id ?? "") ?? "function"
      emit("tool_result", functionName, functionOutputStatus(payload.output))
    }
  }
  closeTurn()

  return harnessTraceDocumentSchema.parse({
    runtime: codexRuntime,
    status: harnessCollectedStatus,
    eventCount: events.length,
    events,
  })
}

const collectSessionFiles = (
  rootDir: string,
  currentDir: string,
  refs: HarnessSessionRef[],
): void => {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    const entryPath = join(currentDir, entry.name)
    if (entry.isDirectory()) {
      collectSessionFiles(rootDir, entryPath, refs)
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
      continue
    }
    const stats = statSync(entryPath)
    const parentDir = relative(rootDir, join(entryPath, ".."))
    refs.push({
      sessionId: basename(entryPath, ".jsonl"),
      sessionPath: entryPath,
      modifiedAt: stats.mtime.toISOString(),
      sizeBytes: stats.size,
      ...(parentDir === "" || parentDir === "." ? {} : { projectDir: parentDir }),
    })
  }
}

const listCodexSessions = (sourceDir: string): readonly HarnessSessionRef[] => {
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    throw new TrajectoryAdapterError("missing_source_dir", `missing_source_dir: ${sourceDir}`)
  }
  const refs: HarnessSessionRef[] = []
  collectSessionFiles(sourceDir, sourceDir, refs)
  return refs.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))
}

export const codexAdapter: HarnessAdapter = {
  runtime: codexRuntime,
  displayName: "Codex CLI",
  logHint: "~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-<timestamp>-<id>.jsonl",
  defaultSourceDir: () => {
    const home = homedir()
    return home.length === 0 ? undefined : join(home, ".codex", "sessions")
  },
  listSessions: listCodexSessions,
  convertSession: convertCodexSession,
}
