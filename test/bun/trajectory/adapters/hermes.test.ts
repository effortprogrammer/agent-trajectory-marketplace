import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { hermesAdapter } from "../../../../src/trajectory/adapters/hermes";

const fixtureRoots: string[] = [];
const sessionId = "20260723_120000_native";

const createFixtureRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "atm-hermes-native-"));
  fixtureRoots.push(root);
  return root;
};

const createHermesDatabase = (options: Readonly<{ usageColumns?: boolean }> = {}): Readonly<{
  dbPath: string;
  sourceDir: string;
}> => {
  const sourceDir = join(createFixtureRoot(), "hermes-home");
  mkdirSync(sourceDir, { recursive: true });
  const dbPath = join(sourceDir, "state.db");
  const sqlite = new Database(dbPath, { create: true, strict: true });
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec(`CREATE TABLE sessions (
    id TEXT PRIMARY KEY, model TEXT, cwd TEXT, started_at REAL, ended_at REAL
    ${options.usageColumns === false ? "" : ", input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, reasoning_tokens INTEGER"}
  )`);
  sqlite.exec(`CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL,
    content TEXT, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL,
    active INTEGER NOT NULL DEFAULT 1
  )`);
  if (options.usageColumns === false) {
    sqlite.query("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)").run(
      sessionId,
      null,
      null,
      1_800_000_000,
      null,
    );
  } else {
    sqlite.query("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      sessionId,
      "hermes-4-405b",
      "/work/native",
      1_800_000_000,
      null,
      120,
      34,
      55,
      8,
      13,
    );
  }
  sqlite.query("INSERT INTO sessions (id, model, cwd, started_at, ended_at) VALUES (?, ?, ?, ?, ?)").run(
    "20260101_000000_old",
    "old-model",
    "/work/old",
    1_700_000_000,
    1_700_000_010,
  );
  const insert = sqlite.query(
    `INSERT INTO messages
      (session_id, role, content, tool_call_id, tool_calls, tool_name, timestamp, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insert.run(sessionId, "system", "private system prompt", null, null, null, 1_800_000_001, 1);
  insert.run(sessionId, "user", "inspect workspace", null, null, null, 1_800_000_002, 1);
  insert.run(
    sessionId,
    "assistant",
    "working",
    null,
    JSON.stringify([
      { id: "call-native-1", function: { name: "terminal", arguments: '{"command":"bun test"}' } },
    ]),
    null,
    1_800_000_003,
    1,
  );
  insert.run(
    sessionId,
    "tool",
    "tests passed",
    "call-native-1",
    null,
    "terminal",
    1_800_000_004,
    1,
  );
  insert.run(
    sessionId,
    "assistant",
    `\x00json:${JSON.stringify([{ type: "text", text: "complete" }])}`,
    null,
    null,
    null,
    1_800_000_005,
    1,
  );
  insert.run(sessionId, "assistant", "rewound", null, null, null, 1_800_000_006, 0);
  sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  sqlite.close();
  return { dbPath, sourceDir };
};

const sha256 = (path: string): string =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("Hermes native SQLite adapter", () => {
  test("defaults discovery to the native Hermes home", () => {
    // Given: the process home used by Hermes for its native state store.
    const expectedSource = join(homedir(), ".hermes");

    // When: the adapter resolves its default source.
    const sourceDir = hermesAdapter.defaultSourceDir();

    // Then: discovery targets the directory containing Hermes state.db.
    expect(sourceDir).toBe(expectedSource);
  });

  test("lists shared-store sessions newest first", () => {
    // Given: a native state.db with sessions whose message and session timestamps differ.
    const { dbPath, sourceDir } = createHermesDatabase();

    // When: Hermes session discovery reads the source directory.
    const sessions = hermesAdapter.listSessions(sourceDir);

    // Then: native references are newest-first and point back to the shared store.
    expect(sessions.map(({ sessionId: id }) => id)).toEqual([
      sessionId,
      "20260101_000000_old",
    ]);
    expect(sessions[0]).toMatchObject({
      sessionPath: dbPath,
      sizeBytes: 5,
      projectDir: "/work/native",
      modifiedAt: new Date(1_800_000_005_000).toISOString(),
    });
  });

  test("converts messages, tool linkage, native attestations, and aggregate usage", () => {
    // Given: native Hermes messages including a tool exchange and aggregate token counters.
    const { dbPath } = createHermesDatabase();

    // When: one session is converted out of the shared SQLite store.
    const trace = hermesAdapter.convertSession({ sessionPath: dbPath, sessionId });

    // Then: the ATF trace preserves visible behavior, native identity, and aggregate usage.
    expect(trace.runtime).toBe("hermes");
    expect(trace.formatVersion).toBe(2);
    expect(trace.events.map(({ kind, name }) => `${kind}:${name}`)).toEqual([
      `session_start:${sessionId}`,
      "function_enter:turn-1",
      "llm_call:hermes-4-405b",
      "tool_call:terminal",
      "tool_result:terminal",
      "llm_call:hermes-4-405b",
      "function_exit:turn-1",
    ]);
    expect(trace.events[0]?.payload?.usage).toEqual({
      model: "hermes-4-405b",
      inputTokens: 120,
      outputTokens: 34,
      cachedInputTokens: 55,
      cacheWriteTokens: 8,
      reasoningOutputTokens: 13,
    });
    expect(trace.events[3]).toMatchObject({
      detail: "bun test",
      sourceEventId: `hermes:${sessionId}:tcall:call-native-1`,
      parentSourceEventId: `hermes:${sessionId}:msg:3`,
    });
    expect(trace.events[4]).toMatchObject({
      detail: "tests passed",
      sourceEventId: `hermes:${sessionId}:msg:4`,
      parentSourceEventId: `hermes:${sessionId}:tcall:call-native-1`,
    });
    expect(trace.events[5]?.detail).toBe("complete");
    expect(JSON.stringify(trace)).not.toContain("private system prompt");
    expect(JSON.stringify(trace)).not.toContain("rewound");
  });

  test("supports schemas without optional session token columns", () => {
    // Given: a legacy native schema with no aggregate usage columns and null model/cwd.
    const { dbPath } = createHermesDatabase({ usageColumns: false });

    // When: that session is converted.
    const trace = hermesAdapter.convertSession({ sessionPath: dbPath, sessionId });

    // Then: conversion succeeds with Hermes defaults and no fabricated usage.
    expect(trace.events[0]).toMatchObject({
      kind: "session_start",
      name: sessionId,
      detail: "hermes model=hermes cwd=unknown",
    });
    expect(trace.events[0]?.payload).toBeUndefined();
    expect(trace.events.filter(({ kind }) => kind === "llm_call").map(({ name }) => name)).toEqual([
      "hermes",
      "hermes",
    ]);
  });

  test("rejects missing, corrupt, and unidentified sessions", () => {
    // Given: a valid store, a missing path, and a corrupt state.db file.
    const { dbPath, sourceDir } = createHermesDatabase();
    const corruptDir = join(createFixtureRoot(), "corrupt");
    mkdirSync(corruptDir);
    writeFileSync(join(corruptDir, "state.db"), "not sqlite", "utf8");

    // When/Then: each invalid native source fails instead of creating or migrating data.
    expect(() => hermesAdapter.convertSession({ sessionPath: dbPath })).toThrow("invalid_session");
    expect(() => hermesAdapter.convertSession({ sessionPath: dbPath, sessionId: "missing" })).toThrow(
      "missing_session",
    );
    expect(() => hermesAdapter.listSessions(join(sourceDir, "absent"))).toThrow(
      "missing_source_dir",
    );
    expect(() => hermesAdapter.listSessions(corruptDir)).toThrow();
  });

  test("leaves source bytes unchanged and closes every read handle", () => {
    // Given: a checkpointed WAL source with a captured hash and directory manifest.
    const { dbPath, sourceDir } = createHermesDatabase();
    const hashBefore = sha256(dbPath);
    const filesBefore = readdirSync(sourceDir).sort();

    // When: discovery and conversion both complete.
    hermesAdapter.listSessions(sourceDir);
    hermesAdapter.convertSession({ sessionPath: dbPath, sessionId });

    // Then: no source bytes/sidecars changed and immediate removal proves handles were closed.
    expect(sha256(dbPath)).toBe(hashBefore);
    expect(readdirSync(sourceDir).sort()).toEqual(filesBefore);
    rmSync(sourceDir, { recursive: true });
    expect(() => readdirSync(sourceDir)).toThrow();
  });
});
