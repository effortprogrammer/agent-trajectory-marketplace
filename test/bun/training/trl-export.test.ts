import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { atfTraceToTrlRecord, exportAtfToTrl } from "../../../src/training/trl-export";

const roots: string[] = [];

const temporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "trl-export-"));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const trace = {
  runtime: "senpi",
  status: "collected",
  formatVersion: 2,
  eventCount: 8,
  events: [
    { kind: "session_start", name: "session-1" },
    { kind: "function_enter", name: "turn-1", payload: { role: "user", content: "inspect the repository" } },
    { kind: "llm_call", name: "gpt-test", payload: { role: "assistant", content: "I will inspect it." } },
    { kind: "tool_call", name: "read", payload: { toolUseId: "call-1", input: { path: "README.md" } } },
    { kind: "tool_call", name: "bash", payload: { toolUseId: "call-2", input: "{\"command\":\"bun test\"}" } },
    { kind: "tool_result", name: "bash", payload: { toolUseId: "call-2", output: "2 pass", isError: false } },
    { kind: "tool_result", name: "read", payload: { toolUseId: "call-1", output: { title: "ATM" }, isError: false } },
    { kind: "llm_call", name: "gpt-test", payload: { role: "assistant", content: "The repository is healthy." } },
  ],
} as const;

describe("ATF to TRL export", () => {
  test("drops assistant and tool activity before the first user turn", () => {
    const prefixed = {
      ...trace,
      eventCount: trace.eventCount + 3,
      events: [
        { kind: "llm_call", name: "gpt-test", payload: { role: "assistant", content: "startup response" } },
        { kind: "tool_call", name: "read", payload: { toolUseId: "startup-call", input: { path: "startup.md" } } },
        { kind: "tool_result", name: "read", payload: { toolUseId: "startup-call", output: "startup" } },
        ...trace.events,
      ],
    };

    const converted = atfTraceToTrlRecord(prefixed);

    expect(converted.record.messages[0]).toEqual({
      role: "user",
      content: "inspect the repository",
    });
    expect(converted.record.messages).not.toContainEqual({
      role: "assistant",
      content: "startup response",
      tool_calls: [
        { type: "function", function: { name: "read", arguments: { path: "startup.md" } } },
      ],
    });
  });

  test("preserves conversational order, tool calls, results, and schemas", () => {
    const root = temporaryRoot();
    const inputPath = join(root, "session.atf.json");
    const outputPath = join(root, "train.jsonl");
    writeFileSync(inputPath, JSON.stringify(trace), "utf8");

    const result = exportAtfToTrl({ inputPath, outputPath });
    const record = JSON.parse(readFileSync(outputPath, "utf8"));

    expect(result).toEqual({
      exampleCount: 1,
      inputPath,
      messageCount: 5,
      outputPath,
      runtime: "senpi",
      toolCount: 2,
    });
    expect(record.messages).toEqual([
      { role: "user", content: "inspect the repository" },
      {
        role: "assistant",
        content: "I will inspect it.",
        tool_calls: [
          { type: "function", function: { name: "read", arguments: { path: "README.md" } } },
          { type: "function", function: { name: "bash", arguments: { command: "bun test" } } },
        ],
      },
      { role: "tool", name: "bash", content: "2 pass" },
      { role: "tool", name: "read", content: "{\"title\":\"ATM\"}" },
      { role: "assistant", content: "The repository is healthy." },
    ]);
    expect(record.tools).toEqual([
      {
        type: "function",
        function: {
          name: "bash",
          description: "Tool observed in the collected senpi trajectory.",
          parameters: {
            type: "object",
            properties: { command: { type: "string" } },
            required: ["command"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "read",
          description: "Tool observed in the collected senpi trajectory.",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      },
    ]);
  });

  test("rejects malformed, empty, version-one, and symlink inputs without output", () => {
    const root = temporaryRoot();
    const malformedPath = join(root, "malformed.atf.json");
    const emptyPath = join(root, "empty.atf.json");
    const versionOnePath = join(root, "v1.atf.json");
    const linkedPath = join(root, "linked.atf.json");
    writeFileSync(malformedPath, "{", "utf8");
    writeFileSync(emptyPath, JSON.stringify({ runtime: "senpi", status: "collected", formatVersion: 2, eventCount: 0, events: [] }), "utf8");
    writeFileSync(versionOnePath, JSON.stringify({ runtime: "senpi", status: "collected", formatVersion: 1, eventCount: 1, events: [{ kind: "session_start", name: "s" }] }), "utf8");
    symlinkSync(emptyPath, linkedPath);

    for (const [inputPath, error] of [
      [malformedPath, "invalid_atf"],
      [emptyPath, "empty_training_example"],
      [versionOnePath, "unsupported_atf_version"],
      [linkedPath, "unsafe_input_path"],
    ] as const) {
      const outputPath = join(root, `${error}.jsonl`);
      expect(() => exportAtfToTrl({ inputPath, outputPath })).toThrow(error);
      expect(existsSync(outputPath)).toBe(false);
    }
  });

  test("rejects an output symlink without overwriting its target", () => {
    const root = temporaryRoot();
    const inputPath = join(root, "session.atf.json");
    const targetPath = join(root, "target.jsonl");
    const outputPath = join(root, "linked.jsonl");
    writeFileSync(inputPath, JSON.stringify(trace), "utf8");
    writeFileSync(targetPath, "preserve", "utf8");
    symlinkSync(targetPath, outputPath);

    expect(() => exportAtfToTrl({ inputPath, outputPath })).toThrow("unsafe_output_path");
    expect(readFileSync(targetPath, "utf8")).toBe("preserve");
  });
});
