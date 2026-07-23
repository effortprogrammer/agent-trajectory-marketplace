import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { openclawAdapter } from "../../../../src/trajectory/adapters/openclaw";

const sessionId = "b7c9d1e3-1111-2222-3333-444455556666";
const temporaryRoots: string[] = [];

const writeSession = (lines: readonly unknown[]): Readonly<{
  readonly sourceDir: string;
  readonly sessionPath: string;
}> => {
  const sourceDir = mkdtempSync(join(tmpdir(), "openclaw-adapter-"));
  temporaryRoots.push(sourceDir);
  const sessionsDir = join(sourceDir, "agents", "main", "sessions");
  mkdirSync(sessionsDir, { recursive: true });
  const sessionPath = join(sessionsDir, `${sessionId}.jsonl`);
  writeFileSync(sessionPath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
  return { sourceDir, sessionPath };
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("converts the native OpenClaw envelope and message semantics", () => {
  const { sessionPath } = writeSession([
    {
      type: "session",
      version: 3,
      id: sessionId,
      timestamp: "2026-07-07T00:00:00.000Z",
      cwd: "/tmp/project",
    },
    {
      type: "message",
      id: "m1",
      timestamp: "2026-07-07T00:00:01.000Z",
      parentId: null,
      message: { role: "user", content: "Ship the feature" },
    },
    {
      type: "message",
      id: "m2",
      timestamp: "2026-07-07T00:00:02.000Z",
      parentId: "m1",
      message: {
        role: "assistant",
        model: "claude-opus-4-8",
        content: [
          { type: "thinking", thinking: "private plan" },
          { type: "text", text: "Shipping now" },
          { type: "toolCall", id: "tc1", name: "exec", arguments: { command: "bun test" } },
        ],
        usage: { input: 1660, output: 55, cacheRead: 12, cacheWrite: 4 },
      },
    },
    {
      type: "message",
      id: "m3",
      timestamp: "2026-07-07T00:00:03.000Z",
      parentId: "m2",
      message: {
        role: "toolResult",
        toolCallId: "tc1",
        toolName: "exec",
        content: [{ type: "text", text: "tests passed" }],
        isError: false,
      },
    },
  ]);

  const trace = openclawAdapter.convertSession({ sessionPath });

  expect(trace.events.map((event) => `${event.kind}:${event.name}`)).toEqual([
    `session_start:${sessionId}`,
    "function_enter:turn-1",
    "llm_call:claude-opus-4-8",
    "tool_call:exec",
    "tool_result:exec",
    "function_exit:turn-1",
  ]);
  expect(trace.events[0]).toMatchObject({
    timestamp: "2026-07-07T00:00:00.000Z",
    sourceEventId: `openclaw:${sessionId}`,
  });
  expect(trace.events[3]).toMatchObject({
    detail: "bun test",
    sourceEventId: "openclaw:m2:tc1",
    parentSourceEventId: "openclaw:m2",
  });
  expect(trace.events[4]).toMatchObject({
    detail: "ok",
    sourceEventId: "openclaw:m3",
    parentSourceEventId: "openclaw:m2:tc1",
  });
  expect(trace.events[2]?.payload?.usage).toEqual({
    model: "claude-opus-4-8",
    inputTokens: 1660,
    outputTokens: 55,
    cachedInputTokens: 12,
    cacheWriteTokens: 4,
  });
  expect(JSON.stringify(trace)).not.toContain("private plan");
});

describe("OpenClaw native source discovery", () => {
  test("discovers nested transcript files and excludes trajectory companions", () => {
    const { sourceDir, sessionPath } = writeSession([]);
    writeFileSync(`${sessionPath.replace(".jsonl", ".trajectory.jsonl")}`, "{}\n", "utf8");

    const sessions = openclawAdapter.listSessions(sourceDir);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId,
      sessionPath,
      projectDir: join("agents", "main", "sessions"),
    });
    expect(openclawAdapter.defaultSourceDir()).toBe(join(homedir(), ".openclaw"));
  });

  test("rejects a missing source directory instead of falling back to generic files", () => {
    expect(() => openclawAdapter.listSessions(join(tmpdir(), "openclaw-directory-does-not-exist"))).toThrow(
      "missing_source_dir",
    );
  });
});

test("skips malformed lines but rejects empty or non-native transcripts", () => {
  const { sessionPath } = writeSession([
    {
      type: "session",
      version: 3,
      id: sessionId,
      timestamp: "2026-07-07T00:00:00.000Z",
    },
    { type: "message", id: "m1", message: { role: "user", content: "hello" } },
  ]);
  writeFileSync(
    sessionPath,
    `${JSON.stringify({ type: "session", version: 3, id: sessionId })}\nnot-json\n${JSON.stringify({ type: "message", id: "m1", message: { role: "user", content: "hello" } })}\n`,
    "utf8",
  );
  expect(openclawAdapter.convertSession({ sessionPath }).events).toHaveLength(3);

  const emptyPath = join(dirname(sessionPath), "empty.jsonl");
  writeFileSync(emptyPath, "\nnot-json\n", "utf8");
  expect(() => openclawAdapter.convertSession({ sessionPath: emptyPath })).toThrow("invalid_session");

  const genericPath = join(dirname(sessionPath), "generic.jsonl");
  writeFileSync(genericPath, `${JSON.stringify({ kind: "function_enter", name: "x", detail: "y" })}\n`, "utf8");
  expect(() => openclawAdapter.convertSession({ sessionPath: genericPath })).toThrow("invalid_session");
});

test("converts bash execution into paired tool events and omits secrets", () => {
  const { sessionPath } = writeSession([
    {
      type: "session",
      version: 3,
      id: sessionId,
      timestamp: "2026-07-07T00:00:00.000Z",
    },
    {
      type: "message",
      id: "m1",
      timestamp: "2026-07-07T00:00:01.000Z",
      message: { role: "user", content: "use api_key=sk-abcdefghijklmnop" },
    },
    {
      type: "message",
      id: "m2",
      parentId: "m1",
      timestamp: "2026-07-07T00:00:02.000Z",
      message: {
        role: "bashExecution",
        command: "printf 'Authorization: Bearer abcdefghijklmnop'",
        exitCode: 1,
      },
    },
  ]);

  const trace = openclawAdapter.convertSession({ sessionPath });

  expect(trace.events.map((event) => `${event.kind}:${event.name}`)).toEqual([
    `session_start:${sessionId}`,
    "function_enter:turn-1",
    "tool_call:bash",
    "tool_result:bash",
    "function_exit:turn-1",
  ]);
  expect(trace.events[2]).toMatchObject({
    detail: "[redacted]",
    sourceEventId: "openclaw:m2:call",
    parentSourceEventId: "openclaw:m1",
  });
  expect(trace.events[3]).toMatchObject({
    detail: "error",
    sourceEventId: "openclaw:m2:result",
    parentSourceEventId: "openclaw:m2:call",
  });
  expect(JSON.stringify(trace)).not.toContain("sk-abcdefghijklmnop");
});
