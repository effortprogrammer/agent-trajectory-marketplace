import {
  extractHarnessSourceAttestation,
  type HarnessEventPayload,
  type HarnessSessionInput,
  type HarnessSourceAttestation,
  type HarnessTraceDocument,
  type HarnessTraceEvent,
  harnessCollectedStatus,
  harnessTraceDocumentSchema,
  sanitizeHarnessPayload,
  TrajectoryAdapterError,
} from "../contract";
import {
  fetchOpenCodeMessages,
  fetchOpenCodeParts,
  fetchOpenCodeSession,
  type OpenCodePartRow,
  openOpenCodeDatabase,
  resolveOpenCodeDbPath,
} from "./database";
import {
  collectStepFinishTokens,
  collectTextParts,
  readToolPart,
  safeJsonParse,
} from "./parts";
import { messageDataSchema, type OpenCodeTokenSet } from "./schema";

export const opencodeRuntime = "opencode";

type EventInput = Readonly<{
  kind: string;
  name: string;
  attestation?: HarnessSourceAttestation;
  payload?: HarnessEventPayload;
}>;

const msToIso = (ms: number | null | undefined): string | undefined =>
  ms === null || ms === undefined ? undefined : new Date(ms).toISOString();

const mapTokenSet = (
  raw: OpenCodeTokenSet | undefined,
  model: string,
): NonNullable<HarnessEventPayload["usage"]> | undefined => {
  if (raw === undefined) return undefined;
  const cache = raw.cache;
  const hasUsage = raw.input !== undefined || raw.output !== undefined || raw.reasoning !== undefined ||
    cache?.read !== undefined || cache?.write !== undefined;
  if (!hasUsage) return undefined;
  return {
    model,
    ...(raw.input === undefined ? {} : { inputTokens: raw.input }),
    ...(raw.output === undefined ? {} : { outputTokens: raw.output }),
    ...(raw.reasoning === undefined ? {} : { reasoningOutputTokens: raw.reasoning }),
    ...(cache?.read === undefined ? {} : { cachedInputTokens: cache.read }),
    ...(cache?.write === undefined ? {} : { cacheWriteTokens: cache.write }),
  };
};

export const convertOpenCodeSession = (session: HarnessSessionInput): HarnessTraceDocument => {
  if (session.sessionId === undefined) {
    throw new TrajectoryAdapterError(
      "invalid_session",
      "invalid_session: opencode sessions require a session id from the shared database",
    );
  }
  const dbPath = resolveOpenCodeDbPath(session.sessionPath);
  const sqlite = openOpenCodeDatabase(dbPath);
  try {
    const sessionRow = fetchOpenCodeSession(sqlite, session.sessionId);
    if (sessionRow === null) {
      throw new TrajectoryAdapterError(
        "missing_session",
        `missing_session: ${session.sessionId} not found in ${dbPath}`,
      );
    }
    const messages = fetchOpenCodeMessages(sqlite, session.sessionId);
    const partsByMessage = new Map<string, readonly OpenCodePartRow[]>();
    for (const part of fetchOpenCodeParts(sqlite, session.sessionId)) {
      partsByMessage.set(part.message_id, [...(partsByMessage.get(part.message_id) ?? []), part]);
    }

    const events: HarnessTraceEvent[] = [];
    let formatVersionTwo = false;
    const emit = (input: EventInput): HarnessTraceEvent => {
      const payload = input.payload === undefined ? undefined : sanitizeHarnessPayload(input.payload);
      const attestation = extractHarnessSourceAttestation(input.attestation);
      if (payload !== undefined || attestation !== undefined) formatVersionTwo = true;
      const event: HarnessTraceEvent = {
        kind: input.kind,
        name: input.name,
        ...(attestation === undefined ? {} : attestation),
        ...(payload === undefined ? {} : { payload }),
      };
      events.push(event);
      return event;
    };
    const sessionTimestamp = msToIso(sessionRow.time_created ?? sessionRow.time_updated);
    emit({
      kind: "session_start",
      name: session.sessionId,
      ...(sessionTimestamp === undefined ? {} : {
        attestation: {
          timestamp: sessionTimestamp,
          sourceEventId: `opencode:session:${session.sessionId}`,
        },
      }),
    });

    let turnCount = 0;
    const closeTurn = (): void => {
      if (turnCount > 0) emit({ kind: "function_exit", name: `turn-${turnCount}` });
    };
    for (const message of messages) {
      const parsed = messageDataSchema.safeParse(safeJsonParse(message.data));
      if (!parsed.success) continue;
      const data = parsed.data;
      const parts = partsByMessage.get(message.id) ?? [];
      const timestamp = msToIso(message.time_created ?? message.time_updated);
      if (data.role === "user") {
        closeTurn();
        turnCount += 1;
        const prompt = collectTextParts(parts);
        emit({
          kind: "function_enter",
          name: `turn-${turnCount}`,
          payload: { role: "user", content: prompt },
          ...(timestamp === undefined ? {} : {
            attestation: { timestamp, sourceEventId: `opencode:message:${message.id}` },
          }),
        });
        continue;
      }
      if (data.role !== "assistant") continue;
      const model = data.modelID ?? opencodeRuntime;
      const usage = mapTokenSet(
        data.tokens ?? collectStepFinishTokens(parts),
        model,
      );
      const content = collectTextParts(parts);
      const llmEvent = emit({
          kind: "llm_call",
          name: model,
          payload: {
          role: "assistant",
          ...(content.length === 0 ? {} : { content }),
          ...(usage === undefined ? {} : { usage }),
        },
        ...(timestamp === undefined ? {} : {
          attestation: { timestamp, sourceEventId: `opencode:message:${message.id}` },
        }),
      });
      for (const part of parts) {
        const tool = readToolPart(part);
        if (tool === undefined) continue;
        const callTimestamp = msToIso(part.time_created ?? part.time_updated);
        const callSourceEventId = `opencode:part:${part.id}:call`;
        const toolCall = emit({
          kind: "tool_call",
          name: tool.tool,
          payload: {
            toolUseId: part.id,
            ...(tool.state.input === undefined ? {} : { input: tool.state.input }),
          },
          ...(callTimestamp === undefined ? {} : {
            attestation: {
              timestamp: callTimestamp,
              sourceEventId: callSourceEventId,
              ...(llmEvent.sourceEventId === undefined ? {} : { parentSourceEventId: llmEvent.sourceEventId }),
            },
          }),
        });
        const output = tool.state.output;
        const resultTimestamp = msToIso(part.time_updated ?? part.time_created);
        emit({
          kind: "tool_result",
          name: tool.tool,
          payload: {
            toolUseId: part.id,
            isError: tool.state.status === "error",
            ...(output === undefined ? {} : { output }),
            ...(typeof output === "string" ? { byteCount: Buffer.byteLength(output, "utf8") } : {}),
          },
          ...(resultTimestamp === undefined ? {} : {
            attestation: {
              timestamp: resultTimestamp,
              sourceEventId: `opencode:part:${part.id}:result`,
              ...(toolCall.sourceEventId === undefined ? {} : { parentSourceEventId: callSourceEventId }),
            },
          }),
        });
      }
    }
    closeTurn();
    return harnessTraceDocumentSchema.parse({
      runtime: opencodeRuntime,
      status: harnessCollectedStatus,
      ...(formatVersionTwo ? { formatVersion: 2 as const } : {}),
      eventCount: events.length,
      events,
    });
  } finally {
    sqlite.close();
  }
};
