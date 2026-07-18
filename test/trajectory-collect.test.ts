import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { z } from "zod"

import { claudeCodeAdapter } from "../src/trajectory/adapters/claude-code"
import { codexAdapter } from "../src/trajectory/adapters/codex"
import { harnessDetailMaxLength, redactHarnessDetail } from "../src/trajectory/adapters/contract"
import { getHarnessAdapter, listHarnessAdapters } from "../src/trajectory/adapters/registry"
import { exportCollectedSession } from "../src/trajectory/collect"
import { inspectTraceFile } from "../src/trajectory/evidence"
import { parseObservationArtifact } from "../src/trajectory/observation-parser"
import {
  openPrivacyCache,
  type PrivacyCache,
  type PrivacyCacheEntry,
} from "../src/trajectory/privacy/cache"
import {
  type PrivacyFilter,
  PrivacyFilterUnavailableError,
  type PrivacySpan,
} from "../src/trajectory/privacy/contract"
import { resolveCollectPrivacy } from "../src/trajectory/privacy/pipeline"
import { createTrajectoryProjection } from "../src/trajectory/projections"
import { noopPrivacyFilter, stampPrivacyForTest, testPrivacyOptions } from "./privacy-fixtures"
import {
  cleanupSellerWorkspaces,
  createWorkspacePath,
  packageArgs,
  parseJson,
  runCli,
  writeTraceFixture,
} from "./trajectory-seller-fixtures"

const sessionId = "11111111-2222-3333-4444-555555555555"

// Subset of projection span fields the source-attestation round-trip cares
// about. Non-strict so both regular and metadata-bearing spans parse.
const spanMetadataSchema = z.object({
  startTime: z.string().optional(),
  parentSpanIndex: z.number().int().nonnegative().nullable().optional(),
})

const meta = {
  cwd: "/tmp/project",
  gitBranch: "main",
  sessionId,
  version: "2.1.198",
}

const longText = "The login fix works by re-validating the session cookie. ".repeat(10)

// Distinct ISO 8601 timestamps per record so source-attestation linkage can
// assert each event stamps its OWN raw transcript timestamp.
const ts = (seconds: number): string =>
  `2026-07-18T10:00:${seconds.toString().padStart(2, "0")}.000Z`

const fixtureTranscriptLines: readonly unknown[] = [
  { type: "mode", mode: "code", sessionId, timestamp: ts(0) },
  {
    type: "user",
    isMeta: true,
    timestamp: ts(1),
    message: { role: "user", content: "<system-reminder>injected</system-reminder>" },
    ...meta,
  },
  {
    type: "user",
    timestamp: ts(2),
    message: { role: "user", content: "Fix the login bug please" },
    ...meta,
  },
  {
    type: "assistant",
    timestamp: ts(3),
    message: {
      id: "msg_1",
      model: "claude-opus-4-8",
      content: [{ type: "thinking", thinking: "private reasoning that must never be exported" }],
    },
    ...meta,
  },
  {
    type: "assistant",
    timestamp: ts(4),
    message: {
      id: "msg_1",
      model: "claude-opus-4-8",
      content: [{ type: "text", text: "I'll fix the login bug now" }],
      usage: {
        input_tokens: 1200,
        output_tokens: 45,
        cache_read_input_tokens: 800,
        cache_creation_input_tokens: 200,
      },
    },
    ...meta,
  },
  {
    type: "assistant",
    timestamp: ts(5),
    message: {
      id: "msg_1",
      model: "claude-opus-4-8",
      content: [
        { type: "tool_use", id: "tool_1", name: "Read", input: { file_path: "src/login.ts" } },
      ],
    },
    ...meta,
  },
  {
    type: "assistant",
    timestamp: ts(5),
    message: {
      id: "msg_1",
      model: "claude-opus-4-8",
      content: [{ type: "text", text: " I found the source." }],
    },
    ...meta,
  },
  {
    type: "user",
    timestamp: ts(6),
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "tool_1",
          content: [
            { type: "text", text: "export function login(session) { return rotate(session) }" },
          ],
        },
      ],
    },
    ...meta,
  },
  {
    type: "assistant",
    timestamp: ts(7),
    message: {
      id: "msg_2",
      model: "claude-opus-4-8",
      content: [{ type: "tool_use", id: "tool_2", name: "Bash", input: { command: "bun test" } }],
    },
    ...meta,
  },
  {
    type: "user",
    timestamp: ts(8),
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "tool_2", is_error: true }],
    },
    ...meta,
  },
  {
    type: "assistant",
    isSidechain: true,
    timestamp: ts(9),
    message: {
      id: "msg_side",
      model: "claude-opus-4-8",
      content: [{ type: "text", text: "sidechain output" }],
    },
    ...meta,
  },
  {
    type: "assistant",
    timestamp: ts(10),
    message: { id: "msg_synth", model: "<synthetic>", content: [{ type: "text", text: "error" }] },
    ...meta,
  },
  {
    type: "assistant",
    isApiErrorMessage: true,
    timestamp: ts(11),
    message: {
      id: "msg_err",
      model: "claude-opus-4-8",
      content: [{ type: "text", text: "api error" }],
    },
    ...meta,
  },
  {
    type: "user",
    timestamp: ts(12),
    message: {
      role: "user",
      content: "deploy with api_key=sk-proj-Abc123Def456Ghi789Jkl012Mno345Pqr678 for the fix",
    },
    ...meta,
  },
  {
    type: "assistant",
    timestamp: ts(13),
    message: { id: "msg_3", model: "claude-opus-4-8", content: [{ type: "text", text: longText }] },
    ...meta,
  },
]

const writeFixtureSession = (input?: { readonly fileName?: string }) => {
  const workspace = createWorkspacePath()
  const projectDir = join(workspace, "source", "-tmp-project")
  mkdirSync(projectDir, { recursive: true })
  const sessionPath = join(projectDir, input?.fileName ?? `${sessionId}.jsonl`)
  const lines = fixtureTranscriptLines.map((line) => JSON.stringify(line))
  writeFileSync(sessionPath, `${lines.join("\n")}\nnot-json garbage line\n`, "utf8")
  return { workspace, sourceDir: join(workspace, "source"), sessionPath }
}

afterEach(cleanupSellerWorkspaces)

describe("harness adapter registry", () => {
  test("exposes the built-in adapters and rejects unknown runtimes", () => {
    expect(listHarnessAdapters().map((adapter) => adapter.runtime)).toEqual([
      "claude-code",
      "codex",
      "hermes",
      "openclaw",
      "opencode",
    ])
    expect(getHarnessAdapter("claude-code").displayName).toBe("Claude Code")
    expect(getHarnessAdapter("codex").displayName).toBe("Codex CLI")
    expect(getHarnessAdapter("hermes").displayName).toBe("Hermes Agent")
    expect(getHarnessAdapter("opencode").displayName).toBe("OpenCode")
    expect(getHarnessAdapter("openclaw").displayName).toBe("OpenClaw")
    expect(() => getHarnessAdapter("unknown-harness")).toThrow("unknown_runtime: unknown-harness")
    expect(() => getHarnessAdapter("unknown-harness")).toThrow(
      "available: claude-code, codex, hermes, openclaw, opencode",
    )
  })

  test("redacts secret markers and truncates long detail text", () => {
    expect(redactHarnessDetail("Authorization: Bearer abc")).toBe("[redacted]")
    expect(redactHarnessDetail("safe text")).toBe("safe text")
    const truncated = redactHarnessDetail("word ".repeat(200))
    expect(truncated.length).toBe(harnessDetailMaxLength)
    expect(truncated.endsWith("…")).toBe(true)
  })
})

