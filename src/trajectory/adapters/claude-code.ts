import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"

import { z } from "zod"

import {
  type HarnessAdapter,
  type HarnessEventPayload,
  type HarnessSessionInput,
  type HarnessSessionRef,
  type HarnessTraceDocument,
  type HarnessTraceEvent,
  harnessCollectedStatus,
  harnessTraceDocumentSchema,
  redactHarnessDetail,
  sanitizeHarnessPayload,
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
        usage: z
          .object({
            input_tokens: z.number().optional(),
            output_tokens: z.number().optional(),
          })
          .passthrough()
          .optional(),
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

// A tool_result block's content is a string, or an array of {type:"text",text}
// (and occasionally other) blocks. Flatten to the actual returned text — the
// observation the buyer is paying for.
const toolResultOutput = (content: unknown): string => {
  if (typeof content === "string") {
    return content
  }
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") {
          return block
        }
        if (block !== null && typeof block === "object" && "text" in block) {
          const text = (block as { text?: unknown }).text
          return typeof text === "string" ? text : ""
        }
        return ""
      })
      .join("")
  }
  return content === undefined ? "" : JSON.stringify(content)
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
const convertClaudeCodeSession = (session: HarnessSessionInput): HarnessTraceDocument => {
  const sessionPath = session.sessionPath
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
  let hasPayload = false
  const emit = (kind: string, name: string, detail: string, payload?: HarnessEventPayload) => {
    const sanitized = payload === undefined ? undefined : sanitizeHarnessPayload(payload)
    if (sanitized !== undefined) {
      hasPayload = true
    }
    events.push({
      kind,
      name,
      detail: redactHarnessDetail(detail),
      ...(sanitized === undefined ? {} : { payload: sanitized }),
    })
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
        // Payload carries the full prompt; detail stays the capped summary.
        emit("function_enter", `turn-${turnCount}`, prompt, { role: "user", content: prompt })
        continue
      }
      for (const block of contentBlocks(record)) {
        if (block.type !== "tool_result") {
          continue
        }
        const toolName = toolNamesByUseId.get(block.tool_use_id ?? "") ?? "tool"
        // Observation: the actual tool output, not just ok/error.
        const output = toolResultOutput(block.content)
        emit("tool_result", toolName, block.is_error === true ? "error" : "ok", {
          ...(block.tool_use_id === undefined ? {} : { toolUseId: block.tool_use_id }),
          isError: block.is_error === true,
          output,
          byteCount: Buffer.byteLength(output, "utf8"),
        })
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
    // Assistant messages stream one content block per JSONL line but share a
    // message.id; collect this record's blocks into one structured payload the
    // first time we see the id.
    const messageId = record.message?.id
    const blocks = contentBlocks(record)
    // Assistant messages stream one block per record sharing message.id, and a
    // record may hold only a thinking block (dropped). Consume the id — and
    // emit the single llm_call — on the first record that carries a
    // non-thinking block, so a leading thinking-only record does not swallow
    // the assistant turn.
    const hasNonThinkingBlock = blocks.some((block) => block.type !== "thinking")
    if (messageId !== undefined && !seenLlmMessageIds.has(messageId) && hasNonThinkingBlock) {
      seenLlmMessageIds.add(messageId)
      // Assistant messages stream one block per record; the thinking gate and
      // tool actions are handled below/here. The payload carries this chunk's
      // full assistant text (uncapped, vs the 240-char detail) plus usage;
      // the concrete actions are captured as tool_call events with full input.
      const assistantText = blocks
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("")
        .trim()
      const usage = record.message?.usage
      const payload: HarnessEventPayload = {
        role: "assistant",
        ...(assistantText.length === 0 ? {} : { content: assistantText }),
        usage: {
          model,
          ...(usage?.input_tokens === undefined ? {} : { inputTokens: usage.input_tokens }),
          ...(usage?.output_tokens === undefined ? {} : { outputTokens: usage.output_tokens }),
        },
      }
      emit("llm_call", model, assistantText, payload)
    }
    for (const block of blocks) {
      if (block.type === "tool_use") {
        const toolName = block.name ?? "tool"
        if (block.id !== undefined) {
          toolNamesByUseId.set(block.id, toolName)
        }
        // Action: the full tool input, not a single summarized key. The tool
        // name is already the event name.
        emit("tool_call", toolName, summarizeToolInput(block.input), {
          ...(block.id === undefined ? {} : { toolUseId: block.id }),
          input: block.input ?? {},
        })
      }
    }
  }
  closeTurn()

  return harnessTraceDocumentSchema.parse({
    runtime: claudeCodeRuntime,
    status: harnessCollectedStatus,
    ...(hasPayload ? { formatVersion: 2 as const } : {}),
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
