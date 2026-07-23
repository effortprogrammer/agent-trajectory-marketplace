import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Bun SQLite reads a closed WAL database without mutating it", () => {
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

    // When: Bun opens the closed database read-only, reads one row, and closes it.
    const reader = new Database(databasePath, { readonly: true, strict: true });
    const row = reader.query<{ id: string; runtime: string }, []>("SELECT id, runtime FROM sessions").get();
    reader.close();

    // Then: the row is available and neither the database nor sidecar set changed.
    expect(row).toEqual({ id: "session-1", runtime: "opencode" });
    expect(readdirSync(directory).sort()).toEqual(filesBeforeRead);
    expect(statSync(databasePath).mtimeMs).toBe(modifiedBeforeRead);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
