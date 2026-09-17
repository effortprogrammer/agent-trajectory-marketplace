import { expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { removeManagedOutputAfterConversionFailure } from "../../../src/trajectory/collect-output-safety";

test("stale-output cleanup does not hide an unexpected filesystem failure", () => {
  const root = fs.mkdtempSync(join(tmpdir(), "atm-cleanup-failure-"));
  const sourcePath = join(root, "source.jsonl");
  const outputPath = join(root, "managed.atf.json");
  fs.writeFileSync(sourcePath, "SOURCE_SENTINEL");
  fs.writeFileSync(outputPath, "STALE_SENTINEL");
  const denied = Object.assign(new Error("synthetic"), { code: "EACCES" });
  const unlink = spyOn(fs, "unlinkSync").mockImplementation(() => { throw denied; });
  try {
    let observed: unknown;
    try {
      removeManagedOutputAfterConversionFailure(sourcePath, root, outputPath);
    } catch (error) {
      observed = error;
    }
    expect(observed).toBe(denied);
    expect(fs.readFileSync(sourcePath, "utf8")).toBe("SOURCE_SENTINEL");
  } finally {
    unlink.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
