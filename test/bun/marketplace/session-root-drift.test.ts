import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MarketplaceError } from "../../../src/marketplace/error";
import { assertTracesUnchanged, scanSessionSnapshot } from "../../../src/marketplace/session-snapshot";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("Given the approved root is replaced after review, When rechecked, Then root identity drift is rejected", () => {
  const container = mkdtempSync(join(tmpdir(), "trajectory-root-drift-"));
  roots.push(container);
  const root = join(container, "approved");
  const replacement = join(container, "replacement");
  const bytes = new TextEncoder().encode(
    JSON.stringify({ runtime: "codex", status: "collected", eventCount: 0, events: [] }),
  );
  mkdirSync(root);
  mkdirSync(replacement);
  writeFileSync(join(root, "selected.atf.json"), bytes);
  writeFileSync(join(replacement, "selected.atf.json"), bytes);
  const snapshot = scanSessionSnapshot(root);

  renameSync(root, join(container, "parked"));
  renameSync(replacement, root);

  let caught: MarketplaceError | undefined;
  try {
    assertTracesUnchanged(snapshot, snapshot.traces);
  } catch (error) {
    if (error instanceof MarketplaceError) caught = error;
    else throw error;
  }
  expect(caught?.code).toBe("trace_drift");
});
