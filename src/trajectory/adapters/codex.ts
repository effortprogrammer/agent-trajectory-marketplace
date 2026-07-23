import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { z } from "zod";

import {
  extractHarnessSourceAttestation,
  harnessCollectedStatus,
  harnessTraceDocumentSchema,
  sanitizeHarnessPayload,
  type HarnessAdapter,
  type HarnessEventPayload,
  type HarnessSessionInput,
  type HarnessSessionRef,
  type HarnessTraceDocument,
  type HarnessTraceEvent,
  TrajectoryAdapterError,
} from "./contract";

const codexRuntime = "codex";
const contentBlockSchema = z.object({ type: z.string(), text: z.string().optional() }).passthrough();
const usageSchema = z.object({
  input_tokens: z.number().int().nonnegative().optional(),
  cached_input_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative().optional(),
  reasoning_output_tokens: z.number().int().nonnegative().optional(),
  total_tokens: z.number().int().nonnegative().optional(),
}).passthrough();
const payloadSchema = z.object({
  type: z.string().optional(), id: z.string().optional(), session_id: z.string().optional(),
  cwd: z.string().optional(), originator: z.string().optional(), cli_version: z.string().optional(),
  model: z.string().optional(), message: z.string().optional(), role: z.string().optional(),
  content: z.array(contentBlockSchema).optional(), name: z.string().optional(),
  arguments: z.string().optional(), call_id: z.string().optional(), output: z.string().optional(),
  info: z.object({ last_token_usage: usageSchema.optional(), total_token_usage: usageSchema.optional() }).passthrough().optional(),
}).passthrough();
const recordSchema = z.object({ type: z.string(), timestamp: z.string().optional(), payload: payloadSchema.optional() }).passthrough();
type RolloutRecord = z.infer<typeof recordSchema>;
type TokenUsage = z.infer<typeof usageSchema>;

const parseRecords = (path: string): readonly RolloutRecord[] => {
  const records: RolloutRecord[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed = recordSchema.safeParse(JSON.parse(line));
      if (parsed.success) records.push(parsed.data);
    } catch (error) {
      if (error instanceof SyntaxError) continue;
      throw error;
    }
  }
  return records;
};

const hasNonzeroExitCode = (output: string | undefined): boolean => {
  const match = output?.match(/process exited with code (\d+)/i);
  return match?.[1] !== undefined && match[1] !== "0";
};
const usageSignature = (usage: TokenUsage | undefined): string => usage === undefined ? "" : [
  usage.input_tokens ?? 0, usage.cached_input_tokens ?? 0, usage.output_tokens ?? 0,
  usage.reasoning_output_tokens ?? 0, usage.total_tokens ?? 0,
].join(":");

