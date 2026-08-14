import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  collectWatchStateFileName,
  resolveCollectWatchRuntimes,
  runCollectSweep,
  runCollectWatchLoop,
} from "../../../src/trajectory/collect-watch";

const roots: string[] = [];
const temporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "atm-watch-native-"));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

const writeClaudeSession = (sourceDir: string, sessionId: string, content: string): string => {
  const projectDir = join(sourceDir, "project");
  mkdirSync(projectDir, { recursive: true });
  const path = join(projectDir, `${sessionId}.jsonl`);
  writeFileSync(path, `${JSON.stringify({ type: "user", sessionId, timestamp: "2026-07-01T00:00:00.000Z", message: { content } })}\n`, "utf8");
  utimesSync(path, new Date("2026-07-01T00:00:00.000Z"), new Date("2026-07-01T00:00:00.000Z"));
  return path;
};

const writeAllRuntimeFixtures = (home: string, xdgDataHome: string): void => {
  writeClaudeSession(join(home, ".claude", "projects"), "claude-native", "claude prompt");

  const codexDir = join(home, ".codex", "sessions", "2026", "07", "23");
  mkdirSync(codexDir, { recursive: true });
  const codexPath = join(codexDir, "rollout-codex-native.jsonl");
  writeFileSync(codexPath, [
    JSON.stringify({ type: "session_meta", timestamp: "2026-07-01T00:00:00.000Z", payload: { id: "codex-native" } }),
    JSON.stringify({ type: "event_msg", timestamp: "2026-07-01T00:00:01.000Z", payload: { type: "user_message", message: "codex prompt" } }),
  ].join("\n"), "utf8");
  utimesSync(codexPath, new Date("2026-07-01T00:00:00.000Z"), new Date("2026-07-01T00:00:00.000Z"));

  const openclawDir = join(home, ".openclaw", "agents", "main", "sessions");
  mkdirSync(openclawDir, { recursive: true });
  const openclawPath = join(openclawDir, "openclaw-native.jsonl");
  writeFileSync(openclawPath, [
    JSON.stringify({ type: "session", version: 3, id: "openclaw-native", timestamp: "2026-07-01T00:00:00.000Z" }),
    JSON.stringify({ type: "message", id: "m1", timestamp: "2026-07-01T00:00:01.000Z", message: { role: "user", content: "openclaw prompt" } }),
  ].join("\n"), "utf8");
  utimesSync(openclawPath, new Date("2026-07-01T00:00:00.000Z"), new Date("2026-07-01T00:00:00.000Z"));

  const hermesDir = join(home, ".hermes");
  mkdirSync(hermesDir, { recursive: true });
  const hermes = new Database(join(hermesDir, "state.db"), { create: true, strict: true });
  hermes.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, model TEXT, cwd TEXT, started_at REAL, ended_at REAL)");
  hermes.exec("CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL, active INTEGER)");
  hermes.query("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)").run("hermes-native", "hermes", "/repo", 1_780_000_000, 1_780_000_001);
  hermes.query("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(1, "hermes-native", "user", "hermes prompt", null, null, null, 1_780_000_001, 1);
  hermes.close();

  const opencodeDir = join(xdgDataHome, "opencode");
  mkdirSync(opencodeDir, { recursive: true });
  const opencode = new Database(join(opencodeDir, "opencode.db"), { create: true, strict: true });
  opencode.exec("CREATE TABLE session (id TEXT PRIMARY KEY, time_created INTEGER, time_updated INTEGER)");
  opencode.exec("CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)");
  opencode.exec("CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)");
  opencode.query("INSERT INTO session VALUES (?, ?, ?)").run("opencode-native", 1_780_000_000_000, 1_780_000_001_000);
  opencode.query("INSERT INTO message VALUES (?, ?, ?, ?, ?)").run("message-user", "opencode-native", 1_780_000_000_000, 1_780_000_000_000, JSON.stringify({ role: "user" }));
  opencode.query("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)").run("part-user", "message-user", "opencode-native", 1_780_000_000_000, 1_780_000_000_000, JSON.stringify({ type: "text", text: "opencode prompt" }));
  opencode.close();

  for (const [configDir, sessionId] of [
    [".pi", "pi-native"],
    [".omp", "oh-my-pi-native"],
    [".senpi", "senpi-native"],
    [".gjc", "gajae-code-native"],
  ] as const) {
    const scopeDir = join(
      home,
      configDir,
      "agent",
      "sessions",
      configDir === ".pi" ? "--repo--" : "-repo",
    );
    mkdirSync(scopeDir, { recursive: true });
    const path = join(scopeDir, `${sessionId}.jsonl`);
    writeFileSync(path, [
      JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: "2026-07-01T00:00:00.000Z", cwd: "/repo" }),
      JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: "2026-07-01T00:00:01.000Z", message: { role: "user", content: `${sessionId} prompt` } }),
    ].join("\n"), "utf8");
    utimesSync(path, new Date("2026-07-01T00:00:00.000Z"), new Date("2026-07-01T00:00:00.000Z"));
  }
};

