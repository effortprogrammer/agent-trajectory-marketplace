import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { InstallLock, InstallState } from "../../../src/trajectory/install-state";
import {
  acquireInstallLock,
  deriveInstallPaths,
  InstallLockHeldError,
  readInstallState,
  writeInstallState,
} from "../../../src/trajectory/install-state";

const temporaryRoots: string[] = [];

const temporaryRoot = (): string => {
  const root = join(tmpdir(), `atm-install-state-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  temporaryRoots.push(root);
  return root;
};

const stateFixture = (root: string): InstallState => ({
  schemaVersion: 1,
  installRoot: root,
  outputDir: join(root, "collected"),
  service: {
    runtimes: ["claude-code", "codex"],
    sourceDir: join(root, "sessions"),
    intervalSeconds: 17,
    settleSeconds: 23,
  },
});

const writeStaleLock = (lockFile: string, ageMs = 600_001): void => {
  writeFileSync(
    lockFile,
    JSON.stringify({
      schemaVersion: 1,
      pid: 2_147_483_647,
      createdAtMs: Date.now() - ageMs,
      token: crypto.randomUUID(),
    }),
    "utf8",
  );
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("deriveInstallPaths", () => {
  test("models stable state outside a versioned release", () => {
    const root = temporaryRoot();

    const paths = deriveInstallPaths(root, "1.2.3");

    expect(paths).toEqual({
      stateRoot: root,
      releasesDir: join(root, "releases"),
      releaseDir: join(root, "releases", "1.2.3"),
      currentPointer: join(root, "current"),
      previousPointer: join(root, "previous"),
      stateFile: join(root, "install-state.json"),
      lockFile: join(root, "update.lock"),
      outputDir: join(root, "collected"),
    });
  });

  test("rejects a release version that can escape the state root", () => {
    const root = temporaryRoot();

    expect(() => deriveInstallPaths(root, "../escape")).toThrow();
  });
});

describe("install state persistence", () => {
  test("round-trips non-default output and collector options", () => {
    const root = temporaryRoot();
    const paths = deriveInstallPaths(root, "1.2.3");
    const state = stateFixture(root);

    writeInstallState(paths, state);

    expect(readInstallState(paths)).toEqual(state);
  });

  test("strictly rejects stale state and unknown credential fields", () => {
    const root = temporaryRoot();
    const paths = deriveInstallPaths(root, "1.2.3");
    writeFileSync(
      paths.stateFile,
      JSON.stringify({ ...stateFixture(root), schemaVersion: 0, credentials: { token: "secret" } }),
      "utf8",
    );

    expect(() => readInstallState(paths)).toThrow();
  });

  test("refuses secret-bearing writes before persisting a file", () => {
    const root = temporaryRoot();
    const paths = deriveInstallPaths(root, "1.2.3");
    const unsafeState = { ...stateFixture(root), credentials: { token: "secret" } };

    expect(() => writeInstallState(paths, unsafeState)).toThrow();
    expect(existsSync(paths.stateFile)).toBe(false);
  });

  test("cleans temporary files after an interrupted atomic replacement", () => {
    const root = temporaryRoot();
    const paths = deriveInstallPaths(root, "1.2.3");
    mkdirSync(paths.stateFile);

    expect(() => writeInstallState(paths, stateFixture(root))).toThrow();

    expect(readdirSync(root).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });

  test("leaves complete state after repeated atomic replacements", () => {
    const root = temporaryRoot();
    const paths = deriveInstallPaths(root, "1.2.3");

    for (let index = 1; index <= 25; index += 1) {
      writeInstallState(paths, {
        ...stateFixture(root),
        service: { ...stateFixture(root).service, intervalSeconds: index },
      });
    }

    expect(readInstallState(paths).service.intervalSeconds).toBe(25);
    expect(readdirSync(root).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });
});

describe("install update lock", () => {
  test("rejects an immediate contender while the owner is alive", () => {
    const paths = deriveInstallPaths(temporaryRoot(), "1.2.3");
    const owner = acquireInstallLock(paths);

    expect(() => acquireInstallLock(paths)).toThrow(InstallLockHeldError);
    owner.release();
  });

  test("recovers only a lock older than ten minutes with a missing PID", () => {
    const paths = deriveInstallPaths(temporaryRoot(), "1.2.3");
    writeStaleLock(paths.lockFile);

    const recovered = acquireInstallLock(paths);

    expect(recovered.pid).toBe(process.pid);
    recovered.release();
    expect(existsSync(paths.lockFile)).toBe(false);
  });

  test("rejects a second contender racing the same stale recovery", () => {
    const paths = deriveInstallPaths(temporaryRoot(), "1.2.3");
    writeStaleLock(paths.lockFile);
    let nestedLock: InstallLock | undefined;
    let nestedRejected = false;

    const recovered = acquireInstallLock(paths, {
      beforeStaleUnlink: () => {
        try {
          nestedLock = acquireInstallLock(paths);
        } catch (caught: unknown) {
          nestedRejected = caught instanceof InstallLockHeldError;
        }
      },
    });

    expect(nestedRejected).toBe(true);
    expect(nestedLock).toBeUndefined();
    nestedLock?.release();
    recovered.release();
  });

  test("does not recover a missing-PID lock at exactly ten minutes", () => {
    const paths = deriveInstallPaths(temporaryRoot(), "1.2.3");
    const nowMs = Date.now();
    writeFileSync(
      paths.lockFile,
      JSON.stringify({
        schemaVersion: 1,
        pid: 2_147_483_647,
        createdAtMs: nowMs - 600_000,
        token: crypto.randomUUID(),
      }),
      "utf8",
    );

    expect(() => acquireInstallLock(paths, { nowMs })).toThrow(InstallLockHeldError);
  });

  test("does not reclaim malformed or old live-owner locks", () => {
    const paths = deriveInstallPaths(temporaryRoot(), "1.2.3");
    writeFileSync(paths.lockFile, '{"pid":"unknown"}\n', "utf8");
    expect(() => acquireInstallLock(paths)).toThrow(InstallLockHeldError);
    rmSync(paths.lockFile);
    writeFileSync(
      paths.lockFile,
      JSON.stringify({
        schemaVersion: 1,
        pid: process.pid,
        createdAtMs: Date.now() - 1_200_000,
        token: crypto.randomUUID(),
      }),
      "utf8",
    );

    expect(() => acquireInstallLock(paths)).toThrow(InstallLockHeldError);
  });
});