describe("claude-code adapter", () => {
  test("converts a transcript into turn-structured ATF events without leaking thinking", () => {
    const { sessionPath } = writeFixtureSession()
    const trace = claudeCodeAdapter.convertSession({ sessionPath })

    expect(trace.runtime).toBe("claude-code")
    expect(trace.status).toBe("collected")
    expect(trace.eventCount).toBe(trace.events.length)
    expect(trace.events.map((event) => `${event.kind}:${event.name}`)).toEqual([
      `session_start:${sessionId}`,
      "function_enter:turn-1",
      "llm_call:claude-opus-4-8",
      "tool_call:Read",
      "tool_result:Read",
      "llm_call:claude-opus-4-8",
      "tool_call:Bash",
      "tool_result:Bash",
      "function_exit:turn-1",
      "function_enter:turn-2",
      "llm_call:claude-opus-4-8",
      "function_exit:turn-2",
    ])

    const serialized = JSON.stringify(trace)
    expect(serialized).not.toContain("private reasoning")
    expect(serialized).not.toContain("sidechain output")
    // The realistically-shaped secret is redacted in BOTH lanes: the detail
    // summary (blunt marker) and the payload content (credential pattern).
    expect(serialized).not.toContain("sk-proj-Abc123Def456Ghi789")

    expect(trace.events[0]?.detail).toBe("claude-code 2.1.198 cwd=/tmp/project branch=main")
    expect(trace.events[1]?.detail).toBe("Fix the login bug please")
    expect(trace.events[2]?.detail).toBe("I'll fix the login bug now I found the source.")
    expect(trace.events[3]?.detail).toBe("src/login.ts")
    expect(trace.events[4]?.detail).toBe("ok")
    expect(trace.events[5]?.detail).toBe("")
    expect(trace.events[6]?.detail).toBe("bun test")
    expect(trace.events[7]?.detail).toBe("error")
    expect(trace.events[9]?.detail).toBe("[redacted]")
    expect(trace.events[10]?.detail.endsWith("…")).toBe(true)
  })

  test("captures high-fidelity payloads: observation, action, usage (formatVersion 2)", () => {
    const { sessionPath } = writeFixtureSession()
    const trace = claudeCodeAdapter.convertSession({ sessionPath })
    expect(trace.formatVersion).toBe(2)

    const byKind = (kind: string, index = 0) =>
      trace.events.filter((event) => event.kind === kind)[index]

    // Observation: the tool_result now carries the real output, not just "ok".
    const readResult = byKind("tool_result")
    expect(readResult?.detail).toBe("ok")
    expect(readResult?.payload?.isError).toBe(false)
    expect(readResult?.payload?.output).toBe(
      "export function login(session) { return rotate(session) }",
    )
    expect(readResult?.payload?.byteCount).toBeGreaterThan(0)

    // Action: the tool_call carries the full input, not a summarized key.
    const readCall = byKind("tool_call")
    expect(readCall?.payload?.input).toEqual({ file_path: "src/login.ts" })

    // Usage: llm_call carries model + token counts. cache_read_input_tokens
    // maps to cachedInputTokens (cross-adapter field also used by Codex
    // cached_input_tokens and OpenClaw cacheRead); cache_creation_input_tokens
    // maps to cacheWriteTokens (also used by OpenClaw cacheWrite and Hermes
    // cache_write_tokens).
    const llm = byKind("llm_call")
    expect(llm?.payload?.usage).toEqual({
      model: "claude-opus-4-8",
      inputTokens: 1200,
      outputTokens: 45,
      cachedInputTokens: 800,
      cacheWriteTokens: 200,
    })
    expect(llm?.payload?.content).toEqual([
      { type: "text", text: "I'll fix the login bug now" },
      { type: "tool_use", id: "tool_1", name: "Read", input: { file_path: "src/login.ts" } },
      { type: "text", text: " I found the source." },
    ])

    // The secret prompt: detail redacted (marker), payload content redacted
    // (credential pattern) — neither lane leaks it.
    const secretTurn = trace.events.find(
      (event) => event.kind === "function_enter" && event.detail === "[redacted]",
    )
    expect(secretTurn?.payload?.content).not.toContain("sk-proj-Abc123Def456Ghi789")
    expect(secretTurn?.payload?.content).toContain("[redacted]")

    // Thinking never reaches the payload.
    expect(JSON.stringify(trace)).not.toContain("private reasoning")
  })

  test("rejects missing and non-jsonl sessions", () => {
    const { sessionPath } = writeFixtureSession({ fileName: "session.txt" })
    expect(() => claudeCodeAdapter.convertSession({ sessionPath: `.missing` })).toThrow(
      "missing_session",
    )
    expect(() => claudeCodeAdapter.convertSession({ sessionPath })).toThrow("invalid_session")
  })

  test("lists sessions under project directories newest first", () => {
    const { sourceDir, sessionPath } = writeFixtureSession()
    const olderPath = join(sourceDir, "older-session.jsonl")
    writeFileSync(olderPath, `${JSON.stringify(fixtureTranscriptLines[2])}\n`, "utf8")
    utimesSync(olderPath, new Date("2026-01-01"), new Date("2026-01-01"))

    const sessions = claudeCodeAdapter.listSessions(sourceDir)
    expect(sessions).toHaveLength(2)
    expect(sessions[0]?.sessionPath).toBe(sessionPath)
    expect(sessions[0]?.projectDir).toBe("-tmp-project")
    expect(sessions[1]?.sessionId).toBe("older-session")
    expect(() => claudeCodeAdapter.listSessions(join(sourceDir, "missing"))).toThrow(
      "missing_source_dir",
    )
  })

  test("emits ATF v2 source attestation from raw transcript timestamp and native IDs", () => {
    const { sessionPath } = writeFixtureSession()
    const trace = claudeCodeAdapter.convertSession({ sessionPath })
    expect(trace.formatVersion).toBe(2)

    // session_start attests the first conversational record's raw timestamp
    // and a session-namespaced source ID; no parent.
    const sessionStart = trace.events[0]
    expect(sessionStart?.kind).toBe("session_start")
    expect(sessionStart?.timestamp).toBe(ts(2))
    expect(sessionStart?.sourceEventId).toBe(`claude-code:session:${sessionId}`)
    expect(sessionStart?.parentSourceEventId).toBeUndefined()

    // Synthetic turn spans stay unattested.
    for (const event of trace.events.filter((e) => e.kind === "function_enter")) {
      expect(event.timestamp).toBeUndefined()
      expect(event.sourceEventId).toBeUndefined()
      expect(event.parentSourceEventId).toBeUndefined()
    }
    for (const event of trace.events.filter((e) => e.kind === "function_exit")) {
      expect(event.timestamp).toBeUndefined()
      expect(event.sourceEventId).toBeUndefined()
      expect(event.parentSourceEventId).toBeUndefined()
    }

    // llm_call: raw timestamp + claude-code:message:<message.id>, no parent.
    const llmCalls = trace.events.filter((e) => e.kind === "llm_call")
    expect(llmCalls.map((e) => e.sourceEventId)).toEqual([
      "claude-code:message:msg_1",
      "claude-code:message:msg_2",
      "claude-code:message:msg_3",
    ])
    expect(llmCalls.map((e) => e.timestamp)).toEqual([ts(4), ts(7), ts(13)])
    for (const llm of llmCalls) {
      expect(llm.parentSourceEventId).toBeUndefined()
    }

    // tool_call: source ID in the tool namespace; parent points at the
    // enclosing emitted llm_call's sourceEventId.
    const toolCalls = trace.events.filter((e) => e.kind === "tool_call")
    expect(toolCalls.map((e) => e.sourceEventId)).toEqual([
      "claude-code:tool:tool_1",
      "claude-code:tool:tool_2",
    ])
    expect(toolCalls.map((e) => e.parentSourceEventId)).toEqual([
      "claude-code:message:msg_1",
      "claude-code:message:msg_2",
    ])
    expect(toolCalls.map((e) => e.timestamp)).toEqual([ts(5), ts(7)])

    // tool_result: distinct result-namespace source ID (no collision with the
    // matching tool_call); parent points at the matching tool_call's source ID
    // via the tool_use_id map.
    const toolResults = trace.events.filter((e) => e.kind === "tool_result")
    expect(toolResults.map((e) => e.sourceEventId)).toEqual([
      "claude-code:result:tool_1",
      "claude-code:result:tool_2",
    ])
    expect(toolResults.map((e) => e.parentSourceEventId)).toEqual([
      "claude-code:tool:tool_1",
      "claude-code:tool:tool_2",
    ])
    expect(toolResults.map((e) => e.timestamp)).toEqual([ts(6), ts(8)])

    // Every attested event has the complete group; no partial fields leak.
    for (const event of trace.events) {
      const hasTimestamp = event.timestamp !== undefined
      const hasSource = event.sourceEventId !== undefined
      const hasParent = event.parentSourceEventId !== undefined
      expect(hasTimestamp).toBe(hasSource)
      expect(hasParent ? hasTimestamp && hasSource : true).toBe(true)
    }
  })

  test("omits the entire source-attestation group when raw timestamp is missing", () => {
    const workspace = createWorkspacePath()
    const projectDir = join(workspace, "source", "-tmp-project")
    mkdirSync(projectDir, { recursive: true })
    const sessionPath = join(projectDir, `${sessionId}.jsonl`)
    const stripped = fixtureTranscriptLines.map((line) => {
      const record = line as Record<string, unknown>
      const { timestamp: _omit, ...rest } = record
      return JSON.stringify(rest)
    })
    writeFileSync(sessionPath, `${stripped.join("\n")}\n`, "utf8")

    const trace = claudeCodeAdapter.convertSession({ sessionPath })
    for (const event of trace.events) {
      expect(event.timestamp).toBeUndefined()
      expect(event.sourceEventId).toBeUndefined()
      expect(event.parentSourceEventId).toBeUndefined()
    }
    // formatVersion is still 2 because payloads exist.
    expect(trace.formatVersion).toBe(2)
  })

  test("omits the entire source-attestation group when raw timestamp is invalid", () => {
    const workspace = createWorkspacePath()
    const projectDir = join(workspace, "source", "-tmp-project")
    mkdirSync(projectDir, { recursive: true })
    const sessionPath = join(projectDir, `${sessionId}.jsonl`)
    const poisoned = fixtureTranscriptLines.map((line) =>
      JSON.stringify({ ...(line as Record<string, unknown>), timestamp: "not-an-iso-timestamp" }),
    )
    writeFileSync(sessionPath, `${poisoned.join("\n")}\n`, "utf8")

    const trace = claudeCodeAdapter.convertSession({ sessionPath })
    for (const event of trace.events) {
      expect(event.timestamp).toBeUndefined()
      expect(event.sourceEventId).toBeUndefined()
      expect(event.parentSourceEventId).toBeUndefined()
    }
    // Payloads still flow; formatVersion stays 2 from payload alone.
    expect(trace.formatVersion).toBe(2)
  })

  test("round-trips ATF v2 through parseObservationArtifact and createTrajectoryProjection", () => {
    // Given: a real convertSession trace document carrying formatVersion 2
    // source attestation derived from raw transcript IDs/timestamps.
    const { sessionPath } = writeFixtureSession()
    const trace = claudeCodeAdapter.convertSession({ sessionPath })
    expect(trace.formatVersion).toBe(2)
    const sourceBytes = Buffer.from(JSON.stringify(trace), "utf8")

    // When: the canonical observation parser and OpenInference projection both
    // receive the same bytes a downstream buyer would parse after escrow.
    const parsed = parseObservationArtifact(sourceBytes, 0)
    const result = createTrajectoryProjection({ profile: "openinference", sourceBytes })

    // Then: the document parses as ATF v2 with one parsed fact per source event,
    // every attested event survives as a span with the original raw startTime,
    // and the native Claude tool_call -> llm parent link resolves into a numeric
    // parentSpanIndex. Raw source IDs do not leak through the projection surface
    // beyond startTime/parentSpanIndex, and no synthetic trace/span identifiers
    // exist.
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

    // Claude tool_call -> llm: the first tool_call's parentSourceEventId points
    // at an emitted llm_call's sourceEventId, which the projection resolves.
    const firstToolCallIndex = trace.events.findIndex((event) => event.kind === "tool_call")
    expect(firstToolCallIndex).toBeGreaterThan(-1)
    const firstToolCall = trace.events[firstToolCallIndex]
    const parentLinkIndex = trace.events.findIndex(
      (event) => event.sourceEventId === firstToolCall?.parentSourceEventId,
    )
    expect(parentLinkIndex).toBeGreaterThan(-1)
    expect(spanMetadata[firstToolCallIndex]?.parentSpanIndex).toBe(parentLinkIndex)

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
})

const codexSessionId = "rollout-2026-07-01T10-00-00-abc123"

const codexRolloutLines: readonly unknown[] = [
  {
    timestamp: "2026-07-01T10:00:00.000Z",
    type: "session_meta",
    payload: {
      id: "abc123",
      session_id: "abc123",
      cwd: "/tmp/project",
      originator: "codex_cli",
      cli_version: "0.142.4",
    },
  },
  { type: "event_msg", payload: { type: "task_started" } },
  { type: "turn_context", payload: { turn_id: "turn-ctx-1", model: "gpt-5.4-mini" } },
  {
    timestamp: "2026-07-01T10:00:03.000Z",
    type: "event_msg",
    payload: { type: "user_message", message: "Refactor the auth module" },
  },
  {
    type: "response_item",
    payload: { type: "reasoning", id: "rs_1", encrypted_content: "gAAAAA-private-reasoning" },
  },
  {
    type: "response_item",
    payload: {
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: "system instructions blob" }],
    },
  },
  {
    timestamp: "2026-07-01T10:00:06.000Z",
    type: "response_item",
    payload: {
      type: "message",
      id: "msg_1",
      role: "assistant",
      content: [{ type: "output_text", text: "Starting the refactor now" }],
    },
  },
  {
    timestamp: "2026-07-01T10:00:07.000Z",
    type: "response_item",
    payload: {
      type: "function_call",
      name: "exec_command",
      call_id: "call_1",
      arguments: JSON.stringify({ cmd: "rg -n auth src/", workdir: "/tmp/project" }),
    },
  },
  {
    timestamp: "2026-07-01T10:00:08.000Z",
    type: "response_item",
    payload: {
      type: "function_call_output",
      call_id: "call_1",
      output: "Chunk ID: x\nProcess exited with code 0\nOutput:\nsrc/auth.ts",
    },
  },
  {
    timestamp: "2026-07-01T10:00:09.000Z",
    type: "response_item",
    payload: {
      type: "function_call",
      name: "exec_command",
      call_id: "call_2",
      arguments: JSON.stringify({ cmd: "bun test" }),
    },
  },
  {
    timestamp: "2026-07-01T10:00:10.000Z",
    type: "response_item",
    payload: {
      type: "function_call_output",
      call_id: "call_2",
      output: "Process exited with code 1\nOutput:\n1 fail",
    },
  },
  {
    timestamp: "2026-07-01T10:00:11.000Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        last_token_usage: {
          input_tokens: 30335,
          cached_input_tokens: 4992,
          output_tokens: 1088,
          reasoning_output_tokens: 447,
          total_tokens: 31423,
        },
        total_token_usage: {
          input_tokens: 30335,
          cached_input_tokens: 4992,
          output_tokens: 1088,
          reasoning_output_tokens: 447,
          total_tokens: 31423,
        },
        model_context_window: 950000,
      },
      rate_limits: { limit_id: "codex", plan_type: "pro" },
    },
  },
  {
    timestamp: "2026-07-01T10:00:12.000Z",
    type: "event_msg",
    payload: { type: "user_message", message: "now use api_key=sk-demo" },
  },
  {
    timestamp: "2026-07-01T10:00:13.000Z",
    type: "response_item",
    payload: {
      type: "message",
      id: "msg_2",
      role: "assistant",
      content: [{ type: "output_text", text: "Done" }],
    },
  },
  {
    timestamp: "2026-07-01T10:00:14.000Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        last_token_usage: {
          input_tokens: 48044,
          cached_input_tokens: 30080,
          output_tokens: 943,
          reasoning_output_tokens: 461,
          total_tokens: 48987,
        },
        total_token_usage: {
          input_tokens: 78379,
          cached_input_tokens: 35072,
          output_tokens: 2031,
          reasoning_output_tokens: 908,
          total_tokens: 80410,
        },
        model_context_window: 950000,
      },
    },
  },
  // task_complete is bookkeeping: no timestamp, must stay unattested.
  { type: "event_msg", payload: { type: "task_complete" } },
]

