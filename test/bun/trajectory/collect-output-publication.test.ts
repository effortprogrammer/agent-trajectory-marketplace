import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync,
  statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { harnessTraceDocumentSchema } from "../../../src/trajectory/adapters/contract";
import { exportCollectedSession } from "../../../src/trajectory/collect";
import { runCollectSweep } from "../../../src/trajectory/collect-watch";
import * as safety from "../../../src/trajectory/collect-output-safety";

const roots: string[] = [];
const originalCheck = safety.assertSafeOutputPath;

afterEach(() => {
  mock.restore();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

for (const surface of ["direct", "watch"] as const) {
  for (const alias of ["hardlink", "symlink"] as const) {
    test(`${surface} publication preserves source after a post-check ${alias} swap`, () => {
      // Given: a native input and a deterministic destination replacement after safety validation.
      const root = mkdtempSync(join(tmpdir(), "atm-output-publication-"));
      roots.push(root);
      const sourceDir = join(root, "native");
      const projectDir = join(sourceDir, "project");
      const outDir = join(root, "output");
      mkdirSync(projectDir, { recursive: true });
      mkdirSync(outDir);
      const source = join(projectDir, "source.jsonl");
      const original = JSON.stringify({
        type: "user", sessionId: "source", timestamp: "2026-07-01T00:00:00.000Z",
        message: { content: "USER_SENTINEL" },
      }) + "\n";
      writeFileSync(source, original);
      let swapped = false;
      let destination = "";
      spyOn(safety, "assertSafeOutputPath").mockImplementation((input, output) => {
        originalCheck(input, output);
        mkdirSync(dirname(output), { recursive: true });
        if (alias === "hardlink") linkSync(input, output);
        else symlinkSync(input, output);
        destination = output;
        swapped = true;
      });

      // When: the real direct or watch exporter publishes after that exact interleaving.
      if (surface === "direct") {
        exportCollectedSession({
          runtime: "claude-code", session: "source", sourceDir,
          outputRoot: outDir, exportPath: "result.atf.json",
        });
      } else {
        expect(runCollectSweep({
          outDir, sourceDir, runtimes: ["claude-code"], settleSeconds: 0,
        })).toMatchObject({ exported: 1, failed: 0 });
      }

      // Then: publication replaces the directory entry, never the original inode's bytes.
      expect(swapped).toBe(true);
      expect(readFileSync(source, "utf8")).toBe(original);
      expect(lstatSync(destination).isSymbolicLink()).toBe(false);
      expect(statSync(destination).ino).not.toBe(statSync(source).ino);
      expect(harnessTraceDocumentSchema.parse(JSON.parse(readFileSync(destination, "utf8"))).runtime)
        .toBe("claude-code");
      expect([...new Bun.Glob("**/*.trajectory-export-*").scanSync({ cwd: outDir })]).toEqual([]);
    });
  }
}
