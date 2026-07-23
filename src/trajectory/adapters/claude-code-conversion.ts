import { existsSync, statSync } from "node:fs"
import { basename } from "node:path"

import {
  extractHarnessSourceAttestation,
  type HarnessEventPayload,
  type HarnessSessionInput,
  type HarnessTraceDocument,
  harnessCollectedStatus,
  harnessTraceDocumentSchema,
  TrajectoryAdapterError,
} from "./contract"
import {
  type AssistantPayloadBlock,
  type ClaudeUsage,
  type TranscriptRecord,
  syntheticModel,
} from "./claude-code-schema"
import {
  contentBlocks,
  humanPromptText,
  parseTranscriptRecords,
  summarizeToolInput,
  toolResultOutput,
} from "./claude-code-parsing"
import { createClaudeEventSink, emitClaudeEvent } from "./claude-code-events"

const claudeCodeRuntime = "claude-code"

type AssistantData = {
  readonly textById: ReadonlyMap<string, string>
  readonly blocksById: ReadonlyMap<string, AssistantPayloadBlock[]>
  readonly usageById: ReadonlyMap<string, ClaudeUsage>
}

const collectAssistantData = (records: readonly TranscriptRecord[]): AssistantData => {
  const textById = new Map<string, string>()
  const blocksById = new Map<string, AssistantPayloadBlock[]>()
  const usageById = new Map<string, ClaudeUsage>()
  for (const record of records) {
    if (record.type !== "assistant") continue
    const messageId = record.message?.id
    if (messageId === undefined) continue
    const text = contentBlocks(record)
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("")
    if (text.length > 0) {
      textById.set(messageId, `${textById.get(messageId) ?? ""}${text}`)
    }
    const assistantBlocks = blocksById.get(messageId) ?? []
    for (const block of contentBlocks(record)) {
      if (block.type === "text") {
        assistantBlocks.push({ type: "text", text: block.text ?? "" })
      } else if (block.type === "tool_use") {
        assistantBlocks.push({
          type: "tool_use",
          ...(block.id === undefined ? {} : { id: block.id }),
          ...(block.name === undefined ? {} : { name: block.name }),
          input: block.input ?? {},
        })
      }
    }
    blocksById.set(messageId, assistantBlocks)
    if (record.message?.usage !== undefined) {
      usageById.set(messageId, record.message.usage)
    }
  }
  return { textById, blocksById, usageById }
}

const conversationalRecords = (records: readonly TranscriptRecord[]): readonly TranscriptRecord[] =>
  records.filter(
    (record) =>
      (record.type === "user" || record.type === "assistant") &&
      record.isMeta !== true &&
      record.isSidechain !== true,
  )