const writeCodexFixtureSession = () => {
  const workspace = createWorkspacePath()
  const dayDir = join(workspace, "codex-source", "2026", "07", "01")
  mkdirSync(dayDir, { recursive: true })
  const sessionPath = join(dayDir, `${codexSessionId}.jsonl`)
  const lines = codexRolloutLines.map((line) => JSON.stringify(line))
  writeFileSync(sessionPath, `${lines.join("\n")}\ntorn-tail{\n`, "utf8")
  return { workspace, sourceDir: join(workspace, "codex-source"), sessionPath }
}

describe("codex adapter", () => {
  test("converts a rollout into turn-structured ATF events without leaking reasoning", () => {
    const { sessionPath } = writeCodexFixtureSession()
    const trace = codexAdapter.convertSession({ sessionPath })

    expect(trace.runtime).toBe("codex")
    expect(trace.status).toBe("collected")
    expect(trace.events.map((event) => `${event.kind}:${event.name}`)).toEqual([
      "session_start:abc123",
      "function_enter:turn-1",
      "llm_call:gpt-5.4-mini",
      "tool_call:exec_command",
      "tool_result:exec_command",
      "tool_call:exec_command",
      "tool_result:exec_command",
      "function_exit:turn-1",
      "function_enter:turn-2",
      "llm_call:gpt-5.4-mini",
      "function_exit:turn-2",
    ])

    const serialized = JSON.stringify(trace)
    expect(serialized).not.toContain("gAAAAA")
    expect(serialized).not.toContain("system instructions blob")
    expect(serialized).not.toContain("sk-demo")

    expect(trace.events[0]?.detail).toBe("codex 0.142.4 cwd=/tmp/project originator=codex_cli")
    expect(trace.events[1]?.detail).toBe("Refactor the auth module")
    expect(trace.events[2]?.detail).toBe("Starting the refactor now")
    expect(trace.events[3]?.detail).toBe("rg -n auth src/")
    expect(trace.events[4]?.detail).toBe("ok")
    expect(trace.events[6]?.detail).toBe("error")
    expect(trace.events[8]?.detail).toBe("[redacted]")

    expect(trace.formatVersion).toBe(2)

    expect(trace.events[0]).toMatchObject({
      kind: "session_start",
      timestamp: "2026-07-01T10:00:00.000Z",
      sourceEventId: "codex:session:abc123",
    })
    expect(trace.events[0]?.parentSourceEventId).toBeUndefined()

    expect(trace.events[1]?.kind).toBe("function_enter")
    expect(trace.events[1]?.timestamp).toBe("2026-07-01T10:00:03.000Z")
    expect(typeof trace.events[1]?.sourceEventId).toBe("string")
    expect(trace.events[1]?.sourceEventId).toMatch(/^codex:user_message:/)
    expect(trace.events[1]?.parentSourceEventId).toBeUndefined()

    expect(trace.events[2]).toMatchObject({
      kind: "llm_call",
      timestamp: "2026-07-01T10:00:06.000Z",
      sourceEventId: "codex:message:msg_1",
    })
    expect(trace.events[2]?.parentSourceEventId).toBeUndefined()

    expect(trace.events[3]).toMatchObject({
      kind: "tool_call",
      timestamp: "2026-07-01T10:00:07.000Z",
      sourceEventId: "codex:function_call:call_1",
    })
    expect(trace.events[3]?.parentSourceEventId).toBeUndefined()

    expect(trace.events[4]).toMatchObject({
      kind: "tool_result",
      timestamp: "2026-07-01T10:00:08.000Z",
      sourceEventId: "codex:function_call_output:call_1",
      parentSourceEventId: "codex:function_call:call_1",
    })

    expect(trace.events[5]).toMatchObject({
      kind: "tool_call",
      sourceEventId: "codex:function_call:call_2",
    })
    expect(trace.events[5]?.parentSourceEventId).toBeUndefined()

    expect(trace.events[6]).toMatchObject({
      kind: "tool_result",
      sourceEventId: "codex:function_call_output:call_2",
      parentSourceEventId: "codex:function_call:call_2",
    })

    expect(trace.events[7]?.kind).toBe("function_exit")
    expect(trace.events[7]?.timestamp).toBeUndefined()
    expect(trace.events[7]?.sourceEventId).toBeUndefined()

    expect(trace.events[8]?.kind).toBe("function_enter")
    expect(trace.events[8]?.timestamp).toBe("2026-07-01T10:00:12.000Z")
    expect(typeof trace.events[8]?.sourceEventId).toBe("string")
    expect(trace.events[8]?.sourceEventId).toMatch(/^codex:user_message:/)
    expect(trace.events[8]?.parentSourceEventId).toBeUndefined()

    expect(trace.events[9]).toMatchObject({
      kind: "llm_call",
      timestamp: "2026-07-01T10:00:13.000Z",
      sourceEventId: "codex:message:msg_2",
    })

    expect(trace.events[10]?.kind).toBe("function_exit")
    expect(trace.events[10]?.timestamp).toBeUndefined()
    expect(trace.events[10]?.sourceEventId).toBeUndefined()

    // Codex token_count event_msg records are NOT emitted as their own events
    // but their info.last_token_usage attaches as payload.usage on the most
    // recent llm_call. The fixture's two token_count records target events 2
    // and 9 (the two llm_call events).
    expect(trace.events.filter((event) => event.kind === "token_count")).toHaveLength(0)
    expect(trace.events[2]?.payload?.usage).toEqual({
      model: "gpt-5.4-mini",
      // input_tokens=30335 minus cached_input_tokens=4992 (clamped, not double-counted).
      inputTokens: 25343,
      cachedInputTokens: 4992,
      outputTokens: 1088,
      reasoningOutputTokens: 447,
    })
    expect(trace.events[9]?.payload?.usage).toEqual({
      model: "gpt-5.4-mini",
      // input_tokens=48044 minus cached_input_tokens=30080.
      inputTokens: 17964,
      cachedInputTokens: 30080,
      outputTokens: 943,
      reasoningOutputTokens: 461,
    })
    expect(trace.events[0]?.payload?.usage).toBeUndefined()
    expect(trace.events[3]?.payload?.usage).toBeUndefined()
    // rate_limits / model_context_window bookkeeping must not leak through.
    const leakCheck = JSON.stringify(trace)
    expect(leakCheck).not.toContain("rate_limits")
    expect(leakCheck).not.toContain("model_context_window")
    expect(leakCheck).not.toContain("plan_type")

    for (const event of trace.events) {
      const hasTimestamp = event.timestamp !== undefined
      const hasSource = event.sourceEventId !== undefined
      const hasParent = event.parentSourceEventId !== undefined
      expect(hasTimestamp).toBe(hasSource)
      expect(hasParent ? hasTimestamp && hasSource : true).toBe(true)
    }

    const sourceIds = trace.events
      .map((event) => event.sourceEventId)
      .filter((id): id is string => typeof id === "string")
    expect(new Set(sourceIds).size).toBe(sourceIds.length)

    // Raw adapter output has no stamp; stamp it as the collect pipeline would.
    const inspection = inspectTraceFile(writeTraceFixture(stampPrivacyForTest(trace)).tracePath)
    expect(inspection.marketplaceReady).toBe(true)
    expect(inspection.checks.collected).toBe(true)
  })

  test("rejects rollouts without session metadata and lists nested sessions", async () => {
    const { workspace, sourceDir, sessionPath } = writeCodexFixtureSession()
    const bogusPath = join(sourceDir, "2026", "07", "01", "no-meta.jsonl")
    writeFileSync(bogusPath, `${JSON.stringify({ type: "event_msg", payload: {} })}\n`, "utf8")
    utimesSync(bogusPath, new Date("2026-01-01"), new Date("2026-01-01"))

    expect(() => codexAdapter.convertSession({ sessionPath: bogusPath })).toThrow("invalid_session")

    const sessions = codexAdapter.listSessions(sourceDir)
    expect(sessions).toHaveLength(2)
    expect(sessions[0]?.sessionPath).toBe(sessionPath)
    expect(sessions[0]?.projectDir).toBe(join("2026", "07", "01"))

    const exportPath = join(workspace, "artifacts", "codex.atf.json")
    const result = await exportCollectedSession(
      { runtime: "codex", session: codexSessionId, sourceDir, exportPath },
      testPrivacyOptions,
    )
    expect(result.runtime).toBe("codex")
    expect(result.eventCount).toBe(11)
  })

  test("round-trips ATF v2 through parseObservationArtifact and createTrajectoryProjection", () => {
    // Given: a real convertSession trace document carrying formatVersion 2
    // source attestation from rollout-record native IDs/timestamps.
    const { sessionPath } = writeCodexFixtureSession()
    const trace = codexAdapter.convertSession({ sessionPath })
    expect(trace.formatVersion).toBe(2)
    const sourceBytes = Buffer.from(JSON.stringify(trace), "utf8")

    // When: the canonical observation parser and OpenInference projection both
    // receive the same bytes a downstream buyer would parse after escrow.
    const parsed = parseObservationArtifact(sourceBytes, 0)
    const result = createTrajectoryProjection({ profile: "openinference", sourceBytes })

    // Then: the document parses as ATF v2 with one parsed fact per source event,
    // every attested event survives as a span with the original raw startTime,
    // and the native Codex call_id parent link (tool_result -> tool_call)
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

    // Codex call_id: the first tool_result's parentSourceEventId points at the
    // matching tool_call's sourceEventId, which the projection resolves.
    const firstToolResultIndex = trace.events.findIndex((event) => event.kind === "tool_result")
    expect(firstToolResultIndex).toBeGreaterThan(-1)
    const firstToolResult = trace.events[firstToolResultIndex]
    const parentLinkIndex = trace.events.findIndex(
      (event) => event.sourceEventId === firstToolResult?.parentSourceEventId,
    )
    expect(parentLinkIndex).toBeGreaterThan(-1)
    expect(spanMetadata[firstToolResultIndex]?.parentSpanIndex).toBe(parentLinkIndex)

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

  test("clamps cached_input_tokens > input_tokens and subtracts cache from input", () => {
    const workspace = createWorkspacePath()
    const dayDir = join(workspace, "codex-clamp", "2026", "07", "01")
    mkdirSync(dayDir, { recursive: true })
    const sessionPath = join(dayDir, "rollout-clamp-test.jsonl")
    const lines = [
      {
        timestamp: "2026-07-01T10:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "clamp1",
          session_id: "clamp1",
          cwd: "/tmp",
          originator: "codex_cli",
          cli_version: "0.142.4",
        },
      },
      { type: "turn_context", payload: { model: "gpt-5.4" } },
      {
        timestamp: "2026-07-01T10:00:03.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "go" },
      },
      {
        timestamp: "2026-07-01T10:00:06.000Z",
        type: "response_item",
        payload: {
          type: "message",
          id: "m1",
          role: "assistant",
          content: [{ type: "output_text", text: "ok" }],
        },
      },
      {
        timestamp: "2026-07-01T10:00:07.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 100,
              cached_input_tokens: 150,
              output_tokens: 5,
              total_tokens: 105,
            },
            total_token_usage: {
              input_tokens: 100,
              cached_input_tokens: 150,
              output_tokens: 5,
              total_tokens: 105,
            },
          },
        },
      },
    ].map((line) => JSON.stringify(line))
    writeFileSync(sessionPath, `${lines.join("\n")}\n`, "utf8")

    const trace = codexAdapter.convertSession({ sessionPath })

    // Then: cached is clamped to <= input (min(150, 100) = 100), and input is
    // reduced by the clamped cache so input + cached == raw input (no double count).
    const llmCall = trace.events.find((event) => event.kind === "llm_call")
    expect(llmCall?.payload?.usage).toEqual({
      model: "gpt-5.4",
      inputTokens: 0,
      cachedInputTokens: 100,
      outputTokens: 5,
    })
  })

  test("skips duplicate token_count snapshots and post-compaction zero deltas", () => {
    const workspace = createWorkspacePath()
    const dayDir = join(workspace, "codex-dedup", "2026", "07", "01")
    mkdirSync(dayDir, { recursive: true })
    const sessionPath = join(dayDir, "rollout-dedup-test.jsonl")
    const totalAtFirst = { input_tokens: 100, output_tokens: 5, total_tokens: 105 }
    const lines = [
      {
        timestamp: "2026-07-01T10:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "dedup1",
          session_id: "dedup1",
          cwd: "/tmp",
          originator: "codex_cli",
          cli_version: "0.142.4",
        },
      },
      { type: "turn_context", payload: { model: "gpt-5.4" } },
      {
        timestamp: "2026-07-01T10:00:03.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "go" },
      },
      {
        timestamp: "2026-07-01T10:00:06.000Z",
        type: "response_item",
        payload: {
          type: "message",
          id: "m1",
          role: "assistant",
          content: [{ type: "output_text", text: "one" }],
        },
      },
      {
        timestamp: "2026-07-01T10:00:07.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: { input_tokens: 100, output_tokens: 5, total_tokens: 105 },
            total_token_usage: totalAtFirst,
          },
        },
      },
      // Duplicate cumulative snapshot (same total). Would carry a DIFFERENT
      // bogus last_token_usage if not skipped, overwriting the real value.
      {
        timestamp: "2026-07-01T10:00:08.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: { input_tokens: 999, output_tokens: 999, total_tokens: 999 },
            total_token_usage: totalAtFirst,
          },
        },
      },
      // Post-compaction zero delta — must not advance baseline and must not
      // overwrite the llm_call's already-correct usage.
      {
        timestamp: "2026-07-01T10:00:09.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
            total_token_usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          },
        },
      },
    ].map((line) => JSON.stringify(line))
    writeFileSync(sessionPath, `${lines.join("\n")}\n`, "utf8")

    const trace = codexAdapter.convertSession({ sessionPath })
    const llmCall = trace.events.find((event) => event.kind === "llm_call")
    // The first snapshot's usage survives; the duplicate and zero-delta are skipped.
    expect(llmCall?.payload?.usage).toEqual({
      model: "gpt-5.4",
      inputTokens: 100,
      outputTokens: 5,
    })
  })

  test("auto-includes the archived_sessions sibling when scanning the standard sessions dir", () => {
    const workspace = createWorkspacePath()
    const sessionsDir = join(workspace, "sessions")
    const archivedDir = join(workspace, "archived_sessions")
    mkdirSync(sessionsDir, { recursive: true })
    mkdirSync(archivedDir, { recursive: true })
    const live = join(sessionsDir, "rollout-LIVE.jsonl")
    const archived = join(archivedDir, "rollout-ARCHIVED.jsonl")
    const meta = (id: string) =>
      JSON.stringify({
        timestamp: "2026-07-01T10:00:00.000Z",
        type: "session_meta",
        payload: {
          id,
          session_id: id,
          cwd: "/tmp",
          originator: "codex_cli",
          cli_version: "0.142.4",
        },
      })
    writeFileSync(live, `${meta("LIVE")}\n`, "utf8")
    writeFileSync(archived, `${meta("ARCHIVED")}\n`, "utf8")
    utimesSync(archived, new Date("2026-01-01"), new Date("2026-01-01"))

    const refs = codexAdapter.listSessions(sessionsDir)

    const ids = refs.map((ref) => ref.sessionId).sort()
    expect(ids).toEqual(["rollout-ARCHIVED", "rollout-LIVE"])
  })

  test("does not advance dedup baseline when a token_count is skipped (pre-roll + missing last_token_usage)", () => {
    // Regression: a pre-roll token_count (or one with missing last_token_usage)
    // must NOT advance previousTotalSignature. Otherwise a later token_count
    // with the same total signature would be wrongly skipped as a duplicate,
    // dropping real usage attribution.
    const workspace = createWorkspacePath()
    const dayDir = join(workspace, "codex-baseline", "2026", "07", "01")
    mkdirSync(dayDir, { recursive: true })
    const sessionPath = join(dayDir, "rollout-baseline-test.jsonl")
    const sharedTotal = { input_tokens: 500, output_tokens: 30, total_tokens: 530 }
    const lines = [
      {
        timestamp: "2026-07-01T10:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "base1",
          session_id: "base1",
          cwd: "/tmp",
          originator: "codex_cli",
          cli_version: "0.142.4",
        },
      },
      // Pre-roll token_count: total is set but last_token_usage is missing.
      // No llm_call exists yet, so nothing can be attributed. The baseline
      // MUST NOT advance — otherwise the post-llm token_count below (same
      // total signature) would be skipped.
      {
        timestamp: "2026-07-01T10:00:01.000Z",
        type: "event_msg",
        payload: { type: "token_count", info: { total_token_usage: sharedTotal } },
      },
      { type: "turn_context", payload: { model: "gpt-5.4" } },
      {
        timestamp: "2026-07-01T10:00:03.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "go" },
      },
      {
        timestamp: "2026-07-01T10:00:06.000Z",
        type: "response_item",
        payload: {
          type: "message",
          id: "m1",
          role: "assistant",
          content: [{ type: "output_text", text: "ok" }],
        },
      },
      // Same total signature as the pre-roll snapshot; carries real delta.
      {
        timestamp: "2026-07-01T10:00:07.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: { input_tokens: 500, output_tokens: 30, total_tokens: 530 },
            total_token_usage: sharedTotal,
          },
        },
      },
    ].map((line) => JSON.stringify(line))
    writeFileSync(sessionPath, `${lines.join("\n")}\n`, "utf8")

    const trace = codexAdapter.convertSession({ sessionPath })
    const llmCall = trace.events.find((event) => event.kind === "llm_call")
    expect(llmCall?.payload?.usage).toEqual({
      model: "gpt-5.4",
      inputTokens: 500,
      outputTokens: 30,
    })
  })
})