const convertCodexSession = (session: HarnessSessionInput): HarnessTraceDocument => {
  const path = session.sessionPath;
  if (!existsSync(path) || !statSync(path).isFile()) throw new TrajectoryAdapterError("missing_session", `missing_session: ${path}`);
  if (!path.endsWith(".jsonl")) throw new TrajectoryAdapterError("invalid_session", `invalid_session: ${path}`);
  const records = parseRecords(path);
  const metaRecord = records.find((record) => record.type === "session_meta");
  if (metaRecord === undefined) throw new TrajectoryAdapterError("invalid_session", `invalid_session: no session_meta record in ${path}`);

  const events: HarnessTraceEvent[] = [];
  let currentModel = "codex";
  let turnCount = 0;
  let lastLlmIndex: number | undefined;
  let previousUsageSignature: string | undefined;
  const functionNames = new Map<string, string>();
  const toolSourceIds = new Map<string, string>();
  let hasAttestation = false;
  let hasPayload = false;
  const emit = (kind: string, name: string, record?: RolloutRecord, sourceEventId?: string, parentSourceEventId?: string, payload?: HarnessEventPayload): void => {
    const attestation = record === undefined || sourceEventId === undefined ? undefined : extractHarnessSourceAttestation({
      timestamp: record.timestamp, sourceEventId, parentSourceEventId,
    });
    const sanitizedPayload = payload === undefined ? undefined : sanitizeHarnessPayload(payload);
    if (attestation !== undefined) hasAttestation = true;
    if (sanitizedPayload !== undefined) hasPayload = true;
    events.push({
      kind, name,
      ...(attestation === undefined ? {} : { timestamp: attestation.timestamp, sourceEventId: attestation.sourceEventId, ...(attestation.parentSourceEventId === undefined ? {} : { parentSourceEventId: attestation.parentSourceEventId }) }),
      ...(sanitizedPayload === undefined ? {} : { payload: sanitizedPayload }),
    });
  };
  const closeTurn = (): void => { if (turnCount > 0) emit("function_exit", `turn-${turnCount}`); };
  const meta = metaRecord.payload;
  const sessionId = meta?.id ?? meta?.session_id ?? basename(path, ".jsonl");
  emit("session_start", sessionId, metaRecord, `codex:session:${sessionId}`);

  records.forEach((record, index) => {
    const payload = record.payload;
    if (payload === undefined) return;
    if (record.type === "turn_context") {
      if (payload.model !== undefined && payload.model !== "") currentModel = payload.model;
      return;
    }
    if (record.type === "event_msg" && payload.type === "user_message") {
      closeTurn();
      turnCount += 1;
      emit("function_enter", `turn-${turnCount}`, record, `codex:user_message:${sessionId}:${index}`, undefined, {
        role: "user",
        content: payload.message ?? "",
      });
      return;
    }
    if (record.type === "event_msg" && payload.type === "token_count") {
      const usage = payload.info?.last_token_usage;
      const signature = usageSignature(payload.info?.total_token_usage);
      const allZero = usage !== undefined && Object.values(usage).every((value) => value === undefined || value === 0);
      if (usage === undefined || lastLlmIndex === undefined || allZero || (previousUsageSignature !== undefined && signature === previousUsageSignature)) return;
      const input = usage.input_tokens;
      const cached = usage.cached_input_tokens;
      const clamped = input === undefined || cached === undefined ? cached : Math.min(input, cached);
      const usagePayload: NonNullable<HarnessEventPayload["usage"]> = {
        model: currentModel,
        ...(input === undefined ? {} : { inputTokens: input - (clamped ?? 0) }),
        ...(clamped === undefined ? {} : { cachedInputTokens: clamped }),
        ...(usage.output_tokens === undefined ? {} : { outputTokens: usage.output_tokens }),
        ...(usage.reasoning_output_tokens === undefined ? {} : { reasoningOutputTokens: usage.reasoning_output_tokens }),
      };
      const target = events[lastLlmIndex];
      if (target === undefined) return;
      events[lastLlmIndex] = { ...target, payload: { ...(target.payload ?? {}), usage: usagePayload } };
      hasPayload = true;
      previousUsageSignature = signature;
      return;
    }
    if (record.type !== "response_item") return;
    if (payload.type === "message" && payload.role === "assistant") {
      const text = (payload.content ?? []).filter((block) => block.type === "output_text").map((block) => block.text ?? "").join(" ").trim();
      const source = payload.id === undefined ? `codex:message:${sessionId}:${index}` : `codex:message:${payload.id}`;
      emit("llm_call", currentModel, record, source, undefined, {
        role: "assistant",
        ...(text.length === 0 ? {} : { content: text }),
      });
      lastLlmIndex = events.length - 1;
      return;
    }
    if (payload.type === "function_call") {
      const name = payload.name ?? "function";
      const source = payload.call_id === undefined ? `codex:function_call:${sessionId}:${index}` : `codex:function_call:${payload.call_id}`;
      if (payload.call_id !== undefined) { functionNames.set(payload.call_id, name); toolSourceIds.set(payload.call_id, source); }
      emit("tool_call", name, record, source, undefined, {
        ...(payload.call_id === undefined ? {} : { toolUseId: payload.call_id }),
        ...(payload.arguments === undefined ? {} : { input: payload.arguments }),
      });
      return;
    }
    if (payload.type === "function_call_output") {
      const callId = payload.call_id;
      const source = callId === undefined ? `codex:function_call_output:${sessionId}:${index}` : `codex:function_call_output:${callId}`;
      emit("tool_result", functionNames.get(callId ?? "") ?? "function", record, source, callId === undefined ? undefined : toolSourceIds.get(callId), {
        ...(callId === undefined ? {} : { toolUseId: callId }),
        isError: hasNonzeroExitCode(payload.output),
        ...(payload.output === undefined ? {} : { output: payload.output }),
      });
    }
  });
  closeTurn();
  return harnessTraceDocumentSchema.parse({ runtime: codexRuntime, status: harnessCollectedStatus, ...(hasAttestation || hasPayload ? { formatVersion: 2 } : {}), eventCount: events.length, events });
};

const collectRollouts = (rootDir: string, currentDir: string, refs: HarnessSessionRef[]): void => {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    const path = join(currentDir, entry.name);
    if (entry.isDirectory()) { collectRollouts(rootDir, path, refs); continue; }
    if (!entry.isFile() || !/^rollout-.*\.jsonl$/.test(entry.name)) continue;
    const stats = statSync(path);
    const parent = relative(rootDir, dirname(path));
    refs.push({ sessionId: basename(entry.name, ".jsonl"), sessionPath: path, modifiedAt: stats.mtime.toISOString(), sizeBytes: stats.size, ...(parent === "" ? {} : { projectDir: parent }) });
  }
};

const listCodexSessions = (sourceDir: string): readonly HarnessSessionRef[] => {
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) throw new TrajectoryAdapterError("missing_source_dir", `missing_source_dir: ${sourceDir}`);
  const refs: HarnessSessionRef[] = [];
  collectRollouts(sourceDir, sourceDir, refs);
  const archived = join(dirname(sourceDir), "archived_sessions");
  if (basename(sourceDir) === "sessions" && existsSync(archived) && statSync(archived).isDirectory()) collectRollouts(archived, archived, refs);
  return refs.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt) || left.sessionId.localeCompare(right.sessionId));
};

export const codexAdapter: HarnessAdapter = {
  runtime: codexRuntime,
  displayName: "Codex CLI",
  logHint: "~/.codex/sessions/ and ~/.codex/archived_sessions/ (rollout-<timestamp>-<id>.jsonl)",
  defaultSourceDir: () => { const home = homedir(); return home === "" ? undefined : join(home, ".codex", "sessions"); },
  listSessions: listCodexSessions,
  convertSession: convertCodexSession,
};
