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
import { detectPiFamilyVariant, hasNativePiSessionScope } from "./detect";
import { parsePiSessionFile } from "./parse";
import type { PiAgentMessage, PiContentBlock } from "./schema";
import type { PiFamilyVariant } from "./variants";

const messageBlocks = (message: PiAgentMessage): readonly PiContentBlock[] =>
  Array.isArray(message.content) ? message.content : [];

const textFromContent = (message: PiAgentMessage): string => {
  if (typeof message.content === "string") return message.content;
  return messageBlocks(message)
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join(" ")
    .trim();
};

// A toolResult message's content is (TextContent | ImageContent)[]; flatten
// to the returned text — the observation the buyer is paying for.
const toolResultOutput = (message: PiAgentMessage): string => {
  if (typeof message.content === "string") return message.content;
  return messageBlocks(message)
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .join("");
};

// Conversion rules, mirroring the openclaw adapter's event vocabulary (both
// formats descend from pi-mono):
// - session_start once, from the JSONL header.
// - Each non-synthetic user message opens a turn (function_enter/function_exit).
// - Each assistant message becomes one llm_call; its toolCall blocks become
//   tool_call events parented to the llm_call.
// - toolResult messages become tool_result events parented to the tool_call.
// - thinking blocks are never exported (private reasoning); synthetic/steering
//   user injections, extension entries (custom/custom_message/label), and
//   bookkeeping entries (model_change, compaction, tool selections, …) are
//   skipped.
export const convertPiFamilySession = (
  variant: PiFamilyVariant,
  session: HarnessSessionInput,
): HarnessTraceDocument => {
  if (variant.runtime === "pi" && session.runtimeAttribution !== "operator_declared") {
    throw new TrajectoryAdapterError(
      "invalid_session",
      "invalid_session: upstream Pi conversion requires an explicit operator declaration",
    );
  }
  const { sessionPath } = session;
  const file = parsePiSessionFile(sessionPath);

  // Provenance gate: a session whose fingerprint strongly claims a sibling
  // fork must be exported under that fork's runtime, never misattributed.
  const detection = detectPiFamilyVariant(sessionPath, file);
  const strongForkRuntime = detection.strongRuntimes.find(
    (runtime) => runtime !== variant.runtime,
  );
  if (variant.runtime === "pi") {
    // Fork lineage markers (strong or weak) disqualify upstream attribution.
    const forkRuntime = strongForkRuntime ?? detection.weakRuntime;
    if (forkRuntime !== undefined && forkRuntime !== variant.runtime) {
      throw new TrajectoryAdapterError(
        "invalid_session",
        `invalid_session: ${sessionPath} carries ${forkRuntime} lineage evidence (${[...detection.evidence, ...detection.weakEvidence].join(", ")}) and cannot be attributed to upstream Pi`,
      );
    }
    // Without fork markers, upstream attribution still requires the native
    // cwd-derived scope the upstream writer produces; anything else is
    // ambiguous and fails closed rather than being silently stamped as pi.
    if (!hasNativePiSessionScope(sessionPath, file.header.cwd)) {
      throw new TrajectoryAdapterError(
        "invalid_session",
        `invalid_session: ${sessionPath} lacks upstream Pi's cwd-derived --scope-- path evidence`,
      );
    }
  }
  if (strongForkRuntime !== undefined) {
    throw new TrajectoryAdapterError(
      "invalid_session",
      `invalid_session: ${sessionPath} fingerprints as ${strongForkRuntime} (${detection.evidence.join(", ")}); export it with runtime ${strongForkRuntime}`,
    );
  }

  const version = file.header.version ?? 1;
  if (version > variant.maxSessionVersion) {
    throw new TrajectoryAdapterError(
      "invalid_session",
      `invalid_session: session version ${version} exceeds ${variant.runtime} max ${variant.maxSessionVersion} in ${sessionPath}`,
    );
  }

  const messageEntries = file.entries.filter(
    (entry) => entry.type === "message" && entry.message !== undefined,
  );
  if (messageEntries.length === 0) {
    throw new TrajectoryAdapterError(
      "invalid_session",
      `invalid_session: no message entries in ${sessionPath}`,
    );
  }

  const events: HarnessTraceEvent[] = [];
  // Guard against duplicate source IDs (the document schema rejects them):
  // attestation is dropped for a repeated ID rather than failing the export.
  const emittedSourceIds = new Set<string>();
  const toolNamesByCallId = new Map<string, string>();
  const toolSourceIdsByCallId = new Map<string, string>();
  let hasAttestation = false;
  let hasPayload = false;

  const emit = (
    kind: string,
    name: string,
    attestation?: HarnessSourceAttestation,
    payload?: HarnessEventPayload,
  ): HarnessTraceEvent => {
    const sanitizedPayload = payload === undefined ? undefined : sanitizeHarnessPayload(payload);
    if (sanitizedPayload !== undefined) hasPayload = true;
    let source = extractHarnessSourceAttestation(attestation);
    if (source !== undefined && emittedSourceIds.has(source.sourceEventId)) source = undefined;
    const event: HarnessTraceEvent = {
      kind,
      name,
      ...(source === undefined
        ? {}
        : {
            timestamp: source.timestamp,
            sourceEventId: source.sourceEventId,
            ...(source.parentSourceEventId === undefined
              ? {}
              : { parentSourceEventId: source.parentSourceEventId }),
          }),
      ...(sanitizedPayload === undefined ? {} : { payload: sanitizedPayload }),
    };
    events.push(event);
    if (source !== undefined) {
      hasAttestation = true;
      emittedSourceIds.add(source.sourceEventId);
    }
    return event;
  };

  const attestationFor = (
    timestamp: string | undefined,
    sourceEventId: string,
    parentSourceEventId?: string,
  ): HarnessSourceAttestation | undefined =>
    extractHarnessSourceAttestation({
      timestamp,
      sourceEventId,
      ...(parentSourceEventId === undefined ? {} : { parentSourceEventId }),
    });

  emit(
    "session_start",
    file.header.id,
    attestationFor(file.header.timestamp, `${variant.runtime}:session:${file.header.id}`),
  );

  let turnCount = 0;
  const closeTurn = (): void => {
    if (turnCount > 0) emit("function_exit", `turn-${turnCount}`);
  };

  for (const entry of messageEntries) {
    const message = entry.message;
    if (message === undefined) continue;
    const entrySourceId = `${variant.runtime}:entry:${entry.id}`;

    if (message.role === "user") {
      if (message.synthetic === true || message.steering === true) continue;
      const prompt = textFromContent(message);
      if (prompt.length === 0) continue;
      closeTurn();
      turnCount += 1;
      emit("function_enter", `turn-${turnCount}`, attestationFor(entry.timestamp, entrySourceId), {
        role: "user",
        content: prompt,
      });
      continue;
    }

    if (message.role === "assistant") {
      const blocks = messageBlocks(message);
      const toolCallBlocks = blocks.filter((block) => block.type === "toolCall");
      const text = textFromContent(message);
      if (text.length === 0 && toolCallBlocks.length === 0) {
        // Thinking-only or empty (errored/aborted) assistant message.
        continue;
      }
      const usage = message.usage;
      const llmEvent = emit(
        "llm_call",
        message.model ?? variant.runtime,
        attestationFor(entry.timestamp, entrySourceId),
        {
          role: "assistant",
          content: text,
          ...(usage === undefined
            ? {}
            : {
                usage: {
                  model: message.model ?? variant.runtime,
                  ...(usage.input === undefined ? {} : { inputTokens: usage.input }),
                  ...(usage.output === undefined ? {} : { outputTokens: usage.output }),
                  // pi-ai splits cacheRead (cached-input reads) from cacheWrite
                  // (cache creation); both map onto the cross-adapter schema.
                  ...(usage.cacheRead === undefined ? {} : { cachedInputTokens: usage.cacheRead }),
                  ...(usage.cacheWrite === undefined ? {} : { cacheWriteTokens: usage.cacheWrite }),
                },
              }),
        },
      );
      for (const block of toolCallBlocks) {
        const toolName = block.name ?? "tool";
        if (block.id !== undefined) toolNamesByCallId.set(block.id, toolName);
        const toolEvent = emit(
          "tool_call",
          toolName,
          block.id === undefined
            ? undefined
            : attestationFor(
                entry.timestamp,
                `${variant.runtime}:tool:${block.id}`,
                llmEvent.sourceEventId,
              ),
          {
            ...(block.id === undefined ? {} : { toolUseId: block.id }),
            input: block.arguments ?? {},
          },
        );
        if (block.id !== undefined && toolEvent.sourceEventId !== undefined) {
          toolSourceIdsByCallId.set(block.id, toolEvent.sourceEventId);
        }
      }
      continue;
    }

    if (message.role === "toolResult") {
      const callId = message.toolCallId;
      const toolName =
        message.toolName ?? (callId === undefined ? undefined : toolNamesByCallId.get(callId)) ?? "tool";
      emit(
        "tool_result",
        toolName,
        callId === undefined
          ? undefined
          : attestationFor(
              entry.timestamp,
              `${variant.runtime}:result:${callId}`,
              toolSourceIdsByCallId.get(callId),
            ),
        {
          ...(callId === undefined ? {} : { toolUseId: callId }),
          isError: message.isError === true,
          output: toolResultOutput(message),
        },
      );
    }
  }
  closeTurn();

  return harnessTraceDocumentSchema.parse({
    runtime: variant.runtime,
    ...(variant.runtime === "pi"
      ? { runtimeAttribution: "operator_declared" as const }
      : {}),
    status: harnessCollectedStatus,
    ...(hasAttestation || hasPayload ? { formatVersion: 2 as const } : {}),
    eventCount: events.length,
    events,
  }) as HarnessTraceDocument;
};
