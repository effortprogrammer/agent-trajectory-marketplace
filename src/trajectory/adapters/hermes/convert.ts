import {
  extractHarnessSourceAttestation,
  type HarnessEventPayload,
  type HarnessSessionInput,
  type HarnessSourceAttestation,
  type HarnessTraceDocument,
  type HarnessTraceEvent,
  harnessCollectedStatus,
  harnessTraceDocumentSchema,
  redactHarnessDetail,
  TrajectoryAdapterError,
} from "../contract"

import { epochToIso, readHermesSession, type HermesMessageRow } from "./database"
import { decodeHermesContent, hermesToolCallSchema, summarizeArgumentsJson } from "./content"

export const hermesRuntime = "hermes"

const convertHermesSession = (session: HarnessSessionInput): HarnessTraceDocument => {
  if (session.sessionId === undefined) {
    throw new TrajectoryAdapterError(
      "invalid_session",
      "invalid_session: hermes sessions live in one state.db; pass a session id, not the db path",
    )
  }
  const { session: sessionRow, messages: rows } = readHermesSession(
    session.sessionPath,
    session.sessionId,
  )
  const events: HarnessTraceEvent[] = []
  let hasAttestation = false
  // Two namespaces: `msg:<rowId>` for row-backed events and `tcall:<nativeId>`
  // for tool calls, which fan out within one assistant row and would otherwise
  // collide with the row's own llm_call source id. The session prefix defends
  // against id collisions across sessions sharing one store.
  const namespace = `hermes:${session.sessionId}`
  const toolCallSourceByNativeId = new Map<string, string>()
  let hasPayload = false
  const emit = (
    kind: string,
    name: string,
    detail: string,
    attestation?: HarnessSourceAttestation,
    payload?: HarnessEventPayload,
  ): HarnessTraceEvent => {
    if (payload !== undefined) {
      hasPayload = true
    }
    const extracted = extractHarnessSourceAttestation(attestation)
    const event: HarnessTraceEvent =
      extracted === undefined
        ? {
            kind,
            name,
            detail: redactHarnessDetail(detail),
            ...(payload === undefined ? {} : { payload }),
          }
        : {
            kind,
            name,
            detail: redactHarnessDetail(detail),
            timestamp: extracted.timestamp,
            sourceEventId: extracted.sourceEventId,
            ...(extracted.parentSourceEventId === undefined
              ? {}
              : { parentSourceEventId: extracted.parentSourceEventId }),
            ...(payload === undefined ? {} : { payload }),
          }
    if (extracted !== undefined) {
      hasAttestation = true
    }
    events.push(event)
    return event
  }

  // Omit the whole attestation group when the raw timestamp is missing;
  // epochToIso would otherwise pin the event to the Unix epoch.
  const rowAttestation = (
    row: HermesMessageRow,
    sourceEventId: string,
    parentSourceEventId?: string,
  ): HarnessSourceAttestation | undefined => {
    if (row.timestamp === null) return undefined
    return extractHarnessSourceAttestation({
      timestamp: epochToIso(row.timestamp),
      sourceEventId,
      ...(parentSourceEventId === undefined ? {} : { parentSourceEventId }),
    })
  }

  const model = sessionRow.model ?? hermesRuntime
  // Hermes tracks usage only at session aggregate (per tokscale's parser);
  // attach the aggregate as session_start.payload.usage so a buyer reads
  // session totals directly.
  const aggregateUsage: HarnessEventPayload["usage"] = {
    model,
    ...(sessionRow.input_tokens === null || sessionRow.input_tokens === undefined
      ? {}
      : { inputTokens: sessionRow.input_tokens }),
    ...(sessionRow.output_tokens === null || sessionRow.output_tokens === undefined
      ? {}
      : { outputTokens: sessionRow.output_tokens }),
    ...(sessionRow.cache_read_tokens === null || sessionRow.cache_read_tokens === undefined
      ? {}
      : { cachedInputTokens: sessionRow.cache_read_tokens }),
    ...(sessionRow.cache_write_tokens === null || sessionRow.cache_write_tokens === undefined
      ? {}
      : { cacheWriteTokens: sessionRow.cache_write_tokens }),
    ...(sessionRow.reasoning_tokens === null || sessionRow.reasoning_tokens === undefined
      ? {}
      : { reasoningOutputTokens: sessionRow.reasoning_tokens }),
  }
  const hasAnyUsageField =
    aggregateUsage.inputTokens !== undefined ||
    aggregateUsage.outputTokens !== undefined ||
    aggregateUsage.cachedInputTokens !== undefined ||
    aggregateUsage.cacheWriteTokens !== undefined ||
    aggregateUsage.reasoningOutputTokens !== undefined
  emit(
    "session_start",
    session.sessionId,
    `hermes model=${model} cwd=${sessionRow.cwd ?? "unknown"}`,
    undefined,
    hasAnyUsageField ? { usage: aggregateUsage } : undefined,
  )

  let turnCount = 0
  const toolNamesByCallId = new Map<string, string>()
  const closeTurn = () => {
    if (turnCount > 0) {
      emit("function_exit", `turn-${turnCount}`, "")
    }
  }

  for (const row of rows) {
    if (row.role === "user") {
      closeTurn()
      turnCount += 1
      emit(
        "function_enter",
        `turn-${turnCount}`,
        decodeHermesContent(row.content),
        rowAttestation(row, `${namespace}:msg:${row.id}`),
      )
      continue
    }
    if (row.role === "assistant") {
      // Reasoning columns are never exported; only the visible content is.
      const llmEvent = emit(
        "llm_call",
        model,
        decodeHermesContent(row.content),
        rowAttestation(row, `${namespace}:msg:${row.id}`),
      )
      if (row.tool_calls !== null) {
        let parsedToolCalls: unknown
        try {
          parsedToolCalls = JSON.parse(row.tool_calls)
        } catch {
          parsedToolCalls = []
        }
        if (Array.isArray(parsedToolCalls)) {
          for (const rawToolCall of parsedToolCalls) {
            const parsed = hermesToolCallSchema.safeParse(rawToolCall)
            if (!parsed.success) continue
            const toolName = parsed.data.function?.name ?? "tool"
            const nativeToolCallId = parsed.data.id
            const toolCallSourceEventId =
              nativeToolCallId === undefined
                ? undefined
                : `${namespace}:tcall:${nativeToolCallId}`
            if (nativeToolCallId !== undefined) {
              toolNamesByCallId.set(nativeToolCallId, toolName)
            }
            const toolEvent = emit(
              "tool_call",
              toolName,
              summarizeArgumentsJson(parsed.data.function?.arguments),
              toolCallSourceEventId === undefined
                ? undefined
                : rowAttestation(row, toolCallSourceEventId, llmEvent.sourceEventId),
            )
            if (nativeToolCallId !== undefined && toolEvent.sourceEventId !== undefined) {
              toolCallSourceByNativeId.set(nativeToolCallId, toolEvent.sourceEventId)
            }
          }
        }
      }
      continue
    }
    if (row.role === "tool") {
      const toolName = row.tool_name ?? toolNamesByCallId.get(row.tool_call_id ?? "") ?? "tool"
      const parentSourceEventId =
        row.tool_call_id === null ? undefined : toolCallSourceByNativeId.get(row.tool_call_id)
      emit(
        "tool_result",
        toolName,
        decodeHermesContent(row.content),
        rowAttestation(row, `${namespace}:msg:${row.id}`, parentSourceEventId),
      )
    }
    // system rows (prompt scaffolding) are skipped on purpose.
  }
  closeTurn()

  return harnessTraceDocumentSchema.parse({
    runtime: hermesRuntime,
    status: harnessCollectedStatus,
    ...(hasAttestation || hasPayload ? { formatVersion: 2 as const } : {}),
    eventCount: events.length,
    events,
  })
}

export { convertHermesSession }