describe("collect export", () => {
  test("resolves a session id against the source dir and exports a marketplace-ready trace", async () => {
    const { workspace, sourceDir } = writeFixtureSession()
    const exportPath = join(workspace, "artifacts", "collected.atf.json")

    const result = await exportCollectedSession(
      { runtime: "claude-code", session: sessionId, sourceDir, exportPath },
      testPrivacyOptions,
    )
    expect(result).toMatchObject({
      runtime: "claude-code",
      status: "collected",
      eventCount: 12,
    })
    expect(result.eventKinds).toEqual([
      "function_enter",
      "function_exit",
      "llm_call",
      "session_start",
      "tool_call",
      "tool_result",
    ])

    const inspection = inspectTraceFile(exportPath)
    expect(inspection.marketplaceReady).toBe(true)
    expect(inspection.checks.collected).toBe(true)
    expect(inspection.checks.instrumented).toBe(false)
    expect(inspection.checks.redactionClean).toBe(true)
  })

  test("rejects unknown session ids and export paths outside the project", async () => {
    const { sourceDir } = writeFixtureSession()
    expect(
      exportCollectedSession(
        {
          runtime: "claude-code",
          session: "does-not-exist",
          sourceDir,
          exportPath: join(createWorkspacePath(), "out.atf.json"),
        },
        testPrivacyOptions,
      ),
    ).rejects.toThrow("missing_session")
    expect(
      exportCollectedSession(
        {
          runtime: "claude-code",
          session: sessionId,
          sourceDir,
          exportPath: "/tmp/outside-project.atf.json",
        },
        testPrivacyOptions,
      ),
    ).rejects.toThrow("invalid_export_path")
  })

  test("collected traces without tool calls stay below marketplace-ready", () => {
    const workspace = createWorkspacePath()
    mkdirSync(workspace, { recursive: true })
    const tracePath = join(workspace, "no-tools.atf.json")
    writeFileSync(
      tracePath,
      `${JSON.stringify({
        runtime: "claude-code",
        status: "collected",
        eventCount: 2,
        events: [
          { kind: "session_start", name: sessionId, detail: "" },
          { kind: "llm_call", name: "claude-opus-4-8", detail: "hello" },
        ],
      })}\n`,
      "utf8",
    )
    const inspection = inspectTraceFile(tracePath)
    expect(inspection.marketplaceReady).toBe(false)
    expect(inspection.checks.requiredKindsPresent).toBe(false)
  })
})

