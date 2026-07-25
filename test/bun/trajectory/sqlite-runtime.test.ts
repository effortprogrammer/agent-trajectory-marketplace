import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSqliteSnapshot, SqliteSnapshotError } from "../../../src/trajectory/adapters/sqlite-snapshot";
import type { SqliteSnapshot } from "../../../src/trajectory/adapters/sqlite-snapshot";

const manifest = (directory: string): readonly string[] =>
  readdirSync(directory).sort().map((name) => {
    const path = join(directory, name);
    return `${name}:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
  });

test("SQLite snapshots read a closed WAL database without mutating it", () => {
  // Given: a real SQLite database written in WAL mode and cleanly closed.
  const directory = mkdtempSync(join(tmpdir(), "atm-bun-sqlite-"));
  const databasePath = join(directory, "sessions.db");
  try {
    const writer = new Database(databasePath, { create: true, strict: true });
    writer.exec("PRAGMA journal_mode = WAL");
    writer.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, runtime TEXT NOT NULL)");
    writer.query("INSERT INTO sessions (id, runtime) VALUES (?, ?)").run("session-1", "opencode");
    writer.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    writer.close();
    const filesBeforeRead = readdirSync(directory).sort();
    const modifiedBeforeRead = statSync(databasePath).mtimeMs;

    // When: the source is snapshotted, read, and released.
    const snapshot = openSqliteSnapshot(databasePath);
    const row = snapshot.database.query<{ id: string; runtime: string }, []>("SELECT id, runtime FROM sessions").get();
    snapshot.close();

    // Then: the row is available and neither the database nor sidecar set changed.
    expect(row).toEqual({ id: "session-1", runtime: "opencode" });
    expect(readdirSync(directory).sort()).toEqual(filesBeforeRead);
    expect(statSync(databasePath).mtimeMs).toBe(modifiedBeforeRead);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("SQLite snapshots read live WAL rows without changing source sidecars", () => {
  // Given: an open writer with one checkpointed row and one live WAL row.
  const directory = mkdtempSync(join(tmpdir(), "atm-bun-sqlite-live-"));
  const databasePath = join(directory, "sessions.db");
  const writer = new Database(databasePath, { create: true, strict: true });
  try {
    writer.exec("PRAGMA journal_mode = WAL");
    writer.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, runtime TEXT NOT NULL)");
    writer.query("INSERT INTO sessions (id, runtime) VALUES (?, ?)").run("checkpointed", "hermes");
    writer.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    writer.query("INSERT INTO sessions (id, runtime) VALUES (?, ?)").run("live-wal", "opencode");
    const before = manifest(directory);

    // When: a snapshot reads while the native writer stays open.
    const snapshot = openSqliteSnapshot(databasePath);
    const rows = snapshot.database.query<{ id: string }, []>("SELECT id FROM sessions ORDER BY id").all();
    snapshot.close();

    // Then: live data is visible and every native source byte is unchanged.
    expect(rows).toEqual([{ id: "checkpointed" }, { id: "live-wal" }]);
    expect(manifest(directory)).toEqual(before);
  } finally {
    writer.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("SQLite snapshots reject a checkpoint between database and WAL copies", () => {
  // Given: a live WAL row that can be checkpointed after the base database copy.
  const directory = mkdtempSync(join(tmpdir(), "atm-bun-sqlite-race-"));
  const databasePath = join(directory, "sessions.db");
  const writer = new Database(databasePath, { create: true, strict: true });
  let snapshot: SqliteSnapshot | undefined;
  let caught: unknown;
  try {
    writer.exec("PRAGMA journal_mode = WAL");
    writer.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY)");
    writer.query("INSERT INTO sessions (id) VALUES (?)").run("checkpointed");
    writer.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    writer.query("INSERT INTO sessions (id) VALUES (?)").run("live-wal");

    // When: the writer checkpoints between the two filesystem copies.
    try {
      snapshot = openSqliteSnapshot(databasePath, {
        afterDatabaseCopy: () => writer.exec("PRAGMA wal_checkpoint(TRUNCATE)"),
      });
    } catch (error) {
      if (error instanceof SqliteSnapshotError) caught = error;
      else throw error;
    }
    snapshot?.close();

    // Then: the mixed source moments are rejected rather than opened.
    expect(caught).toBeInstanceOf(SqliteSnapshotError);
    if (!(caught instanceof SqliteSnapshotError)) throw new Error("expected SqliteSnapshotError");
    expect(caught.message).toBe("sqlite_source_changed");
  } finally {
    writer.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("SQLite snapshots normalize source disappearance between version check and copy", () => {
  // Given: a closed database removed immediately after its stable pre-copy version check.
  const directory = mkdtempSync(join(tmpdir(), "atm-bun-sqlite-copy-race-"));
  const databasePath = join(directory, "sessions.db");
  const writer = new Database(databasePath, { create: true, strict: true });
  writer.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY)");
  writer.close();
  let snapshot: SqliteSnapshot | undefined;
  let caught: unknown;
  const raceOptions = {
    afterDatabaseCopy: (): void => {},
    afterSourceVersionCheck: (source: string): void => {
      if (source === databasePath) unlinkSync(source);
    },
  };
  try {
    // When: the source disappears in the stat-to-copy race window.
    try {
      snapshot = openSqliteSnapshot(databasePath, raceOptions);
    } catch (error) {
      if (error instanceof SqliteSnapshotError) caught = error;
      else throw error;
    }
    snapshot?.close();

    // Then: callers receive the stable typed drift error rather than raw ENOENT.
    expect(caught).toBeInstanceOf(SqliteSnapshotError);
    if (!(caught instanceof SqliteSnapshotError)) throw new Error("expected SqliteSnapshotError");
    expect(caught.message).toBe("sqlite_source_changed");
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
