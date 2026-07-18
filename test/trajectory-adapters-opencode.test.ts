import { Database } from "bun:sqlite"
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

import { opencodeAdapter, resolveOpenCodeDataDir } from "../src/trajectory/adapters/opencode"
import { cleanupSellerWorkspaces, createWorkspacePath } from "./trajectory-seller-fixtures"

const sessionId = "01J8TEST00000000000000000A"
const startMs = 1_750_000_000_000
const iso = (ms: number): string => new Date(ms).toISOString()

type InsertSessionRow = {
  readonly id: string
  readonly timeCreatedMs: number
  readonly timeUpdatedMs: number
}

type InsertMessageRow = {
  readonly id: string
  readonly timeCreatedMs: number
  readonly timeUpdatedMs: number
  readonly data: unknown
}

type InsertPartRow = {
  readonly id: string
  readonly messageId: string
  readonly timeCreatedMs: number
  readonly timeUpdatedMs: number
  readonly data: unknown
}

type OpenCodeStore = {
  readonly sourceDir: string
  readonly dbPath: string
  readonly sessionId: string
  readonly insertSession: (row: InsertSessionRow) => void
  readonly insertMessage: (row: InsertMessageRow) => void
  readonly insertPart: (row: InsertPartRow) => void
}

type FixturePaths = Readonly<{ readonly sourceDir: string; readonly dbPath: string }>

type WriteStoreOptions = {
  readonly sessionId?: string
  readonly sessionCreatedMs?: number
  readonly sessionUpdatedMs?: number
}

const writeOpenCodeStore = (
  build: (store: OpenCodeStore) => void,
  options: WriteStoreOptions = {},
): FixturePaths & { readonly sessionId: string } => {
  const workspace = createWorkspacePath()
  const sourceDir = join(workspace, "opencode-home")
  mkdirSync(sourceDir, { recursive: true })
  const dbPath = join(sourceDir, "opencode.db")
  const sqlite = new Database(dbPath, { create: true, strict: true })
  sqlite.run(`CREATE TABLE session (
    id TEXT PRIMARY KEY,
    time_created INTEGER NOT NULL,
    time_updated INTEGER NOT NULL
  )`)
  sqlite.run(`CREATE TABLE message (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    time_created INTEGER NOT NULL,
    time_updated INTEGER NOT NULL,
    data TEXT NOT NULL
  )`)
  sqlite.run(`CREATE TABLE part (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    time_created INTEGER NOT NULL,
    time_updated INTEGER NOT NULL,
    data TEXT NOT NULL
  )`)
  const activeSessionId = options.sessionId ?? sessionId
  sqlite
    .query("INSERT INTO session (id, time_created, time_updated) VALUES (?, ?, ?)")
    .run(activeSessionId, options.sessionCreatedMs ?? startMs, options.sessionUpdatedMs ?? startMs)
  const store: OpenCodeStore = {
    sourceDir,
    dbPath,
    sessionId: activeSessionId,
    insertSession: (row) => {
      sqlite
        .query("INSERT INTO session (id, time_created, time_updated) VALUES (?, ?, ?)")
        .run(row.id, row.timeCreatedMs, row.timeUpdatedMs)
    },
    insertMessage: (row) => {
      sqlite
        .query(
          "INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          row.id,
          activeSessionId,
          row.timeCreatedMs,
          row.timeUpdatedMs,
          JSON.stringify(row.data),
        )
    },
    insertPart: (row) => {
      sqlite
        .query(
          "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          row.id,
          row.messageId,
          activeSessionId,
          row.timeCreatedMs,
          row.timeUpdatedMs,
          JSON.stringify(row.data),
        )
    },
  }
  build(store)
  sqlite.close()
  return { sourceDir, dbPath, sessionId: activeSessionId }
}

