import { Database } from "bun:sqlite"
import { existsSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { z } from "zod"

import {
  type HarnessAdapter,
  type HarnessSessionInput,
  type HarnessSessionRef,
  type HarnessTraceDocument,
  type HarnessTraceEvent,
  harnessCollectedStatus,
  harnessTraceDocumentSchema,
  redactHarnessDetail,
  TrajectoryAdapterError,
} from "./contract"

const hermesRuntime = "hermes"

// hermes-agent persists every session in one SQLite store (~/.hermes/state.db,
// schema v19): a `sessions` metadata table plus an OpenAI-style `messages`
// table ordered by insertion id. Multimodal content is stored with a
// "\x00json:" prefix; `active = 0` rows are rewound/soft-deleted history.
const hermesContentJsonPrefix = "\x00json:"

type HermesSessionRow = {
  readonly session_id: string
  readonly model: string | null
  readonly cwd: string | null
  readonly last_activity: number | null
  readonly msg_count: number
}

type HermesMessageRow = {
  readonly role: string
  readonly content: string | null
  readonly tool_call_id: string | null
  readonly tool_calls: string | null
  readonly tool_name: string | null
}

const hermesToolCallSchema = z
  .object({
    id: z.string().optional(),
    function: z
      .object({
        name: z.string().optional(),
        arguments: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

const toolArgumentSummaryKeys = [
  "cmd",
  "command",
  "file_path",
  "path",
  "pattern",
  "query",
  "prompt",
  "url",
] as const

const summarizeArgumentsJson = (rawArguments: string | undefined): string => {
  if (rawArguments === undefined || rawArguments.trim().length === 0) {
    return ""
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(rawArguments)
  } catch {
    return rawArguments
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return rawArguments
  }
  const record = parsed as Readonly<Record<string, unknown>>
  for (const key of toolArgumentSummaryKeys) {
    const value = record[key]
    if (typeof value === "string" && value.trim().length > 0) {
      return value
    }
  }
  return rawArguments
}

const decodeHermesContent = (content: string | null): string => {
  if (content === null) {
    return ""
  }
  if (!content.startsWith(hermesContentJsonPrefix)) {
    return content
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(content.slice(hermesContentJsonPrefix.length))
  } catch {
    return ""
  }
  if (!Array.isArray(parsed)) {
    return typeof parsed === "string" ? parsed : ""
  }
  return parsed
    .map((part) => {
      if (typeof part === "string") {
        return part
      }
      if (typeof part === "object" && part !== null && "text" in part) {
        const text = (part as { readonly text?: unknown }).text
        return typeof text === "string" ? text : ""
      }
      return ""
    })
    .join(" ")
    .trim()
}

const resolveHermesDbPath = (sourceDirOrDb: string): string =>
  sourceDirOrDb.endsWith(".db") ? sourceDirOrDb : join(sourceDirOrDb, "state.db")

const openHermesDatabase = (dbPath: string): Database => {
  if (!existsSync(dbPath) || !statSync(dbPath).isFile()) {
    throw new TrajectoryAdapterError("missing_source_dir", `missing_source_dir: ${dbPath}`)
  }
  // hermes keeps state.db in WAL mode; a strictly read-only connection cannot
  // create the missing -shm sidecar and fails with SQLITE_CANTOPEN. Probe the
  // read-only path first, then fall back to a normal WAL-safe connection that
  // this adapter only ever uses for SELECTs.
  try {
    const readonlyDb = new Database(dbPath, { readonly: true, strict: true })
    readonlyDb.query("SELECT 1").get()
    return readonlyDb
  } catch {
    return new Database(dbPath, { strict: true })
  }
}

const epochToIso = (epochSeconds: number | null): string =>
  new Date(Math.round((epochSeconds ?? 0) * 1_000)).toISOString()

const listHermesSessions = (sourceDir: string): readonly HarnessSessionRef[] => {
  const dbPath = resolveHermesDbPath(sourceDir)
  const sqlite = openHermesDatabase(dbPath)
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
    sqlite.close()
  }
}

const convertHermesSession = (session: HarnessSessionInput): HarnessTraceDocument => {
  if (session.sessionId === undefined) {
    throw new TrajectoryAdapterError(
      "invalid_session",
      "invalid_session: hermes sessions live in one state.db; pass a session id, not the db path",
    )
  }
  const dbPath = resolveHermesDbPath(session.sessionPath)
  const sqlite = openHermesDatabase(dbPath)
  try {
    const sessionRow = sqlite
      .query<{ readonly model: string | null; readonly cwd: string | null }, [string]>(
        "SELECT model, cwd FROM sessions WHERE id = ?",
      )
      .get(session.sessionId)
    if (sessionRow === null) {
      throw new TrajectoryAdapterError(
        "missing_session",
        `missing_session: ${session.sessionId} not found in ${dbPath}`,
      )
    }
    const rows = sqlite
      .query<HermesMessageRow, [string]>(
        `SELECT role, content, tool_call_id, tool_calls, tool_name
        FROM messages
        WHERE session_id = ? AND active = 1
        ORDER BY id ASC`,
      )
      .all(session.sessionId)

    const events: HarnessTraceEvent[] = []
    const emit = (kind: string, name: string, detail: string) => {
      events.push({ kind, name, detail: redactHarnessDetail(detail) })
    }

    const model = sessionRow.model ?? hermesRuntime
    emit(
      "session_start",
      session.sessionId,
      `hermes model=${model} cwd=${sessionRow.cwd ?? "unknown"}`,
    )

    let turnCount = 0
    const toolNamesByCallId = new Map<string, string>()
    const closeTurn = () => {
      if (turnCount > 0) {
        emit("function_exit", `turn-${turnCount}`, "")
      }
    }

    for (const row of rows) {
      if (row.role === "user") {
        closeTurn()
        turnCount += 1
        emit("function_enter", `turn-${turnCount}`, decodeHermesContent(row.content))
        continue
      }
      if (row.role === "assistant") {
        // Reasoning columns are never exported; only the visible content is.
        emit("llm_call", model, decodeHermesContent(row.content))
        if (row.tool_calls !== null) {
          let parsedToolCalls: unknown
          try {
            parsedToolCalls = JSON.parse(row.tool_calls)
          } catch {
            parsedToolCalls = []
          }
          if (Array.isArray(parsedToolCalls)) {
            for (const rawToolCall of parsedToolCalls) {
              const parsed = hermesToolCallSchema.safeParse(rawToolCall)
              if (!parsed.success) {
                continue
              }
              const toolName = parsed.data.function?.name ?? "tool"
              if (parsed.data.id !== undefined) {
                toolNamesByCallId.set(parsed.data.id, toolName)
              }
              emit("tool_call", toolName, summarizeArgumentsJson(parsed.data.function?.arguments))
            }
          }
        }
        continue
      }
      if (row.role === "tool") {
        const toolName = row.tool_name ?? toolNamesByCallId.get(row.tool_call_id ?? "") ?? "tool"
        emit("tool_result", toolName, decodeHermesContent(row.content))
      }
      // system rows (prompt scaffolding) are skipped on purpose.
    }
    closeTurn()

    return harnessTraceDocumentSchema.parse({
      runtime: hermesRuntime,
      status: harnessCollectedStatus,
      eventCount: events.length,
      events,
    })
  } finally {
    sqlite.close()
  }
}

export const hermesAdapter: HarnessAdapter = {
  runtime: hermesRuntime,
  displayName: "Hermes Agent",
  logHint: "~/.hermes/state.db (sessions + messages tables, one store for all sessions)",
  defaultSourceDir: () => {
    const home = homedir()
    return home.length === 0 ? undefined : join(home, ".hermes")
  },
  listSessions: listHermesSessions,
  convertSession: convertHermesSession,
}
