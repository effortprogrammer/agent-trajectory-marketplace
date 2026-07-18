import { Database } from "bun:sqlite"
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { z } from "zod"

import { hermesAdapter } from "../src/trajectory/adapters/hermes"
import { openclawAdapter } from "../src/trajectory/adapters/openclaw"
import { exportCollectedSession } from "../src/trajectory/collect"
import { inspectTraceFile } from "../src/trajectory/evidence"
import { parseObservationArtifact } from "../src/trajectory/observation-parser"
import { createTrajectoryProjection } from "../src/trajectory/projections"
import { testPrivacyOptions } from "./privacy-fixtures"
import { cleanupSellerWorkspaces, createWorkspacePath } from "./trajectory-seller-fixtures"

const hermesSessionId = "20260707_120000_abc123"

// Subset of projection span fields the source-attestation round-trip cares
// about. Non-strict so both regular and metadata-bearing spans parse.
const spanMetadataSchema = z.object({
  startTime: z.string().optional(),
  parentSpanIndex: z.number().int().nonnegative().nullable().optional(),
})

const writeHermesFixture = () => {
  const workspace = createWorkspacePath()
  const sourceDir = join(workspace, "hermes-home")
  mkdirSync(sourceDir, { recursive: true })
  const dbPath = join(sourceDir, "state.db")
  const sqlite = new Database(dbPath, { create: true, strict: true })
  sqlite.run(`CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    model TEXT,
    cwd TEXT,
    started_at REAL,
    ended_at REAL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_read_tokens INTEGER,
    cache_write_tokens INTEGER,
    reasoning_tokens INTEGER,
    actual_cost_usd REAL,
    estimated_cost_usd REAL
  )`)
  sqlite.run(`CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT,
    tool_call_id TEXT,
    tool_calls TEXT,
    tool_name TEXT,
    timestamp REAL NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  )`)
  const insertSession = sqlite.query(
    `INSERT INTO sessions
      (id, model, cwd, started_at, ended_at, input_tokens, output_tokens,
       cache_read_tokens, cache_write_tokens, reasoning_tokens, actual_cost_usd, estimated_cost_usd)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  insertSession.run(
    hermesSessionId,
    "hermes-4-405b",
    "/tmp/project",
    1_800_000_000,
    null,
    5_212_345,
    844_156,
    4_992_111,
    1_024_000,
    215_554,
    12.3456,
    null,
  )
  insertSession.run(
    "20260101_000000_old111",
    "hermes-4-405b",
    "/tmp/old",
    1_700_000_000,
    1_700_000_100,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  )

  const insertMessage = sqlite.query(
    `INSERT INTO messages (session_id, role, content, tool_call_id, tool_calls, tool_name, timestamp, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  let ts = 1_800_000_001
  const row = (
    role: string,
    content: string | null,
    extras?: {
      readonly toolCallId?: string
      readonly toolCalls?: string
      readonly toolName?: string
      readonly active?: number
    },
  ) => {
    ts += 1
    insertMessage.run(
      hermesSessionId,
      role,
      content,
      extras?.toolCallId ?? null,
      extras?.toolCalls ?? null,
      extras?.toolName ?? null,
      ts,
      extras?.active ?? 1,
    )
  }
  row("system", "You are Hermes, a helpful agent.")
  row("user", "Fix the login bug")
  row("assistant", "On it", {
    toolCalls: JSON.stringify([
      { id: "call_1", function: { name: "terminal", arguments: '{"command":"rg login src/"}' } },
    ]),
  })
  row("tool", "src/login.ts:42 matches", { toolCallId: "call_1", toolName: "terminal" })
  row("user", "now use api_key=sk-demo")
  row("assistant", `\x00json:${JSON.stringify([{ type: "text", text: "done" }])}`)
  row("assistant", "rewound draft that must not export", { active: 0 })
  sqlite.close()
  return { workspace, sourceDir, dbPath }
}

const openclawSessionId = "b7c9d1e3-1111-2222-3333-444455556666"

const openclawLines: readonly unknown[] = [
  {
    type: "session",
    version: 3,
    id: openclawSessionId,
    timestamp: "2026-07-07T00:00:00.000Z",
    cwd: "/tmp/project",
  },
  { type: "leaf", id: "leaf-1", targetId: "x" },
  {
    type: "message",
    id: "m1",
    parentId: null,
    timestamp: "2026-07-07T00:00:01.000Z",
    message: { role: "user", content: "Ship the feature", timestamp: 1 },
  },
  {
    type: "message",
    id: "m2",
    parentId: "m1",
    timestamp: "2026-07-07T00:00:02.000Z",
    message: {
      role: "user",
      content: "injected context",
      runtimeContextCarrier: true,
      timestamp: 2,
    },
  },
  {
    type: "message",
    id: "m3",
    parentId: "m2",
    timestamp: "2026-07-07T00:00:03.000Z",
    message: {
      role: "assistant",
      model: "claude-opus-4-8",
      stopReason: "toolUse",
      timestamp: 3,
      content: [
        { type: "thinking", thinking: "private plan that must never be exported" },
        { type: "text", text: "Shipping now" },
        { type: "toolCall", id: "tc1", name: "exec", arguments: { command: "bun test" } },
      ],
      usage: {
        input: 1660,
        output: 55,
        cacheRead: 108928,
        cacheWrite: 4096,
        cost: { total: 0.0247 },
      },
    },
  },
  {
    type: "message",
    id: "m4",
    parentId: "m3",
    timestamp: "2026-07-07T00:00:04.000Z",
    message: {
      role: "toolResult",
      toolCallId: "tc1",
      toolName: "exec",
      content: [{ type: "text", text: "tests passed" }],
      isError: false,
      timestamp: 4,
    },
  },
  {
    type: "message",
    id: "m5",
    parentId: "m4",
    timestamp: "2026-07-07T00:00:05.000Z",
    message: { role: "bashExecution", command: "ls -la", exitCode: 1, timestamp: 5 },
  },
  {
    type: "message",
    id: "m6",
    parentId: "m5",
    timestamp: "2026-07-07T00:00:06.000Z",
    message: { role: "compactionSummary", summary: "compacted", tokensBefore: 10, timestamp: 6 },
  },
  {
    type: "message",
    id: "m7",
    parentId: "m6",
    timestamp: "2026-07-07T00:00:07.000Z",
    message: {
      role: "assistant",
      model: "claude-opus-4-8",
      stopReason: "stop",
      timestamp: 7,
      content: [{ type: "text", text: "Feature shipped" }],
      usage: { input: 900, output: 22 },
    },
  },
]

const writeOpenclawFixture = () => {
  const workspace = createWorkspacePath()
  const sourceDir = join(workspace, "openclaw-state")
  const sessionsDir = join(sourceDir, "agents", "main", "sessions")
  mkdirSync(sessionsDir, { recursive: true })
  const sessionPath = join(sessionsDir, `${openclawSessionId}.jsonl`)
  writeFileSync(
    sessionPath,
    `${openclawLines.map((line) => JSON.stringify(line)).join("\n")}\n`,
    "utf8",
  )
  writeFileSync(join(sessionsDir, "sessions.json"), "{}\n", "utf8")
  return { workspace, sourceDir, sessionPath }
}

afterEach(cleanupSellerWorkspaces)

describe("hermes adapter", () => {
  test("converts one session out of the shared state.db store", () => {
    const { dbPath } = writeHermesFixture()
    const trace = hermesAdapter.convertSession({ sessionPath: dbPath, sessionId: hermesSessionId })

    expect(trace.runtime).toBe("hermes")
    expect(trace.status).toBe("collected")
    expect(trace.events.map((event) => `${event.kind}:${event.name}`)).toEqual([
      `session_start:${hermesSessionId}`,
      "function_enter:turn-1",
      "llm_call:hermes-4-405b",
      "tool_call:terminal",
      "tool_result:terminal",
      "function_exit:turn-1",
      "function_enter:turn-2",
      "llm_call:hermes-4-405b",
      "function_exit:turn-2",
    ])
    expect(trace.events[0]?.detail).toBe("hermes model=hermes-4-405b cwd=/tmp/project")
    expect(trace.events[1]?.detail).toBe("Fix the login bug")
    expect(trace.events[3]?.detail).toBe("rg login src/")
    expect(trace.events[4]?.detail).toBe("src/login.ts:42 matches")
    expect(trace.events[6]?.detail).toBe("[redacted]")
    expect(trace.events[7]?.detail).toBe("done")

    const serialized = JSON.stringify(trace)
    expect(serialized).not.toContain("You are Hermes")
    expect(serialized).not.toContain("rewound draft")
    expect(serialized).not.toContain("sk-demo")
  })

  test("emits ATF v2 source attestation from message rows and native tool_call ids", () => {
    const { dbPath } = writeHermesFixture()
    const trace = hermesAdapter.convertSession({ sessionPath: dbPath, sessionId: hermesSessionId })

    expect(trace.formatVersion).toBe(2)

    expect(trace.events[0]?.kind).toBe("session_start")
    expect(trace.events[0]?.timestamp).toBeUndefined()
    expect(trace.events[0]?.sourceEventId).toBeUndefined()
    expect(trace.events[0]?.parentSourceEventId).toBeUndefined()

    expect(trace.events[1]?.kind).toBe("function_enter")
    expect(trace.events[1]?.timestamp).toBe(new Date(1_800_000_003 * 1_000).toISOString())
    expect(trace.events[1]?.sourceEventId).toBe(`hermes:${hermesSessionId}:msg:2`)
    expect(trace.events[5]?.kind).toBe("function_exit")
    expect(trace.events[5]?.timestamp).toBeUndefined()
    expect(trace.events[6]?.kind).toBe("function_enter")
    expect(trace.events[6]?.timestamp).toBe(new Date(1_800_000_006 * 1_000).toISOString())
    expect(trace.events[6]?.sourceEventId).toBe(`hermes:${hermesSessionId}:msg:5`)
    expect(trace.events[8]?.kind).toBe("function_exit")
    expect(trace.events[8]?.timestamp).toBeUndefined()

    // Fixture row ids are 1-based AUTOINCREMENT; row 3 is the first assistant
    // message at ts=1_800_000_004, row 4 is its tool_result at ts=1_800_000_005.
    const llmCall = trace.events[2]
    expect(llmCall?.kind).toBe("llm_call")
    expect(llmCall?.timestamp).toBe(new Date(1_800_000_004 * 1_000).toISOString())
    expect(llmCall?.sourceEventId).toBe(`hermes:${hermesSessionId}:msg:3`)
    expect(llmCall?.parentSourceEventId).toBeUndefined()

    const toolCall = trace.events[3]
    expect(toolCall?.kind).toBe("tool_call")
    expect(toolCall?.timestamp).toBe(new Date(1_800_000_004 * 1_000).toISOString())
    expect(toolCall?.sourceEventId).toBe(`hermes:${hermesSessionId}:tcall:call_1`)
    expect(toolCall?.parentSourceEventId).toBe(`hermes:${hermesSessionId}:msg:3`)

    const toolResult = trace.events[4]
    expect(toolResult?.kind).toBe("tool_result")
    expect(toolResult?.timestamp).toBe(new Date(1_800_000_005 * 1_000).toISOString())
    expect(toolResult?.sourceEventId).toBe(`hermes:${hermesSessionId}:msg:4`)
    expect(toolResult?.parentSourceEventId).toBe(`hermes:${hermesSessionId}:tcall:call_1`)

    expect(trace.events[7]?.kind).toBe("llm_call")
    expect(trace.events[7]?.sourceEventId).toBe(`hermes:${hermesSessionId}:msg:6`)
  })

  test("omits source attestation entirely when message rows lack timestamps", () => {
    const workspace = createWorkspacePath()
    const sourceDir = join(workspace, "hermes-home")
    mkdirSync(sourceDir, { recursive: true })
    const dbPath = join(sourceDir, "state.db")
    const sqlite = new Database(dbPath, { create: true, strict: true })
    sqlite.run(`CREATE TABLE sessions (
      id TEXT PRIMARY KEY, model TEXT, cwd TEXT, started_at REAL, ended_at REAL
    )`)
    // Same shape as the production fixture but with a nullable timestamp so a
    // row can lack raw time data.
    sqlite.run(`CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT,
      tool_call_id TEXT,
      tool_calls TEXT,
      tool_name TEXT,
      timestamp REAL,
      active INTEGER NOT NULL DEFAULT 1
    )`)
    sqlite
      .query("INSERT INTO sessions (id, model, cwd, started_at, ended_at) VALUES (?, ?, ?, ?, ?)")
      .run("no-ts", "hermes-4-405b", "/tmp", 1_700_000_000, null)
    sqlite
      .query(
        `INSERT INTO messages (session_id, role, content, tool_call_id, tool_calls, tool_name, timestamp, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("no-ts", "user", "hello", null, null, null, null, 1)
    sqlite
      .query(
        `INSERT INTO messages (session_id, role, content, tool_call_id, tool_calls, tool_name, timestamp, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("no-ts", "assistant", "hi", null, null, null, null, 1)
    sqlite.close()

    const trace = hermesAdapter.convertSession({ sessionPath: dbPath, sessionId: "no-ts" })

    // No attested event keeps the document in the v1 summary-only envelope.
    expect(trace.formatVersion).toBeUndefined()
    for (const event of trace.events) {
      expect(event.timestamp).toBeUndefined()
      expect(event.sourceEventId).toBeUndefined()
      expect(event.parentSourceEventId).toBeUndefined()
    }
  })

  test("requires a session id and validates it against the store", () => {
    const { dbPath, sourceDir } = writeHermesFixture()
    expect(() => hermesAdapter.convertSession({ sessionPath: dbPath })).toThrow("invalid_session")
    expect(() =>
      hermesAdapter.convertSession({ sessionPath: dbPath, sessionId: "20990101_000000_nope00" }),
    ).toThrow("missing_session")
    expect(() => hermesAdapter.listSessions(join(sourceDir, "missing"))).toThrow(
      "missing_source_dir",
    )
  })

  test("lists sessions from the store newest first with message-count change proxies", () => {
    const { sourceDir, dbPath } = writeHermesFixture()
    const sessions = hermesAdapter.listSessions(sourceDir)
    expect(sessions).toHaveLength(2)
    expect(sessions[0]).toMatchObject({
      sessionId: hermesSessionId,
      sessionPath: dbPath,
      sizeBytes: 6,
      projectDir: "/tmp/project",
    })
    expect(sessions[1]?.sessionId).toBe("20260101_000000_old111")
  })

  test("exports through the shared collect pipeline by session id", async () => {
    const { workspace, sourceDir } = writeHermesFixture()
    const exportPath = join(workspace, "artifacts", "hermes.atf.json")
    const result = await exportCollectedSession(
      { runtime: "hermes", session: hermesSessionId, sourceDir, exportPath },
      testPrivacyOptions,
    )
    expect(result).toMatchObject({ runtime: "hermes", status: "collected", eventCount: 9 })
    const inspection = inspectTraceFile(exportPath)
    expect(inspection.marketplaceReady).toBe(true)
    expect(inspection.checks.collected).toBe(true)
  })

  test("round-trips ATF v2 through parseObservationArtifact and createTrajectoryProjection", () => {
    // Given: a real convertSession trace document carrying formatVersion 2
    // source attestation from message-row IDs/timestamps including the native
    // tool_call_id linkage between a tool_result and its tool_call.
    const { dbPath } = writeHermesFixture()
    const trace = hermesAdapter.convertSession({ sessionPath: dbPath, sessionId: hermesSessionId })
    expect(trace.formatVersion).toBe(2)
    const sourceBytes = Buffer.from(JSON.stringify(trace), "utf8")

    // When: the canonical observation parser and OpenInference projection both
    // receive the same bytes a downstream buyer would parse after escrow.
    const parsed = parseObservationArtifact(sourceBytes, 0)
    const result = createTrajectoryProjection({ profile: "openinference", sourceBytes })

    // Then: the document parses as ATF v2 with one parsed fact per source event,
    // every attested event survives as a span with the original raw startTime,
    // and the native Hermes tool_call_id parent link (tool_result -> tool_call)
    // resolves into a numeric parentSpanIndex. Raw source IDs do not leak
    // through the projection surface beyond startTime/parentSpanIndex, and no
    // synthetic trace/span identifiers exist.
    expect(parsed.version).toBe(2)
    expect(parsed.events).toHaveLength(trace.events.length)

    const spanMetadata = spanMetadataSchema.array().parse(result.projection.spans)
    expect(spanMetadata).toHaveLength(trace.events.length)

    const attested = trace.events
      .map((event, index) => ({ event, index }))
      .filter((entry) => entry.event.sourceEventId !== undefined)
    expect(attested.length).toBeGreaterThan(0)
    expect(attested.every(({ event }) => event.timestamp !== undefined)).toBe(true)
    for (const { event, index } of attested) {
      expect(spanMetadata[index]?.startTime).toBe(event.timestamp)
    }

    // Hermes tool_call_id: the tool_result's parentSourceEventId points at the
    // matching tool_call's sourceEventId, which the projection resolves.
    const toolResultIndex = trace.events.findIndex((event) => event.kind === "tool_result")
    expect(toolResultIndex).toBeGreaterThan(-1)
    const toolResult = trace.events[toolResultIndex]
    const parentLinkIndex = trace.events.findIndex(
      (event) => event.sourceEventId === toolResult?.parentSourceEventId,
    )
    expect(parentLinkIndex).toBeGreaterThan(-1)
    expect(spanMetadata[toolResultIndex]?.parentSpanIndex).toBe(parentLinkIndex)

    const serializedProjection = JSON.stringify(result.projection)
    for (const id of trace.events.flatMap((event) => [
      event.sourceEventId,
      event.parentSourceEventId,
    ])) {
      if (typeof id === "string") expect(serializedProjection).not.toContain(id)
    }
    for (const forbidden of ["traceId", "spanId", "parentSpanId"]) {
      expect(serializedProjection).not.toContain(forbidden)
    }
  })

  test("attaches session-aggregate token and cache usage to session_start", () => {
    const { dbPath } = writeHermesFixture()
    const trace = hermesAdapter.convertSession({ sessionPath: dbPath, sessionId: hermesSessionId })

    // Hermes tracks usage only at the session level (tokscale-parity), so the
    const sessionStart = trace.events[0]
    expect(sessionStart?.kind).toBe("session_start")
    expect(sessionStart?.payload?.usage).toEqual({
      model: "hermes-4-405b",
      inputTokens: 5_212_345,
      outputTokens: 844_156,
      cachedInputTokens: 4_992_111,
      cacheWriteTokens: 1_024_000,
      reasoningOutputTokens: 215_554,
    })

    // Per-llm_call events do not carry a fabricated per-message usage slice.
    const llmCalls = trace.events.filter((event) => event.kind === "llm_call")
    for (const llmCall of llmCalls) {
      expect(llmCall.payload?.usage).toBeUndefined()
    }
  })

  test("omits usage when the sessions table lacks the token columns", () => {
    // Hermes schema evolution: older DBs may not carry the token/cost columns.
    // The PRAGMA probe must skip usage extraction without throwing.
    const workspace = createWorkspacePath()
    const sourceDir = join(workspace, "hermes-home")
    mkdirSync(sourceDir, { recursive: true })
    const dbPath = join(sourceDir, "state.db")
    const sqlite = new Database(dbPath, { create: true, strict: true })
    sqlite.run(`CREATE TABLE sessions (
      id TEXT PRIMARY KEY, model TEXT, cwd TEXT, started_at REAL, ended_at REAL
    )`)
    sqlite.run(`CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT,
      tool_call_id TEXT, tool_calls TEXT, tool_name TEXT,
      timestamp REAL, active INTEGER NOT NULL DEFAULT 1
    )`)
    sqlite
      .query("INSERT INTO sessions (id, model, cwd, started_at, ended_at) VALUES (?, ?, ?, ?, ?)")
      .run("legacy", "hermes-4-405b", "/tmp", 1_700_000_000, null)
    sqlite
      .query(
        "INSERT INTO messages (session_id, role, content, timestamp, active) VALUES (?, ?, ?, ?, ?)",
      )
      .run("legacy", "user", "hi", 1_700_000_001, 1)
    sqlite.close()

    const trace = hermesAdapter.convertSession({ sessionPath: dbPath, sessionId: "legacy" })
    const sessionStart = trace.events[0]
    expect(sessionStart?.kind).toBe("session_start")
    expect(sessionStart?.payload).toBeUndefined()
  })
})

describe("openclaw adapter", () => {
  test("converts a parent-linked transcript without leaking thinking blocks", () => {
    const { sessionPath } = writeOpenclawFixture()
    const trace = openclawAdapter.convertSession({ sessionPath })

    expect(trace.runtime).toBe("openclaw")
    expect(trace.events.map((event) => `${event.kind}:${event.name}`)).toEqual([
      `session_start:${openclawSessionId}`,
      "function_enter:turn-1",
      "llm_call:claude-opus-4-8",
      "tool_call:exec",
      "tool_result:exec",
      "tool_call:bash",
      "tool_result:bash",
      "llm_call:claude-opus-4-8",
      "function_exit:turn-1",
    ])
    expect(trace.events[0]?.detail).toBe("openclaw transcript-v3 cwd=/tmp/project")
    expect(trace.events[1]?.detail).toBe("Ship the feature")
    expect(trace.events[2]?.detail).toBe("Shipping now")
    expect(trace.events[3]?.detail).toBe("bun test")
    expect(trace.events[4]?.detail).toBe("ok")
    expect(trace.events[5]?.detail).toBe("ls -la")
    expect(trace.events[6]?.detail).toBe("error")

    const serialized = JSON.stringify(trace)
    expect(serialized).not.toContain("private plan")
    expect(serialized).not.toContain("injected context")
    expect(serialized).not.toContain("compacted")
  })

  test("discovers sessions under agent directories and rejects invalid files", () => {
    const { sourceDir, sessionPath } = writeOpenclawFixture()
    const sessions = openclawAdapter.listSessions(sourceDir)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      sessionId: openclawSessionId,
      sessionPath,
      projectDir: join("agents", "main", "sessions"),
    })

    const emptyPath = join(sourceDir, "agents", "main", "sessions", "empty.jsonl")
    writeFileSync(emptyPath, "not-json\n", "utf8")
    expect(() => openclawAdapter.convertSession({ sessionPath: emptyPath })).toThrow(
      "invalid_session",
    )
  })

  test("emits ATF v2 source attestation from envelope id/timestamp/parentId", () => {
    const { sessionPath } = writeOpenclawFixture()
    const trace = openclawAdapter.convertSession({ sessionPath })

    // formatVersion 2 is required once any event carries attestation.
    expect(trace.formatVersion).toBe(2)

    // Each emitted event keeps a paired timestamp/sourceEventId drawn from the
    // envelope. Parent links only point at emitted source events; skipped
    // records (m2/m6) are omitted rather than re-linearized.
    const attested = trace.events.filter((event) => event.sourceEventId !== undefined)
    expect(attested.map((event) => event.kind)).toEqual([
      "session_start",
      "function_enter",
      "llm_call",
      "tool_call",
      "tool_result",
      "tool_call",
      "tool_result",
      "llm_call",
    ])
    // The synthetic function_exit closer has no native line, so the whole
    // attestation group is omitted for it.
    const closer = trace.events[trace.events.length - 1]
    expect(closer?.kind).toBe("function_exit")
    expect(closer?.sourceEventId).toBeUndefined()
    expect(closer?.timestamp).toBeUndefined()

    // Header line: id is the session id, no parentId in the envelope.
    expect(trace.events[0]).toMatchObject({
      kind: "session_start",
      timestamp: "2026-07-07T00:00:00.000Z",
      sourceEventId: `openclaw:${openclawSessionId}`,
    })
    expect(trace.events[0]?.parentSourceEventId).toBeUndefined()

    // m1 user message: parentId is null in the fixture, so no parent is
    // attached even though the rest of the group is present.
    expect(trace.events[1]).toMatchObject({
      kind: "function_enter",
      timestamp: "2026-07-07T00:00:01.000Z",
      sourceEventId: "openclaw:m1",
    })
    expect(trace.events[1]?.parentSourceEventId).toBeUndefined()

    // m3 assistant: llm_call carries the line id; the tool_call (block tc1)
    // gets a distinct composed id and parents to the emitted llm_call.
    expect(trace.events[2]).toMatchObject({
      kind: "llm_call",
      timestamp: "2026-07-07T00:00:03.000Z",
      sourceEventId: "openclaw:m3",
    })
    expect(trace.events[2]?.parentSourceEventId).toBeUndefined()
    expect(trace.events[3]).toMatchObject({
      kind: "tool_call",
      timestamp: "2026-07-07T00:00:03.000Z",
      sourceEventId: "openclaw:m3:tc1",
      parentSourceEventId: "openclaw:m3",
    })

    // m4 toolResult: parent links back to the emitted assistant tool_call.
    expect(trace.events[4]).toMatchObject({
      kind: "tool_result",
      timestamp: "2026-07-07T00:00:04.000Z",
      sourceEventId: "openclaw:m4",
      parentSourceEventId: "openclaw:m3:tc1",
    })

    // m5 bashExecution is a single line emitting two events. Both must keep
    // distinct deterministic sourceEventIds; the result parents to the call.
    expect(trace.events[5]).toMatchObject({
      kind: "tool_call",
      name: "bash",
      timestamp: "2026-07-07T00:00:05.000Z",
      sourceEventId: "openclaw:m5:call",
      parentSourceEventId: "openclaw:m4",
    })
    expect(trace.events[6]).toMatchObject({
      kind: "tool_result",
      name: "bash",
      timestamp: "2026-07-07T00:00:05.000Z",
      sourceEventId: "openclaw:m5:result",
      parentSourceEventId: "openclaw:m5:call",
    })

    // m7 assistant: parent m6 is a skipped compactionSummary, so it is omitted.
    expect(trace.events[7]).toMatchObject({
      kind: "llm_call",
      timestamp: "2026-07-07T00:00:07.000Z",
      sourceEventId: "openclaw:m7",
    })
    expect(trace.events[7]?.parentSourceEventId).toBeUndefined()

    // Source IDs must be unique across the document so the downstream
    // observation normalizer can key observations by id.
    const sourceIds = attested.map((event) => event.sourceEventId)
    expect(new Set(sourceIds).size).toBe(sourceIds.length)

    // Numeric in-message timestamps are never confused with the envelope
    // ISO-8601 timestamp; only the envelope value is exported.
    const serialized = JSON.stringify(trace)
    expect(serialized).not.toMatch(/"timestamp":\s*[0-9]+/)
    expect(serialized).not.toContain("injected context")
    expect(serialized).not.toContain("compacted")
    expect(serialized).not.toContain('"m2"')
    expect(serialized).not.toContain('"m6"')
  })

  test("exported openclaw traces are marketplace-ready", async () => {
    const { workspace, sourceDir } = writeOpenclawFixture()
    const exportPath = join(workspace, "artifacts", "openclaw.atf.json")
    const result = await exportCollectedSession(
      { runtime: "openclaw", session: openclawSessionId, sourceDir, exportPath },
      testPrivacyOptions,
    )
    expect(result).toMatchObject({ runtime: "openclaw", status: "collected", eventCount: 9 })
    expect(inspectTraceFile(exportPath).marketplaceReady).toBe(true)
  })

  test("round-trips ATF v2 through parseObservationArtifact and createTrajectoryProjection", () => {
    // Given: a real convertSession trace document carrying formatVersion 2
    // source attestation from envelope line IDs/timestamps, where emitted
    // parentSourceEventIds resolve only to emitted source events.
    const { sessionPath } = writeOpenclawFixture()
    const trace = openclawAdapter.convertSession({ sessionPath })
    expect(trace.formatVersion).toBe(2)
    const sourceBytes = Buffer.from(JSON.stringify(trace), "utf8")

    // When: the canonical observation parser and OpenInference projection both
    // receive the same bytes a downstream buyer would parse after escrow.
    const parsed = parseObservationArtifact(sourceBytes, 0)
    const result = createTrajectoryProjection({ profile: "openinference", sourceBytes })

    // Then: the document parses as ATF v2 with one parsed fact per source event,
    // every attested event survives as a span with the original raw startTime,
    // native parent links resolve (tool_result m4 -> tool_call m3:tc1),
    // while skipped-line parents (m2, m6) are omitted. Raw source IDs do not
    // leak through the projection surface beyond startTime/parentSpanIndex, and
    // no synthetic trace/span identifiers exist.
    expect(parsed.version).toBe(2)
    expect(parsed.events).toHaveLength(trace.events.length)

    const spanMetadata = spanMetadataSchema.array().parse(result.projection.spans)
    expect(spanMetadata).toHaveLength(trace.events.length)

    const attested = trace.events
      .map((event, index) => ({ event, index }))
      .filter((entry) => entry.event.sourceEventId !== undefined)
    expect(attested.length).toBeGreaterThan(0)
    expect(attested.every(({ event }) => event.timestamp !== undefined)).toBe(true)
    for (const { event, index } of attested) {
      expect(spanMetadata[index]?.startTime).toBe(event.timestamp)
    }

    // Resolvable native OpenClaw parent: tool_result m4 has parentSourceEventId
    // "openclaw:m3:tc1", which matches the emitted tool_call source ID.
    const m4Index = trace.events.findIndex((event) => event.sourceEventId === "openclaw:m4")
    expect(m4Index).toBeGreaterThan(-1)
    const m4 = trace.events[m4Index]
    const m3Index = trace.events.findIndex(
      (event) => event.sourceEventId === m4?.parentSourceEventId,
    )
    expect(m3Index).toBeGreaterThan(-1)
    expect(spanMetadata[m4Index]?.parentSpanIndex).toBe(m3Index)

    // Skipped-line parent loss: m3 (parent m2) and m7 (parent m6) omit
    // parentSourceEventId because m2/m6 are not emitted source events.
    const m3SpanIndex = trace.events.findIndex((event) => event.sourceEventId === "openclaw:m3")
    const m7SpanIndex = trace.events.findIndex((event) => event.sourceEventId === "openclaw:m7")
    expect(m3SpanIndex).toBeGreaterThan(-1)
    expect(m7SpanIndex).toBeGreaterThan(-1)
    expect(trace.events[m3SpanIndex]?.parentSourceEventId).toBeUndefined()
    expect(trace.events[m7SpanIndex]?.parentSourceEventId).toBeUndefined()
    expect(spanMetadata[m3SpanIndex]?.parentSpanIndex).toBeNull()
    expect(spanMetadata[m7SpanIndex]?.parentSpanIndex).toBeNull()

    const serializedProjection = JSON.stringify(result.projection)
    for (const id of trace.events.flatMap((event) => [
      event.sourceEventId,
      event.parentSourceEventId,
    ])) {
      if (typeof id === "string") expect(serializedProjection).not.toContain(id)
    }
    for (const forbidden of ["traceId", "spanId", "parentSpanId"]) {
      expect(serializedProjection).not.toContain(forbidden)
    }
  })

  test("extracts token and cache usage on assistant messages", () => {
    const { sessionPath } = writeOpenclawFixture()
    const trace = openclawAdapter.convertSession({ sessionPath })
    const llmCalls = trace.events.filter((event) => event.kind === "llm_call")
    expect(llmCalls).toHaveLength(2)

    expect(llmCalls[0]?.payload?.usage).toEqual({
      model: "claude-opus-4-8",
      inputTokens: 1660,
      outputTokens: 55,
      cachedInputTokens: 108928,
      cacheWriteTokens: 4096,
    })
    expect(llmCalls[1]?.payload?.usage).toEqual({
      model: "claude-opus-4-8",
      inputTokens: 900,
      outputTokens: 22,
    })
    const toolCall = trace.events.find((event) => event.kind === "tool_call")
    expect(toolCall?.payload?.usage).toBeUndefined()
  })
})