// The canonical one-turn fixture used by event-mapping, attestation,
// token-mapping, cost-exclusion, and reasoning-redaction tests.
const writeStandardConversionFixture = (): FixturePaths =>
  writeOpenCodeStore((store) => {
    store.insertMessage({
      id: "msg_user_1",
      timeCreatedMs: startMs + 1_000,
      timeUpdatedMs: startMs + 1_000,
      data: {
        role: "user",
        metadata: { time: { created: startMs + 1_000 }, sessionID: store.sessionId },
      },
    })
    store.insertPart({
      id: "part_user_1_text",
      messageId: "msg_user_1",
      timeCreatedMs: startMs + 1_000,
      timeUpdatedMs: startMs + 1_000,
      data: { type: "text", text: "Fix the login bug" },
    })
    store.insertMessage({
      id: "msg_asst_1",
      timeCreatedMs: startMs + 2_000,
      timeUpdatedMs: startMs + 5_000,
      data: {
        role: "assistant",
        modelID: "claude-sonnet-4-5",
        providerID: "anthropic",
        cost: 0.0247,
        tokens: {
          input: 1660,
          output: 55,
          reasoning: 1024,
          cache: { read: 108928, write: 4096 },
        },
      },
    })
    store.insertPart({
      id: "part_asst_1_text",
      messageId: "msg_asst_1",
      timeCreatedMs: startMs + 2_000,
      timeUpdatedMs: startMs + 2_000,
      data: { type: "text", text: "On it" },
    })
    store.insertPart({
      id: "part_asst_1_reasoning",
      messageId: "msg_asst_1",
      timeCreatedMs: startMs + 2_000,
      timeUpdatedMs: startMs + 2_000,
      data: { type: "reasoning", text: "private reasoning that must never be exported" },
    })
    store.insertPart({
      id: "part_asst_1_tool",
      messageId: "msg_asst_1",
      timeCreatedMs: startMs + 3_000,
      timeUpdatedMs: startMs + 4_000,
      data: {
        type: "tool",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "rg login src/" },
          output: "src/login.ts:42 matches",
        },
      },
    })
  })

afterEach(cleanupSellerWorkspaces)

