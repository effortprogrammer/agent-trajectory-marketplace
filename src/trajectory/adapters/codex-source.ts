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
// Native user-message modalities are not representable by this text-only adapter.
const eventUserModalitiesSchema = z.object({
  images: z.array(z.unknown()).nullish(),
  local_images: z.array(z.unknown()).nullish(),
  audio: z.array(z.unknown()).nullish(),
  local_audio: z.array(z.unknown()).nullish(),
  text_elements: z.array(z.unknown()).nullish(),
  attachments: z.array(z.unknown()).nullish(),
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

const recordTypes = new Set([
  "session_meta", "response_item", "inter_agent_communication", "inter_agent_communication_metadata",
  "compacted", "turn_context", "world_state", "event_msg",
]);
const responseTypes = new Set([
  "additional_tools", "message", "agent_message", "reasoning", "local_shell_call", "function_call",
  "tool_search_call", "function_call_output", "custom_tool_call", "custom_tool_call_output",
  "tool_search_output", "web_search_call", "image_generation_call", "compaction", "compaction_trigger",
  "context_compaction", "other",
]);
// These are non-user metadata or mirrors of response items, not alternative user input.
const eventTypes = new Set([
  "error", "warning", "guardian_warning", "realtime_conversation_started", "realtime_conversation_realtime",
  "realtime_conversation_closed", "realtime_conversation_sdp", "model_reroute", "model_verification",
  "turn_moderation_metadata", "safety_buffering", "context_compacted", "thread_rolled_back", "task_started",
  "thread_settings_applied", "task_complete", "token_count", "agent_message", "user_message", "agent_reasoning",
  "agent_reasoning_raw_content", "agent_reasoning_section_break", "session_configured", "environment_connected",
  "environment_disconnected", "thread_goal_updated", "mcp_startup_update", "mcp_startup_complete",
  "mcp_tool_call_begin", "mcp_tool_call_end", "web_search_begin", "web_search_end", "image_generation_begin",
  "image_generation_end", "exec_command_begin", "exec_command_output_delta", "terminal_interaction",
  "exec_command_end", "view_image_tool_call", "exec_approval_request", "request_user_input",
  "dynamic_tool_call_request", "dynamic_tool_call_response", "elicitation_request", "apply_patch_approval_request",
  "guardian_assessment", "deprecation_notice", "stream_error", "patch_apply_begin", "patch_apply_updated",
  "patch_apply_end", "turn_diff", "realtime_conversation_list_voices_response", "plan_update", "turn_aborted",
  "shutdown_complete", "entered_review_mode", "exited_review_mode", "raw_response_item", "raw_response_completed",
  "item_started", "item_completed", "hook_started", "hook_completed", "agent_message_content_delta", "plan_delta",
  "reasoning_content_delta", "reasoning_raw_content_delta", "collab_agent_spawn_begin", "collab_agent_spawn_end",
  "collab_agent_interaction_begin", "collab_agent_interaction_end", "collab_waiting_begin", "collab_waiting_end",
  "collab_close_begin", "collab_close_end", "collab_resume_begin", "collab_resume_end", "sub_agent_activity",
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
    if (record.type === "event_msg" && record.payload?.type === "user_message"
      && !eventUserModalitiesSchema.safeParse(record.payload).success) {
      return fail("invalid_record", index + 1);
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
      const modalities = eventUserModalitiesSchema.safeParse(payload);
      if (!modalities.success) return fail("invalid_record", record.sourceLine);
      const modalityValues = [
        modalities.data.images, modalities.data.local_images, modalities.data.audio, modalities.data.local_audio,
        modalities.data.text_elements, modalities.data.attachments,
      ];
      if (modalityValues.some((value) => Array.isArray(value) && value.length > 0)) {
        return fail("unsupported_user_content", record.sourceLine);
      }
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
