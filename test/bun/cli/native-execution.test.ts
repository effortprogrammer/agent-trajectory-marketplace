import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCollectorCli } from "../../../src/cli/collector";

const roots: string[] = [];

const fixture = (): Readonly<{ outputDir: string; sourceDir: string }> => {
  const root = mkdtempSync(join(tmpdir(), "native-cli-execution-"));
  const sourceDir = join(root, "sessions", "2026", "07", "23");
  const outputDir = join(root, "exports");
  roots.push(root);
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(outputDir);
  writeFileSync(
    join(sourceDir, "rollout-native-cli.jsonl"),
    [
      JSON.stringify({
        payload: { cwd: "/tmp", id: "native-cli" },
        timestamp: "2026-07-23T00:00:00.000Z",
        type: "session_meta",
      }),
      JSON.stringify({
        payload: { message: "collect this", type: "user_message" },
        timestamp: "2026-07-23T00:00:01.000Z",
        type: "event_msg",
      }),
    ].join("\n") + "\n",
    "utf8",
  );
  return { outputDir, sourceDir: join(root, "sessions") };
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("native collector CLI execution", () => {
  test("executes canonical sessions through the native facade", () => {
    // Given: a native Codex session and the canonical hierarchical command.
    const { sourceDir } = fixture();

    // When: the collector executes the parsed request in-process.
    const result = runCollectorCli([
      "trajectory",
      "collect",
      "sessions",
      "codex",
      "--source",
      sourceDir,
      "--limit",
      "1",
    ]);

    // Then: the native facade returns its discovery summary synchronously.
    expect(result).toMatchObject({ runtime: "codex", sessionCount: 1, sourceDir });
    expect(result).not.toBeInstanceOf(Promise);
  });

  test("executes canonical export and writes the requested ATF file", () => {
    // Given: a native Codex session and an absolute canonical export target.
    const { outputDir, sourceDir } = fixture();
    const exportPath = join(outputDir, "native-cli.atf.json");

    // When: the canonical export command runs through the CLI dispatcher.
    const result = runCollectorCli([
      "trajectory",
      "collect",
      "export",
      "codex",
      "--source",
      sourceDir,
      "--session",
      "rollout-native-cli",
      "--export",
      exportPath,
    ]);

    // Then: the summary and file are produced by the native facade.
    expect(result).toMatchObject({ exportPath, runtime: "codex", status: "collected" });
    expect(JSON.parse(readFileSync(exportPath, "utf8"))).toHaveProperty("formatVersion", 2);
  });

  test("preserves the flat export alias with output-root confinement", () => {
    // Given: the same native fixture addressed with legacy flat options.
    const { outputDir, sourceDir } = fixture();

    // When: the flat alias exports beneath its explicit output root.
    const result = runCollectorCli([
      "export",
      "--runtime",
      "codex",
      "--source-dir",
      sourceDir,
      "--output-root",
      outputDir,
      "--session",
      "rollout-native-cli",
      "--export-path",
      "legacy.atf.json",
    ]);

    // Then: legacy path semantics remain observable.
    expect(result).toMatchObject({ exportPath: join(realpathSync(outputDir), "legacy.atf.json"), runtime: "codex" });
  });

  test("executes canonical watch once with native multi-runtime configuration", () => {
    // Given: a native source override for one runtime and a canonical watch destination.
    const { outputDir, sourceDir } = fixture();

    // When: one native watch sweep is requested.
    const result = runCollectorCli([
      "trajectory",
      "collect",
      "watch",
      "--once",
      "--out",
      outputDir,
      "--runtime",
      "codex",
      "--source",
      sourceDir,
      "--settle-seconds",
      "0",
    ]);

    // Then: the sweep reports the selected runtime and writes one ATF export.
    expect(result).toMatchObject({ exported: 1, failed: 0, runtimes: ["codex"] });
  });

  test("renders a canonical service install without mutating the platform manager", () => {
    // Given: a canonical dry-run request using native runtime defaults.
    const outputDir = fixture().outputDir;

    // When: service installation is previewed through the CLI.
    const result = runCollectorCli([
      "trajectory",
      "collect",
      "service",
      "install",
      "--dry-run",
      "--out",
      outputDir,
      "--runtime",
      "codex",
    ]);

    // Then: the platform manager is not changed and the generated command uses canonical grammar.
    expect(result).toMatchObject({ bootstrapped: false, detail: "dry_run" });
    expect(result).toHaveProperty(process.platform === "linux" ? "unit" : "plist");
  });

  test("installs an unpinned service by default and dedupes repeated runtimes", () => {
    // Given: one request relying on registry-following defaults, one repeating a runtime.
    const outputDir = fixture().outputDir;
    const preview = (runtimeArguments: readonly string[]): unknown =>
      runCollectorCli([
        "trajectory",
        "collect",
        "service",
        "install",
        "--dry-run",
        "--out",
        outputDir,
        ...runtimeArguments,
      ]);

    // When: both service installations are previewed through the CLI.
    const rendered = (result: unknown): string => {
      const { plist, unit } = result as { plist?: string; unit?: string };
      return plist ?? unit ?? "";
    };
    const unpinned = rendered(preview([]));
    const repeated = rendered(preview(["--runtime", "codex", "codex"]));

    // Then: the default renders no --runtime flags (the watch process follows
    // the adapter registry), and explicit duplicates collapse to one flag.
    expect(unpinned).toContain("watch");
    expect(unpinned).not.toContain("--runtime");
    expect(repeated.match(/--runtime/g)).toHaveLength(1);
  });

  test("reports resident sweep failures as safe stderr JSON and exits nonzero", () => {
    // Given: the watch output path is an existing file, forcing a sweep-level
    // filesystem failure before any session data can be processed.
    const root = mkdtempSync(join(tmpdir(), "native-cli-watch-error-"));
    roots.push(root);
    const outputPath = join(root, "output-secret-marker");
    writeFileSync(outputPath, "not a directory", "utf8");

    // When: the real Bun CLI enters resident watch mode.
    const result = spawnSync(
      process.execPath,
      [
        "src/cli/index.ts",
        "collect",
        "watch",
        "--out",
        outputPath,
        "--runtime",
        "codex",
        "--source",
        "/tmp",
        "--interval-seconds",
        "1",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    // Then: launchd can observe the failure, while stderr contains only the
    // stable machine-readable error code and never the filesystem path.
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe('{"error":"collect_watch_failed"}\n');
    expect(result.stderr).not.toContain("output-secret-marker");
  });
});
