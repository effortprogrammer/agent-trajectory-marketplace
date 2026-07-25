import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MarketplaceError } from "../../../src/marketplace/error";
import { readExplicitTraces, scanSessionSnapshot } from "../../../src/marketplace/session-snapshot";

const roots: string[] = [];

const fixtureRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "trajectory-snapshot-bounds-"));
  roots.push(root);
  return root;
};

const traceBytes = (input: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify({
  runtime: "codex",
  status: "collected",
  formatVersion: 2,
  eventCount: 1,
  events: [{ kind: "tool_call", name: "bounded-input", payload: { input } }],
}));

const nestedInput = (depth: number): Record<string, unknown> => {
  const root: Record<string, unknown> = {};
  let cursor = root;
  for (let index = 0; index < depth; index += 1) {
    const child: Record<string, unknown> = {};
    cursor["child"] = child;
    cursor = child;
  }
  return root;
};

const expectInvalidTrace = (action: () => unknown): void => {
  try {
    action();
    throw new Error("expected invalid_trace");
  } catch (error) {
    if (!(error instanceof MarketplaceError)) throw error;
    expect(error.code).toBe("invalid_trace");
  }
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

test("session ingestion rejects payloads beyond the shared depth and node limits", () => {
  const deepRoot = fixtureRoot();
  writeFileSync(join(deepRoot, "deep.atf.json"), traceBytes(nestedInput(257)));
  const wideRoot = fixtureRoot();
  writeFileSync(join(wideRoot, "wide.atf.json"), traceBytes(new Array<null>(65_536).fill(null)));

  expectInvalidTrace(() => scanSessionSnapshot(deepRoot));
  expectInvalidTrace(() => readExplicitTraces(wideRoot, ["wide.atf.json"]));
});
