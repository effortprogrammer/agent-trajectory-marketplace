import { Database } from "bun:sqlite";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { codexAdapter } from "../../../src/trajectory/adapters/codex";
import {
  exportCollectedSession,
  listCollectRuntimes,
  listCollectSessions,
} from "../../../src/trajectory/collect";

const roots: string[] = [];

const temporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "native-collector-facade-"));
  roots.push(root);
  return root;
};

const writeJsonl = (path: string, records: readonly unknown[]): void => {
  writeFileSync(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
};

type NativeFixture = Readonly<{ runtime: string; sessionId: string; sourceDir: string }>;

const nativeFixtures = (root: string): readonly NativeFixture[] => {
  const claudeSource = join(root, "claude");
  mkdirSync(join(claudeSource, "project"), { recursive: true });
  writeJsonl(join(claudeSource, "project", "claude-session.jsonl"), [
    { type: "user", sessionId: "claude-session", timestamp: "2026-07-01T10:00:00.000Z", message: { content: "inspect" } },
    { type: "assistant", sessionId: "claude-session", timestamp: "2026-07-01T10:01:00.000Z", message: { id: "claude-answer", model: "claude-test", content: [{ type: "text", text: "done" }] } },
  ]);

  const codexSource = join(root, "codex", "2026", "07", "01");
  mkdirSync(codexSource, { recursive: true });
  writeJsonl(join(codexSource, "rollout-codex-session.jsonl"), [
    { type: "session_meta", timestamp: "2026-07-01T11:00:00.000Z", payload: { id: "codex-session", cwd: "/tmp" } },
    { type: "event_msg", timestamp: "2026-07-01T11:01:00.000Z", payload: { type: "user_message", message: "inspect" } },
    { type: "response_item", timestamp: "2026-07-01T11:02:00.000Z", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "done" }] } },
  ]);

  const hermesSource = join(root, "hermes");
  mkdirSync(hermesSource, { recursive: true });
  const hermes = new Database(join(hermesSource, "state.db"), { create: true, strict: true });
  hermes.run("CREATE TABLE sessions (id TEXT PRIMARY KEY, model TEXT, cwd TEXT, started_at REAL, ended_at REAL, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, reasoning_tokens INTEGER)");
  hermes.run("CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, timestamp REAL, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, active INTEGER)");
  hermes.query("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("hermes-session", "hermes-test", "/tmp", 1_782_903_600, 1_782_903_720, 2, 1, 0, 0, 0);
  hermes.query("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(1, "hermes-session", "user", "inspect", 1_782_903_600, null, null, null, 1);
  hermes.query("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(2, "hermes-session", "assistant", "done", 1_782_903_660, null, null, null, 1);
  hermes.close();

  const openclawSource = join(root, "openclaw");
  const openclawSessions = join(openclawSource, "agents", "main", "sessions");
  mkdirSync(openclawSessions, { recursive: true });
  writeJsonl(join(openclawSessions, "openclaw-session.jsonl"), [
    { type: "session", version: 3, id: "openclaw-session", cwd: "/tmp" },
    { type: "message", id: "openclaw-user", timestamp: "2026-07-01T12:00:00.000Z", message: { role: "user", content: "inspect" } },
    { type: "message", id: "openclaw-answer", timestamp: "2026-07-01T12:01:00.000Z", message: { role: "assistant", model: "openclaw-test", content: [{ type: "text", text: "done" }] } },
  ]);

  const opencodeSource = join(root, "opencode");
  mkdirSync(opencodeSource, { recursive: true });
  const opencode = new Database(join(opencodeSource, "opencode.db"), { create: true, strict: true });
  opencode.run("CREATE TABLE session (id TEXT PRIMARY KEY, time_created INTEGER, time_updated INTEGER)");
  opencode.run("CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)");
  opencode.run("CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)");
  opencode.query("INSERT INTO session VALUES (?, ?, ?)").run("opencode-session", 1_782_903_600_000, 1_782_903_720_000);
  opencode.query("INSERT INTO message VALUES (?, ?, ?, ?, ?)").run("opencode-user", "opencode-session", 1_782_903_600_000, 1_782_903_600_000, JSON.stringify({ role: "user" }));
  opencode.query("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)").run("opencode-text", "opencode-user", "opencode-session", 1_782_903_600_000, 1_782_903_600_000, JSON.stringify({ type: "text", text: "inspect" }));
  opencode.close();

  const piFamilyFixtures: NativeFixture[] = [
    { runtime: "pi", configDir: ".pi" },
    { runtime: "oh-my-pi", configDir: ".omp" },
    { runtime: "senpi", configDir: ".senpi" },
    { runtime: "gajae-code", configDir: ".gjc" },
  ].map(({ runtime, configDir }) => {
    const source = join(root, configDir, "agent", "sessions");
    const scopeDir = join(source, runtime === "pi" ? "--tmp--" : "-tmp-project");
    mkdirSync(scopeDir, { recursive: true });
    writeJsonl(join(scopeDir, `${runtime}-session.jsonl`), [
      { type: "session", version: 3, id: `${runtime}-session`, timestamp: "2026-07-01T13:00:00.000Z", cwd: "/tmp" },
      { type: "message", id: "u1", parentId: null, timestamp: "2026-07-01T13:00:01.000Z", message: { role: "user", content: "inspect" } },
      { type: "message", id: "a1", parentId: "u1", timestamp: "2026-07-01T13:01:00.000Z", message: { role: "assistant", model: `${runtime}-test`, content: [{ type: "text", text: "done" }] } },
    ]);
    return { runtime, sessionId: `${runtime}-session`, sourceDir: source };
  });

  return [
    { runtime: "claude-code", sessionId: "claude-session", sourceDir: claudeSource },
    { runtime: "codex", sessionId: "rollout-codex-session", sourceDir: join(root, "codex") },
    { runtime: "hermes", sessionId: "hermes-session", sourceDir: hermesSource },
    { runtime: "openclaw", sessionId: "openclaw-session", sourceDir: openclawSource },
    { runtime: "opencode", sessionId: "opencode-session", sourceDir: opencodeSource },
    ...piFamilyFixtures,
  ];
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("native collector facade", () => {
  test("lists and exports all native fixtures", () => {
    // Given: one real native JSONL or SQLite fixture for each supported runtime.
    const root = temporaryRoot();
    const output = join(root, "exports");
    const fixtures = nativeFixtures(root);

    // When: each fixture is discovered and exported through the facade.
    const results = fixtures.map((fixture) => {
      const listed = listCollectSessions({ runtime: fixture.runtime, sourceDir: fixture.sourceDir });
      const exported = exportCollectedSession({
        runtime: fixture.runtime,
        ...(fixture.runtime === "pi"
          ? { runtimeAttribution: "operator_declared" as const }
          : {}),
        session: fixture.sessionId,
        sourceDir: fixture.sourceDir,
        exportPath: join(output, `${fixture.runtime}.atf.json`),
      });
      return { exported, listed };
    });

    // Then: every runtime summary contains native metadata but no trace body.
    expect(listCollectRuntimes().map(({ runtime }) => runtime)).toEqual([
      "claude-code", "codex", "gajae-code", "hermes", "oh-my-pi", "openclaw", "opencode", "pi", "senpi",
    ]);
    expect(results.map(({ listed }) => listed.sessionCount)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    for (const { exported } of results) {
      expect(exported.status).toBe("collected");
      expect(exported.eventCount).toBeGreaterThan(0);
      expect(exported.eventKinds).toContain("session_start");
      expect(exported).not.toHaveProperty("events");
      expect(JSON.parse(readFileSync(exported.exportPath, "utf8"))).toHaveProperty("formatVersion", 2);
    }
  });

  test("uses optional defaults and limits newest sessions after discovery", () => {
    // Given: 22 native Codex sessions under an adapter default, with ordered mtimes.
    const root = temporaryRoot();
    const sourceDir = join(root, "sessions");
    const dayDir = join(sourceDir, "2026", "07", "01");
    mkdirSync(dayDir, { recursive: true });
    for (let index = 0; index < 22; index += 1) {
      const path = join(dayDir, `rollout-${index.toString().padStart(2, "0")}.jsonl`);
      writeJsonl(path, [{ type: "session_meta", timestamp: "2026-07-01T11:00:00.000Z", payload: { id: `native-${index}`, cwd: "/tmp" } }]);
      utimesSync(path, index, index);
    }
    const defaultSpy = spyOn(codexAdapter, "defaultSourceDir").mockReturnValue(sourceDir);

    // When: sessions are listed without an override at default and explicit limits.
    const defaultResult = listCollectSessions({ runtime: "codex" });
    const limited = listCollectSessions({ runtime: "codex", limit: 2 });
    defaultSpy.mockReturnValue(join(root, "missing-default"));
    const missingDefault = listCollectSessions({ runtime: "codex" });
    defaultSpy.mockRestore();

    // Then: discovery remains newest-first, limiting is post-discovery, and an absent default is empty.
    expect(defaultResult.sessionCount).toBe(22);
    expect(defaultResult.sessions).toHaveLength(20);
    expect(limited.sessions.map(({ sessionId }) => sessionId)).toEqual(["rollout-21", "rollout-20"]);
    expect(missingDefault.sessions).toEqual([]);
    expect(() => listCollectSessions({ runtime: "codex", sourceDir, limit: 501 })).toThrow();
  });

  test("rejects traversal and disambiguates duplicate native ids", () => {
    // Given: duplicate Claude session ids in distinct native paths and a legacy output root with a symlink escape.
    const root = temporaryRoot();
    const sourceDir = join(root, "source");
    const outputRoot = join(root, "output");
    const outside = join(root, "outside");
    mkdirSync(join(sourceDir, "one"), { recursive: true });
    mkdirSync(join(sourceDir, "two"), { recursive: true });
    mkdirSync(join(outputRoot, "safe"), { recursive: true });
    mkdirSync(outside);
    symlinkSync(outside, join(outputRoot, "escape"));
    for (const project of ["one", "two"]) {
      writeJsonl(join(sourceDir, project, "same.jsonl"), [{ type: "user", sessionId: "same", timestamp: "2026-07-01T10:00:00.000Z", message: { content: project } }]);
    }
    const sessions = listCollectSessions({ runtime: "claude-code", sourceDir }).sessions;

    // When: callers select the duplicates by their existing paths and unsafe legacy paths are attempted.
    const first = exportCollectedSession({ runtime: "claude-code", session: sessions[0]?.sessionPath ?? "", sourceDir, exportPath: join(root, "first.atf.json") });
    const second = exportCollectedSession({ runtime: "claude-code", session: sessions[1]?.sessionPath ?? "", sourceDir, exportPath: join(root, "second.atf.json") });
    const traversal = () => exportCollectedSession({ runtime: "claude-code", session: "same", sourceDir, outputRoot, exportPath: "../outside.atf.json" });
    const symlinkEscape = () => exportCollectedSession({ runtime: "claude-code", session: "same", sourceDir, outputRoot, exportPath: "escape/outside.atf.json" });

    // Then: paths select collision-free sessions while traversal and symlink escapes are rejected.
    expect(new Set([first.sessionPath, second.sessionPath]).size).toBe(2);
    expect(first.exportPath).not.toBe(second.exportPath);
    expect(traversal).toThrow("invalid_export_path");
    expect(symlinkEscape).toThrow("invalid_export_path");
  });

  test("rejects an existing final export symlink without writing through it", () => {
    // Given: a valid session and an export destination symlinked to a separate root.
    const root = temporaryRoot();
    const outsideRoot = temporaryRoot();
    const fixtures = nativeFixtures(root);
    const fixture = fixtures[0];
    if (fixture === undefined) throw new Error("missing native fixture");
    const exportPath = join(root, "exports", "collected.atf.json");
    const outsidePath = join(outsideRoot, "outside.atf.json");
    mkdirSync(dirname(exportPath), { recursive: true });
    writeFileSync(outsidePath, "do-not-overwrite", "utf8");
    symlinkSync(outsidePath, exportPath);

    // When: collection exports to the pre-existing symlink.
    const exportAttempt = () => exportCollectedSession({
      runtime: fixture.runtime,
      session: fixture.sessionId,
      sourceDir: fixture.sourceDir,
      exportPath,
    });

    // Then: the collector rejects the destination and preserves the external file.
    expect(exportAttempt).toThrow("invalid_export_path");
    expect(readFileSync(outsidePath, "utf8")).toBe("do-not-overwrite");

    rmSync(exportPath);
    rmSync(outsidePath);
    symlinkSync(outsidePath, exportPath);
    expect(exportAttempt).toThrow("invalid_export_path");
    expect(existsSync(outsidePath)).toBe(false);
  });

  test("reports missing sessions and unknown runtimes", () => {
    // Given: an empty explicit source.
    const sourceDir = temporaryRoot();

    // When / Then: invalid runtime and session identities retain typed adapter errors.
    expect(() => listCollectSessions({ runtime: "unknown", sourceDir })).toThrow("unknown_runtime");
    expect(() => exportCollectedSession({ runtime: "codex", session: "missing", sourceDir, exportPath: join(sourceDir, "missing.atf.json") })).toThrow("missing_session");
  });

  test("confines direct session paths to the selected source and rejects symlinks", () => {
    const root = temporaryRoot();
    const source = join(root, ".pi", "agent", "sessions");
    const outside = join(root, "outside.jsonl");
    const linked = join(source, "linked.jsonl");
    mkdirSync(source, { recursive: true });
    writeFileSync(outside, `${JSON.stringify({
      type: "session",
      version: 3,
      id: "outside",
      timestamp: "2026-07-20T10:00:00.000Z",
      cwd: "/work/demo",
    })}\n`, "utf8");
    symlinkSync(outside, linked);

    for (const session of [outside, linked]) {
      expect(() =>
        exportCollectedSession({
          runtime: "pi",
          runtimeAttribution: "operator_declared",
          sourceDir: source,
          session,
          exportPath: join(root, `${session === outside ? "outside" : "linked"}.atf.json`),
        }),
      ).toThrow(/invalid_session/);
    }
  });
});
