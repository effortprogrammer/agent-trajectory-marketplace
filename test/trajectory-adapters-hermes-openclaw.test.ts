import { Database } from "bun:sqlite"
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { hermesAdapter } from "../src/trajectory/adapters/hermes"
import { openclawAdapter } from "../src/trajectory/adapters/openclaw"
import { exportCollectedSession } from "../src/trajectory/collect"
import { inspectTraceFile } from "../src/trajectory/evidence"
import { cleanupSellerWorkspaces, createWorkspacePath } from "./trajectory-seller-fixtures"

const hermesSessionId = "20260707_120000_abc123"

const writeHermesFixture = () => {
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
    "INSERT INTO sessions (id, model, cwd, started_at, ended_at) VALUES (?, ?, ?, ?, ?)",
  )
  insertSession.run(hermesSessionId, "hermes-4-405b", "/tmp/project", 1_800_000_000, null)
  insertSession.run(
    "20260101_000000_old111",
    "hermes-4-405b",
    "/tmp/old",
    1_700_000_000,
    1_700_000_100,
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

  test("exports through the shared collect pipeline by session id", () => {
    const { workspace, sourceDir } = writeHermesFixture()
    const exportPath = join(workspace, "artifacts", "hermes.atf.json")
    const result = exportCollectedSession({
      runtime: "hermes",
      session: hermesSessionId,
      sourceDir,
      exportPath,
    })
    expect(result).toMatchObject({ runtime: "hermes", status: "collected", eventCount: 9 })
    const inspection = inspectTraceFile(exportPath)
    expect(inspection.marketplaceReady).toBe(true)
    expect(inspection.checks.collected).toBe(true)
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

  test("exported openclaw traces are marketplace-ready", () => {
    const { workspace, sourceDir } = writeOpenclawFixture()
    const exportPath = join(workspace, "artifacts", "openclaw.atf.json")
    const result = exportCollectedSession({
      runtime: "openclaw",
      session: openclawSessionId,
      sourceDir,
      exportPath,
    })
    expect(result).toMatchObject({ runtime: "openclaw", status: "collected", eventCount: 9 })
    expect(inspectTraceFile(exportPath).marketplaceReady).toBe(true)
  })
})
