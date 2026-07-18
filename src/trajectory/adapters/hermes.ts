import { Database } from "bun:sqlite"
import { existsSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { z } from "zod"

import {
  extractHarnessSourceAttestation,
  type HarnessAdapter,
  type HarnessEventPayload,
  type HarnessSessionInput,
  type HarnessSessionRef,
  type HarnessSourceAttestation,
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

// Hermes schema v19 exposes per-session aggregate usage on the `sessions`
// table. Older or stripped schemas may omit them; the adapter probes PRAGMA
// and only SELECTs the columns that exist.
type HermesSessionUsageRow = {
  readonly model: string | null
  readonly cwd: string | null
  readonly input_tokens: number | null
  readonly output_tokens: number | null
  readonly cache_read_tokens: number | null
  readonly cache_write_tokens: number | null
  readonly reasoning_tokens: number | null
}

type HermesMessageRow = {
  readonly id: number
  readonly role: string
  readonly content: string | null
  readonly timestamp: number | null
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
    // Probe sessions columns once; older/stripped schemas may not carry the
    // usage columns and a hard SELECT would throw. The probe-list is the set
    // of optional columns the usage extraction below reads.
    const sessionsColumns = sqlite
      .query<{ readonly name: string }, []>("PRAGMA table_info(sessions)")
      .all()
    const optionalColumns = new Set(sessionsColumns.map((row) => row.name))
    const usageColumnSelects = [
      "input_tokens",
      "output_tokens",
      "cache_read_tokens",
      "cache_write_tokens",
      "reasoning_tokens",
    ]
      .filter((column) => optionalColumns.has(column))
      .map((column) => `CAST("${column}" AS REAL) AS ${column}`)
    const sessionRow = sqlite
      .query<HermesSessionUsageRow, [string]>(
        `SELECT model, cwd${
          usageColumnSelects.length === 0 ? "" : `, ${usageColumnSelects.join(", ")}`
        } FROM sessions WHERE id = ?`,
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
        `SELECT id, role, content, timestamp, tool_call_id, tool_calls, tool_name
        FROM messages
        WHERE session_id = ? AND active = 1
        ORDER BY id ASC`,
      )
      .all(session.sessionId)

    const events: HarnessTraceEvent[] = []
    let hasAttestation = false
    // Two namespaces: `msg:<rowId>` for row-backed events and `tcall:<nativeId>`
    // for tool calls, which fan out within one assistant row and would otherwise
    // collide with the row's own llm_call source id. The session prefix defends
    // against id collisions across sessions sharing one store.
    const namespace = `hermes:${session.sessionId}`
    const toolCallSourceByNativeId = new Map<string, string>()
    let hasPayload = false
    const emit = (
      kind: string,
      name: string,
      detail: string,
      attestation?: HarnessSourceAttestation,
      payload?: HarnessEventPayload,
    ): HarnessTraceEvent => {
      if (payload !== undefined) {
        hasPayload = true
      }
      const extracted = extractHarnessSourceAttestation(attestation)
      if (extracted === undefined) {
        const event: HarnessTraceEvent = {
          kind,
          name,
          detail: redactHarnessDetail(detail),
          ...(payload === undefined ? {} : { payload }),
        }
        events.push(event)
        return event
      }
      hasAttestation = true
      const event: HarnessTraceEvent = {
        kind,
        name,
        detail: redactHarnessDetail(detail),
        timestamp: extracted.timestamp,
        sourceEventId: extracted.sourceEventId,
        ...(extracted.parentSourceEventId === undefined
          ? {}
          : { parentSourceEventId: extracted.parentSourceEventId }),
        ...(payload === undefined ? {} : { payload }),
      }
      events.push(event)
      return event
    }

    // Omit the whole attestation group when the raw timestamp is missing;
    // epochToIso would otherwise pin the event to the Unix epoch.
    const rowAttestation = (
      row: HermesMessageRow,
      sourceEventId: string,
      parentSourceEventId?: string,
    ): HarnessSourceAttestation | undefined => {
      if (row.timestamp === null) return undefined
      return extractHarnessSourceAttestation({
        timestamp: epochToIso(row.timestamp),
        sourceEventId,
        ...(parentSourceEventId === undefined ? {} : { parentSourceEventId }),
      })
    }

    const model = sessionRow.model ?? hermesRuntime
    // Hermes tracks usage only at session aggregate (per tokscale's parser);
    // attach the aggregate as session_start.payload.usage so a buyer reads
    // session totals directly.
    const aggregateUsage: HarnessEventPayload["usage"] = {
      model,
      ...(sessionRow.input_tokens === null || sessionRow.input_tokens === undefined
        ? {}
        : { inputTokens: sessionRow.input_tokens }),
      ...(sessionRow.output_tokens === null || sessionRow.output_tokens === undefined
        ? {}
        : { outputTokens: sessionRow.output_tokens }),
      ...(sessionRow.cache_read_tokens === null || sessionRow.cache_read_tokens === undefined
        ? {}
        : { cachedInputTokens: sessionRow.cache_read_tokens }),
      ...(sessionRow.cache_write_tokens === null || sessionRow.cache_write_tokens === undefined
        ? {}
        : { cacheWriteTokens: sessionRow.cache_write_tokens }),
      ...(sessionRow.reasoning_tokens === null || sessionRow.reasoning_tokens === undefined
        ? {}
        : { reasoningOutputTokens: sessionRow.reasoning_tokens }),
    }
    const hasAnyUsageField =
      aggregateUsage.inputTokens !== undefined ||
      aggregateUsage.outputTokens !== undefined ||
      aggregateUsage.cachedInputTokens !== undefined ||
      aggregateUsage.cacheWriteTokens !== undefined ||
      aggregateUsage.reasoningOutputTokens !== undefined
    emit(
      "session_start",
      session.sessionId,
      `hermes model=${model} cwd=${sessionRow.cwd ?? "unknown"}`,
      undefined,
      hasAnyUsageField ? { usage: aggregateUsage } : undefined,
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
        emit(
          "function_enter",
          `turn-${turnCount}`,
          decodeHermesContent(row.content),
          rowAttestation(row, `${namespace}:msg:${row.id}`),
        )
        continue
      }
      if (row.role === "assistant") {
        // Reasoning columns are never exported; only the visible content is.
        const llmEvent = emit(
          "llm_call",
          model,
          decodeHermesContent(row.content),
          rowAttestation(row, `${namespace}:msg:${row.id}`),
        )
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
              const nativeToolCallId = parsed.data.id
              const toolCallSourceEventId =
                nativeToolCallId === undefined
                  ? undefined
                  : `${namespace}:tcall:${nativeToolCallId}`
              if (nativeToolCallId !== undefined) {
                toolNamesByCallId.set(nativeToolCallId, toolName)
              }
              const toolEvent = emit(
                "tool_call",
                toolName,
                summarizeArgumentsJson(parsed.data.function?.arguments),
                toolCallSourceEventId === undefined
                  ? undefined
                  : rowAttestation(row, toolCallSourceEventId, llmEvent.sourceEventId),
              )
              if (nativeToolCallId !== undefined && toolEvent.sourceEventId !== undefined) {
                toolCallSourceByNativeId.set(nativeToolCallId, toolEvent.sourceEventId)
              }
            }
          }
        }
        continue
      }
      if (row.role === "tool") {
        const toolName = row.tool_name ?? toolNamesByCallId.get(row.tool_call_id ?? "") ?? "tool"
        const parentSourceEventId =
          row.tool_call_id === null ? undefined : toolCallSourceByNativeId.get(row.tool_call_id)
        emit(
          "tool_result",
          toolName,
          decodeHermesContent(row.content),
          rowAttestation(row, `${namespace}:msg:${row.id}`, parentSourceEventId),
        )
      }
      // system rows (prompt scaffolding) are skipped on purpose.
    }
    closeTurn()

    return harnessTraceDocumentSchema.parse({
      runtime: hermesRuntime,
      status: harnessCollectedStatus,
      ...(hasAttestation || hasPayload ? { formatVersion: 2 as const } : {}),
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
