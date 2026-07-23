import { Database } from "bun:sqlite";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

import { z } from "zod";

import type { InstallPaths } from "./install-state";

const STALE_LOCK_AGE_MS = 10 * 60 * 1_000;

const installLockSchema = z
  .object({
    schemaVersion: z.literal(1),
    pid: z.number().int().positive(),
    createdAtMs: z.number().int().nonnegative(),
    token: z.string().uuid(),
  })
  .strict();

export type InstallLock = Readonly<{
  pid: number;
  release: () => void;
}>;

export class InstallLockHeldError extends Error {
  readonly name = "InstallLockHeldError";

  constructor(
    readonly lockFile: string,
    options?: ErrorOptions,
  ) {
    super(`install update lock is already held: ${lockFile}`, options);
  }
}

type AcquireInstallLockOptions = Readonly<{
  nowMs?: number;
  beforeStaleUnlink?: () => void;
}>;

type LockReadResult =
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "invalid"; raw: string }>
  | Readonly<{ kind: "valid"; raw: string; lock: z.infer<typeof installLockSchema> }>;

const isFileSystemError = (caught: unknown, code: string): boolean =>
  caught instanceof Error && "code" in caught && caught.code === code;

const isSqliteBusy = (caught: unknown): boolean =>
  caught instanceof Error &&
  "code" in caught &&
  (caught.code === "SQLITE_BUSY" || caught.code === "SQLITE_BUSY_RECOVERY");

const readLock = (lockFile: string): LockReadResult => {
  let raw: string;
  try {
    raw = readFileSync(lockFile, "utf8");
  } catch (caught: unknown) {
    if (isFileSystemError(caught, "ENOENT")) {
      return { kind: "missing" };
    }
    throw caught;
  }
  try {
    const parsed = installLockSchema.safeParse(JSON.parse(raw));
    return parsed.success ? { kind: "valid", raw, lock: parsed.data } : { kind: "invalid", raw };
  } catch (caught: unknown) {
    if (caught instanceof SyntaxError) {
      return { kind: "invalid", raw };
    }
    throw caught;
  }
};

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (caught: unknown) {
    if (isFileSystemError(caught, "ESRCH")) {
      return false;
    }
    if (isFileSystemError(caught, "EPERM")) {
      return true;
    }
    throw caught;
  }
};

const createLockFile = (
  lockFile: string,
  lock: z.infer<typeof installLockSchema>,
): "created" | "exists" => {
  let descriptor: number;
  try {
    descriptor = openSync(lockFile, "wx", 0o600);
  } catch (caught: unknown) {
    if (isFileSystemError(caught, "EEXIST")) {
      return "exists";
    }
    throw caught;
  }
  let completed = false;
  try {
    writeFileSync(descriptor, `${JSON.stringify(lock)}\n`, "utf8");
    fsyncSync(descriptor);
    completed = true;
  } finally {
    closeSync(descriptor);
    if (!completed) {
      unlinkSync(lockFile);
    }
  }
  return "created";
};

const releaseOwnedLockFile = (lockFile: string, token: string): void => {
  const current = readLock(lockFile);
  if (current.kind === "valid" && current.lock.token === token) {
    unlinkSync(lockFile);
  }
};

const coordinateStaleRecovery = (paths: InstallPaths, recover: () => void): void => {
  const database = new Database(`${paths.lockFile}.coordination`, { create: true, strict: true });
  database.run("PRAGMA busy_timeout=0");
  try {
    try {
      database.run("BEGIN IMMEDIATE");
    } catch (caught: unknown) {
      if (isSqliteBusy(caught)) {
        throw new InstallLockHeldError(paths.lockFile, { cause: caught });
      }
      throw caught;
    }
    try {
      recover();
      database.run("COMMIT");
    } catch (caught: unknown) {
      database.run("ROLLBACK");
      throw caught;
    }
  } finally {
    database.close();
  }
};

export const acquireInstallLock = (
  paths: InstallPaths,
  options: AcquireInstallLockOptions = {},
): InstallLock => {
  mkdirSync(paths.stateRoot, { recursive: true });
  const nowMs = options.nowMs ?? Date.now();
  const lock = installLockSchema.parse({
    schemaVersion: 1,
    pid: process.pid,
    createdAtMs: nowMs,
    token: crypto.randomUUID(),
  });

  if (createLockFile(paths.lockFile, lock) === "exists") {
    coordinateStaleRecovery(paths, (): void => {
      const existing = readLock(paths.lockFile);
      const stale =
        existing.kind === "valid" &&
        nowMs - existing.lock.createdAtMs > STALE_LOCK_AGE_MS &&
        !isProcessAlive(existing.lock.pid);
      if (!stale) {
        throw new InstallLockHeldError(paths.lockFile);
      }
      options.beforeStaleUnlink?.();
      unlinkSync(paths.lockFile);
      if (createLockFile(paths.lockFile, lock) === "exists") {
        throw new InstallLockHeldError(paths.lockFile);
      }
    });
  }

  let released = false;
  return {
    pid: lock.pid,
    release: (): void => {
      if (released) {
        return;
      }
      released = true;
      releaseOwnedLockFile(paths.lockFile, lock.token);
    },
  };
};
