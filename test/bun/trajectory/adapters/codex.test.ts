import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { codexAdapter } from "../../../../src/trajectory/adapters/codex";

const writeRollout = (directory: string, name: string, records: readonly unknown[]): string => {
  const path = join(directory, name);
  writeFileSync(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
  return path;
};

describe("native Codex rollout adapter", () => {
  test("converts native rollout records with usage, tool pairing, attestation, and redaction", () => {
    const root = mkdtempSync(join(tmpdir(), "atm-codex-"));
    const records = [
      {
        type: "session_meta",
        timestamp: "2026-07-23T01:00:00.000Z",
        payload: { id: "native-1", cwd: "/tmp/project", originator: "codex_cli", cli_version: "1.2.3" },
      },
      { type: "turn_context", payload: { model: "gpt-5.4" } },
      {
        type: "event_msg",
        timestamp: "2026-07-23T01:00:01.000Z",
        payload: { type: "user_message", message: "Fix auth" },
      },
      {
        type: "response_item",
        timestamp: "2026-07-23T01:00:02.000Z",
        payload: { type: "message", id: "msg-1", role: "assistant", content: [{ type: "output_text", text: "On it" }] },
      },
      {
        type: "response_item",
        timestamp: "2026-07-23T01:00:03.000Z",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call-1",
          arguments: JSON.stringify({ cmd: "rg auth src", token: "sk-abcdefghijklmnopqrstuvwxyz" }),
        },
      },
      {
        type: "response_item",
        timestamp: "2026-07-23T01:00:04.000Z",
        payload: { type: "function_call_output", call_id: "call-1", output: "Process exited with code 0" },
      },
      {
        type: "event_msg",
        timestamp: "2026-07-23T01:00:05.000Z",
        payload: {
          type: "token_count",
          info: { last_token_usage: { input_tokens: 12, cached_input_tokens: 4, output_tokens: 7, reasoning_output_tokens: 2 } },
        },
      },
    ] as const;
    const sessionPath = writeRollout(root, "rollout-native-1.jsonl", records);

    const trace = codexAdapter.convertSession({ sessionPath });

    expect(trace.runtime).toBe("codex");
    expect(trace.events.map((event) => event.kind)).toEqual([
      "session_start",
      "function_enter",
      "llm_call",
      "tool_call",
      "tool_result",
      "function_exit",
    ]);
    expect(trace.events[0]).toMatchObject({
      name: "native-1",
      detail: "codex 1.2.3 cwd=/tmp/project originator=codex_cli",
      timestamp: "2026-07-23T01:00:00.000Z",
      sourceEventId: "codex:session:native-1",
    });
    expect(trace.events[2]?.payload?.usage).toEqual({
      model: "gpt-5.4",
      inputTokens: 8,
      cachedInputTokens: 4,
      outputTokens: 7,
      reasoningOutputTokens: 2,
    });
    expect(trace.events[3]).toMatchObject({ name: "exec_command", detail: "rg auth src", sourceEventId: "codex:function_call:call-1" });
    expect(trace.events[4]).toMatchObject({
      name: "exec_command",
      detail: "ok",
      parentSourceEventId: "codex:function_call:call-1",
    });
    expect(JSON.stringify(trace)).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
  });

  test("discovers dated sessions and archived sibling newest first", () => {
    const root = mkdtempSync(join(tmpdir(), "atm-codex-discovery-"));
    const sessions = join(root, "sessions");
    const archived = join(root, "archived_sessions");
    const dated = join(sessions, "2026", "07", "23");
    mkdirSync(dated, { recursive: true });
    mkdirSync(archived, { recursive: true });
    const livePath = writeRollout(dated, "rollout-live.jsonl", [{ type: "session_meta", payload: { id: "live" } }]);
    const archivedPath = writeRollout(archived, "rollout-archived.jsonl", [{ type: "session_meta", payload: { id: "archived" } }]);
    utimesSync(livePath, new Date("2026-07-23T02:00:00.000Z"), new Date("2026-07-23T02:00:00.000Z"));
    utimesSync(archivedPath, new Date("2026-07-23T03:00:00.000Z"), new Date("2026-07-23T03:00:00.000Z"));
    writeFileSync(join(sessions, "ignore.jsonl"), "{}\n", "utf8");

    const refs = codexAdapter.listSessions(sessions);

    expect(refs.map((ref) => ref.sessionId)).toEqual(["rollout-archived", "rollout-live"]);
    expect(refs[0]?.projectDir).toBeUndefined();
    expect(refs[1]?.projectDir).toBe(join("2026", "07", "23"));
  });

  test("skips malformed JSONL records and redacts malformed function arguments", () => {
    const root = mkdtempSync(join(tmpdir(), "atm-codex-malformed-"));
    const path = join(root, "rollout-malformed.jsonl");
    const lines = [
      JSON.stringify({ type: "session_meta", payload: { id: "malformed" } }),
      "not-json",
      JSON.stringify({ type: "turn_context", payload: { model: "gpt-5.4" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "go" } }),
      JSON.stringify({ type: "response_item", payload: { type: "function_call", name: "exec_command", call_id: "bad", arguments: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz" } }),
      JSON.stringify({ type: "response_item", payload: { type: "function_call_output", call_id: "bad", output: "Process exited with code 1" } }),
      JSON.stringify({ type: "unexpected", payload: { type: 42 } }),
    ];
    writeFileSync(path, `${lines.join("\n")}\n`, "utf8");

    const trace = codexAdapter.convertSession({ sessionPath: path });

    expect(trace.events.map((event) => event.kind)).toEqual([
      "session_start",
      "function_enter",
      "tool_call",
      "tool_result",
      "function_exit",
    ]);
    expect(trace.events[2]?.detail).toBe("[redacted]");
    expect(trace.events[3]?.detail).toBe("error");
    expect(JSON.stringify(trace)).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(() => codexAdapter.convertSession({ sessionPath: join(root, "not-a-rollout.json") })).toThrow("missing_session");
    const genericPath = join(root, "generic.jsonl");
    writeFileSync(genericPath, `${JSON.stringify({ kind: "tool_call", name: "exec", detail: "ok" })}\n`, "utf8");
    expect(() => codexAdapter.convertSession({ sessionPath: genericPath })).toThrow("no session_meta");
  });
});
