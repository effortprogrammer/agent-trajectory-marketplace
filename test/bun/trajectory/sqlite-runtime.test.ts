import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSqliteSnapshot } from "../../../src/trajectory/adapters/sqlite-snapshot";

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