describe("collect CLI", () => {
  test("collect export feeds the existing seller package pipeline end to end", async () => {
    const { workspace, sourceDir } = writeFixtureSession()
    const exportPath = join(workspace, "artifacts", "collected.atf.json")

    const runtimes = await runCli(["trajectory", "collect", "runtimes"])
    expect(runtimes.success).toBe(true)
    expect(runtimes.stdout).toContain("claude-code")

    const sessions = await runCli([
      "trajectory",
      "collect",
      "sessions",
      "claude-code",
      "--source",
      sourceDir,
    ])
    expect(sessions.success).toBe(true)
    expect(sessions.stdout).toContain(sessionId)

    // Export runs in-process with the fake filter so the E2E stays
    // model-free while still producing a privacy-stamped trace.
    const exported = await exportCollectedSession(
      { runtime: "claude-code", session: sessionId, sourceDir, exportPath },
      testPrivacyOptions,
    )
    expect(exported.privacy.filtered).toBe(true)

    const packaged = await runCli(packageArgs(exportPath, join(workspace, "seller-package")))
    expect(packaged.success).toBe(true)
    const packageResult = parseJson(packaged.stdout) as { listingReady: boolean }
    expect(packageResult.listingReady).toBe(true)
  })

  test("collect export rejects unknown runtimes with the available adapter list", async () => {
    const { sourceDir } = writeFixtureSession()
    const result = await runCli([
      "trajectory",
      "collect",
      "export",
      "codex-cli",
      "--session",
      sessionId,
      "--source",
      sourceDir,
      "--export",
      join(createWorkspacePath(), "out.atf.json"),
    ])
    expect(result.success).toBe(false)
    expect(result.stderr).toContain("unknown_runtime")
    expect(result.stderr).toContain("available: claude-code")
  })
})