describe("native multi-runtime collect watch", () => {
  test("collects every registered native runtime in one sweep", () => {
    // Given: native JSONL and SQLite stores exist at isolated default paths for all registered runtimes.
    const home = temporaryRoot();
    const xdgDataHome = temporaryRoot();
    const outDir = temporaryRoot();
    writeAllRuntimeFixtures(home, xdgDataHome);

    // When: one sweep resolves the empty runtime list to every registered adapter.
    const summary = runCollectSweep(
      { declareRuntime: "pi", outDir, runtimes: [], settleSeconds: 0 },
      new Date("2026-07-02T00:00:00.000Z"),
      {
        "claude-code": join(home, ".claude", "projects"),
        codex: join(home, ".codex", "sessions"),
        "gajae-code": join(home, ".gjc", "agent", "sessions"),
        hermes: join(home, ".hermes"),
        "oh-my-pi": join(home, ".omp", "agent", "sessions"),
        openclaw: join(home, ".openclaw"),
        opencode: join(xdgDataHome, "opencode"),
        pi: join(home, ".pi", "agent", "sessions"),
        senpi: join(home, ".senpi", "agent", "sessions"),
      },
    );

    // Then: each runtime exports its native session with valid Bun collector metadata.
    expect(resolveCollectWatchRuntimes([])).toEqual([
      "claude-code", "codex", "gajae-code", "hermes", "oh-my-pi", "openclaw", "opencode", "pi", "senpi",
    ]);
    expect(summary).toMatchObject({ exported: 9, failed: 0, missingSources: [] });
    expect(summary.exportedSessions.map(({ runtime }) => runtime).sort()).toEqual([
      "claude-code", "codex", "gajae-code", "hermes", "oh-my-pi", "openclaw", "opencode", "pi", "senpi",
    ]);
    for (const exported of summary.exportedSessions) {
      const trace = JSON.parse(readFileSync(exported.exportPath, "utf8"));
      expect(trace).toMatchObject({ runtime: exported.runtime, status: "collected", eventCount: exported.eventCount });
    }
  });

  test("exports changed sessions, skips unchanged sessions, and leaves no atomic temporary state", () => {
    // Given: a settled native JSONL session.
    const sourceDir = temporaryRoot();
    const outDir = temporaryRoot();
    const sessionPath = writeClaudeSession(sourceDir, "session-one", "first");
    const config = { outDir, runtimes: ["claude-code"], settleSeconds: 0, sourceDir };

    // When: the session is swept twice, changed, and swept a third time.
    const first = runCollectSweep(config, new Date("2026-07-02T00:00:00.000Z"));
    const second = runCollectSweep(config, new Date("2026-07-02T00:00:01.000Z"));
    writeClaudeSession(sourceDir, "session-one", "second and longer");
    utimesSync(sessionPath, new Date("2026-07-01T01:00:00.000Z"), new Date("2026-07-01T01:00:00.000Z"));
    const third = runCollectSweep(config, new Date("2026-07-02T00:00:02.000Z"));

    // Then: exports are idempotent until the native fingerprint changes.
    expect(first).toMatchObject({ exported: 1, failed: 0, unchanged: 0 });
    expect(second).toMatchObject({ exported: 0, failed: 0, unchanged: 1 });
    expect(third).toMatchObject({ exported: 1, failed: 0, unchanged: 0 });
    expect(first.exportedSessions[0]).toMatchObject({ runtime: "claude-code", sessionId: "session-one" });
    expect(readdirSync(outDir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(JSON.parse(readFileSync(join(outDir, collectWatchStateFileName), "utf8"))).toMatchObject({ schemaVersion: 1 });
  });

  test("isolates failures and recovers from torn state", () => {
    // Given: one convertible session, one unusable session, and a torn prior state file.
    const sourceDir = temporaryRoot();
    const outDir = temporaryRoot();
    writeClaudeSession(sourceDir, "valid", "ship it");
    writeClaudeSession(sourceDir, "broken", "temporary");
    const brokenPath = join(sourceDir, "project", "broken.jsonl");
    writeFileSync(brokenPath, `${JSON.stringify({ type: "system", sessionId: "broken" })}\n`, "utf8");
    utimesSync(brokenPath, new Date("2026-07-01T00:00:00.000Z"), new Date("2026-07-01T00:00:00.000Z"));
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, collectWatchStateFileName), "{torn", "utf8");
    const config = { outDir, runtimes: ["claude-code"], settleSeconds: 0, sourceDir };

    // When: a sweep encounters the malformed Claude session.
    const first = runCollectSweep(config, new Date("2026-07-02T00:00:00.000Z"));
    const second = runCollectSweep(config, new Date("2026-07-02T00:00:01.000Z"));

    // Then: valid work survives, failures are typed, and failed fingerprints remain retryable.
    expect(first).toMatchObject({ exported: 1, failed: 1 });
    expect(first.failedSessions[0]).toMatchObject({ runtime: "claude-code", sessionId: "broken", errorCode: "invalid_session" });
    expect(first.missingSources).toEqual([]);
    expect(second).toMatchObject({ exported: 0, failed: 1, unchanged: 1 });
    expect(() => JSON.parse(readFileSync(join(outDir, collectWatchStateFileName), "utf8"))).not.toThrow();
  });

  test("uses collision-safe output names for duplicate native session IDs", () => {
    // Given: two native sessions with the same ID in separate project directories.
    const sourceDir = temporaryRoot();
    const outDir = temporaryRoot();
    writeClaudeSession(sourceDir, "same", "first project");
    const secondProject = join(sourceDir, "other");
    mkdirSync(secondProject, { recursive: true });
    const secondPath = join(secondProject, "same.jsonl");
    writeFileSync(secondPath, `${JSON.stringify({ type: "user", sessionId: "same", message: { content: "second project" } })}\n`, "utf8");
    utimesSync(secondPath, new Date("2026-07-01T00:00:00.000Z"), new Date("2026-07-01T00:00:00.000Z"));

    // When: both sessions export in one sweep.
    const summary = runCollectSweep({ outDir, runtimes: ["claude-code"], settleSeconds: 0, sourceDir }, new Date("2026-07-02T00:00:00.000Z"));

    // Then: neither output overwrites the other.
    expect(summary.exported).toBe(2);
    expect(new Set(summary.exportedSessions.map(({ exportPath }) => exportPath)).size).toBe(2);
    expect(summary.exportedSessions.every(({ exportPath }) => existsSync(exportPath))).toBe(true);
  });

  test("rejects an external runtime directory symlink without writing outside", () => {
    // Given: a settled session and a runtime output directory symlinked to another root.
    const sourceDir = temporaryRoot();
    const outDir = temporaryRoot();
    const outsideDir = temporaryRoot();
    const sessionId = "runtime-symlink";
    writeClaudeSession(sourceDir, sessionId, "do not escape");
    mkdirSync(outDir, { recursive: true });
    symlinkSync(outsideDir, join(outDir, "claude-code"), "dir");

    // When: one watch sweep converts the session.
    const summary = runCollectSweep(
      { outDir, runtimes: ["claude-code"], settleSeconds: 0, sourceDir },
      new Date("2026-07-02T00:00:00.000Z"),
    );

    // Then: the sweep records a typed path failure and writes no external export.
    expect(summary).toMatchObject({ exported: 0, failed: 1 });
    expect(summary.failedSessions[0]?.errorCode).toBe("invalid_export_path");
    expect(readdirSync(outsideDir)).toEqual([]);
  });

  test("waits for unsettled sessions and exits the resident loop promptly", async () => {
    // Given: a fresh native session and a loop whose injected sleep requests shutdown.
    const sourceDir = temporaryRoot();
    const outDir = temporaryRoot();
    const sessionPath = writeClaudeSession(sourceDir, "live", "still writing");
    utimesSync(sessionPath, new Date("2026-07-02T00:00:00.000Z"), new Date("2026-07-02T00:00:00.000Z"));
    let running = true;
    let sleepCalls = 0;

    // When: one sweep runs before settlement and the first short sleep observes shutdown.
    const summary = runCollectSweep({ outDir, runtimes: ["claude-code"], settleSeconds: 60, sourceDir }, new Date("2026-07-02T00:00:30.000Z"));
    await runCollectWatchLoop({
      config: { outDir, runtimes: ["claude-code"], settleSeconds: 60, sourceDir },
      intervalSeconds: 30,
      onSweep: () => undefined,
      onSweepError: () => undefined,
      shouldContinue: () => running,
      sleep: async () => { sleepCalls += 1; running = false; },
    });

    // Then: partial data is not exported and stop latency is one bounded sleep chunk.
    expect(summary).toMatchObject({ exported: 0, pendingSettle: 1 });
    expect(sleepCalls).toBe(1);
  });

  test("fails the resident loop on sweep errors with a safe stable error", async () => {
    // Given: the configured output path is an existing file, so the sweep
    // cannot create its state directory.
    const root = temporaryRoot();
    const outPath = join(root, "output-secret-marker");
    writeFileSync(outPath, "not a directory", "utf8");
    let running = true;

    // When: the resident loop attempts its first sweep.
    const loop = runCollectWatchLoop({
      config: { outDir: outPath, runtimes: ["codex"], settleSeconds: 0 },
      intervalSeconds: 30,
      onSweep: () => undefined,
      shouldContinue: () => running,
      sleep: async () => {
        running = false;
      },
    });
    const failure = await loop.catch((error: unknown) => error);

    // Then: the failure is observable to the caller and does not expose the
    // path (or any other filesystem detail) to a CLI boundary.
    expect(failure).toMatchObject({
      code: "collect_watch_failed",
      message: "collect_watch_failed",
    });
    expect(failure).not.toHaveProperty("message", expect.stringContaining("output-secret-marker"));
  });
});
