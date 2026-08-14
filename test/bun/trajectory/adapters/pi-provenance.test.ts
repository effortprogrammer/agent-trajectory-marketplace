import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { piAdapter } from "../../../../src/trajectory/adapters/pi-family";

const roots: string[] = [];

const writePiSession = (scopeDir: string, records: readonly unknown[]): string => {
  const root = mkdtempSync(join(tmpdir(), "pi-provenance-"));
  roots.push(root);
  const directory = join(root, ".pi", "agent", "sessions", scopeDir);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "2026-07-20_sess0001.jsonl");
  writeFileSync(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
  return path;
};

const nativeRecords = [
  {
    type: "session",
    version: 3,
    id: "sess0001",
    timestamp: "2026-07-20T10:00:00.000Z",
    cwd: "/work/demo",
  },
  {
    type: "message",
    id: "e1",
    parentId: null,
    timestamp: "2026-07-20T10:00:01.000Z",
    message: { role: "user", content: "run the tests" },
  },
] as const;

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("upstream Pi provenance", () => {
  test("requires an explicit operator declaration for native Pi conversion", () => {
    const sessionPath = writePiSession("--work-demo--", nativeRecords);
    const declared = { sessionPath, runtimeAttribution: "operator_declared" as const };

    expect(() => piAdapter.convertSession({ sessionPath })).toThrow(/operator declaration/);
    expect(piAdapter.convertSession(declared)).toMatchObject({
      runtime: "pi",
      runtimeAttribution: "operator_declared",
    });
  });

  test("rejects a copied v3 session without native scope evidence", () => {
    const sessionPath = writePiSession("-work-demo", nativeRecords);

    expect(() =>
      piAdapter.convertSession({ sessionPath, runtimeAttribution: "operator_declared" }),
    ).toThrow(/upstream Pi/);
  });

  test("rejects fork lineage even under a matching native scope", () => {
    const sessionPath = writePiSession("--work-demo--", [
      ...nativeRecords,
      {
        type: "session_info",
        id: "info1",
        parentId: null,
        timestamp: "2026-07-20T10:00:02.000Z",
        name: "fork session metadata",
      },
    ]);

    expect(() =>
      piAdapter.convertSession({ sessionPath, runtimeAttribution: "operator_declared" }),
    ).toThrow(/lineage/);
  });

  test("rejects conflicting strong fork evidence hidden by a Pi path", () => {
    const sessionPath = writePiSession("--work-demo--", [
      ...nativeRecords,
      {
        type: "header_patch",
        id: "patch1",
        timestamp: "2026-07-20T10:00:02.000Z",
        patch: { title: "gajae patch record" },
      },
    ]);

    expect(() =>
      piAdapter.convertSession({ sessionPath, runtimeAttribution: "operator_declared" }),
    ).toThrow(/gajae-code/);
  });

  test("rejects malformed JSON before the final non-empty line", () => {
    const sessionPath = writePiSession("--work-demo--", nativeRecords);
    writeFileSync(
      sessionPath,
      `${JSON.stringify(nativeRecords[0])}\n{not-json\n${JSON.stringify(nativeRecords[1])}\n`,
      "utf8",
    );
    const declared = { sessionPath, runtimeAttribution: "operator_declared" as const };

    expect(() => piAdapter.convertSession(declared)).toThrow(/invalid_session/);
  });
});