// =============================================================================
// TODO 3 (privacy-filter-cache): resolveCollectPrivacy wiring + cache lifecycle.
// Tests exercise: (a) cache enabled → resolved.cache is a PrivacyCache and
// filter is the wrapped filter; (b) cache disabled → no cache field, unwrapped;
// (c) privacy disabled → no cache opened even when cache flag is set;
// (d) exportCollectedSession closes the cache exactly once per export even on
// throw (Oracle O2); (e) export resolves cache path to
// dirname(exportPath)/privacy-cache.db (Oracle O5).
// =============================================================================

const spanOf = (
  start: number,
  end: number,
  category: PrivacySpan["category"],
  score = 0.95,
): PrivacySpan => ({ start, end, category, score })

// In-memory PrivacyCache whose close() counter tests can assert on. Mirrors
// the createMockCache helper in trajectory-privacy-cache.test.ts.
interface MockCache {
  cache: PrivacyCache
  state: {
    closeCalls: number
    setManyCalls: Array<{ entries: PrivacyCacheEntry[]; configHash: string }>
  }
}

const createMockCache = (): MockCache => {
  const backing = new Map<string, readonly PrivacySpan[]>()
  const state: MockCache["state"] = { closeCalls: 0, setManyCalls: [] }
  const keyOf = (textHash: string, configHash: string) => `${textHash}|${configHash}`
  const cache: PrivacyCache = {
    getMany: async (entries) => {
      const result = new Map<string, readonly PrivacySpan[] | undefined>()
      for (const entry of entries) {
        if (result.has(entry.textHash)) continue
        result.set(entry.textHash, backing.get(keyOf(entry.textHash, entry.configHash)))
      }
      return result
    },
    setMany: async (entries, configHash) => {
      state.setManyCalls.push({ entries: [...entries], configHash })
      for (const entry of entries) {
        backing.set(keyOf(entry.textHash, entry.configHash), entry.spans)
      }
    },
    flush: async () => {},
    stats: () => ({ entries: backing.size, diskBytes: 0 }),
    purge: async () => {
      backing.clear()
    },
    close: async () => {
      state.closeCalls += 1
    },
  }
  return { cache, state }
}

