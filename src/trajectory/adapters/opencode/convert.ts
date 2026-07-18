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
import {
  fetchOpenCodeMessages,
  fetchOpenCodeParts,
  fetchOpenCodeSession,
  type OpenCodePartRow,
  openOpenCodeDatabase,
  resolveOpenCodeDbPath,
} from "./database"
import {
  collectStepFinishTokens,
  collectTextParts,
  readToolPart,
  safeJsonParse,
  summarizeToolInput,
  toolStatusDetail,
} from "./parts"
import { messageDataSchema, type OpenCodeTokenSet } from "./schema"

export const opencodeRuntime = "opencode"

const epochMsToIso = (ms: number): string => new Date(ms).toISOString()

// Native ms-timestamp → ISO 8601. Returns undefined when raw is null/undefined
// so the caller drops the whole attestation group rather than pin to the
// Unix epoch.
const msToIso = (ms: number | null | undefined): string | undefined => {
  if (ms === null || ms === undefined) return undefined
  return epochMsToIso(ms)
}

// Namespaced source-event IDs give every emitted event a stable, unique
// handle the buyer-side normalizer can resolve. The `:call` / `:result`
// suffixes keep the two faces of one tool part distinct so the document
// never carries a duplicate sourceEventId.
const sessionSourceEventId = (sessionId: string): string => `opencode:session:${sessionId}`
const messageSourceEventId = (messageId: string): string => `opencode:message:${messageId}`
const toolCallSourceEventId = (partId: string): string => `opencode:part:${partId}:call`
const toolResultSourceEventId = (partId: string): string => `opencode:part:${partId}:result`

// Maps an OpenCode token set (assistant.tokens or step-finish part tokens)
// to the cross-adapter usage shape. cache.read maps to cachedInputTokens
// and cache.write maps to cacheWriteTokens; the two stay distinct and are
// never subtracted from input (mirrors the user-requirement mapping).
const mapTokenSet = (
  raw: OpenCodeTokenSet | undefined,
  model: string,
): NonNullable<HarnessEventPayload["usage"]> | undefined => {
  if (raw === undefined) return undefined
  const cache = raw.cache
  const hasAny =
    raw.input !== undefined ||
    raw.output !== undefined ||
    raw.reasoning !== undefined ||
    cache?.read !== undefined ||
    cache?.write !== undefined
  if (!hasAny) return undefined
  return {
    model,
    ...(raw.input === undefined ? {} : { inputTokens: raw.input }),
    ...(raw.output === undefined ? {} : { outputTokens: raw.output }),
    ...(raw.reasoning === undefined ? {} : { reasoningOutputTokens: raw.reasoning }),
    ...(cache?.read === undefined ? {} : { cachedInputTokens: cache.read }),
    ...(cache?.write === undefined ? {} : { cacheWriteTokens: cache.write }),
  }
}

