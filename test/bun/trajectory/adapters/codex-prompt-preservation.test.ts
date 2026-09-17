import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { codexAdapter } from "../../../../src/trajectory/adapters/codex";
import * as contract from "../../../../src/trajectory/adapters/contract";

const roots: string[] = [];
const timestamp = "2026-07-23T01:00:01.000Z";
const meta = { type: "session_meta", timestamp, payload: { id: "preserve" } };
const eventUser = (message: string) => ({
  type: "event_msg", timestamp, payload: { type: "user_message", message },
});
const responseUser = (text: string, id = "user-1") => ({
  type: "response_item", timestamp,
  payload: { type: "message", role: "user", id, content: [{ type: "input_text", text }] },
});
const assistant = {
  type: "response_item", timestamp,
  payload: { type: "message", role: "assistant", id: "assistant-1",
    content: [{ type: "output_text", text: "ASSISTANT_SENTINEL" }] },
};

const source = (records: readonly unknown[], tail = ""): string => {
  const root = mkdtempSync(join(tmpdir(), "atm-codex-preservation-"));
  roots.push(root);
  const path = join(root, "rollout-preserve.jsonl");
  writeFileSync(path, `${[meta, ...records].map((record) => JSON.stringify(record)).join("\n")}\n${tail}`);
  return path;
};
const users = (path: string) => codexAdapter.convertSession({ sessionPath: path }).events
  .filter((event) => event.payload?.role === "user");

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Codex user-message preservation", () => {
  test("preserves response-only input_text blocks exactly after redaction", () => {
    const path = source([{
      type: "response_item", timestamp,
      payload: { type: "message", role: "user", id: "user-1", content: [
        { type: "input_text", text: "PREFIX\n" },
        { type: "input_text", text: " api_key=sk-abcdefghijklmnopqrstuvwxyz SUFFIX " },
      ] },
    }, assistant]);
    const before = readFileSync(path);
    expect(users(path)).toMatchObject([{
      kind: "function_enter", timestamp, sourceEventId: "codex:message:user-1",
      payload: { role: "user", content: "PREFIX\n [redacted] SUFFIX " },
    }]);
    expect(readFileSync(path)).toEqual(before);
  });

  test("keeps the existing event-only user representation", () => {
    const path = source([eventUser("USER_SENTINEL"), assistant]);
    expect(users(path)).toMatchObject([{
      sourceEventId: "codex:user_message:preserve:1",
      payload: { content: "USER_SENTINEL" },
    }]);
  });

  test("keeps event users with empty optional native modalities", () => {
    const path = source([{
      type: "event_msg", timestamp, payload: {
        type: "user_message", message: "USER_SENTINEL", images: [], local_images: [], audio: [],
        local_audio: [], text_elements: [], attachments: [],
      },
    }, assistant]);
    expect(users(path).map((event) => event.payload?.content)).toEqual(["USER_SENTINEL"]);
  });

  for (const responseFirst of [false, true]) {
    test(`deduplicates one mirror pair while preserving first attestation (${responseFirst})`, () => {
      const first = responseFirst ? responseUser("USER_SENTINEL") : eventUser("USER_SENTINEL");
      const second = responseFirst ? eventUser("USER_SENTINEL") : responseUser("USER_SENTINEL");
      const path = source([first, second, assistant]);
      expect(users(path)).toMatchObject([{
        sourceEventId: responseFirst ? "codex:message:user-1" : "codex:user_message:preserve:1",
        payload: { content: "USER_SENTINEL" },
      }]);
    });
  }

  test("consumes each mirror pair once instead of collapsing repeated turns", () => {
    const path = source([
      responseUser("REPEAT", "first"), eventUser("REPEAT"),
      responseUser("REPEAT", "second"), eventUser("REPEAT"), assistant,
    ]);
    expect(users(path).map((event) => event.sourceEventId)).toEqual([
      "codex:message:first", "codex:message:second",
    ]);
  });

  test("retains consecutive same-family equal requests", () => {
    const path = source([responseUser("REPEAT", "first"), responseUser("REPEAT", "second")]);
    expect(users(path).map((event) => event.payload?.content)).toEqual(["REPEAT", "REPEAT"]);
  });

  test("does not merge equal user requests across assistant activity", () => {
    const path = source([eventUser("REPEAT"), assistant, responseUser("REPEAT")]);
    expect(users(path).map((event) => event.payload?.content)).toEqual(["REPEAT", "REPEAT"]);
  });

  test("accepts the exact UTF-8 payload byte boundary without truncation", () => {
    const text = String.fromCodePoint(0x1f4a1).repeat(4096);
    const path = source([eventUser(text)]);
    expect(users(path)).toHaveLength(1);
    expect(users(path)[0]?.payload?.content).toBe(text);
    expect(users(path)[0]?.payload?.truncated).not.toBe(true);
  });

  test("does not deduplicate distinct raw messages that redact to the same text", () => {
    const path = source([
      eventUser("token=first-synthetic-value"),
      responseUser("token=second-synthetic-value"),
    ]);
    expect(users(path).map((event) => event.payload?.content)).toEqual(["[redacted]", "[redacted]"]);
  });

  test("keeps supported custom tool calls and results alongside user messages", () => {
    const path = source([eventUser("USER_SENTINEL"), {
      type: "response_item", timestamp, payload: {
        type: "custom_tool_call", call_id: "custom-1", name: "apply_patch",
        input: "PATCH_SENTINEL",
      },
    }, {
      type: "response_item", timestamp, payload: {
        type: "custom_tool_call_output", call_id: "custom-1", output: "PATCH_RESULT",
      },
    }, assistant]);
    const tools = codexAdapter.convertSession({ sessionPath: path }).events
      .filter((event) => event.kind === "tool_call" || event.kind === "tool_result");
    expect(tools).toMatchObject([
      { kind: "tool_call", payload: { toolUseId: "custom-1", input: "PATCH_SENTINEL" } },
      { kind: "tool_result", payload: { toolUseId: "custom-1", output: "PATCH_RESULT" } },
    ]);
    expect(tools[1]?.parentSourceEventId).toBe(tools[0]?.sourceEventId);
  });

  test("does not reject valid non-user reasoning metadata with null content", () => {
    const path = source([eventUser("USER_SENTINEL"), {
      type: "response_item", timestamp, payload: {
        type: "reasoning", content: null, summary: [],
      },
    }, assistant]);
    expect(users(path).map((event) => event.payload?.content)).toEqual(["USER_SENTINEL"]);
  });

  test("skips known current native non-user rollout records", () => {
    const path = source([eventUser("USER_SENTINEL"),
      { type: "world_state", payload: { version: 1, sections: [] } },
      { type: "inter_agent_communication", payload: { sender: "agent-1", recipient: "agent-2" } },
      { type: "inter_agent_communication_metadata", payload: { sender: "agent-1", recipient: "agent-2" } },
      { type: "response_item", payload: { type: "web_search_call", id: "web-1", status: "completed", action: { type: "search", query: "native schema" } } },
      { type: "response_item", payload: { type: "tool_search_call", call_id: "search-1", status: "completed", execution: "local" } },
      { type: "response_item", payload: { type: "tool_search_output", call_id: "search-1", output: "result" } },
      { type: "response_item", payload: { type: "image_generation_call", id: "image-1", status: "completed", revised_prompt: "diagram" } },
      { type: "response_item", payload: { type: "agent_message", id: "agent-1", content: [] } },
      { type: "response_item", payload: { type: "local_shell_call", call_id: "shell-1", status: "completed", action: { type: "exec", command: "true" } } },
      { type: "response_item", payload: { type: "additional_tools", tools: [] } },
      { type: "response_item", payload: { type: "compaction" } },
      { type: "response_item", payload: { type: "compaction_trigger" } },
      { type: "response_item", payload: { type: "context_compaction" } },
      { type: "response_item", payload: { type: "other" } },
      assistant,
    ]);
    expect(users(path).map((event) => event.payload?.content)).toEqual(["USER_SENTINEL"]);
  });
});

