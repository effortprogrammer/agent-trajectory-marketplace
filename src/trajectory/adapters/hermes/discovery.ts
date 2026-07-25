import type { HarnessSessionRef } from "../contract"

import {
  epochToIso,
  openHermesDatabase,
  resolveHermesDbPath,
  type HermesSessionRow,
} from "./database"

export const listHermesSessions = (sourceDir: string): readonly HarnessSessionRef[] => {
  const dbPath = resolveHermesDbPath(sourceDir)
  const snapshot = openHermesDatabase(dbPath)
  const sqlite = snapshot.database
  try {
    const rows = sqlite
      .query<HermesSessionRow, []>(
        `SELECT
          s.id AS session_id,
          s.model AS model,
          s.cwd AS cwd,
          COALESCE(m.max_ts, s.ended_at, s.started_at) AS last_activity,
          COALESCE(m.msg_count, 0) AS msg_count
        FROM sessions s
        LEFT JOIN (
          SELECT session_id, MAX(timestamp) AS max_ts, COUNT(*) AS msg_count
          FROM messages
          WHERE active = 1
          GROUP BY session_id
        ) m ON m.session_id = s.id
        ORDER BY last_activity DESC, s.id ASC`,
      )
      .all()
    return rows.map((row) => ({
      sessionId: row.session_id,
      sessionPath: dbPath,
      modifiedAt: epochToIso(row.last_activity),
      // The store is one shared file, so the per-session message count is the
      // change-detection proxy instead of a file size.
      sizeBytes: row.msg_count,
      ...(row.cwd === null ? {} : { projectDir: row.cwd }),
    }))
  } finally {
    snapshot.close()
  }
}