export const convertOpenCodeSession = (session: HarnessSessionInput): HarnessTraceDocument => {
  if (session.sessionId === undefined) {
    throw new TrajectoryAdapterError(
      "invalid_session",
      "invalid_session: opencode sessions live in one shared opencode*.db; pass a session id, not the db path",
    )
  }
  const dbPath = resolveOpenCodeDbPath(session.sessionPath)
  const sqlite = openOpenCodeDatabase(dbPath)
  try {
    const sessionRow = fetchOpenCodeSession(sqlite, session.sessionId)
    if (sessionRow === null) {
      throw new TrajectoryAdapterError(
        "missing_session",
        `missing_session: ${session.sessionId} not found in ${dbPath}`,
      )
    }
    const messages = fetchOpenCodeMessages(sqlite, session.sessionId)
    const parts = fetchOpenCodeParts(sqlite, session.sessionId)
    const partsByMessage = new Map<string, readonly OpenCodePartRow[]>()
    for (const part of parts) {
      const existing = partsByMessage.get(part.message_id) ?? []
      partsByMessage.set(part.message_id, [...existing, part])
    }

    const events: HarnessTraceEvent[] = []
    let hasAttestation = false
    let hasPayload = false

    const emit = (
      kind: string,
      name: string,
      detail: string,
      attestation?: HarnessSourceAttestation,
      payload?: HarnessEventPayload,
    ): HarnessTraceEvent => {
      if (payload !== undefined) hasPayload = true
      const extracted = extractHarnessSourceAttestation(attestation)
      if (extracted === undefined) {
        const event: HarnessTraceEvent = {
          kind,
          name,
          detail: redactHarnessDetail(detail),
          ...(payload === undefined ? {} : { payload }),
        }
        events.push(event)
        return event
      }
      hasAttestation = true
      const event: HarnessTraceEvent = {
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
      events.push(event)
      return event
    }

    const sessionTimestamp = msToIso(sessionRow.time_created ?? sessionRow.time_updated)
    emit(
      "session_start",
      session.sessionId,
      `opencode session=${session.sessionId}`,
      sessionTimestamp === undefined
        ? undefined
        : extractHarnessSourceAttestation({
            timestamp: sessionTimestamp,
            sourceEventId: sessionSourceEventId(session.sessionId),
          }),
    )

    let turnCount = 0
    const closeTurn = () => {
      if (turnCount > 0) emit("function_exit", `turn-${turnCount}`, "")
    }

    for (const message of messages) {
      const parsedMessage = messageDataSchema.safeParse(safeJsonParse(message.data))
      if (!parsedMessage.success) continue
      const data = parsedMessage.data
      const messageParts = partsByMessage.get(message.id) ?? []

      if (data.role === "user") {
        closeTurn()
        turnCount += 1
        const ts = msToIso(message.time_created ?? message.time_updated)
        emit(
          "function_enter",
          `turn-${turnCount}`,
          collectTextParts(messageParts),
          ts === undefined
            ? undefined
            : extractHarnessSourceAttestation({
                timestamp: ts,
                sourceEventId: messageSourceEventId(message.id),
              }),
        )
        continue
      }

      if (data.role !== "assistant") continue

      const model = data.modelID ?? opencodeRuntime
      const fallbackTokens =
        data.tokens === undefined ? collectStepFinishTokens(messageParts) : undefined
      const usage = mapTokenSet(data.tokens ?? fallbackTokens, model)
      const payload: HarnessEventPayload | undefined =
        usage === undefined ? undefined : { role: "assistant", usage }
      const assistantTs = msToIso(message.time_created ?? message.time_updated)
      const llmEvent = emit(
        "llm_call",
        model,
        collectTextParts(messageParts),
        assistantTs === undefined
          ? undefined
          : extractHarnessSourceAttestation({
              timestamp: assistantTs,
              sourceEventId: messageSourceEventId(message.id),
            }),
        payload,
      )

      for (const part of messageParts) {
        const toolPart = readToolPart(part)
        if (toolPart === undefined) continue
        const callTs = msToIso(part.time_created ?? part.time_updated)
        const toolCallEvent = emit(
          "tool_call",
          toolPart.tool,
          summarizeToolInput(toolPart.state.input),
          callTs === undefined
            ? undefined
            : extractHarnessSourceAttestation({
                timestamp: callTs,
                sourceEventId: toolCallSourceEventId(part.id),
                ...(llmEvent.sourceEventId === undefined
                  ? {}
                  : { parentSourceEventId: llmEvent.sourceEventId }),
              }),
        )
        const resultTs = msToIso(part.time_updated ?? part.time_created)
        emit(
          "tool_result",
          toolPart.tool,
          toolStatusDetail(toolPart.state.status),
          resultTs === undefined
            ? undefined
            : extractHarnessSourceAttestation({
                timestamp: resultTs,
                sourceEventId: toolResultSourceEventId(part.id),
                ...(toolCallEvent.sourceEventId === undefined
                  ? {}
                  : { parentSourceEventId: toolCallEvent.sourceEventId }),
              }),
        )
      }
    }
    closeTurn()

    return harnessTraceDocumentSchema.parse({
      runtime: opencodeRuntime,
      status: harnessCollectedStatus,
      ...(hasAttestation || hasPayload ? { formatVersion: 2 as const } : {}),
      eventCount: events.length,
      events,
    })
  } finally {
    sqlite.close()
  }
}
