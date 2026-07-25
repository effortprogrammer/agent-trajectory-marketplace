import { Database } from "bun:sqlite";
import { constants, copyFileSync, lstatSync, mkdtempSync, rmSync } from "node:fs";
import type { BigIntStats } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class SqliteSnapshotError extends Error {
  readonly name = "SqliteSnapshotError";
}

export type SqliteSnapshot = Readonly<{
  close: () => void;
  database: Database;
}>;

export type SqliteSnapshotOptions = Readonly<{
  readonly afterDatabaseCopy?: () => void;
  readonly afterSourceVersionCheck?: (source: string) => void;
}>;

type SourceVersion = Readonly<{
  ctimeNs: bigint;
  dev: bigint;
  ino: bigint;
  mtimeNs: bigint;
  size: bigint;
}>;

type StableCopyRequest = Readonly<{
  source: string;
  target: string;
  expected: SourceVersion;
  afterSourceVersionCheck: SqliteSnapshotOptions["afterSourceVersionCheck"];
}>;

const sourceVersion = (status: BigIntStats): SourceVersion => ({
  ctimeNs: status.ctimeNs,
  dev: status.dev,
  ino: status.ino,
  mtimeNs: status.mtimeNs,
  size: status.size,
});

const sameVersion = (left: SourceVersion, right: SourceVersion): boolean =>
  left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
  left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;

const readSourceVersion = (source: string): SourceVersion | undefined => {
  try {
    const status = lstatSync(source, { bigint: true });
    if (!status.isFile() || status.isSymbolicLink()) {
      throw new SqliteSnapshotError("unsafe_sqlite_source");
    }
    return sourceVersion(status);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
};

const copyStableFile = (request: StableCopyRequest): void => {
  const before = readSourceVersion(request.source);
  if (before === undefined || !sameVersion(request.expected, before)) {
    throw new SqliteSnapshotError("sqlite_source_changed");
  }
  request.afterSourceVersionCheck?.(request.source);
  try {
    copyFileSync(request.source, request.target, constants.COPYFILE_EXCL);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new SqliteSnapshotError("sqlite_source_changed");
    }
    throw error;
  }
  const after = readSourceVersion(request.source);
  if (after === undefined || !sameVersion(request.expected, after)) {
    throw new SqliteSnapshotError("sqlite_source_changed");
  }
};

export const openSqliteSnapshot = (
  sourcePath: string,
  options: SqliteSnapshotOptions = {},
): SqliteSnapshot => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "trajectory-sqlite-snapshot-"));
  const databasePath = join(temporaryRoot, "source.db");
  const suffixes = ["", "-wal", "-shm", "-journal"] as const;
  try {
    const sourceFiles = suffixes.map((suffix) => ({
      source: `${sourcePath}${suffix}`,
      suffix,
      version: readSourceVersion(`${sourcePath}${suffix}`),
    }));
    const databaseSource = sourceFiles[0];
    if (databaseSource?.version === undefined) throw new SqliteSnapshotError("unsafe_sqlite_source");
    copyStableFile({
      source: databaseSource.source,
      target: databasePath,
      expected: databaseSource.version,
      afterSourceVersionCheck: options.afterSourceVersionCheck,
    });
    options.afterDatabaseCopy?.();
    for (const sourceFile of sourceFiles.slice(1)) {
      if (sourceFile.version !== undefined && sourceFile.suffix !== "-shm") {
        copyStableFile({
          source: sourceFile.source,
          target: `${databasePath}${sourceFile.suffix}`,
          expected: sourceFile.version,
          afterSourceVersionCheck: options.afterSourceVersionCheck,
        });
      }
    }
    if (sourceFiles.some((sourceFile) => {
      const current = readSourceVersion(sourceFile.source);
      return sourceFile.version === undefined
        ? current !== undefined
        : current === undefined || !sameVersion(sourceFile.version, current);
    })) {
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
