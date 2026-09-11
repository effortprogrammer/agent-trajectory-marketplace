import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { exportCollectedSession } from "../../../src/trajectory/collect";
import { collectWatchSessionFileName, collectWatchStateFileName, runCollectSweep } from "../../../src/trajectory/collect-watch";

const roots: string[] = [];
const temporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "atm-output-safety-"));
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

const writeCodexSession = (sourceDir: string, sessionId: string, records: readonly unknown[]): string => {
  const sessionDir = join(sourceDir, "2026", "07", "01");
  mkdirSync(sessionDir, { recursive: true });
  const path = join(sessionDir, `${sessionId}.jsonl`);
  writeFileSync(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
  utimesSync(path, new Date("2026-07-01T00:00:00.000Z"), new Date("2026-07-01T00:00:00.000Z"));
  return path;
};

describe("collector output safety", () => {
  test("rejects source destinations and hardlink aliases without changing the source", () => {
    // Given: one native session and an existing hardlink to its bytes.
    const root = temporaryRoot();
    const sourceDir = join(root, "claude");
    const sessionId = "source-alias";
    const sessionPath = writeClaudeSession(sourceDir, sessionId, "prompt");
    const aliasPath = join(root, "source-alias.atf.json");
    const original = readFileSync(sessionPath, "utf8");
    linkSync(sessionPath, aliasPath);

    // When / Then: neither the identical path nor its existing inode alias can be exported to.
    for (const exportPath of [sessionPath, aliasPath]) {
      expect(() => exportCollectedSession({
        runtime: "claude-code",
        session: sessionId,
        sourceDir,
        exportPath,
      })).toThrow("invalid_export_path");
    }
    expect(readFileSync(sessionPath, "utf8")).toBe(original);
    expect(readFileSync(aliasPath, "utf8")).toBe(original);
  });

  test("removes only a stale managed output after conversion failure and retries without an export path", () => {
    // Given: a previously exported Codex session which becomes malformed.
    const sourceDir = temporaryRoot();
    const outDir = temporaryRoot();
    const sessionId = "rollout-stale-output";
    const sessionPath = writeCodexSession(sourceDir, sessionId, [
      { type: "session_meta", timestamp: "2026-07-01T00:00:00.000Z", payload: { id: sessionId } },
      { type: "event_msg", timestamp: "2026-07-01T00:00:01.000Z", payload: { type: "user_message", message: "prompt" } },
    ]);
    const config = { outDir, runtimes: ["codex"], settleSeconds: 0, sourceDir };
    const first = runCollectSweep(config, new Date("2026-07-02T00:00:00.000Z"));
    const exportPath = first.exportedSessions[0]?.exportPath;
    if (exportPath === undefined) throw new Error("missing export");
    const malformed = `${JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "prompt" } })}\n`;
    writeFileSync(sessionPath, malformed, "utf8");
    utimesSync(sessionPath, new Date("2026-07-01T01:00:00.000Z"), new Date("2026-07-01T01:00:00.000Z"));

    // When: conversion fails for the changed source and is retried unchanged.
    const failed = runCollectSweep(config, new Date("2026-07-02T00:00:01.000Z"));
    const retried = runCollectSweep(config, new Date("2026-07-02T00:00:02.000Z"));
    const state = JSON.parse(readFileSync(join(outDir, collectWatchStateFileName), "utf8"));

    // Then: only the deterministic stale output is cleared; input bytes stay exact and failure remains retryable.
    expect(first).toMatchObject({ exported: 1 });
    expect(failed).toMatchObject({ exported: 0, failed: 1 });
    expect(retried).toMatchObject({ exported: 0, failed: 1, unchanged: 0 });
    expect(existsSync(exportPath)).toBe(false);
    expect(readFileSync(sessionPath, "utf8")).toBe(malformed);
    expect(state.sessions[`codex:${sessionPath}:${sessionId}`]).toMatchObject({ outcome: "failed" });
    expect(state.sessions[`codex:${sessionPath}:${sessionId}`]).not.toHaveProperty("exportPath");
  });

  test("preserves the prior artifact when a valid conversion cannot write its replacement", () => {
    // Given: a successfully collected session whose output directory is made read-only.
    const sourceDir = temporaryRoot();
    const outDir = temporaryRoot();
    const sessionPath = writeClaudeSession(sourceDir, "write-failure", "first prompt");
    const config = { outDir, runtimes: ["claude-code"], settleSeconds: 0, sourceDir };
    const first = runCollectSweep(config, new Date("2026-07-02T00:00:00.000Z"));
    const exportPath = first.exportedSessions[0]?.exportPath;
    if (exportPath === undefined) throw new Error("missing export");
    const priorArtifact = readFileSync(exportPath, "utf8");
    writeClaudeSession(sourceDir, "write-failure", "updated prompt");
    utimesSync(sessionPath, new Date("2026-07-01T01:00:00.000Z"), new Date("2026-07-01T01:00:00.000Z"));
    const publicationDirectory = dirname(exportPath);
    chmodSync(publicationDirectory, 0o555);

    // When: conversion succeeds but replacing the output fails.
    let failed: ReturnType<typeof runCollectSweep>;
    try {
      failed = runCollectSweep(config, new Date("2026-07-02T00:00:01.000Z"));
    } finally {
      chmodSync(publicationDirectory, 0o755);
    }

    // Then: the old valid artifact is retained rather than conversion cleanup deleting it.
    expect(failed).toMatchObject({ exported: 0, failed: 1 });
    expect(readFileSync(exportPath, "utf8")).toBe(priorArtifact);
    const state = JSON.parse(readFileSync(join(outDir, collectWatchStateFileName), "utf8"));
    expect(state.sessions[`claude-code:${sessionPath}:write-failure`]).not.toHaveProperty("exportPath");
  });

  test("does not traverse or remove symlink and source-alias outputs during conversion cleanup", () => {
    // Given: malformed Codex inputs with deterministic outputs replaced by hostile paths.
    const sourceDir = temporaryRoot();
    const outDir = temporaryRoot();
    const outside = temporaryRoot();
    const records = [{ type: "event_msg", payload: { type: "user_message", message: "prompt" } }];
    const linkedId = "rollout-cleanup-symlink";
    const aliasedId = "rollout-cleanup-alias";
    const linkedSource = writeCodexSession(sourceDir, linkedId, records);
    const aliasedSource = writeCodexSession(sourceDir, aliasedId, records);
    const runtimeDir = join(outDir, "codex");
    mkdirSync(runtimeDir, { recursive: true });
    const linkedOutput = join(runtimeDir, `${collectWatchSessionFileName("codex", linkedSource, linkedId)}.atf.json`);
    const aliasedOutput = join(runtimeDir, `${collectWatchSessionFileName("codex", aliasedSource, aliasedId)}.atf.json`);
    const outsideMarker = join(outside, "marker.atf.json");
    writeFileSync(outsideMarker, "do-not-touch", "utf8");
    symlinkSync(outsideMarker, linkedOutput);
    const aliasedBytes = readFileSync(aliasedSource, "utf8");
    linkSync(aliasedSource, aliasedOutput);

    // When: both adapter conversions fail before any valid output is produced.
    const summary = runCollectSweep(
      { outDir, runtimes: ["codex"], settleSeconds: 0, sourceDir },
      new Date("2026-07-02T00:00:00.000Z"),
    );

    // Then: cleanup does not follow the symlink or unlink the source inode.
    expect(summary).toMatchObject({ exported: 0, failed: 2 });
    expect(readFileSync(outsideMarker, "utf8")).toBe("do-not-touch");
    expect(existsSync(linkedOutput)).toBe(true);
    expect(readFileSync(aliasedSource, "utf8")).toBe(aliasedBytes);
    expect(readFileSync(aliasedOutput, "utf8")).toBe(aliasedBytes);
  });

  test("reprocesses old Codex cache entries once without invalidating other runtimes", () => {
    // Given: old successful state has no Codex conversion policy version.
    const codexSource = temporaryRoot();
    const claudeSource = temporaryRoot();
    const outDir = temporaryRoot();
    const codexId = "rollout-policy-cache";
    const codexPath = writeCodexSession(codexSource, codexId, [
      { type: "session_meta", payload: { id: codexId } },
      { type: "event_msg", payload: { type: "user_message", message: "prompt" } },
    ]);
    const claudePath = writeClaudeSession(claudeSource, "other-runtime-cache", "prompt");
    const modifiedAt = "2026-07-01T00:00:00.000Z";
    writeFileSync(join(outDir, collectWatchStateFileName), JSON.stringify({
      schemaVersion: 1,
      sessions: {
        [`codex:${codexPath}:${codexId}`]: {
          eventCount: 2, exportPath: "old-codex.atf.json", modifiedAt, outcome: "exported", outputNameVersion: 1,
          sizeBytes: readFileSync(codexPath).byteLength, updatedAt: modifiedAt,
        },
        [`claude-code:${claudePath}:other-runtime-cache`]: {
          eventCount: 2, exportPath: "old-claude.atf.json", modifiedAt, outcome: "exported", outputNameVersion: 1,
          sizeBytes: readFileSync(claudePath).byteLength, updatedAt: modifiedAt,
        },
      },
    }), "utf8");

    // When: the unchanged cache is swept twice under the new conversion policy.
    const first = runCollectSweep(
      { outDir, runtimes: ["codex", "claude-code"], settleSeconds: 0 },
      new Date("2026-07-02T00:00:00.000Z"),
      { codex: codexSource, "claude-code": claudeSource },
    );
    const second = runCollectSweep(
      { outDir, runtimes: ["codex", "claude-code"], settleSeconds: 0 },
      new Date("2026-07-02T00:00:01.000Z"),
      { codex: codexSource, "claude-code": claudeSource },
    );

    // Then: Codex is upgraded once while an unchanged non-Codex entry still skips.
    expect(first).toMatchObject({ exported: 1, unchanged: 1, failed: 0 });
    expect(first.exportedSessions[0]).toMatchObject({ runtime: "codex", sessionId: codexId });
    expect(second).toMatchObject({ exported: 0, unchanged: 2, failed: 0 });
  });

});
