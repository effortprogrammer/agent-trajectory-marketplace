import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"

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

const claudeCodeRuntime = "claude-code"

const contentBlockSchema = z
  .object({
    type: z.string(),
    text: z.string().optional(),
    id: z.string().optional(),
    name: z.string().optional(),
    input: z.record(z.unknown()).optional(),
    tool_use_id: z.string().optional(),
    is_error: z.boolean().optional(),
    content: z.unknown().optional(),
  })
  .passthrough()

const transcriptRecordSchema = z
  .object({
    type: z.string(),
    isMeta: z.boolean().optional(),
    isSidechain: z.boolean().optional(),
    isApiErrorMessage: z.boolean().optional(),
    cwd: z.string().optional(),
    sessionId: z.string().optional(),
    version: z.string().optional(),
    gitBranch: z.string().optional(),
    message: z
      .object({
        id: z.string().optional(),
        model: z.string().optional(),
        content: z.union([z.string(), z.array(contentBlockSchema)]).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

type TranscriptRecord = z.infer<typeof transcriptRecordSchema>
type ContentBlock = z.infer<typeof contentBlockSchema>

const syntheticModel = "<synthetic>"

const toolInputSummaryKeys = [
  "command",
  "file_path",
  "path",
  "description",
  "prompt",
  "query",
  "pattern",
  "url",
] as const

const summarizeToolInput = (input: Readonly<Record<string, unknown>> | undefined): string => {
  if (input === undefined) {
    return ""
  }
  for (const key of toolInputSummaryKeys) {
    const value = input[key]
    if (typeof value === "string" && value.trim().length > 0) {
      return value
    }
  }
  return JSON.stringify(input)
}

const contentBlocks = (record: TranscriptRecord): readonly ContentBlock[] => {
  const content = record.message?.content
  return Array.isArray(content) ? content : []
}

const humanPromptText = (record: TranscriptRecord): string | undefined => {
  const content = record.message?.content
  if (typeof content === "string") {
    return content.trim().length > 0 ? content : undefined
  }
  const blocks = contentBlocks(record)
  if (blocks.some((block) => block.type === "tool_result")) {
    return undefined
  }
  const text = blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join(" ")
    .trim()
  return text.length > 0 ? text : undefined
}

const parseTranscriptRecords = (sessionPath: string): readonly TranscriptRecord[] => {
  const records: TranscriptRecord[] = []
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
    const parsed = transcriptRecordSchema.safeParse(rawRecord)
    if (parsed.success) {
      records.push(parsed.data)
    }
  }
  return records
}

// Conversion rules (v1):
// - session_start once, from the first conversational record's metadata.
// - Each human prompt opens a turn: function_enter/function_exit spans so the
//   marketplace topology preview reflects real turn structure.
// - llm_call once per assistant message.id (assistant records stream one
//   content block per JSONL line and share message.id).
// - tool_use blocks become tool_call events; tool_result blocks become
//   tool_result events named after the originating tool.
// - thinking blocks are never exported (private reasoning), meta records and
//   synthetic/error assistant records are skipped, and sidechain (subagent)
//   records are skipped in v1.
const convertClaudeCodeSession = (sessionPath: string): HarnessTraceDocument => {
  if (!existsSync(sessionPath) || !statSync(sessionPath).isFile()) {
    throw new TrajectoryAdapterError("missing_session", `missing_session: ${sessionPath}`)
  }
  if (!sessionPath.endsWith(".jsonl")) {
    throw new TrajectoryAdapterError("invalid_session", `invalid_session: ${sessionPath}`)
  }
  const records = parseTranscriptRecords(sessionPath)
  const conversational = records.filter(
    (record) =>
      (record.type === "user" || record.type === "assistant") &&
      record.isMeta !== true &&
      record.isSidechain !== true,
  )
  if (conversational.length === 0) {
    throw new TrajectoryAdapterError(
      "invalid_session",
      `invalid_session: no conversational records in ${sessionPath}`,
    )
  }

  const events: HarnessTraceEvent[] = []
  const emit = (kind: string, name: string, detail: string) => {
    events.push({ kind, name, detail: redactHarnessDetail(detail) })
  }

  const first = conversational[0]
  const sessionId = first?.sessionId ?? basename(sessionPath, ".jsonl")
  emit(
    "session_start",
    sessionId,
    `claude-code ${first?.version ?? "unknown"} cwd=${first?.cwd ?? "unknown"} branch=${first?.gitBranch ?? "unknown"}`,
  )

  let turnCount = 0
  const seenLlmMessageIds = new Set<string>()
  const toolNamesByUseId = new Map<string, string>()
  const closeTurn = () => {
    if (turnCount > 0) {
      emit("function_exit", `turn-${turnCount}`, "")
    }
  }

  for (const record of conversational) {
    if (record.type === "user") {
      const prompt = humanPromptText(record)
      if (prompt !== undefined) {
        closeTurn()
        turnCount += 1
        emit("function_enter", `turn-${turnCount}`, prompt)
        continue
      }
      for (const block of contentBlocks(record)) {
        if (block.type !== "tool_result") {
          continue
        }
        const toolName = toolNamesByUseId.get(block.tool_use_id ?? "") ?? "tool"
        emit("tool_result", toolName, block.is_error === true ? "error" : "ok")
      }
      continue
    }

    if (record.isApiErrorMessage === true) {
      continue
    }
    const model = record.message?.model
    if (model === undefined || model === syntheticModel) {
      continue
    }
    for (const block of contentBlocks(record)) {
      if (block.type === "thinking") {
        continue
      }
      const messageId = record.message?.id
      if (messageId !== undefined && !seenLlmMessageIds.has(messageId)) {
        seenLlmMessageIds.add(messageId)
        emit("llm_call", model, block.type === "text" ? (block.text ?? "") : "")
      }
      if (block.type === "tool_use") {
        const toolName = block.name ?? "tool"
        if (block.id !== undefined) {
          toolNamesByUseId.set(block.id, toolName)
        }
        emit("tool_call", toolName, summarizeToolInput(block.input))
      }
    }
  }
  closeTurn()

  return harnessTraceDocumentSchema.parse({
    runtime: claudeCodeRuntime,
    status: harnessCollectedStatus,
    eventCount: events.length,
    events,
  })
}

const sessionRefForFile = (sessionPath: string, projectDir?: string): HarnessSessionRef => {
  const stats = statSync(sessionPath)
  return {
    sessionId: basename(sessionPath, ".jsonl"),
    sessionPath,
    modifiedAt: stats.mtime.toISOString(),
    sizeBytes: stats.size,
    ...(projectDir === undefined ? {} : { projectDir }),
  }
}

const listClaudeCodeSessions = (sourceDir: string): readonly HarnessSessionRef[] => {
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    throw new TrajectoryAdapterError("missing_source_dir", `missing_source_dir: ${sourceDir}`)
  }
  const refs: HarnessSessionRef[] = []
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const entryPath = join(sourceDir, entry.name)
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      refs.push(sessionRefForFile(entryPath))
      continue
    }
    if (!entry.isDirectory()) {
      continue
    }
    for (const candidate of readdirSync(entryPath, { withFileTypes: true })) {
      if (candidate.isFile() && candidate.name.endsWith(".jsonl")) {
        refs.push(sessionRefForFile(join(entryPath, candidate.name), entry.name))
      }
    }
  }
  return refs.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))
}

export const claudeCodeAdapter: HarnessAdapter = {
  runtime: claudeCodeRuntime,
  displayName: "Claude Code",
  logHint: "~/.claude/projects/<project>/<sessionId>.jsonl",
  defaultSourceDir: () => {
    const home = homedir()
    return home.length === 0 ? undefined : join(home, ".claude", "projects")
  },
  listSessions: listClaudeCodeSessions,
  convertSession: convertClaudeCodeSession,
}
