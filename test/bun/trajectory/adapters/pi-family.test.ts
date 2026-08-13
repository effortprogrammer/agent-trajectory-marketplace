import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TrajectoryAdapterError } from "../../../../src/trajectory/adapters/contract";
import {
  gajaeCodeAdapter,
  ohMyPiAdapter,
  piAdapter,
  piFamilySessionsDir,
  piFamilyVariants,
  senpiAdapter,
} from "../../../../src/trajectory/adapters/pi-family";

const temporaryRoots: string[] = [];

const createRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "pi-family-adapter-"));
  temporaryRoots.push(root);
  return root;
};

const writeSessionFile = (dir: string, fileName: string, records: readonly unknown[]): string => {
  mkdirSync(dir, { recursive: true });
  const sessionPath = join(dir, fileName);
  writeFileSync(
    sessionPath,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );
  return sessionPath;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const header = (overrides: Record<string, unknown> = {}) => ({
  type: "session",
  version: 3,
  id: "sess0001",
  timestamp: "2026-07-20T10:00:00.000Z",
  cwd: "/work/demo",
  ...overrides,
});

const userEntry = (id: string, parentId: string | null, text: string) => ({
  type: "message",
  id,
  parentId,
  timestamp: "2026-07-20T10:00:01.000Z",
  message: { role: "user", content: text },
});

const assistantEntry = (id: string, parentId: string) => ({
  type: "message",
  id,
  parentId,
  timestamp: "2026-07-20T10:00:05.000Z",
  message: {
    role: "assistant",
    provider: "anthropic",
    model: "claude-sonnet-5",
    content: [
      { type: "thinking", thinking: "private reasoning" },
      { type: "text", text: "Running the build." },
      { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "bun test" } },
    ],
    usage: { input: 120, output: 40, cacheRead: 30, cacheWrite: 10 },
    stopReason: "toolUse",
  },
});

const toolResultEntry = (id: string, parentId: string) => ({
  type: "message",
  id,
  parentId,
  timestamp: "2026-07-20T10:00:06.000Z",
  message: {
    role: "toolResult",
    toolCallId: "call-1",
    toolName: "bash",
    content: [{ type: "text", text: "0 fail, 12 pass" }],
    isError: false,
  },
});

const baseRecords = [
  header(),
  userEntry("e1", null, "run the tests"),
  assistantEntry("e2", "e1"),
  toolResultEntry("e3", "e2"),
];