describe("Codex fails closed rather than exporting lost user input", () => {
  test("rejects a context-less session rather than labelling it collected", () => {
    const path = source([assistant]);
    expect(() => users(path)).toThrow("invalid_session");
  });

  const invalidRecords = [
    { label: "missing event text", record: { type: "event_msg", payload: { type: "user_message" } } },
    { label: "empty event text", record: eventUser("") },
    { label: "blank event text", record: eventUser(" \n\t ") },
    { label: "event user images", record: { type: "event_msg", payload: {
      type: "user_message", message: "USER_SENTINEL", images: [{ image_url: "synthetic" }],
    } } },
    { label: "event user local images", record: { type: "event_msg", payload: {
      type: "user_message", message: "USER_SENTINEL", local_images: ["/tmp/synthetic.png"],
    } } },
    { label: "event user audio", record: { type: "event_msg", payload: {
      type: "user_message", message: "USER_SENTINEL", audio: [{ audio_url: "synthetic" }],
    } } },
    { label: "event user text elements", record: { type: "event_msg", payload: {
      type: "user_message", message: "USER_SENTINEL", text_elements: [{ text: "synthetic" }],
    } } },
    { label: "event user attachments", record: { type: "event_msg", payload: {
      type: "user_message", message: "USER_SENTINEL", attachments: ["/tmp/synthetic.txt"],
    } } },
    { label: "missing block text", record: { type: "response_item", payload: {
      type: "message", role: "user", content: [{ type: "input_text" }],
    } } },
    { label: "unsupported user image", record: { type: "response_item", payload: {
      type: "message", role: "user", content: [
        { type: "input_text", text: "USER_SENTINEL" }, { type: "input_image", image_url: "synthetic" },
      ],
    } } },
    { label: "unknown user record", record: { type: "future_record", payload: {
      role: "user", content: [{ type: "input_text", text: "USER_SENTINEL" }],
    } } },
    { label: "unknown response item", record: { type: "response_item", payload: {
      type: "future_message", role: "user", content: [{ type: "input_text", text: "USER_SENTINEL" }],
    } } },
    { label: "unknown event message", record: { type: "event_msg", payload: {
      type: "future_message", message: "USER_SENTINEL",
    } } },
    { label: "invalid record schema", record: { type: "event_msg", payload: { type: 42 } } },
    { label: "oversized user text", record: eventUser("X".repeat(16 * 1024 + 1)) },
  ];
  for (const { label, record } of invalidRecords) {
    test(`rejects ${label} without changing source bytes`, () => {
      const path = source([eventUser("VALID_PREFIX"), record, assistant]);
      const before = readFileSync(path);
      expect(() => users(path)).toThrow("invalid_session");
      expect(readFileSync(path)).toEqual(before);
    });
  }

  test("does not silently skip a malformed JSONL line", () => {
    const path = source([eventUser("VALID_PREFIX"), assistant], '{"type":"event_msg",');
    const before = readFileSync(path);
    expect(() => users(path)).toThrow("invalid_session");
    expect(readFileSync(path)).toEqual(before);
  });

  test("does not silently replace malformed UTF-8 inside a prompt", () => {
    const path = source([eventUser("UTF8_SENTINEL")]);
    const bytes = readFileSync(path);
    const offset = bytes.indexOf("UTF8_SENTINEL");
    expect(offset).toBeGreaterThan(0);
    bytes[offset] = 0xff;
    writeFileSync(path, bytes);
    expect(() => users(path)).toThrow("invalid_session");
    expect(readFileSync(path)).toEqual(bytes);
  });

  test("rejects source user text if payload sanitization drops the user event", () => {
    const path = source([eventUser("USER_SENTINEL"), assistant]);
    const original = contract.sanitizeHarnessPayload;
    const sanitizer = spyOn(contract, "sanitizeHarnessPayload").mockImplementation(
      (payload) => payload.role === "user" ? undefined : original(payload),
    );
    try {
      expect(() => users(path)).toThrow("invalid_session");
    } finally {
      sanitizer.mockRestore();
    }
  });
});
