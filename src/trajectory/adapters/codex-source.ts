import { readFileSync } from "node:fs";
import { z } from "zod";

import {
  extractHarnessSourceAttestation,
  sanitizeHarnessPayload,
  TrajectoryAdapterError,
  type HarnessSourceAttestation,
  type HarnessTraceEvent,
} from "./contract";

const contentBlockSchema = z.object({ type: z.string(), text: z.string().optional() }).passthrough();
const usageSchema = z.object({
  input_tokens: z.number().int().nonnegative().optional(),
  cached_input_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative().optional(),
  reasoning_output_tokens: z.number().int().nonnegative().optional(),
  total_tokens: z.number().int().nonnegative().optional(),
}).passthrough();
const payloadSchema = z.object({
  type: z.string().optional(), id: z.string().min(1).optional(), session_id: z.string().min(1).optional(),
  cwd: z.string().optional(), originator: z.string().optional(), cli_version: z.string().optional(),
  model: z.string().optional(), message: z.string().optional(), role: z.string().optional(),
  content: z.array(contentBlockSchema).nullish(), name: z.string().optional(),
  arguments: z.string().optional(), input: z.string().optional(),
  call_id: z.string().optional(), output: z.string().optional(),
  info: z.object({
    last_token_usage: usageSchema.optional(), total_token_usage: usageSchema.optional(),
  }).passthrough().optional(),
}).passthrough();
const recordSchema = z.object({
  type: z.string(), timestamp: z.string().optional(), payload: payloadSchema.optional(),
}).passthrough();

export type CodexRecord = z.infer<typeof recordSchema> & Readonly<{ sourceLine: number }>;
export type CodexTokenUsage = z.infer<typeof usageSchema>;
type SourceFailure = "invalid_utf8" | "malformed_jsonl" | "invalid_record" | "unsupported_record"
  | "unsupported_user_content" | "missing_user_text" | "user_text_truncated" | "user_text_not_preserved";

export class CodexSourceError extends TrajectoryAdapterError {
  readonly reason: SourceFailure;
  readonly sourceLine: number | undefined;

  constructor(reason: SourceFailure, sourceLine?: number) {
    super(
      "invalid_session",
      `invalid_session: codex_${reason}${sourceLine === undefined ? "" : ` at line ${sourceLine}`}. `
      + "Keep the original Codex JSONL; update the collector and recollect.",
    );
    this.reason = reason;
    this.sourceLine = sourceLine;
  }
}

const fail = (reason: SourceFailure, line?: number): never => {
  throw new CodexSourceError(reason, line);
};

const recordTypes = new Set(["session_meta", "turn_context", "response_item", "event_msg", "compacted"]);
const responseTypes = new Set([
  "message", "reasoning", "function_call", "function_call_output", "custom_tool_call", "custom_tool_call_output",
]);
// These are non-user metadata or mirrors of response items, not alternative user input.
const eventTypes = new Set([
  "user_message", "token_count", "agent_message", "agent_reasoning",
  "task_started", "task_complete", "turn_aborted", "context_compacted",
  "item_started", "item_completed", "warning", "error", "thread_rolled_back",
]);

export const readCodexRecords = (path: string): readonly CodexRecord[] => {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
  } catch (error) {
    if (error instanceof TypeError) return fail("invalid_utf8");
    throw error;
  }
  const records: CodexRecord[] = [];
  for (const [index, line] of source.split("\n").entries()) {
    if (line.trim() === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      if (error instanceof SyntaxError) return fail("malformed_jsonl", index + 1);
      throw error;
    }
    const parsed = recordSchema.safeParse(value);
    if (!parsed.success) return fail("invalid_record", index + 1);
    const record = parsed.data;
    if (!recordTypes.has(record.type)) return fail("unsupported_record", index + 1);
    if (record.type === "response_item" && !responseTypes.has(record.payload?.type ?? "")) {
      return fail("unsupported_record", index + 1);
    }
    if (record.type === "event_msg" && !eventTypes.has(record.payload?.type ?? "")) {
      return fail("unsupported_record", index + 1);
    }
    records.push({ ...record, sourceLine: index + 1 });
  }
  return records;
};

