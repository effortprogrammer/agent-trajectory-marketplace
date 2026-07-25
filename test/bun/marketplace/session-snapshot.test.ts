import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MarketplaceError } from "../../../src/marketplace/error";
import {
  assertTracesUnchanged,
  readExplicitTraces,
  resolveTraceSelector,
  scanSessionSnapshot,
} from "../../../src/marketplace/session-snapshot";

const roots: string[] = [];

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "trajectory-snapshot-"));
  roots.push(root);
  return root;
}

function validAtf(runtime = "codex"): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({ runtime, status: "collected", eventCount: 0, events: [] }),
  );
}

function timestampedAtf(): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    runtime: "codex",
    status: "collected",
    formatVersion: 2,
    eventCount: 3,
    events: [
      { kind: "llm_call", name: "late", timestamp: "2026-07-24T09:00:00.000Z", sourceEventId: "late" },
      { kind: "llm_call", name: "undated" },
      { kind: "llm_call", name: "early", timestamp: "2026-07-23T08:00:00.000Z", sourceEventId: "early" },
    ],
  }));
}

function expectCode(action: () => unknown, code: MarketplaceError["code"]): void {
  let caught: MarketplaceError | undefined;
  try {
    action();
  } catch (error) {
    if (error instanceof MarketplaceError) caught = error;
    else throw error;
  }
  expect(caught).toBeInstanceOf(MarketplaceError);
  if (caught === undefined) throw new Error("expected MarketplaceError");
  expect(caught.code).toBe(code);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("session snapshot", () => {
  test("Given stored timestamps, When frozen, Then scalar report metadata survives transient parsing", () => {
    const root = fixtureRoot();
    writeFileSync(join(root, "timed.atf.json"), timestampedAtf());

    const trace = scanSessionSnapshot(root).traces[0];

    expect(trace?.runtime).toBe("codex");
    expect(trace?.eventCount).toBe(3);
    expect(trace?.earliestTimestamp).toBe("2026-07-23T08:00:00.000Z");
  });

  test("Given an intermediate directory is replaced after open, When scanned, Then traversal stays on its descriptor", () => {
    const root = fixtureRoot();
    const outside = fixtureRoot();
    mkdirSync(join(root, "nested"));
    writeFileSync(join(root, "nested", "inside.atf.json"), validAtf("inside"));
    writeFileSync(join(outside, "outside.atf.json"), validAtf("outside"));
    let hookCount = 0;

    const snapshot = scanSessionSnapshot(root, {
      afterDirectoryOpen: (relativeDirectory: string) => {
        if (relativeDirectory !== "nested") return;
        hookCount += 1;
        renameSync(join(root, "nested"), join(root, "parked"));
        symlinkSync(outside, join(root, "nested"));
      },
    });

    expect(hookCount).toBe(1);
    expect(snapshot.traces.map((trace) => trace.runtime)).toEqual(["inside"]);
    expect(snapshot.traces.map((trace) => trace.relativePath)).toEqual(["nested/inside.atf.json"]);
  });

  test("Given the approved root is replaced after validation, When scanned, Then traversal stays on the acquired root", () => {
    const container = fixtureRoot();
    const root = join(container, "approved");
    const replacement = join(container, "replacement");
    mkdirSync(root);
    mkdirSync(replacement);
    writeFileSync(join(root, "inside.atf.json"), validAtf("inside"));
    writeFileSync(join(replacement, "outside.atf.json"), validAtf("outside"));

    const snapshot = scanSessionSnapshot(root, {
      afterRootPathResolved: (resolvedRoot: string) => {
        renameSync(resolvedRoot, join(container, "parked"));
        renameSync(replacement, resolvedRoot);
      },
    });

    expect(snapshot.traces.map((trace) => trace.runtime)).toEqual(["inside"]);
    expect(snapshot.traces.map((trace) => trace.relativePath)).toEqual(["inside.atf.json"]);
  });

  test("Given native descriptor traversal is unavailable, When scanned, Then it fails closed", () => {
    const root = fixtureRoot();
    writeFileSync(join(root, "trace.atf.json"), validAtf());

    expectCode(
      () => scanSessionSnapshot(root, { forceUnsupportedPlatform: true }),
      "unsupported_platform",
    );
  });

  test("Given nested ATFs, When scanned, Then it freezes valid bytes in selector order", () => {
    const root = fixtureRoot();
    mkdirSync(join(root, "nested"));
    writeFileSync(join(root, "z.atf.json"), validAtf("codex"));
    writeFileSync(join(root, "nested", "a.atf.json"), validAtf("claude-code"));
    writeFileSync(join(root, "ignored.json"), "{}");

    const snapshot = scanSessionSnapshot(root);

    expect(snapshot.traces).toHaveLength(2);
    expect(snapshot.traces.map((trace) => trace.selector)).toEqual(
      snapshot.traces.map((trace) => trace.selector).toSorted(),
    );
    expect(snapshot.traces.every((trace) => /^s-[a-f0-9]{64}$/.test(trace.selector))).toBe(true);
    expect(String(snapshot.traces.find((trace) => trace.relativePath === "z.atf.json")?.selector)).toBe(
      "s-7303a2074a8304f60e6036ab9b3635aee7705b101f0d4ba68497d60bd46b14d4",
    );
    expect(snapshot.totalByteCount).toBe(
      snapshot.traces.reduce((sum, trace) => sum + trace.byteCount, 0),
    );
  });

  test("Given a snapshot, When a new file appears, Then selectors remain stable and rehash ignores it", () => {
    const root = fixtureRoot();
    writeFileSync(join(root, "one.atf.json"), validAtf());
    const before = scanSessionSnapshot(root);

    writeFileSync(join(root, "new.atf.json"), validAtf("opencode"));
    const after = scanSessionSnapshot(root);
    const checked = assertTracesUnchanged(before, before.traces);

    expect(after.traces.find((trace) => trace.relativePath === "one.atf.json")?.selector).toBe(
      before.traces[0]?.selector,
    );
    expect(checked).toHaveLength(1);
  });

  test("Given malformed ATFs, When scanned, Then JSON, UTF-8, schema, and event counts fail", () => {
    const cases = [
      new TextEncoder().encode("{"),
      Uint8Array.from([0xc3, 0x28]),
      new TextEncoder().encode(JSON.stringify({ runtime: "", status: "collected", eventCount: 0, events: [] })),
      new TextEncoder().encode(JSON.stringify({ runtime: "codex", status: "collected", eventCount: 1, events: [] })),
    ];

    for (const bytes of cases) {
      const root = fixtureRoot();
      writeFileSync(join(root, "bad.atf.json"), bytes);
      expectCode(() => scanSessionSnapshot(root), "invalid_trace");
    }
  });

  test("Given unsafe explicit paths, When read, Then absolute and traversal paths fail closed", () => {
    const root = fixtureRoot();
    writeFileSync(join(root, "ok.atf.json"), validAtf());

    expectCode(() => readExplicitTraces(root, ["/tmp/out.atf.json"]), "unsafe_trace_path");
    expectCode(() => readExplicitTraces(root, ["../out.atf.json"]), "unsafe_trace_path");
    expectCode(() => readExplicitTraces(root, ["ok.atf.json", "ok.atf.json"]), "duplicate_trace");
  });

  test("Given symlink files and directories, When scanned or explicit, Then links are never followed", () => {
    const root = fixtureRoot();
    const outside = fixtureRoot();
    writeFileSync(join(outside, "secret.atf.json"), validAtf());
    symlinkSync(join(outside, "secret.atf.json"), join(root, "link.atf.json"));
    symlinkSync(outside, join(root, "linked-dir"));

    expect(scanSessionSnapshot(root).traces).toHaveLength(0);
    expectCode(() => readExplicitTraces(root, ["link.atf.json"]), "unsafe_trace_path");
  });

  test("Given a read-time pathname replacement, When freezing, Then identity drift is rejected", () => {
    const root = fixtureRoot();
    const target = join(root, "race.atf.json");
    const replacement = join(root, "replacement.atf.json");
    writeFileSync(target, validAtf("codex"));
    writeFileSync(replacement, validAtf("opencode"));

    expectCode(
      () =>
        readExplicitTraces(root, ["race.atf.json"], {
          afterInitialStat: () => renameSync(replacement, target),
        }),
      "trace_drift",
    );
  });

  test("Given a frozen trace, When its exposed bytes are mutated, Then the snapshot remains intact", () => {
    const root = fixtureRoot();
    const original = validAtf();
    writeFileSync(join(root, "safe.atf.json"), original);
    const snapshot = scanSessionSnapshot(root);
    const exposed = snapshot.traces[0]?.bytes;
    if (exposed === undefined) throw new Error("missing fixture trace");

    exposed.fill(0);
    const checked = assertTracesUnchanged(snapshot, snapshot.traces);

    expect(checked[0]?.bytes).toEqual(original);
  });

  test("Given selected traces, When deleted, replaced, symlinked, or mutated, Then final checks detect drift", () => {
    const mutations: readonly ((root: string, path: string) => void)[] = [
      (_root, path) => rmSync(path),
      (root, path) => {
        writeFileSync(join(root, "other"), validAtf("opencode"));
        renameSync(join(root, "other"), path);
      },
      (root, path) => {
        rmSync(path);
        writeFileSync(join(root, "other"), validAtf());
        symlinkSync(join(root, "other"), path);
      },
      (_root, path) => writeFileSync(path, validAtf("hermes")),
    ];

    for (const mutate of mutations) {
      const root = fixtureRoot();
      const path = join(root, "selected.atf.json");
      writeFileSync(path, validAtf());
      const snapshot = scanSessionSnapshot(root);
      mutate(root, path);
      expectCode(() => assertTracesUnchanged(snapshot, snapshot.traces), "trace_drift");
    }
  });

  test("Given a selected subset, When resolved, Then only exact full selectors are accepted", () => {
    const root = fixtureRoot();
    writeFileSync(join(root, "one.atf.json"), validAtf());
    const snapshot = scanSessionSnapshot(root);
    const selector = snapshot.traces[0]?.selector;
    if (selector === undefined) throw new Error("missing fixture selector");

    expect(resolveTraceSelector(snapshot, selector).selector).toBe(selector);
    expectCode(() => resolveTraceSelector(snapshot, selector.slice(0, 12)), "invalid_selector");
  });

  test("Given a small injected retained-byte cap, When aggregate size exceeds it, Then scan rejects", () => {
    const root = fixtureRoot();
    const bytes = validAtf();
    writeFileSync(join(root, "one.atf.json"), bytes);
    writeFileSync(join(root, "two.atf.json"), bytes);

    expectCode(
      () => scanSessionSnapshot(root, { maxRetainedBytes: bytes.byteLength * 2 - 1 }),
      "snapshot_too_large",
    );
  });

  test("Given an external sentinel, When unsafe input is rejected, Then it is neither read nor modified", () => {
    const root = fixtureRoot();
    const outside = fixtureRoot();
    const sentinel = join(outside, "sentinel.atf.json");
    writeFileSync(sentinel, "not-json-secret");

    expectCode(() => readExplicitTraces(root, ["../sentinel.atf.json"]), "unsafe_trace_path");
    expect(readFileSync(sentinel, "utf8")).toBe("not-json-secret");
  });
});
