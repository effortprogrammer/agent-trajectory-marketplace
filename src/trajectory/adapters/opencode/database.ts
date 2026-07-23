import { Database } from "bun:sqlite";
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import type { HarnessSessionRef } from "../contract";
import { TrajectoryAdapterError } from "../contract";

export type OpenCodeSessionRow = Readonly<{
  id: string;
  time_created: number | null;
  time_updated: number | null;
}>;

export type OpenCodeMessageRow = Readonly<{
  id: string;
  time_created: number | null;
  time_updated: number | null;
  data: string | null;
}>;

export type OpenCodePartRow = Readonly<{
  id: string;
  message_id: string;
  time_created: number | null;
  time_updated: number | null;
  data: string | null;
}>;

type OpenCodeSessionListRow = Readonly<{
  id: string;
  time_created: number | null;
  time_updated: number | null;
  msg_count: number;
}>;

const dbFilePattern = /^opencode.*\.db$/i;

export const listOpenCodeDbFiles = (sourceDir: string): readonly string[] => {
  if (!existsSync(sourceDir)) {
    throw new TrajectoryAdapterError("missing_source_dir", `missing_source_dir: ${sourceDir}`);
  }
  const sourceStat = statSync(sourceDir);
  if (sourceStat.isFile()) {
    if (!dbFilePattern.test(basename(sourceDir))) {
      throw new TrajectoryAdapterError("missing_source_dir", `missing_source_dir: ${sourceDir}`);
    }
    return [sourceDir];
  }
  if (!sourceStat.isDirectory()) {
    throw new TrajectoryAdapterError("missing_source_dir", `missing_source_dir: ${sourceDir}`);
  }
  return readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && dbFilePattern.test(entry.name))
    .map((entry) => join(sourceDir, entry.name))
    .sort();
};

export const openOpenCodeDatabase = (dbPath: string): Database => {
  if (!existsSync(dbPath) || !statSync(dbPath).isFile()) {
    throw new TrajectoryAdapterError("missing_source_dir", `missing_source_dir: ${dbPath}`);
  }
  let readonlyDatabase: Database | undefined;
  try {
    readonlyDatabase = new Database(dbPath, { readonly: true, strict: true });
    readonlyDatabase.query("SELECT 1").get();
    return readonlyDatabase;
  } catch (error: unknown) {
    readonlyDatabase?.close();
    if (!(error instanceof Error)) throw error;
    return new Database(dbPath, { strict: true });
  }
};

export const resolveOpenCodeDbPath = (sessionPath: string): string => {
  if (sessionPath.endsWith(".db")) return sessionPath;
  const first = listOpenCodeDbFiles(sessionPath)[0];
  if (first === undefined) {
    throw new TrajectoryAdapterError("missing_source_dir", `missing_source_dir: ${sessionPath}`);
  }
  return first;
};

export const fetchOpenCodeSession = (sqlite: Database, sessionId: string): OpenCodeSessionRow | null =>
  sqlite.query<OpenCodeSessionRow, [string]>(
    "SELECT id, time_created, time_updated FROM session WHERE id = ?",
  ).get(sessionId);

export const fetchOpenCodeMessages = (
  sqlite: Database,
  sessionId: string,
): readonly OpenCodeMessageRow[] =>
  sqlite.query<OpenCodeMessageRow, [string]>(
    "SELECT id, time_created, time_updated, data FROM message WHERE session_id = ? ORDER BY rowid ASC",
  ).all(sessionId);

export const fetchOpenCodeParts = (
  sqlite: Database,
  sessionId: string,
): readonly OpenCodePartRow[] =>
  sqlite.query<OpenCodePartRow, [string]>(
    "SELECT id, message_id, time_created, time_updated, data FROM part WHERE session_id = ? ORDER BY rowid ASC",
  ).all(sessionId);

export const listOpenCodeSessions = (sourceDir: string): readonly HarnessSessionRef[] => {
  const dbPaths = listOpenCodeDbFiles(sourceDir);
  if (dbPaths.length === 0) {
    throw new TrajectoryAdapterError("missing_source_dir", `missing_source_dir: ${sourceDir}`);
  }
  const sessions: HarnessSessionRef[] = [];
  for (const dbPath of dbPaths) {
    const sqlite = openOpenCodeDatabase(dbPath);
    try {
      const rows = sqlite.query<OpenCodeSessionListRow, []>(
        `SELECT s.id, s.time_created, s.time_updated, COALESCE(m.msg_count, 0) AS msg_count
         FROM session s LEFT JOIN (
           SELECT session_id, COUNT(*) AS msg_count FROM message GROUP BY session_id
         ) m ON m.session_id = s.id`,
      ).all();
      for (const row of rows) {
        const modifiedMs = row.time_updated ?? row.time_created;
        if (modifiedMs === null) continue;
        sessions.push({
          sessionId: row.id,
          sessionPath: dbPath,
          modifiedAt: new Date(modifiedMs).toISOString(),
          sizeBytes: row.msg_count,
        });
      }
    } finally {
      sqlite.close();
    }
  }
  return sessions.sort((left, right) =>
    right.modifiedAt.localeCompare(left.modifiedAt) || left.sessionId.localeCompare(right.sessionId),
  );
};
