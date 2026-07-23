import { Database } from "bun:sqlite";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TrajectoryAdapterError } from "../../../../src/trajectory/adapters/contract";
import { opencodeAdapter, resolveOpenCodeDataDir } from "../../../../src/trajectory/adapters/opencode";

const workspaces: string[] = [];
const sessionId = "session-native";
const startMs = 1_750_000_000_000;

const createWorkspace = (): string => {
  const workspace = mkdtempSync(join(tmpdir(), "opencode-adapter-"));
  workspaces.push(workspace);
  return workspace;
};

const createStore = (name = "opencode.db"): Readonly<{ dbPath: string; sourceDir: string }> => {
  const sourceDir = createWorkspace();
  const dbPath = join(sourceDir, name);
  const sqlite = new Database(dbPath, { create: true, strict: true });
  sqlite.run("CREATE TABLE session (id TEXT PRIMARY KEY, time_created INTEGER, time_updated INTEGER)");
  sqlite.run("CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)");
  sqlite.run("CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)");
  sqlite.query("INSERT INTO session VALUES (?, ?, ?)").run(sessionId, startMs, startMs + 5_000);
  sqlite.close();
  return { dbPath, sourceDir };
};

const insertConversation = (dbPath: string): void => {
  const sqlite = new Database(dbPath, { strict: true });
  const insertMessage = sqlite.query("INSERT INTO message VALUES (?, ?, ?, ?, ?)");
  const insertPart = sqlite.query("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)");
  insertMessage.run("message-user", sessionId, startMs + 1_000, startMs + 1_000, JSON.stringify({ role: "user" }));
  insertPart.run("part-user", "message-user", sessionId, startMs + 1_000, startMs + 1_000, JSON.stringify({ type: "text", text: "Inspect auth" }));
  insertMessage.run("message-assistant", sessionId, startMs + 2_000, startMs + 5_000, JSON.stringify({
    role: "assistant",
    modelID: "claude-sonnet-4-5",
    tokens: { input: 12, output: 7, reasoning: 3, cache: { read: 5, write: 2 } },
  }));
  insertPart.run("part-text", "message-assistant", sessionId, startMs + 2_000, startMs + 2_000, JSON.stringify({ type: "text", text: "Found it" }));
  insertPart.run("part-tool", "message-assistant", sessionId, startMs + 3_000, startMs + 4_000, JSON.stringify({
    type: "tool",
    tool: "bash",
    state: { status: "completed", input: { command: "rg auth src" }, output: "src/auth.ts" },
  }));
  sqlite.close();
};

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { force: true, recursive: true });
});

