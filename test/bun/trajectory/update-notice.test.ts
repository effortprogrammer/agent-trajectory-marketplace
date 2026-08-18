import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  checkUpdateNotice,
  formatUpdateNotice,
} from "../../../src/trajectory/update-notice";

const roots: string[] = [];

const stateRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "atm-update-notice-"));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("bounded update availability notice", () => {
  test("renders one actionable stderr line", () => {
    expect(formatUpdateNotice({
      currentVersion: "1.0.11",
      latestVersion: "1.1.0",
      command: "trajectory update",
    })).toBe(
      "Update available: 1.0.11 -> 1.1.0. Run: trajectory update\n",
    );
  });

  test("checks every six hours but notifies at most once per day", async () => {
    const root = stateRoot();
    let calls = 0;
    const latestVersion = async (): Promise<string> => {
      calls += 1;
      return "1.1.0";
    };
    const first = new Date("2026-08-18T00:00:00.000Z");

    expect(await checkUpdateNotice({
      currentVersion: "1.0.11",
      latestVersion,
      now: first,
      stateRoot: root,
    })).toEqual({
      currentVersion: "1.0.11",
      latestVersion: "1.1.0",
      command: "trajectory update",
    });
    expect(await checkUpdateNotice({
      currentVersion: "1.0.11",
      latestVersion,
      now: new Date(first.getTime() + 60 * 60 * 1_000),
      stateRoot: root,
    })).toBeUndefined();
    expect(await checkUpdateNotice({
      currentVersion: "1.0.11",
      latestVersion,
      now: new Date(first.getTime() + 7 * 60 * 60 * 1_000),
      stateRoot: root,
    })).toBeUndefined();
    expect(await checkUpdateNotice({
      currentVersion: "1.0.11",
      latestVersion,
      now: new Date(first.getTime() + 25 * 60 * 60 * 1_000),
      stateRoot: root,
    })).toEqual({
      currentVersion: "1.0.11",
      latestVersion: "1.1.0",
      command: "trajectory update",
    });
    expect(calls).toBe(3);
  });

  test("stays silent when current or when the bounded check fails", async () => {
    const currentRoot = stateRoot();
    const failedRoot = stateRoot();

    expect(await checkUpdateNotice({
      currentVersion: "1.0.11",
      latestVersion: async () => "1.0.11",
      now: new Date("2026-08-18T00:00:00.000Z"),
      stateRoot: currentRoot,
    })).toBeUndefined();
    expect(await checkUpdateNotice({
      currentVersion: "1.0.11",
      latestVersion: async () => {
        throw new Error("offline");
      },
      now: new Date("2026-08-18T00:00:00.000Z"),
      stateRoot: failedRoot,
    })).toBeUndefined();
  });

  test("does not contact GitHub outside a managed install", async () => {
    let called = false;

    expect(await checkUpdateNotice({
      currentVersion: "1.0.11",
      latestVersion: async () => {
        called = true;
        return "1.1.0";
      },
      now: new Date("2026-08-18T00:00:00.000Z"),
      stateRoot: undefined,
    })).toBeUndefined();
    expect(called).toBe(false);
  });

  test("does not check or write after the command is aborted", async () => {
    const root = stateRoot();
    const controller = new AbortController();
    let called = false;
    controller.abort();

    expect(await checkUpdateNotice({
      currentVersion: "1.0.11",
      latestVersion: async () => {
        called = true;
        return "1.1.0";
      },
      now: new Date("2026-08-18T00:00:00.000Z"),
      signal: controller.signal,
      stateRoot: root,
    })).toBeUndefined();
    expect(called).toBe(false);
    expect(existsSync(join(root, "update-notice.sqlite"))).toBe(false);
  });

  test("serializes concurrent processes to one notification", async () => {
    const root = stateRoot();
    let calls = 0;
    let releaseCheck = (): void => {};
    let reportStarted = (): void => {};
    const started = new Promise<void>((resolve) => {
      reportStarted = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      releaseCheck = resolve;
    });
    const latestVersion = async (): Promise<string> => {
      calls += 1;
      reportStarted();
      await blocked;
      return "1.1.0";
    };
    const request = {
      currentVersion: "1.0.11",
      latestVersion,
      now: new Date("2026-08-18T00:00:00.000Z"),
      stateRoot: root,
    } as const;

    const first = checkUpdateNotice(request);
    await started;
    const second = await checkUpdateNotice(request);
    releaseCheck();

    expect(await first).toEqual({
      currentVersion: "1.0.11",
      latestVersion: "1.1.0",
      command: "trajectory update",
    });
    expect(second).toBeUndefined();
    expect(calls).toBe(1);
  });

  test("rejects a symlinked notice database without touching its target", async () => {
    const root = stateRoot();
    const target = join(root, "target.sqlite");
    writeFileSync(target, "");
    symlinkSync(target, join(root, "update-notice.sqlite"));
    let called = false;

    expect(await checkUpdateNotice({
      currentVersion: "1.0.11",
      latestVersion: async () => {
        called = true;
        return "1.1.0";
      },
      now: new Date("2026-08-18T00:00:00.000Z"),
      stateRoot: root,
    })).toBeUndefined();
    expect(called).toBe(false);
    expect(readFileSync(target, "utf8")).toBe("");
  });
});