describe("resolveCollectPrivacy — privacy cache wiring (TODO 3 acceptance 4,5,6)", () => {
  test("cache enabled + privacy enabled → resolved.cache is a PrivacyCache and filter wraps inner", async () => {
    // Given: a temp dir for the on-disk cache and a recording inner filter.
    const workspace = createWorkspacePath()
    mkdirSync(workspace, { recursive: true })
    const cachePath = join(workspace, "privacy-cache.db")
    let innerDetectCalls = 0
    const inner: PrivacyFilter = {
      detect: async (texts) => {
        innerDetectCalls += 1
        return texts.map(() => [spanOf(0, 1, "email", 0.9)])
      },
    }

    // When: resolveCollectPrivacy runs with cache enabled.
    const resolved = await resolveCollectPrivacy({
      enabled: true,
      filter: inner,
      cache: { enabled: true, path: cachePath },
    })

    // Then: the resolved privacy is enabled, carries a cache handle, and the
    // filter is the wrapped one (first call is observed by the wrapper).
    if (!resolved.enabled) {
      throw new Error("expected privacy to be enabled")
    }
    expect(resolved.cache).toBeDefined()
    expect(typeof resolved.cache?.close).toBe("function")

    // Sanity: the wrapped filter still produces results and reaches inner.
    const result = await resolved.filter.detect(["alpha"])
    expect(result).toEqual([[spanOf(0, 1, "email", 0.9)]])
    expect(innerDetectCalls).toBe(1)

    // And: a second identical call hits the cache (inner not invoked again).
    await resolved.filter.detect(["alpha"])
    expect(innerDetectCalls).toBe(1)

    await resolved.cache?.close()
  })

  test("cache enabled but privacy disabled → no cache field; cache file never opened", async () => {
    // Given: a cache path that does NOT exist (opening it would throw if it
    // were attempted). Privacy is disabled.
    const workspace = createWorkspacePath()
    mkdirSync(workspace, { recursive: true })
    const cachePath = join(workspace, "never-opened.db")
    expect(existsSync(cachePath)).toBe(false)

    // When: resolveCollectPrivacy runs with privacy disabled but cache on.
    const resolved = await resolveCollectPrivacy({
      enabled: false,
      cache: { enabled: true, path: cachePath },
    })

    // Then: privacy is disabled, no cache field, and the file was never
    // created (openPrivacyCache was never called).
    expect(resolved).toEqual({ enabled: false })
    expect(existsSync(cachePath)).toBe(false)
    if (resolved.enabled) {
      throw new Error("privacy must be disabled")
    }
  })

  test("cache disabled + privacy enabled → no cache field on resolved; filter is the unwrapped inner", async () => {
    // Given: a recording inner filter and cache flag explicitly off.
    let innerDetectCalls = 0
    const inner: PrivacyFilter = {
      detect: async (texts) => {
        innerDetectCalls += 1
        return texts.map(() => [])
      },
    }

    // When: resolveCollectPrivacy runs with cache explicitly disabled.
    const resolved = await resolveCollectPrivacy({
      enabled: true,
      filter: inner,
      cache: { enabled: false, path: "/tmp/should-not-be-opened.db" },
    })

    // Then: resolved has no cache field, and the filter is the inner directly
    // (no wrapper). Two calls hit inner twice (no caching).
    if (!resolved.enabled) {
      throw new Error("expected privacy to be enabled")
    }
    expect(resolved.cache).toBeUndefined()
    await resolved.filter.detect(["a"])
    await resolved.filter.detect(["a"])
    expect(innerDetectCalls).toBe(2)
  })

  test("cache options omitted entirely → resolved.cache undefined (existing test paths unchanged)", async () => {
    // Given: privacy options without any cache field (the shape existing tests
    // and the retrofit path pass today).
    const resolved = await resolveCollectPrivacy({ filter: noopPrivacyFilter })

    // Then: the resolved privacy carries no cache handle.
    if (!resolved.enabled) {
      throw new Error("expected privacy to be enabled")
    }
    expect(resolved.cache).toBeUndefined()
  })
})

