import { Database } from "bun:sqlite";
import { constants, copyFileSync, existsSync, lstatSync, mkdtempSync, rmSync } from "node:fs";
import type { Stats } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class SqliteSnapshotError extends Error {
  readonly name = "SqliteSnapshotError";
}

export type SqliteSnapshot = Readonly<{
  close: () => void;
  database: Database;
}>;

type SourceVersion = Readonly<{
  ctimeMs: number;
  dev: number;
  ino: number;
  mtimeMs: number;
  size: number;
}>;

const sourceVersion = (status: Stats): SourceVersion => ({
  ctimeMs: status.ctimeMs,
  dev: status.dev,
  ino: status.ino,
  mtimeMs: status.mtimeMs,
  size: status.size,
});

const sameVersion = (left: SourceVersion, right: SourceVersion): boolean =>
  left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
  left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;

const copyStableFile = (source: string, target: string): void => {
  const beforeStatus = lstatSync(source);
  if (!beforeStatus.isFile() || beforeStatus.isSymbolicLink()) {
    throw new SqliteSnapshotError("unsafe_sqlite_source");
  }
  const before = sourceVersion(beforeStatus);
  copyFileSync(source, target, constants.COPYFILE_EXCL);
  if (!sameVersion(before, sourceVersion(lstatSync(source)))) {
    throw new SqliteSnapshotError("sqlite_source_changed");
  }
};

export const openSqliteSnapshot = (sourcePath: string): SqliteSnapshot => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "trajectory-sqlite-snapshot-"));
  const databasePath = join(temporaryRoot, "source.db");
  const sidecarSuffixes = ["-wal", "-shm", "-journal"] as const;
  const sidecarsBefore = sidecarSuffixes.map((suffix) => existsSync(`${sourcePath}${suffix}`));
  try {
    copyStableFile(sourcePath, databasePath);
    for (const [index, suffix] of sidecarSuffixes.entries()) {
      if (sidecarsBefore[index] === true && suffix !== "-shm") {
        copyStableFile(`${sourcePath}${suffix}`, `${databasePath}${suffix}`);
      }
    }
    const sidecarsAfter = sidecarSuffixes.map((suffix) => existsSync(`${sourcePath}${suffix}`));
    if (sidecarsBefore.some((present, index) => present !== sidecarsAfter[index])) {
      throw new SqliteSnapshotError("sqlite_source_changed");
    }
    const database = new Database(databasePath, { readwrite: true, strict: true });
    database.exec("PRAGMA query_only = ON");
    let open = true;
    return Object.freeze({
      close: (): void => {
        if (!open) return;
        open = false;
        try {
          database.close();
        } finally {
          rmSync(temporaryRoot, { force: true, recursive: true });
        }
      },
      database,
    });
  } catch (error) {
    rmSync(temporaryRoot, { force: true, recursive: true });
    if (error instanceof Error) throw error;
    throw new SqliteSnapshotError("sqlite_snapshot_failed");
  }
};
