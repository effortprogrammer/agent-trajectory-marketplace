import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join, relative } from "node:path"

import { z } from "zod"

import {
  type HarnessAdapter,
  type HarnessSessionInput,
  type HarnessSessionRef,
  type HarnessTraceDocument,
  type HarnessTraceEvent,
  harnessCollectedStatus,
  harnessTraceDocumentSchema,
  redactHarnessDetail,
  TrajectoryAdapterError,
} from "./contract"

const openclawRuntime = "openclaw"

const contentBlockSchema = z
  .object({
    type: z.string(),
    text: z.string().optional(),
    thinking: z.string().optional(),
    id: z.string().optional(),
    name: z.string().optional(),
    arguments: z.record(z.unknown()).optional(),
  })
  .passthrough()

const messagePayloadSchema = z
  .object({
    role: z.string(),
    content: z.union([z.string(), z.array(contentBlockSchema)]).optional(),
    model: z.string().optional(),
    toolCallId: z.string().optional(),
    toolName: z.string().optional(),
    isError: z.boolean().optional(),
    runtimeContextCarrier: z.boolean().optional(),
    command: z.string().optional(),
    exitCode: z.number().nullable().optional(),
    cancelled: z.boolean().optional(),
  })
  .passthrough()

const transcriptLineSchema = z
  .object({
    type: z.string(),
    version: z.number().optional(),
    id: z.string().optional(),
    cwd: z.string().optional(),
    message: messagePayloadSchema.optional(),
  })
  .passthrough()

type TranscriptLine = z.infer<typeof transcriptLineSchema>
type ContentBlock = z.infer<typeof contentBlockSchema>

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

const summarizeToolArguments = (input: Readonly<Record<string, unknown>> | undefined): string => {
  if (input === undefined) {
    return ""
  }
  for (const key of toolArgumentSummaryKeys) {
    const value = input[key]
    if (typeof value === "string" && value.trim().length > 0) {
      return value
    }
  }
  return JSON.stringify(input)
}

const textFromContent = (content: string | readonly ContentBlock[] | undefined): string => {
  if (content === undefined) {
    return ""
  }
  if (typeof content === "string") {
    return content
  }
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join(" ")
    .trim()
}

const parseTranscriptLines = (sessionPath: string): readonly TranscriptLine[] => {
  const lines: TranscriptLine[] = []
  for (const line of readFileSync(sessionPath, "utf8").split("\n")) {
    if (line.trim().length === 0) {
      continue
    }
    let rawLine: unknown
    try {
      rawLine = JSON.parse(line)
    } catch {
      // Tolerate torn tail lines from live sessions.
      continue
    }
    const parsed = transcriptLineSchema.safeParse(rawLine)
    if (parsed.success) {
      lines.push(parsed.data)
    }
  }
  return lines
}

// Conversion rules (v1):
// - The header line ({type: "session", version, id, cwd}) becomes
//   session_start.
// - Records are processed in append order; parent-linked branches are not
//   re-linearized in v1.
// - user messages open turn function_enter/function_exit spans
//   (runtimeContextCarrier context injections are skipped).
// - assistant messages become llm_call events named after message.model;
//   their toolCall blocks become tool_call events. thinking blocks are never
//   exported.
// - toolResult messages become tool_result events (ok/error from isError).
// - bashExecution records become a tool_call/tool_result pair named "bash".
// - leaf control records, branch/compaction summaries, and custom messages
//   are skipped.
const convertOpenclawSession = (session: HarnessSessionInput): HarnessTraceDocument => {
  const sessionPath = session.sessionPath
  if (!existsSync(sessionPath) || !statSync(sessionPath).isFile()) {
    throw new TrajectoryAdapterError("missing_session", `missing_session: ${sessionPath}`)
  }
  if (!sessionPath.endsWith(".jsonl")) {
    throw new TrajectoryAdapterError("invalid_session", `invalid_session: ${sessionPath}`)
  }
  const lines = parseTranscriptLines(sessionPath)
  const header = lines.find((line) => line.type === "session")
  const messageLines = lines.filter((line) => line.type === "message" && line.message !== undefined)
  if (header === undefined && messageLines.length === 0) {
    throw new TrajectoryAdapterError(
      "invalid_session",
      `invalid_session: no session header or message records in ${sessionPath}`,
    )
  }

  const events: HarnessTraceEvent[] = []
  const emit = (kind: string, name: string, detail: string) => {
    events.push({ kind, name, detail: redactHarnessDetail(detail) })
  }

  const sessionId = header?.id ?? session.sessionId ?? basename(sessionPath, ".jsonl")
  emit(
    "session_start",
    sessionId,
    `openclaw transcript-v${header?.version ?? 0} cwd=${header?.cwd ?? "unknown"}`,
  )

  let turnCount = 0
  const toolNamesByCallId = new Map<string, string>()
  const closeTurn = () => {
    if (turnCount > 0) {
      emit("function_exit", `turn-${turnCount}`, "")
    }
  }

  for (const line of messageLines) {
    const message = line.message
    if (message === undefined) {
      continue
    }
    if (message.role === "user") {
      if (message.runtimeContextCarrier === true) {
        continue
      }
      closeTurn()
      turnCount += 1
      emit("function_enter", `turn-${turnCount}`, textFromContent(message.content))
      continue
    }
    if (message.role === "assistant") {
      emit("llm_call", message.model ?? openclawRuntime, textFromContent(message.content))
      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block.type !== "toolCall") {
            continue
          }
          const toolName = block.name ?? "tool"
          if (block.id !== undefined) {
            toolNamesByCallId.set(block.id, toolName)
          }
          emit("tool_call", toolName, summarizeToolArguments(block.arguments))
        }
      }
      continue
    }
    if (message.role === "toolResult") {
      const toolName = message.toolName ?? toolNamesByCallId.get(message.toolCallId ?? "") ?? "tool"
      emit("tool_result", toolName, message.isError === true ? "error" : "ok")
      continue
    }
    if (message.role === "bashExecution") {
      emit("tool_call", "bash", message.command ?? "")
      const failed = message.cancelled === true || (message.exitCode ?? 0) !== 0
      emit("tool_result", "bash", failed ? "error" : "ok")
    }
  }
  closeTurn()

  return harnessTraceDocumentSchema.parse({
    runtime: openclawRuntime,
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
    // OpenClaw writes a sibling <sessionId>.trajectory.jsonl trace file next
    // to each transcript; only the transcript is the session log.
    if (entry.name.endsWith(".trajectory.jsonl")) {
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

const listOpenclawSessions = (sourceDir: string): readonly HarnessSessionRef[] => {
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    throw new TrajectoryAdapterError("missing_source_dir", `missing_source_dir: ${sourceDir}`)
  }
  const refs: HarnessSessionRef[] = []
  collectSessionFiles(sourceDir, sourceDir, refs)
  return refs.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))
}

export const openclawAdapter: HarnessAdapter = {
  runtime: openclawRuntime,
  displayName: "OpenClaw",
  logHint: "~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl",
  defaultSourceDir: () => {
    const home = homedir()
    return home.length === 0 ? undefined : join(home, ".openclaw")
  },
  listSessions: listOpenclawSessions,
  convertSession: convertOpenclawSession,
}
