import { Database } from "bun:sqlite"
import { existsSync, statSync } from "node:fs"
import { join } from "node:path"

import { TrajectoryAdapterError } from "../contract"

export type HermesSessionRow = {
  readonly session_id: string
  readonly model: string | null
  readonly cwd: string | null
  readonly last_activity: number | null
  readonly msg_count: number
}

// Hermes schema v19 exposes per-session aggregate usage on the `sessions`
// table. Older or stripped schemas may omit them; the adapter probes PRAGMA
// and only SELECTs the columns that exist.
export type HermesSessionUsageRow = {
  readonly model: string | null
  readonly cwd: string | null
  readonly input_tokens: number | null
  readonly output_tokens: number | null
  readonly cache_read_tokens: number | null
  readonly cache_write_tokens: number | null
  readonly reasoning_tokens: number | null
}

export type HermesMessageRow = {
  readonly id: number
  readonly role: string
  readonly content: string | null
  readonly timestamp: number | null
  readonly tool_call_id: string | null
  readonly tool_calls: string | null
  readonly tool_name: string | null
}

export type HermesSessionData = Readonly<{
  readonly dbPath: string
  readonly session: HermesSessionUsageRow
  readonly messages: readonly HermesMessageRow[]
}>

export const resolveHermesDbPath = (sourceDirOrDb: string): string =>
  sourceDirOrDb.endsWith(".db") ? sourceDirOrDb : join(sourceDirOrDb, "state.db")

export const openHermesDatabase = (dbPath: string): Database => {
  if (!existsSync(dbPath) || !statSync(dbPath).isFile()) {
    throw new TrajectoryAdapterError("missing_source_dir", `missing_source_dir: ${dbPath}`)
  }
  // A native readonly connection can consume an existing WAL and its sidecars,
  // but cannot create, migrate, checkpoint, or otherwise mutate the source.
  return new Database(dbPath, { readonly: true, strict: true })
}

export const epochToIso = (epochSeconds: number | null): string =>
  new Date(Math.round((epochSeconds ?? 0) * 1_000)).toISOString()

const usageColumns = [
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "reasoning_tokens",
] as const

export const readHermesSession = (
  sourceDirOrDb: string,
  sessionId: string,
): HermesSessionData => {
  const dbPath = resolveHermesDbPath(sourceDirOrDb)
  const sqlite = openHermesDatabase(dbPath)
  try {
    const sessionsColumns = sqlite
      .query<{ readonly name: string }, []>("PRAGMA table_info(sessions)")
      .all()
    const availableColumns = new Set(sessionsColumns.map((row) => row.name))
    const usageColumnSelects = usageColumns
      .filter((column) => availableColumns.has(column))
      .map((column) => `CAST("${column}" AS REAL) AS ${column}`)
    const session = sqlite
      .query<HermesSessionUsageRow, [string]>(
        `SELECT model, cwd${
          usageColumnSelects.length === 0 ? "" : `, ${usageColumnSelects.join(", ")}`
        } FROM sessions WHERE id = ?`,
      )
      .get(sessionId)
    if (session === null) {
      throw new TrajectoryAdapterError(
        "missing_session",
        `missing_session: ${sessionId} not found in ${dbPath}`,
      )
    }
    const messages = sqlite
      .query<HermesMessageRow, [string]>(
        `SELECT id, role, content, timestamp, tool_call_id, tool_calls, tool_name
        FROM messages
        WHERE session_id = ? AND active = 1
        ORDER BY id ASC`,
      )
      .all(sessionId)
    return { dbPath, session, messages }
  } finally {
    sqlite.close()
  }
}
