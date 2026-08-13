import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("trajectory dataset TRL process", () => {
  test("prints focused TRL export help without requiring input files", () => {
    const process = Bun.spawnSync([
      "bun",
      "src/cli/index.ts",
      "trajectory",
      "dataset",
      "trl",
      "--help",
    ], {
      cwd: import.meta.dir + "/../../..",
      stderr: "pipe",
      stdout: "pipe",
    });

    expect(process.exitCode).toBe(0);
    expect(process.stderr.toString()).toBe("");
    expect(process.stdout.toString()).toContain(
      "Usage: trajectory dataset trl --input <absolute-atf-json> --out <absolute-jsonl>",
    );
  });

  test("returns a stable JSON error and leaves no partial output for malformed ATF", () => {
    const root = mkdtempSync(join(tmpdir(), "trl-process-"));
    roots.push(root);
    const inputPath = join(root, "malformed.atf.json");
    const outputPath = join(root, "train.jsonl");
    writeFileSync(inputPath, "{", "utf8");

    const process = Bun.spawnSync([
      "bun",
      "src/cli/index.ts",
      "trajectory",
      "dataset",
      "trl",
      "--input",
      inputPath,
      "--out",
      outputPath,
    ], {
      cwd: import.meta.dir + "/../../..",
      stderr: "pipe",
      stdout: "pipe",
    });

    expect(process.exitCode).toBe(1);
    expect(process.stdout.toString()).toBe("");
    expect(JSON.parse(process.stderr.toString())).toEqual({ error: "invalid_atf" });
    expect(existsSync(outputPath)).toBe(false);
  });
});
