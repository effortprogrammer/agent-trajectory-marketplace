import { Database } from "bun:sqlite"
import { existsSync, readdirSync, statSync } from "node:fs"
import { basename, join } from "node:path"

import type { HarnessSessionRef } from "../contract"
import { TrajectoryAdapterError } from "../contract"

// OpenCode's production schema (anomalyco/opencode packages/core/src/session/sql.ts):
//   session(id TEXT PK, time_created INTEGER, time_updated INTEGER, ...)
//   message(id TEXT PK, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)
//   part(id TEXT PK, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)
// Time columns are integer epoch-ms on every table.

export type OpenCodeSessionRow = {
  readonly id: string
  readonly time_created: number | null
  readonly time_updated: number | null
}

export type OpenCodeMessageRow = {
  readonly id: string
  readonly time_created: number | null
  readonly time_updated: number | null
  readonly data: string | null
}

export type OpenCodePartRow = {
  readonly id: string
  readonly message_id: string
  readonly time_created: number | null
  readonly time_updated: number | null
  readonly data: string | null
}

type OpenCodeSessionListRow = {
  readonly id: string
  readonly time_created: number | null
  readonly time_updated: number | null
  readonly msg_count: number
}

// OpenCode writes one opencode*.db per release channel; the default channel
// is `opencode.db` and per-channel variants are suffix-named
// (opencode-nightly.db, opencode-main.db, ...). Sidecar -wal/-shm files
// never match.
const dbFilePattern = /^opencode.*\.db$/i

export const listOpenCodeDbFiles = (sourceDir: string): readonly string[] => {
  if (!existsSync(sourceDir)) {
    throw new TrajectoryAdapterError("missing_source_dir", `missing_source_dir: ${sourceDir}`)
  }
  const sourceStat = statSync(sourceDir)
  if (sourceStat.isFile()) {
    if (!dbFilePattern.test(basename(sourceDir))) {
      throw new TrajectoryAdapterError("missing_source_dir", `missing_source_dir: ${sourceDir}`)
    }
    return [sourceDir]
  }
  if (!sourceStat.isDirectory()) {
    throw new TrajectoryAdapterError("missing_source_dir", `missing_source_dir: ${sourceDir}`)
  }
  const entries = readdirSync(sourceDir, { withFileTypes: true })
  const dbPaths: string[] = []
  for (const entry of entries) {
    if (entry.isFile() && dbFilePattern.test(entry.name)) {
      dbPaths.push(join(sourceDir, entry.name))
    }
  }
  return dbPaths.sort()
}

// OpenCode runs SQLite in WAL mode; a strictly read-only connection cannot
// create the missing -shm sidecar and fails with SQLITE_CANTOPEN. Probe
// read-only first, then fall back to a WAL-safe connection that this
// adapter only ever uses for SELECTs (mirrors the hermes pattern).
export const openOpenCodeDatabase = (dbPath: string): Database => {
  if (!existsSync(dbPath) || !statSync(dbPath).isFile()) {
    throw new TrajectoryAdapterError("missing_source_dir", `missing_source_dir: ${dbPath}`)
  }
  let readonlyDb: Database | undefined
  try {
    readonlyDb = new Database(dbPath, { readonly: true, strict: true })
    readonlyDb.query("SELECT 1").get()
    return readonlyDb
  } catch {
    readonlyDb?.close()
    return new Database(dbPath, { strict: true })
  }
}

// Resolves the explicit sessionPath argument: a `.db` file is used directly,
// otherwise the path is treated as a data directory and the lexically-first
// opencode*.db file is selected so the result is deterministic.
export const resolveOpenCodeDbPath = (sessionPath: string): string => {
  if (sessionPath.endsWith(".db")) return sessionPath
  const dbPaths = listOpenCodeDbFiles(sessionPath)
  const first = dbPaths[0]
  if (first === undefined) {
    throw new TrajectoryAdapterError("missing_source_dir", `missing_source_dir: ${sessionPath}`)
  }
  return first
}

export const fetchOpenCodeSession = (
  sqlite: Database,
  sessionId: string,
): OpenCodeSessionRow | null =>
  sqlite
    .query<OpenCodeSessionRow, [string]>(
      "SELECT id, time_created, time_updated FROM session WHERE id = ?",
    )
    .get(sessionId)

export const fetchOpenCodeMessages = (
  sqlite: Database,
  sessionId: string,
): readonly OpenCodeMessageRow[] =>
  sqlite
    .query<OpenCodeMessageRow, [string]>(
      // rowid preserves insertion order even when ids are non-monotonic
      // strings (the production store uses time-sortable ULIDs, but the
      // adapter must not depend on that).
      "SELECT id, time_created, time_updated, data FROM message WHERE session_id = ? ORDER BY rowid ASC",
    )
    .all(sessionId)

export const fetchOpenCodeParts = (
  sqlite: Database,
  sessionId: string,
): readonly OpenCodePartRow[] =>
  sqlite
    .query<OpenCodePartRow, [string]>(
      "SELECT id, message_id, time_created, time_updated, data FROM part WHERE session_id = ? ORDER BY rowid ASC",
    )
    .all(sessionId)

const epochMsToIso = (ms: number): string => new Date(ms).toISOString()

// Enumerates every session across every opencode*.db file under a data
// directory, newest-first by time_updated (falling back to time_created).
// Per-session message count stands in for sizeBytes since the store is one
// shared file (same shape as the hermes adapter).
export const listOpenCodeSessions = (sourceDir: string): readonly HarnessSessionRef[] => {
  const dbPaths = listOpenCodeDbFiles(sourceDir)
  if (dbPaths.length === 0) {
    throw new TrajectoryAdapterError("missing_source_dir", `missing_source_dir: ${sourceDir}`)
  }
  const refs: HarnessSessionRef[] = []
  for (const dbPath of dbPaths) {
    const sqlite = openOpenCodeDatabase(dbPath)
    try {
      const rows = sqlite
        .query<OpenCodeSessionListRow, []>(
          `SELECT s.id AS id, s.time_created AS time_created, s.time_updated AS time_updated,
           COALESCE(m.msg_count, 0) AS msg_count
           FROM session s
           LEFT JOIN (
             SELECT session_id, COUNT(*) AS msg_count FROM message GROUP BY session_id
           ) m ON m.session_id = s.id`,
        )
        .all()
      for (const row of rows) {
        const modifiedMs = row.time_updated ?? row.time_created
        if (modifiedMs === null) continue
        refs.push({
          sessionId: row.id,
          sessionPath: dbPath,
          modifiedAt: epochMsToIso(modifiedMs),
          sizeBytes: row.msg_count,
        })
      }
    } finally {
      sqlite.close()
    }
  }
  return refs.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))
}
