import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  collectWatchSessionFileName,
  runCollectSweep,
} from "../../../src/trajectory/collect-watch";

const roots: string[] = [];

const fixture = (): Readonly<{ outDir: string; sessionId: string; sessionPath: string; sourceDir: string }> => {
  const root = mkdtempSync(join(tmpdir(), "pi-watch-attribution-"));
  roots.push(root);
  const sourceDir = join(root, ".pi", "agent", "sessions");
  const sessionId = "native";
  const sessionPath = join(sourceDir, "--work-demo--", `${sessionId}.jsonl`);
  mkdirSync(dirname(sessionPath), { recursive: true });
  writeFileSync(
    sessionPath,
    `${JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: "2026-07-20T10:00:00.000Z", cwd: "/work/demo" })}\n${JSON.stringify({ type: "message", id: "u1", parentId: null, timestamp: "2026-07-20T10:00:01.000Z", message: { role: "user", content: "inspect" } })}\n`,
    "utf8",
  );
  utimesSync(sessionPath, new Date("2026-07-20T10:00:00.000Z"), new Date("2026-07-20T10:00:00.000Z"));
  return { outDir: join(root, "out"), sessionId, sessionPath, sourceDir };
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("Pi collect watch attribution", () => {
  test("retries an undeclared failure after declaration", () => {
    const input = fixture();
    const base = { outDir: input.outDir, runtimes: ["pi"], settleSeconds: 0, sourceDir: input.sourceDir };

    const undeclared = runCollectSweep(base, new Date("2026-07-21T00:00:00.000Z"));
    const declared = runCollectSweep({ ...base, declareRuntime: "pi" }, new Date("2026-07-21T00:00:00.000Z"));

    expect(undeclared).toMatchObject({ exported: 0, failed: 1 });
    expect(declared).toMatchObject({ exported: 1, failed: 0, unchanged: 0 });
  });

  test("rejects a dangling final output symlink", () => {
    const input = fixture();
    const outside = join(dirname(input.outDir), "outside.atf.json");
    const exportPath = join(
      input.outDir,
      "pi",
      `${collectWatchSessionFileName("pi", input.sessionPath, input.sessionId)}.atf.json`,
    );
    mkdirSync(dirname(exportPath), { recursive: true });
    symlinkSync(outside, exportPath);

    const summary = runCollectSweep(
      { declareRuntime: "pi", outDir: input.outDir, runtimes: ["pi"], settleSeconds: 0, sourceDir: input.sourceDir },
      new Date("2026-07-21T00:00:00.000Z"),
    );

    expect(summary).toMatchObject({ exported: 0, failed: 1 });
    expect(summary.failedSessions[0]?.errorCode).toBe("invalid_export_path");
    expect(existsSync(outside)).toBe(false);
  });
});