export const convertClaudeCodeSession = (session: HarnessSessionInput): HarnessTraceDocument => {
  const sessionPath = session.sessionPath
  if (!existsSync(sessionPath) || !statSync(sessionPath).isFile()) {
    throw new TrajectoryAdapterError("missing_session", `missing_session: ${sessionPath}`)
  }
  if (!sessionPath.endsWith(".jsonl")) {
    throw new TrajectoryAdapterError("invalid_session", `invalid_session: ${sessionPath}`)
  }
  const records = parseTranscriptRecords(sessionPath)
  const conversational = conversationalRecords(records)
  if (conversational.length === 0) {
    throw new TrajectoryAdapterError(
      "invalid_session",
      `invalid_session: no conversational records in ${sessionPath}`,
    )
  }

  const sink = createClaudeEventSink()
  let currentLlmSourceEventId: string | undefined
  const toolCallSourceEventIdByUseId = new Map<string, string>()
  const first = conversational[0]
  const sessionId = first?.sessionId ?? basename(sessionPath, ".jsonl")
  emitClaudeEvent(
    sink,
    "session_start",
    sessionId,
    `claude-code ${first?.version ?? "unknown"} cwd=${first?.cwd ?? "unknown"} branch=${first?.gitBranch ?? "unknown"}`,
    {
      attestation: extractHarnessSourceAttestation({
        ...(first?.timestamp === undefined ? {} : { timestamp: first.timestamp }),
        sourceEventId: `claude-code:session:${sessionId}`,
      }),
    },
  )

  const assistantData = collectAssistantData(conversational)
  const seenLlmMessageIds = new Set<string>()
  const toolNamesByUseId = new Map<string, string>()
  let turnCount = 0
  const closeTurn = () => {
    if (turnCount > 0) emitClaudeEvent(sink, "function_exit", `turn-${turnCount}`, "")
  }

  for (const record of conversational) {
    if (record.type === "user") {
      const prompt = humanPromptText(record)
      if (prompt !== undefined) {
        closeTurn()
        turnCount += 1
        emitClaudeEvent(sink, "function_enter", `turn-${turnCount}`, prompt, {
          payload: { role: "user", content: prompt },
        })
        continue
      }
      for (const block of contentBlocks(record)) {
        if (block.type !== "tool_result") continue
        const toolUseId = block.tool_use_id
        const output = toolResultOutput(block.content)
        const parentToolSourceId =
          toolUseId === undefined ? undefined : toolCallSourceEventIdByUseId.get(toolUseId)
        emitClaudeEvent(sink, "tool_result", toolNamesByUseId.get(toolUseId ?? "") ?? "tool", block.is_error === true ? "error" : "ok", {
          payload: {
            ...(toolUseId === undefined ? {} : { toolUseId }),
            isError: block.is_error === true,
            output,
            byteCount: Buffer.byteLength(output, "utf8"),
          },
          attestation: extractHarnessSourceAttestation({
            ...(record.timestamp === undefined ? {} : { timestamp: record.timestamp }),
            ...(toolUseId === undefined ? {} : { sourceEventId: `claude-code:result:${toolUseId}` }),
            ...(parentToolSourceId === undefined ? {} : { parentSourceEventId: parentToolSourceId }),
          }),
        })
      }
      continue
    }
    if (record.isApiErrorMessage === true) continue
    const model = record.message?.model
    if (model === undefined || model === syntheticModel) continue
    const messageId = record.message?.id
    const blocks = contentBlocks(record)
    const hasNonThinkingBlock = blocks.some((block) => block.type !== "thinking")
    if (messageId !== undefined && !seenLlmMessageIds.has(messageId) && hasNonThinkingBlock) {
      seenLlmMessageIds.add(messageId)
      const usage = assistantData.usageById.get(messageId) ?? record.message?.usage
      const assistantBlocks = assistantData.blocksById.get(messageId) ?? []
      const payload: HarnessEventPayload = {
        role: "assistant",
        ...(assistantBlocks.length === 0 ? {} : { content: assistantBlocks }),
        usage: {
          model,
          ...(usage?.input_tokens === undefined ? {} : { inputTokens: usage.input_tokens }),
          ...(usage?.output_tokens === undefined ? {} : { outputTokens: usage.output_tokens }),
          ...(usage?.cache_read_input_tokens === undefined
            ? {}
            : { cachedInputTokens: usage.cache_read_input_tokens }),
          ...(usage?.cache_creation_input_tokens === undefined
            ? {}
            : { cacheWriteTokens: usage.cache_creation_input_tokens }),
        },
      }
      const llmEvent = emitClaudeEvent(sink, "llm_call", model, (assistantData.textById.get(messageId) ?? "").trim(), {
        payload,
        attestation: extractHarnessSourceAttestation({
          ...(record.timestamp === undefined ? {} : { timestamp: record.timestamp }),
          sourceEventId: `claude-code:message:${messageId}`,
        }),
      })
      currentLlmSourceEventId = llmEvent.sourceEventId
    }
    for (const block of blocks) {
      if (block.type !== "tool_use") continue
      const toolName = block.name ?? "tool"
      if (block.id !== undefined) toolNamesByUseId.set(block.id, toolName)
      const toolEvent = emitClaudeEvent(sink, "tool_call", toolName, summarizeToolInput(block.input), {
        payload: {
          ...(block.id === undefined ? {} : { toolUseId: block.id }),
          input: block.input ?? {},
        },
        attestation: extractHarnessSourceAttestation({
          ...(record.timestamp === undefined ? {} : { timestamp: record.timestamp }),
          ...(block.id === undefined ? {} : { sourceEventId: `claude-code:tool:${block.id}` }),
          ...(currentLlmSourceEventId === undefined ? {} : { parentSourceEventId: currentLlmSourceEventId }),
        }),
      })
      if (block.id !== undefined && toolEvent.sourceEventId !== undefined) {
        toolCallSourceEventIdByUseId.set(block.id, toolEvent.sourceEventId)
      }
    }
  }
  closeTurn()
  return harnessTraceDocumentSchema.parse({
    runtime: claudeCodeRuntime,
    status: harnessCollectedStatus,
    ...(sink.hasPayload || sink.hasAttestation ? { formatVersion: 2 as const } : {}),
    eventCount: sink.events.length,
    events: sink.events,
  })
}