describe("pi-family adapters", () => {
  test("registers upstream Pi and three fork runtimes with native source dirs", () => {
    expect(piAdapter.runtime).toBe("pi");
    expect(ohMyPiAdapter.runtime).toBe("oh-my-pi");
    expect(senpiAdapter.runtime).toBe("senpi");
    expect(gajaeCodeAdapter.runtime).toBe("gajae-code");
    const dirs = piFamilyVariants.map((variant) => piFamilySessionsDir(variant, "/home/seller"));
    expect(dirs).toEqual([
      "/home/seller/.pi/agent/sessions",
      "/home/seller/.omp/agent/sessions",
      "/home/seller/.senpi/agent/sessions",
      "/home/seller/.gjc/agent/sessions",
    ]);
  });

  test("converts an upstream Pi session under the pi runtime namespace", () => {
    const root = createRoot();
    const sessionPath = writeSessionFile(
      join(root, ".pi", "agent", "sessions", "--work-demo--"),
      "2026-07-20_sess0001.jsonl",
      baseRecords,
    );
    const trace = piAdapter.convertSession({ sessionPath });

    expect(trace.runtime).toBe("pi");
    expect(trace.events[0]?.sourceEventId).toBe("pi:session:sess0001");
    expect(trace.events[1]?.sourceEventId).toBe("pi:entry:e1");
    expect(trace.events[3]?.sourceEventId).toBe("pi:tool:call-1");
  });

  test("converts an oh-my-pi session with turn, llm_call, tool linkage, and usage", () => {
    const root = createRoot();
    const sessionPath = writeSessionFile(
      join(root, ".omp", "agent", "sessions", "-work-demo"),
      "2026-07-20_sess0001.jsonl",
      baseRecords,
    );
    const trace = ohMyPiAdapter.convertSession({ sessionPath });

    expect(trace.runtime).toBe("oh-my-pi");
    expect(trace.formatVersion).toBe(2);
    expect(trace.events.map((event) => event.kind)).toEqual([
      "session_start",
      "function_enter",
      "llm_call",
      "tool_call",
      "tool_result",
      "function_exit",
    ]);

    expect(trace.events[0]?.sourceEventId).toBe("oh-my-pi:session:sess0001");

    const turn = trace.events[1];
    expect(turn?.sourceEventId).toBe("oh-my-pi:entry:e1");
    expect(turn?.payload?.content).toBe("run the tests");

    const llmCall = trace.events[2];
    expect(llmCall?.name).toBe("claude-sonnet-5");
    expect(llmCall?.sourceEventId).toBe("oh-my-pi:entry:e2");
    // Thinking blocks stay private; only visible text is exported.
    expect(llmCall?.payload?.content).toBe("Running the build.");
    expect(llmCall?.payload?.usage).toEqual({
      model: "claude-sonnet-5",
      inputTokens: 120,
      outputTokens: 40,
      cachedInputTokens: 30,
      cacheWriteTokens: 10,
    });

    const toolCall = trace.events[3];
    expect(toolCall?.sourceEventId).toBe("oh-my-pi:tool:call-1");
    expect(toolCall?.parentSourceEventId).toBe("oh-my-pi:entry:e2");
    expect(toolCall?.payload?.input).toEqual({ command: "bun test" });

    const toolResult = trace.events[4];
    expect(toolResult?.sourceEventId).toBe("oh-my-pi:result:call-1");
    expect(toolResult?.parentSourceEventId).toBe("oh-my-pi:tool:call-1");
    expect(toolResult?.payload?.output).toBe("0 fail, 12 pass");
  });

  test("converts a senpi session under the senpi runtime namespace", () => {
    const root = createRoot();
    const sessionPath = writeSessionFile(
      join(root, ".senpi", "agent", "sessions", "--work-demo--"),
      "2026-07-20_sess0001.jsonl",
      baseRecords,
    );
    const trace = senpiAdapter.convertSession({ sessionPath });
    expect(trace.runtime).toBe("senpi");
    expect(trace.events[0]?.sourceEventId).toBe("senpi:session:sess0001");
  });

  test("replays gajae-code v5 entry_patch records and skips v5-only entries", () => {
    const root = createRoot();
    const sessionPath = writeSessionFile(
      join(
        root,
        ".gjc",
        "agent",
        "sessions",
        "v2-abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrst",
      ),
      "2026-07-20_sess0001.jsonl",
      [
        header({ version: 5 }),
        {
          type: "mcp_tool_selection",
          id: "s1",
          parentId: null,
          timestamp: "2026-07-20T10:00:00.500Z",
        },
        userEntry("e1", null, "run the tests"),
        assistantEntry("e2", "e1"),
        {
          type: "entry_patch",
          entryId: "e1",
          patch: { message: { role: "user", content: "run the tests (sanitized)" } },
        },
      ],
    );
    const trace = gajaeCodeAdapter.convertSession({ sessionPath });
    expect(trace.runtime).toBe("gajae-code");
    const turn = trace.events.find((event) => event.kind === "function_enter");
    expect(turn?.payload?.content).toBe("run the tests (sanitized)");
  });

  test("fails closed when a session fingerprints as a sibling fork", () => {
    const root = createRoot();
    const sessionPath = writeSessionFile(join(root, "exports"), "copied.jsonl", [
      header({ version: 5 }),
      userEntry("e1", null, "hello"),
      assistantEntry("e2", "e1"),
      { type: "entry_patch", entryId: "e1", patch: { message: { role: "user", content: "hi" } } },
    ]);
    expect(() => ohMyPiAdapter.convertSession({ sessionPath })).toThrow(TrajectoryAdapterError);
    expect(() => ohMyPiAdapter.convertSession({ sessionPath })).toThrow(/gajae-code/);
  });

  test("accepts a path-ambiguous v3 session under the invoked runtime", () => {
    const root = createRoot();
    const sessionPath = writeSessionFile(join(root, "exports"), "shared.jsonl", baseRecords);
    const trace = senpiAdapter.convertSession({ sessionPath });
    expect(trace.runtime).toBe("senpi");
  });

  test("rejects a session version above the invoked variant's max", () => {
    const root = createRoot();
    const sessionPath = writeSessionFile(
      join(root, ".senpi", "agent", "sessions", "--work--"),
      "too-new.jsonl",
      [header({ version: 4 }), userEntry("e1", null, "hello"), assistantEntry("e2", "e1")],
    );
    expect(() => senpiAdapter.convertSession({ sessionPath })).toThrow(/gajae-code|version/);
  });

  test("skips synthetic user injections and thinking-only assistant messages", () => {
    const root = createRoot();
    const sessionPath = writeSessionFile(
      join(root, ".omp", "agent", "sessions", "-work-demo"),
      "synthetic.jsonl",
      [
        header(),
        userEntry("e1", null, "real prompt"),
        {
          type: "message",
          id: "e2",
          parentId: "e1",
          timestamp: "2026-07-20T10:00:02.000Z",
          message: { role: "user", content: "auto-continue", synthetic: true },
        },
        {
          type: "message",
          id: "e3",
          parentId: "e2",
          timestamp: "2026-07-20T10:00:03.000Z",
          message: {
            role: "assistant",
            model: "claude-sonnet-5",
            content: [{ type: "thinking", thinking: "only thinking" }],
          },
        },
        assistantEntry("e4", "e3"),
      ],
    );
    const trace = ohMyPiAdapter.convertSession({ sessionPath });
    expect(trace.events.filter((event) => event.kind === "function_enter")).toHaveLength(1);
    expect(trace.events.filter((event) => event.kind === "llm_call")).toHaveLength(1);
  });

  test("lists sessions newest-first with the scope dir as projectDir", () => {
    const root = createRoot();
    const sessionsRoot = join(root, ".omp", "agent", "sessions");
    const oldPath = writeSessionFile(join(sessionsRoot, "-work-a"), "old.jsonl", baseRecords);
    const newPath = writeSessionFile(join(sessionsRoot, "-work-b"), "new.jsonl", baseRecords);
    const past = new Date(Date.now() - 60_000);
    utimesSync(oldPath, past, past);

    const refs = ohMyPiAdapter.listSessions(sessionsRoot);
    expect(refs.map((ref) => ref.sessionPath)).toEqual([newPath, oldPath]);
    expect(refs[0]?.projectDir).toBe("-work-b");
    expect(refs[0]?.sessionId).toBe("new");
  });

  test("rejects a file whose first record is not a session header", () => {
    const root = createRoot();
    const sessionPath = writeSessionFile(join(root, "exports"), "broken.jsonl", [
      userEntry("e1", null, "no header"),
    ]);
    expect(() => ohMyPiAdapter.convertSession({ sessionPath })).toThrow(TrajectoryAdapterError);
  });
});
