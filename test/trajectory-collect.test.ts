import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { claudeCodeAdapter } from "../src/trajectory/adapters/claude-code"
import { harnessDetailMaxLength, redactHarnessDetail } from "../src/trajectory/adapters/contract"
import { getHarnessAdapter, listHarnessAdapters } from "../src/trajectory/adapters/registry"
import { exportCollectedSession } from "../src/trajectory/collect"
import { inspectTraceFile } from "../src/trajectory/evidence"
import {
  cleanupSellerWorkspaces,
  createWorkspacePath,
  packageArgs,
  parseJson,
  runCli,
} from "./trajectory-seller-fixtures"

const sessionId = "11111111-2222-3333-4444-555555555555"

const meta = {
  cwd: "/tmp/project",
  gitBranch: "main",
  sessionId,
  version: "2.1.198",
}

const longText = "The login fix works by re-validating the session cookie. ".repeat(10)

const fixtureTranscriptLines: readonly unknown[] = [
  { type: "mode", mode: "code", sessionId },
  {
    type: "user",
    isMeta: true,
    message: { role: "user", content: "<system-reminder>injected</system-reminder>" },
    ...meta,
  },
  { type: "user", message: { role: "user", content: "Fix the login bug please" }, ...meta },
  {
    type: "assistant",
    message: {
      id: "msg_1",
      model: "claude-opus-4-8",
      content: [{ type: "thinking", thinking: "private reasoning that must never be exported" }],
    },
    ...meta,
  },
  {
    type: "assistant",
    message: {
      id: "msg_1",
      model: "claude-opus-4-8",
      content: [{ type: "text", text: "I'll fix the login bug now" }],
    },
    ...meta,
  },
  {
    type: "assistant",
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
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool_1" }] },
    ...meta,
  },
  {
    type: "assistant",
    message: {
      id: "msg_2",
      model: "claude-opus-4-8",
      content: [{ type: "tool_use", id: "tool_2", name: "Bash", input: { command: "bun test" } }],
    },
    ...meta,
  },
  {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "tool_2", is_error: true }],
    },
    ...meta,
  },
  {
    type: "assistant",
    isSidechain: true,
    message: {
      id: "msg_side",
      model: "claude-opus-4-8",
      content: [{ type: "text", text: "sidechain output" }],
    },
    ...meta,
  },
  {
    type: "assistant",
    message: { id: "msg_synth", model: "<synthetic>", content: [{ type: "text", text: "error" }] },
    ...meta,
  },
  {
    type: "assistant",
    isApiErrorMessage: true,
    message: {
      id: "msg_err",
      model: "claude-opus-4-8",
      content: [{ type: "text", text: "api error" }],
    },
    ...meta,
  },
  { type: "user", message: { role: "user", content: "use api_key=sk-demo for the fix" }, ...meta },
  {
    type: "assistant",
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
  test("exposes the claude-code adapter and rejects unknown runtimes", () => {
    expect(listHarnessAdapters().map((adapter) => adapter.runtime)).toContain("claude-code")
    expect(getHarnessAdapter("claude-code").displayName).toBe("Claude Code")
    expect(() => getHarnessAdapter("codex-cli")).toThrow("unknown_runtime: codex-cli")
    expect(() => getHarnessAdapter("codex-cli")).toThrow("available: claude-code")
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
    const trace = claudeCodeAdapter.convertSession(sessionPath)

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
    expect(serialized).not.toContain("sk-demo")

    expect(trace.events[0]?.detail).toBe("claude-code 2.1.198 cwd=/tmp/project branch=main")
    expect(trace.events[1]?.detail).toBe("Fix the login bug please")
    expect(trace.events[2]?.detail).toBe("I'll fix the login bug now")
    expect(trace.events[3]?.detail).toBe("src/login.ts")
    expect(trace.events[4]?.detail).toBe("ok")
    expect(trace.events[5]?.detail).toBe("")
    expect(trace.events[6]?.detail).toBe("bun test")
    expect(trace.events[7]?.detail).toBe("error")
    expect(trace.events[9]?.detail).toBe("[redacted]")
    expect(trace.events[10]?.detail.endsWith("…")).toBe(true)
  })

  test("rejects missing and non-jsonl sessions", () => {
    const { sessionPath } = writeFixtureSession({ fileName: "session.txt" })
    expect(() => claudeCodeAdapter.convertSession(`${sessionPath}.missing`)).toThrow(
      "missing_session",
    )
    expect(() => claudeCodeAdapter.convertSession(sessionPath)).toThrow("invalid_session")
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
})

describe("collect export", () => {
  test("resolves a session id against the source dir and exports a marketplace-ready trace", () => {
    const { workspace, sourceDir } = writeFixtureSession()
    const exportPath = join(workspace, "artifacts", "collected.atf.json")

    const result = exportCollectedSession({
      runtime: "claude-code",
      session: sessionId,
      sourceDir,
      exportPath,
    })
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

  test("rejects unknown session ids and export paths outside the project", () => {
    const { sourceDir } = writeFixtureSession()
    expect(() =>
      exportCollectedSession({
        runtime: "claude-code",
        session: "does-not-exist",
        sourceDir,
        exportPath: join(createWorkspacePath(), "out.atf.json"),
      }),
    ).toThrow("missing_session")
    expect(() =>
      exportCollectedSession({
        runtime: "claude-code",
        session: sessionId,
        sourceDir,
        exportPath: "/tmp/outside-project.atf.json",
      }),
    ).toThrow("invalid_export_path")
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

    const exported = await runCli([
      "trajectory",
      "collect",
      "export",
      "claude-code",
      "--session",
      sessionId,
      "--source",
      sourceDir,
      "--export",
      exportPath,
    ])
    expect(exported.success).toBe(true)

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