describe("opencode adapter", () => {
  test("resolves OpenCode data under XDG_DATA_HOME or the XDG fallback", () => {
    expect(resolveOpenCodeDataDir("/Users/example", { XDG_DATA_HOME: "/custom/data" })).toBe(
      "/custom/data/opencode",
    )
    expect(resolveOpenCodeDataDir("/Users/example", {})).toBe(
      "/Users/example/.local/share/opencode",
    )
  })

  test("lists sessions newest-first from the shared opencode.db", () => {
    const olderSessionId = "01J8OLD000000000000000000Z"
    const newerSessionId = "01J8NEW000000000000000000Z"
    const { sourceDir, dbPath } = writeOpenCodeStore(
      (store) => {
        store.insertSession({
          id: newerSessionId,
          timeCreatedMs: startMs + 1_000,
          timeUpdatedMs: startMs + 86_400_000,
        })
      },
      {
        sessionId: olderSessionId,
        sessionCreatedMs: startMs,
        sessionUpdatedMs: startMs,
      },
    )

    const sessions = opencodeAdapter.listSessions(sourceDir)

    expect(sessions.map((session) => session.sessionId)).toEqual([newerSessionId, olderSessionId])
    // The store is one shared file; both rows point at the same dbPath.
    expect(sessions[0]?.sessionPath).toBe(dbPath)
    expect(sessions[1]?.sessionPath).toBe(dbPath)
    expect(sessions[0]?.modifiedAt).toBe(iso(startMs + 86_400_000))
    expect(sessions[1]?.modifiedAt).toBe(iso(startMs))

    expect(opencodeAdapter.listSessions(dbPath).map((session) => session.sessionId)).toEqual([
      newerSessionId,
      olderSessionId,
    ])
  })

  test("converts one full session into the cross-adapter event sequence", () => {
    const { dbPath } = writeStandardConversionFixture()

    const trace = opencodeAdapter.convertSession({ sessionPath: dbPath, sessionId })

    expect(trace.runtime).toBe("opencode")
    expect(trace.status).toBe("collected")
    expect(trace.events.map((event) => `${event.kind}:${event.name}`)).toEqual([
      `session_start:${sessionId}`,
      "function_enter:turn-1",
      "llm_call:claude-sonnet-4-5",
      "tool_call:bash",
      "tool_result:bash",
      "function_exit:turn-1",
    ])
    expect(trace.events[1]?.detail).toBe("Fix the login bug")
    expect(trace.events[2]?.detail).toBe("On it")
    expect(trace.events[3]?.detail).toBe("rg login src/")
    expect(trace.events[4]?.detail).toBe("ok")

    // Reasoning text and the raw cost value must never leak through the
    // serialized trace.
    const serialized = JSON.stringify(trace)
    expect(serialized).not.toContain("private reasoning")
    expect(serialized).not.toContain("0.0247")
  })

  test("emits ATF v2 source attestation from session/message/part rows with native parent links", () => {
    const { dbPath } = writeStandardConversionFixture()

    const trace = opencodeAdapter.convertSession({ sessionPath: dbPath, sessionId })
    expect(trace.formatVersion).toBe(2)

    // session_start is attested from the session row's stable id + time_created.
    const sessionStart = trace.events[0]
    expect(sessionStart?.kind).toBe("session_start")
    expect(sessionStart?.timestamp).toBe(iso(startMs))
    expect(sessionStart?.sourceEventId).toBe(`opencode:session:${sessionId}`)
    expect(sessionStart?.parentSourceEventId).toBeUndefined()

    // function_enter is attested from the user message row.
    const functionEnter = trace.events[1]
    expect(functionEnter?.kind).toBe("function_enter")
    expect(functionEnter?.timestamp).toBe(iso(startMs + 1_000))
    expect(functionEnter?.sourceEventId).toBe("opencode:message:msg_user_1")
    expect(functionEnter?.parentSourceEventId).toBeUndefined()

    // llm_call is attested from the assistant message row.
    const llmCall = trace.events[2]
    expect(llmCall?.kind).toBe("llm_call")
    expect(llmCall?.timestamp).toBe(iso(startMs + 2_000))
    expect(llmCall?.sourceEventId).toBe("opencode:message:msg_asst_1")
    expect(llmCall?.parentSourceEventId).toBeUndefined()

    // tool_call: the tool part's "call" face. Parent is the enclosing
    // assistant llm_call. The composed source ID keeps the call/result pair
    // distinct so the document never carries a duplicate sourceEventId.
    const toolCall = trace.events[3]
    expect(toolCall?.kind).toBe("tool_call")
    expect(toolCall?.timestamp).toBe(iso(startMs + 3_000))
    expect(toolCall?.sourceEventId).toBe("opencode:part:part_asst_1_tool:call")
    expect(toolCall?.parentSourceEventId).toBe("opencode:message:msg_asst_1")

    // tool_result: the tool part's "result" face. Parent is the matching
    // tool_call from the same part, not the assistant message.
    const toolResult = trace.events[4]
    expect(toolResult?.kind).toBe("tool_result")
    expect(toolResult?.timestamp).toBe(iso(startMs + 4_000))
    expect(toolResult?.sourceEventId).toBe("opencode:part:part_asst_1_tool:result")
    expect(toolResult?.parentSourceEventId).toBe("opencode:part:part_asst_1_tool:call")

    // Synthetic function_exit closer has no native source line.
    const closer = trace.events[5]
    expect(closer?.kind).toBe("function_exit")
    expect(closer?.timestamp).toBeUndefined()
    expect(closer?.sourceEventId).toBeUndefined()
    expect(closer?.parentSourceEventId).toBeUndefined()
  })

  test("maps assistant tokens to the cross-adapter usage shape with cache read/write separate", () => {
    const { dbPath } = writeStandardConversionFixture()

    const trace = opencodeAdapter.convertSession({ sessionPath: dbPath, sessionId })
    const llmCall = trace.events.find((event) => event.kind === "llm_call")
    expect(llmCall?.payload?.usage).toEqual({
      model: "claude-sonnet-4-5",
      inputTokens: 1660,
      outputTokens: 55,
      reasoningOutputTokens: 1024,
      // cache.read and cache.write stay distinct on the cross-adapter shape:
      // cachedInputTokens is the cache-read sibling, cacheWriteTokens is the
      // cache-write sibling. They are never summed or conflated.
      cachedInputTokens: 108928,
      cacheWriteTokens: 4096,
    })
  })

  test("ignores the cost field on assistant metadata", () => {
    const { dbPath } = writeStandardConversionFixture()

    const trace = opencodeAdapter.convertSession({ sessionPath: dbPath, sessionId })

    // The emitted usage object must not carry cost in any shape.
    const llmCall = trace.events.find((event) => event.kind === "llm_call")
    expect(llmCall?.payload?.usage).toBeDefined()
    expect(llmCall?.payload?.usage).not.toHaveProperty("cost")

    // The raw cost value and the literal "cost" key must not appear anywhere
    // in the serialized trace — neither in the payload nor in detail strings.
    const serialized = JSON.stringify(trace)
    expect(serialized).not.toContain("0.0247")
    expect(serialized).not.toMatch(/"cost"\s*:/)
  })

  test("never exports reasoning text but keeps reasoning token counts", () => {
    const { dbPath } = writeStandardConversionFixture()

    const trace = opencodeAdapter.convertSession({ sessionPath: dbPath, sessionId })

    // The private reasoning span content must not leak through the trace.
    const serialized = JSON.stringify(trace)
    expect(serialized).not.toContain("private reasoning that must never be exported")

    const llmCall = trace.events.find((event) => event.kind === "llm_call")
    expect(llmCall?.payload?.usage?.reasoningOutputTokens).toBe(1024)
  })

  test("falls back to step-finish part tokens when assistant.tokens is missing", () => {
    const { dbPath } = writeOpenCodeStore((store) => {
      store.insertMessage({
        id: "msg_user_1",
        timeCreatedMs: startMs + 1_000,
        timeUpdatedMs: startMs + 1_000,
        data: { role: "user", metadata: { time: { created: startMs + 1_000 } } },
      })
      store.insertPart({
        id: "part_user_1_text",
        messageId: "msg_user_1",
        timeCreatedMs: startMs + 1_000,
        timeUpdatedMs: startMs + 1_000,
        data: { type: "text", text: "Run it" },
      })
      store.insertMessage({
        id: "msg_asst_1",
        timeCreatedMs: startMs + 2_000,
        timeUpdatedMs: startMs + 5_000,
        data: {
          role: "assistant",
          modelID: "claude-sonnet-4-5",
          providerID: "anthropic",
          cost: 0.01,
        },
      })
      store.insertPart({
        id: "part_asst_1_text",
        messageId: "msg_asst_1",
        timeCreatedMs: startMs + 2_000,
        timeUpdatedMs: startMs + 2_000,
        data: { type: "text", text: "Done" },
      })
      store.insertPart({
        id: "part_asst_1_step_finish",
        messageId: "msg_asst_1",
        timeCreatedMs: startMs + 3_000,
        timeUpdatedMs: startMs + 3_000,
        data: {
          type: "step-finish",
          tokens: {
            input: 2000,
            output: 80,
            reasoning: 1500,
            cache: { read: 2000, write: 1000 },
          },
        },
      })
    })

    const trace = opencodeAdapter.convertSession({ sessionPath: dbPath, sessionId })
    const llmCall = trace.events.find((event) => event.kind === "llm_call")
    expect(llmCall?.payload?.usage).toEqual({
      model: "claude-sonnet-4-5",
      inputTokens: 2000,
      outputTokens: 80,
      reasoningOutputTokens: 1500,
      cachedInputTokens: 2000,
      cacheWriteTokens: 1000,
    })

    // Cost stays excluded even when tokens fall back to a step-finish part.
    expect(llmCall?.payload?.usage).not.toHaveProperty("cost")
  })

  test("omits usage entirely when neither assistant.tokens nor a step-finish part is present", () => {
    const { dbPath } = writeOpenCodeStore((store) => {
      store.insertMessage({
        id: "msg_user_1",
        timeCreatedMs: startMs + 1_000,
        timeUpdatedMs: startMs + 1_000,
        data: { role: "user", metadata: { time: { created: startMs + 1_000 } } },
      })
      store.insertPart({
        id: "part_user_1_text",
        messageId: "msg_user_1",
        timeCreatedMs: startMs + 1_000,
        timeUpdatedMs: startMs + 1_000,
        data: { type: "text", text: "Hi" },
      })
      store.insertMessage({
        id: "msg_asst_1",
        timeCreatedMs: startMs + 2_000,
        timeUpdatedMs: startMs + 3_000,
        data: {
          role: "assistant",
          modelID: "claude-sonnet-4-5",
          providerID: "anthropic",
        },
      })
      store.insertPart({
        id: "part_asst_1_text",
        messageId: "msg_asst_1",
        timeCreatedMs: startMs + 2_000,
        timeUpdatedMs: startMs + 2_000,
        data: { type: "text", text: "Hello" },
      })
    })

    const trace = opencodeAdapter.convertSession({ sessionPath: dbPath, sessionId })
    const llmCall = trace.events.find((event) => event.kind === "llm_call")
    expect(llmCall?.payload?.usage).toBeUndefined()
  })

  test("omits source attestation when message time_created is null", () => {
    // OpenCode's production schema has time_created NOT NULL, but a stripped
    // or partially-migrated store can lack message time data. The adapter
    // must keep emitting the event (kind/name/detail) while dropping the
    // attestation group, mirroring the established hermes fallback.
    const workspace = createWorkspacePath()
    const sourceDir = join(workspace, "opencode-home")
    mkdirSync(sourceDir, { recursive: true })
    const dbPath = join(sourceDir, "opencode.db")
    const sqlite = new Database(dbPath, { create: true, strict: true })
    sqlite.run(`CREATE TABLE session (
      id TEXT PRIMARY KEY,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
    )`)
    sqlite.run(`CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER,
      time_updated INTEGER,
      data TEXT NOT NULL
    )`)
    sqlite.run(`CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    )`)
    sqlite
      .query("INSERT INTO session (id, time_created, time_updated) VALUES (?, ?, ?)")
      .run(sessionId, startMs, startMs + 60_000)
    sqlite
      .query(
        "INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        "msg_user_no_time",
        sessionId,
        null,
        null,
        JSON.stringify({ role: "user", metadata: { time: {} } }),
      )
    sqlite
      .query(
        "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        "part_user_no_time_text",
        "msg_user_no_time",
        sessionId,
        startMs + 1_000,
        startMs + 1_000,
        JSON.stringify({ type: "text", text: "hello" }),
      )
    sqlite.close()

    const trace = opencodeAdapter.convertSession({ sessionPath: dbPath, sessionId })

    // session_start keeps attestation from the session row, whose time data
    // is intact.
    const sessionStart = trace.events[0]
    expect(sessionStart?.kind).toBe("session_start")
    expect(sessionStart?.timestamp).toBe(iso(startMs))
    expect(sessionStart?.sourceEventId).toBe(`opencode:session:${sessionId}`)

    // The function_enter derived from the null-time message keeps its kind,
    // name, and detail but drops the entire attestation group.
    const functionEnter = trace.events[1]
    expect(functionEnter?.kind).toBe("function_enter")
    expect(functionEnter?.detail).toBe("hello")
    expect(functionEnter?.timestamp).toBeUndefined()
    expect(functionEnter?.sourceEventId).toBeUndefined()
    expect(functionEnter?.parentSourceEventId).toBeUndefined()
  })
})
