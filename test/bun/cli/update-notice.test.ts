import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  defaultNoticeStateRoot,
  maybePrintCliUpdateNotice,
} from "../../../src/cli/update-notice";

const roots: string[] = [];

const stateRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "atm-cli-update-notice-"));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("CLI update notice routing", () => {
  test("rejects an unvalidated state-root marker", () => {
    const root = stateRoot();
    writeFileSync(join(root, "install-state.json"), "{}");

    expect(defaultNoticeStateRoot({
      environment: { ATM_INSTALL_STATE_ROOT: root },
      executable: join(root, "current", "dist", "collector.js"),
      workingDirectory: root,
    })).toBeUndefined();
  });

  test("prints one line only for a successful interactive command", async () => {
    const lines: string[] = [];

    await maybePrintCliUpdateNotice(
      ["trajectory", "collect", "runtimes"],
      new AbortController().signal,
      undefined,
      {
        currentVersion: "1.0.11",
        isTTY: true,
        latestVersion: async () => "1.1.0",
        now: new Date("2026-08-18T00:00:00.000Z"),
        stateRoot: stateRoot(),
        write: (line) => {
          lines.push(line);
        },
      },
    );

    expect(lines).toEqual([
      "Update available: 1.0.11 -> 1.1.0. Run: trajectory update\n",
    ]);
  });

  test("skips interrupted, failed, non-TTY, help, doctor, and update commands", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const environment = {
      currentVersion: "1.0.11",
      isTTY: true,
      latestVersion: async (): Promise<string> => {
        calls += 1;
        return "1.1.0";
      },
      now: new Date("2026-08-18T00:00:00.000Z"),
      stateRoot: stateRoot(),
      write: (_line: string): void => {},
    };
    const skipped = [
      [["trajectory", "collect", "runtimes"], controller.signal, undefined, environment],
      [["trajectory", "collect", "runtimes"], new AbortController().signal, 1, environment],
      [["trajectory", "collect", "runtimes"], new AbortController().signal, undefined, { ...environment, isTTY: false }],
      [["--help"], new AbortController().signal, undefined, environment],
      [["trajectory", "doctor"], new AbortController().signal, undefined, environment],
      [["trajectory", "update"], new AbortController().signal, undefined, environment],
    ] as const;

    for (const [argumentsList, signal, exitCode, dependencies] of skipped) {
      await maybePrintCliUpdateNotice(
        argumentsList,
        signal,
        exitCode,
        dependencies,
      );
    }

    expect(calls).toBe(0);
  });
});