describe("exportCollectedSession — privacy cache lifecycle (Oracle O2, O5)", () => {
  test("Oracle O2: closes the cache exactly once per export on the happy path", async () => {
    // Given: a fixture session and a mock cache handle injected via the test
    // seam.
    const { sourceDir, workspace } = writeFixtureSession()
    const exportPath = join(workspace, "artifacts", "collected.atf.json")
    const mock = createMockCache()

    // When: export runs to completion with the cache enabled.
    const result = await exportCollectedSession(
      { runtime: "claude-code", session: sessionId, sourceDir, exportPath },
      {
        filter: noopPrivacyFilter,
        cache: {
          enabled: true,
          path: join(dirname(exportPath), "privacy-cache.db"),
          handle: mock.cache,
        },
      },
    )

    // Then: the export succeeded and the cache was closed exactly once.
    expect(result.eventCount).toBeGreaterThan(0)
    expect(mock.state.closeCalls).toBe(1)
  })

  test("Oracle O2: closes the cache exactly once even when applyCollectPrivacy throws", async () => {
    // Given: a fixture session and an inner filter that throws on every call.
    const { sourceDir, workspace } = writeFixtureSession()
    const exportPath = join(workspace, "artifacts", "collected.atf.json")
    const mock = createMockCache()
    const throwingFilter: PrivacyFilter = {
      detect: () => Promise.reject(new PrivacyFilterUnavailableError("engine down")),
    }

    // When: export runs but the privacy pass throws.
    let caught: unknown
    try {
      await exportCollectedSession(
        { runtime: "claude-code", session: sessionId, sourceDir, exportPath },
        {
          filter: throwingFilter,
          cache: {
            enabled: true,
            path: join(dirname(exportPath), "privacy-cache.db"),
            handle: mock.cache,
          },
        },
      )
    } catch (error) {
      caught = error
    }

    // Then: the error propagated AND the cache was closed exactly once via
    // the finally block (no handle leak).
    expect(caught).toBeInstanceOf(PrivacyFilterUnavailableError)
    expect(mock.state.closeCalls).toBe(1)
  })

  test("Oracle O5: export resolves cache path to dirname(exportPath)/privacy-cache.db", async () => {
    // Given: a fixture session and a real (non-mock) cache path next to the
    // export file. The cache path is NOT injected as a handle, so
    // openPrivacyCache runs against the path the export computed.
    const { sourceDir, workspace } = writeFixtureSession()
    const exportPath = join(workspace, "artifacts", "sub", "collected.atf.json")
    const expectedCachePath = join(workspace, "artifacts", "sub", "privacy-cache.db")

    // When: export runs with cache enabled at the dirname-derived path.
    const result = await exportCollectedSession(
      { runtime: "claude-code", session: sessionId, sourceDir, exportPath },
      {
        filter: noopPrivacyFilter,
        cache: { enabled: true, path: expectedCachePath },
      },
    )

    // Then: the export succeeded and the cache file exists at the expected
    // dirname-derived location.
    expect(result.eventCount).toBeGreaterThan(0)
    expect(existsSync(expectedCachePath)).toBe(true)
    expect(existsSync(join(workspace, "artifacts", "sub", "collected.atf.json"))).toBe(true)
  })

  test("cache disabled on export → no cache file created; inner filter invoked per call", async () => {
    // Given: a fixture session with cache explicitly disabled.
    const { sourceDir, workspace } = writeFixtureSession()
    const exportPath = join(workspace, "artifacts", "collected.atf.json")
    const cachePath = join(dirname(exportPath), "privacy-cache.db")
    let innerCalls = 0
    const inner: PrivacyFilter = {
      detect: async (texts) => {
        innerCalls += 1
        return texts.map(() => [])
      },
    }

    // When: export runs with cache disabled.
    const result = await exportCollectedSession(
      { runtime: "claude-code", session: sessionId, sourceDir, exportPath },
      { filter: inner, cache: { enabled: false, path: cachePath } },
    )

    // Then: export succeeded; no cache file was created.
    expect(result.eventCount).toBeGreaterThan(0)
    expect(existsSync(cachePath)).toBe(false)
    expect(innerCalls).toBeGreaterThan(0)
  })
})

describe("resolveCollectPrivacy — wiring with real on-disk cache (integration)", () => {
  test("end-to-end: two detects reuse the cache; second call invokes inner 0 times", async () => {
    // Given: a real on-disk cache at a temp path and a recording inner filter.
    const workspace = createWorkspacePath()
    mkdirSync(workspace, { recursive: true })
    const cachePath = join(workspace, "privacy-cache.db")
    let innerCalls = 0
    const inner: PrivacyFilter = {
      detect: async (texts) => {
        innerCalls += 1
        return texts.map(() => [spanOf(0, 1, "email", 0.9)])
      },
    }

    // When: resolveCollectPrivacy runs with cache enabled; two identical
    // detects issued back-to-back against the resolved (wrapped) filter.
    const resolved = await resolveCollectPrivacy({
      enabled: true,
      filter: inner,
      cache: { enabled: true, path: cachePath },
    })
    if (!resolved.enabled) {
      throw new Error("expected privacy to be enabled")
    }
    try {
      await resolved.filter.detect(["foo"])
      await resolved.filter.detect(["foo"])

      // Then: inner was invoked exactly once (second call was a cache hit).
      expect(innerCalls).toBe(1)
    } finally {
      await resolved.cache?.close()
    }

    // And: the cache file was materialized on disk.
    expect(existsSync(cachePath)).toBe(true)
  })

  test("end-to-end: re-opening the same cache after close still serves hits (persistence)", async () => {
    // Given: a cache populated and closed in a first resolveCollectPrivacy call.
    const workspace = createWorkspacePath()
    mkdirSync(workspace, { recursive: true })
    const cachePath = join(workspace, "privacy-cache.db")
    let innerCalls = 0
    const inner: PrivacyFilter = {
      detect: async (texts) => {
        innerCalls += 1
        return texts.map(() => [spanOf(0, 1, "email", 0.9)])
      },
    }

    const first = await resolveCollectPrivacy({
      enabled: true,
      filter: inner,
      cache: { enabled: true, path: cachePath },
    })
    if (!first.enabled) throw new Error("expected first privacy enabled")
    try {
      await first.filter.detect(["persistent-text"])
    } finally {
      await first.cache?.close()
    }
    const callsAfterFirst = innerCalls
    expect(callsAfterFirst).toBe(1)

    // When: a SECOND resolveCollectPrivacy reopens the same cache file.
    const second = await resolveCollectPrivacy({
      enabled: true,
      filter: inner,
      cache: { enabled: true, path: cachePath },
    })
    if (!second.enabled) throw new Error("expected second privacy enabled")
    try {
      await second.filter.detect(["persistent-text"])
    } finally {
      await second.cache?.close()
    }

    // Then: the cache hit on disk — inner was not invoked again across reopens.
    expect(innerCalls).toBe(callsAfterFirst)
  })

  test("end-to-end: real openPrivacyCache integration — wrapped filter round-trips spans through cache", async () => {
    // Given: a real PrivacyCache handle and a recording inner whose spans
    // encode the input position. Bypass openPrivacyCache via the test seam.
    const dir = await (async () => {
      const workspace = createWorkspacePath()
      mkdirSync(workspace, { recursive: true })
      return workspace
    })()
    const realPath = join(dir, "privacy-cache.db")
    const cacheHandle = await openPrivacyCache(realPath)

    let innerCalls = 0
    const inner: PrivacyFilter = {
      detect: async (texts) => {
        innerCalls += 1
        return texts.map((_, i) => [spanOf(i, i + 1, "email", 0.9)])
      },
    }

    try {
      const resolved = await resolveCollectPrivacy({
        enabled: true,
        filter: inner,
        cache: { enabled: true, path: realPath, handle: cacheHandle },
      })
      if (!resolved.enabled) throw new Error("expected privacy enabled")

      // When: two detects with overlapping input run back-to-back.
      const first = await resolved.filter.detect(["a", "b", "c"])
      const second = await resolved.filter.detect(["a", "b", "c"])

      // Then: outputs are byte-identical and inner was invoked exactly once.
      expect(first).toEqual(second)
      expect(first.map((spans) => spans.length)).toEqual([1, 1, 1])
      expect(innerCalls).toBe(1)
    } finally {
      await cacheHandle.close()
    }
  })
})