describe("OpenCode native SQLite adapter", () => {
  test("resolves XDG data and discovers every OpenCode channel database", () => {
    // Given
    const sourceDir = createWorkspace();
    for (const name of ["opencode.db", "opencode-nightly.db", "notes.db", "opencode.db-wal"]) {
      writeFileSync(join(sourceDir, name), "fixture");
    }

    // When
    const xdgPath = resolveOpenCodeDataDir("/Users/example", { XDG_DATA_HOME: "/custom/data" });
    const fallbackPath = resolveOpenCodeDataDir("/Users/example", {});
    const files = readdirSync(sourceDir).filter((name) => /^opencode.*\.db$/i.test(name));

    // Then
    expect(xdgPath).toBe("/custom/data/opencode");
    expect(fallbackPath).toBe("/Users/example/.local/share/opencode");
    expect(files.sort()).toEqual(["opencode-nightly.db", "opencode.db"]);
  });

  test("lists channel sessions and converts native messages, tools, usage, and source links", () => {
    // Given
    const first = createStore();
    insertConversation(first.dbPath);
    const channelPath = join(first.sourceDir, "opencode-nightly.db");
    const channel = new Database(channelPath, { create: true, strict: true });
    channel.run("PRAGMA journal_mode=WAL");
    channel.run("PRAGMA wal_autocheckpoint=0");
    channel.run("CREATE TABLE session (id TEXT PRIMARY KEY, time_created INTEGER, time_updated INTEGER)");
    channel.run("CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)");
    channel.run("CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)");
    channel.query("INSERT INTO session VALUES (?, ?, ?)").run("session-nightly", startMs, startMs + 10_000);
    channel.close();

    // When
    const sessions = opencodeAdapter.listSessions(first.sourceDir);
    channel.close();
    const trace = opencodeAdapter.convertSession({ sessionId, sessionPath: first.dbPath });

    // Then
    expect(sessions.map(({ sessionId: id }) => id)).toEqual(["session-nightly", sessionId]);
    expect(trace.events.map(({ kind, name }) => `${kind}:${name}`)).toEqual([
      `session_start:${sessionId}`,
      "function_enter:turn-1",
      "llm_call:claude-sonnet-4-5",
      "tool_call:bash",
      "tool_result:bash",
      "function_exit:turn-1",
    ]);
    expect(trace.events[1]?.payload).toMatchObject({ role: "user", content: "Inspect auth" });
    expect(trace.events[1]).not.toHaveProperty("detail");
    expect(trace.events[2]?.payload).toMatchObject({
      role: "assistant",
      content: "Found it",
      usage: { model: "claude-sonnet-4-5", inputTokens: 12, outputTokens: 7, reasoningOutputTokens: 3, cachedInputTokens: 5, cacheWriteTokens: 2 },
    });
    expect(trace.events[3]).toMatchObject({
      sourceEventId: "opencode:part:part-tool:call",
      parentSourceEventId: "opencode:message:message-assistant",
      payload: { toolUseId: "part-tool", input: { command: "rg auth src" } },
    });
    expect(trace.events[4]).toMatchObject({
      sourceEventId: "opencode:part:part-tool:result",
      parentSourceEventId: "opencode:part:part-tool:call",
      payload: { toolUseId: "part-tool", output: "src/auth.ts", isError: false },
    });
  });

  test("ignores malformed message and part JSON without leaking reasoning", () => {
    // Given
    const store = createStore();
    const sqlite = new Database(store.dbPath, { strict: true });
    sqlite.query("INSERT INTO message VALUES (?, ?, ?, ?, ?)").run("bad-message", sessionId, startMs + 1_000, startMs + 1_000, "{");
    sqlite.query("INSERT INTO message VALUES (?, ?, ?, ?, ?)").run("assistant", sessionId, startMs + 2_000, startMs + 2_000, JSON.stringify({ role: "assistant" }));
    sqlite.query("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)").run("bad-part", "assistant", sessionId, startMs + 2_000, startMs + 2_000, "{");
    sqlite.query("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)").run("reasoning", "assistant", sessionId, startMs + 2_000, startMs + 2_000, JSON.stringify({ type: "reasoning", text: "private chain" }));
    sqlite.close();

    // When
    const trace = opencodeAdapter.convertSession({ sessionId, sessionPath: store.dbPath });

    // Then
    expect(trace.events.map(({ kind }) => kind)).toEqual(["session_start", "llm_call"]);
    expect(JSON.stringify(trace)).not.toContain("private chain");
  });

  test("does not create a missing database or mutate and retain a corrupt database", () => {
    // Given
    const workspace = createWorkspace();
    const missingPath = join(workspace, "opencode.db");
    const corruptPath = join(workspace, "opencode-corrupt.db");
    writeFileSync(corruptPath, "not sqlite");
    const before = readFileSync(corruptPath);
    const closeSpy = spyOn(Database.prototype, "close");

    // When
    const readMissing = (): unknown => opencodeAdapter.convertSession({ sessionId, sessionPath: missingPath });
    const readCorrupt = (): unknown => opencodeAdapter.listSessions(corruptPath);

    // Then
    expect(readMissing).toThrow(TrajectoryAdapterError);
    expect(existsSync(missingPath)).toBe(false);
    expect(readCorrupt).toThrow();
    expect(readFileSync(corruptPath)).toEqual(before);
    expect(readdirSync(workspace).sort()).toEqual(["opencode-corrupt.db"]);
    expect(closeSpy).toHaveBeenCalledTimes(1);
    closeSpy.mockRestore();
    rmSync(corruptPath);
    expect(existsSync(corruptPath)).toBe(false);
  });
});