export type CodexUserMessage = Readonly<{
  rawText: string;
  text: string;
  sourceId: string;
  attestation: HarnessSourceAttestation | undefined;
}>;

/** Normalize source messages before conversion; pair mirrors only once, before redaction. */
export const collectCodexUserMessages = (
  records: readonly CodexRecord[],
  sessionId: string,
): ReadonlyMap<number, CodexUserMessage> => {
  const messages = new Map<number, CodexUserMessage>();
  let previous: Readonly<{ index: number; family: string; text: string }> | undefined;
  for (const [index, record] of records.entries()) {
    const payload = record.payload;
    const eventUser = record.type === "event_msg" && payload?.type === "user_message";
    const responseUser = record.type === "response_item" && payload?.type === "message" && payload.role === "user";
    if (!eventUser && !responseUser) {
      if (payload?.role === "user") return fail("unsupported_user_content", record.sourceLine);
      if (record.type === "response_item" && payload?.type === "message"
        && !["assistant", "system", "developer"].includes(payload.role ?? "")) {
        return fail("unsupported_record", record.sourceLine);
      }
      previous = undefined;
      continue;
    }
    let rawText: string;
    if (eventUser) {
      if (typeof payload?.message !== "string") return fail("missing_user_text", record.sourceLine);
      rawText = payload.message;
    } else {
      if (!payload?.content?.length) return fail("missing_user_text", record.sourceLine);
      const parts: string[] = [];
      for (const block of payload.content) {
        if (block.type !== "input_text" || typeof block.text !== "string") {
          return fail("unsupported_user_content", record.sourceLine);
        }
        parts.push(block.text);
      }
      rawText = parts.join("");
    }
    if (rawText.trim() === "") return fail("missing_user_text", record.sourceLine);
    if (previous?.index === index - 1 && previous.family !== record.type && previous.text === rawText) {
      previous = undefined;
      continue;
    }
    const sanitized = sanitizeHarnessPayload({ role: "user", content: rawText });
    if (sanitized?.truncated === true) return fail("user_text_truncated", record.sourceLine);
    if (sanitized?.role !== "user" || typeof sanitized.content !== "string" || sanitized.content.trim() === "") {
      return fail("user_text_not_preserved", record.sourceLine);
    }
    const sourceId = eventUser
      ? `codex:user_message:${sessionId}:${index}`
      : payload?.id === undefined ? `codex:message:${sessionId}:${index}` : `codex:message:${payload.id}`;
    const attestation = extractHarnessSourceAttestation({ timestamp: record.timestamp, sourceEventId: sourceId });
    if (record.timestamp !== undefined && attestation === undefined) return fail("invalid_record", record.sourceLine);
    messages.set(index, { rawText, text: sanitized.content, sourceId, attestation });
    previous = { index, family: record.type, text: rawText };
  }
  if (messages.size === 0) return fail("missing_user_text");
  return messages;
};

/** Independent output postcondition: no normalized source user message can disappear. */
export const assertCodexUserMessagesPreserved = (
  expected: ReadonlyMap<number, CodexUserMessage>,
  events: readonly HarnessTraceEvent[],
): void => {
  const actual = events.filter((event) => event.payload?.role === "user");
  if (actual.length !== expected.size) fail("user_text_not_preserved");
  [...expected.values()].forEach((message, index) => {
    const event = actual[index];
    if (event?.kind !== "function_enter" || event.payload?.content !== message.text
      || event.payload.truncated === true || event.timestamp !== message.attestation?.timestamp
      || event.sourceEventId !== message.attestation?.sourceEventId) {
      fail("user_text_not_preserved");
    }
  });
};
