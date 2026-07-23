import { existsSync, statSync } from "node:fs";
import { basename } from "node:path";

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
} from "../contract";
import { parseTranscriptLines } from "./parse";
import {
  composedSourceId,
  lineAttestation,
  lineSourceId,
  namespacedId,
  summarizeToolArguments,
  textFromContent,
} from "./source";
import type { TranscriptLine } from "./schema";

const runtime = "openclaw";

export const convertOpenclawSession = (session: HarnessSessionInput): HarnessTraceDocument => {
  const { sessionPath } = session;
  if (!existsSync(sessionPath) || !statSync(sessionPath).isFile()) {
    throw new TrajectoryAdapterError("missing_session", `missing_session: ${sessionPath}`);
  }
  if (!sessionPath.endsWith(".jsonl")) {
    throw new TrajectoryAdapterError("invalid_session", `invalid_session: ${sessionPath}`);
  }

  const lines = parseTranscriptLines(sessionPath);
  const header = lines.find((line) => line.type === "session");
  const messageLines = lines.filter((line) => line.type === "message" && line.message !== undefined);
  if (header === undefined && messageLines.length === 0) {
    throw new TrajectoryAdapterError("invalid_session", `invalid_session: no session records in ${sessionPath}`);
  }

  const events: HarnessTraceEvent[] = [];
  const emittedSourceIds = new Set<string>();
  const toolNamesByCallId = new Map<string, string>();
  const toolSourceIdsByCallId = new Map<string, string>();
  let hasAttestation = false;
  let hasPayload = false;

  const emit = (
    kind: string,
    name: string,
    detail: string,
    attestation?: HarnessSourceAttestation,
    payload?: HarnessEventPayload,
  ): HarnessTraceEvent => {
    if (payload !== undefined) hasPayload = true;
    const source = extractHarnessSourceAttestation(attestation);
    const event: HarnessTraceEvent = {
      kind,
      name,
      detail: redactHarnessDetail(detail),
      ...(source === undefined
        ? {}
        : {
            timestamp: source.timestamp,
            sourceEventId: source.sourceEventId,
            ...(source.parentSourceEventId === undefined
              ? {}
              : { parentSourceEventId: source.parentSourceEventId }),
          }),
      ...(payload === undefined ? {} : { payload }),
    };
    events.push(event);
    if (source !== undefined) {
      hasAttestation = true;
      emittedSourceIds.add(source.sourceEventId);
    }
    return event;
  };

  const emittedParentId = (line: Readonly<Pick<TranscriptLine, "parentId">>): string | undefined => {
    if (line.parentId === undefined || line.parentId === null) return undefined;
    const parentId = namespacedId(line.parentId);
    return emittedSourceIds.has(parentId) ? parentId : undefined;
  };

  const sessionId = header?.id ?? session.sessionId ?? basename(sessionPath, ".jsonl");
  emit(
    "session_start",
    sessionId,
    `openclaw transcript-v${header?.version ?? 0} cwd=${header?.cwd ?? "unknown"}`,
    lineAttestation(header ?? {}, lineSourceId(header ?? {}), undefined),
  );

  let turnCount = 0;
  const closeTurn = (): void => {
    if (turnCount > 0) emit("function_exit", `turn-${turnCount}`, "");
  };

  for (const line of messageLines) {
    const message = line.message;
    if (message === undefined) continue;
    if (message.role === "user") {
      if (message.runtimeContextCarrier === true) continue;
      closeTurn();
      turnCount += 1;
      emit(
        "function_enter",
        `turn-${turnCount}`,
        textFromContent(message.content),
        lineAttestation(line, lineSourceId(line), emittedParentId(line)),
      );
      continue;
    }
    if (message.role === "assistant") {
      const usage = message.usage;
      const payload: HarnessEventPayload | undefined = usage === undefined
        ? undefined
        : {
            role: "assistant",
            usage: {
              model: message.model ?? runtime,
              ...(usage.input === undefined ? {} : { inputTokens: usage.input }),
              ...(usage.output === undefined ? {} : { outputTokens: usage.output }),
              ...(usage.cacheRead === undefined ? {} : { cachedInputTokens: usage.cacheRead }),
              ...(usage.cacheWrite === undefined ? {} : { cacheWriteTokens: usage.cacheWrite }),
            },
          };
      const llmEvent = emit(
        "llm_call",
        message.model ?? runtime,
        textFromContent(message.content),
        lineAttestation(line, lineSourceId(line), emittedParentId(line)),
        payload,
      );
      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block.type !== "toolCall") continue;
          const toolName = block.name ?? "tool";
          if (block.id !== undefined) toolNamesByCallId.set(block.id, toolName);
          const toolEvent = emit(
            "tool_call",
            toolName,
            summarizeToolArguments(block.arguments),
            lineAttestation(line, composedSourceId(line, block.id), llmEvent.sourceEventId),
          );
          if (block.id !== undefined && toolEvent.sourceEventId !== undefined) {
            toolSourceIdsByCallId.set(block.id, toolEvent.sourceEventId);
          }
        }
      }
      continue;
    }
    if (message.role === "toolResult") {
      const callId = message.toolCallId ?? "";
      const toolName = message.toolName ?? toolNamesByCallId.get(callId) ?? "tool";
      emit(
        "tool_result",
        toolName,
        message.isError === true ? "error" : "ok",
        lineAttestation(line, lineSourceId(line), toolSourceIdsByCallId.get(callId)),
      );
      continue;
    }
    if (message.role === "bashExecution") {
      const bashCall = emit(
        "tool_call",
        "bash",
        message.command ?? "",
        lineAttestation(line, composedSourceId(line, "call"), emittedParentId(line)),
      );
      const failed = message.cancelled === true || (message.exitCode ?? 0) !== 0;
      emit(
        "tool_result",
        "bash",
        failed ? "error" : "ok",
        lineAttestation(line, composedSourceId(line, "result"), bashCall.sourceEventId),
      );
    }
  }
  closeTurn();

  return harnessTraceDocumentSchema.parse({
    runtime,
    status: harnessCollectedStatus,
    ...(hasAttestation || hasPayload ? { formatVersion: 2 as const } : {}),
    eventCount: events.length,
    events,
  });
};
