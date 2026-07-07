import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  collectServiceLabel,
  collectServicePaths,
  renderCollectWatchPlist,
} from "../src/trajectory/collect-service"
import {
  collectWatchStateFileName,
  resolveCollectWatchRuntimes,
  runCollectSweep,
} from "../src/trajectory/collect-watch"
import {
  cleanupSellerWorkspaces,
  createWorkspacePath,
  parseJson,
  runCli,
} from "./trajectory-seller-fixtures"

const sessionId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

const meta = {
  cwd: "/tmp/project",
  gitBranch: "main",
  sessionId,
  version: "2.1.198",
}

const transcriptLines = (promptText: string): readonly string[] =>
  [
    { type: "user", message: { role: "user", content: promptText }, ...meta },
    {
      type: "assistant",
      message: {
        id: "msg_1",
        model: "claude-opus-4-8",
        content: [{ type: "text", text: "working on it" }],
      },
      ...meta,
    },
    {
      type: "assistant",
      message: {
        id: "msg_1",
        model: "claude-opus-4-8",
        content: [{ type: "tool_use", id: "tool_1", name: "Bash", input: { command: "bun test" } }],
      },
      ...meta,
    },
  ].map((line) => JSON.stringify(line))

const writeWatchFixture = () => {
  const workspace = createWorkspacePath()
  const sourceDir = join(workspace, "source")
  const projectDir = join(sourceDir, "-tmp-project")
  mkdirSync(projectDir, { recursive: true })
  const sessionPath = join(projectDir, `${sessionId}.jsonl`)
  writeFileSync(sessionPath, `${transcriptLines("First prompt").join("\n")}\n`, "utf8")
  const settledAt = new Date("2026-07-07T00:00:00.000Z")
  utimesSync(sessionPath, settledAt, settledAt)
  const outDir = join(workspace, "collected")
  return { workspace, sourceDir, sessionPath, outDir }
}

const sweepConfig = (input: { readonly sourceDir: string; readonly outDir: string }) => ({
  outDir: input.outDir,
  runtimes: ["claude-code"],
  sourceDir: input.sourceDir,
  settleSeconds: 0,
})

afterEach(cleanupSellerWorkspaces)

describe("collect watch sweep", () => {
  test("exports new sessions once and skips them until they change", () => {
    const { sourceDir, sessionPath, outDir } = writeWatchFixture()

    const first = runCollectSweep(sweepConfig({ sourceDir, outDir }))
    expect(first).toMatchObject({ exported: 1, failed: 0, unchanged: 0, pendingSettle: 0 })
    const exportPath = first.exportedSessions[0]?.exportPath
    expect(exportPath).toBeDefined()
    if (exportPath === undefined) {
      throw new Error("missing export path")
    }
    const trace = parseJson(readFileSync(exportPath, "utf8")) as {
      status: string
      eventCount: number
    }
    expect(trace.status).toBe("collected")
    expect(trace.eventCount).toBe(5)
    expect(existsSync(join(outDir, collectWatchStateFileName))).toBe(true)

    const second = runCollectSweep(sweepConfig({ sourceDir, outDir }))
    expect(second).toMatchObject({ exported: 0, unchanged: 1 })

    // A grown session (live session that kept going) is converted again.
    writeFileSync(
      sessionPath,
      `${transcriptLines("First prompt grew longer").join("\n")}\n`,
      "utf8",
    )
    utimesSync(
      sessionPath,
      new Date("2026-07-07T01:00:00.000Z"),
      new Date("2026-07-07T01:00:00.000Z"),
    )
    const third = runCollectSweep(sweepConfig({ sourceDir, outDir }))
    expect(third).toMatchObject({ exported: 1, unchanged: 0 })
    const regrown = parseJson(readFileSync(exportPath, "utf8")) as {
      events: readonly { detail: string }[]
    }
    expect(JSON.stringify(regrown.events)).toContain("First prompt grew longer")
  })

  test("waits for live sessions to settle before converting them", () => {
    const { sourceDir, sessionPath, outDir } = writeWatchFixture()
    const freshTime = new Date()
    utimesSync(sessionPath, freshTime, freshTime)

    const summary = runCollectSweep({
      ...sweepConfig({ sourceDir, outDir }),
      settleSeconds: 3_600,
    })
    expect(summary).toMatchObject({ exported: 0, pendingSettle: 1 })
    expect(existsSync(join(outDir, "claude-code", `${sessionId}.atf.json`))).toBe(false)
  })

  test("records conversion failures without retrying unchanged sessions and survives missing sources", () => {
    const { sourceDir, outDir } = writeWatchFixture()
    const brokenPath = join(sourceDir, "-tmp-project", "broken-session.jsonl")
    writeFileSync(brokenPath, "torn{\n", "utf8")
    utimesSync(
      brokenPath,
      new Date("2026-07-07T00:00:00.000Z"),
      new Date("2026-07-07T00:00:00.000Z"),
    )

    const first = runCollectSweep(sweepConfig({ sourceDir, outDir }))
    expect(first).toMatchObject({ exported: 1, failed: 1 })
    expect(first.failedSessions[0]).toMatchObject({
      sessionId: "broken-session",
      errorCode: "invalid_session",
    })

    const second = runCollectSweep(sweepConfig({ sourceDir, outDir }))
    expect(second).toMatchObject({ exported: 0, failed: 0, unchanged: 2 })

    const missing = runCollectSweep({
      ...sweepConfig({ sourceDir: join(sourceDir, "does-not-exist"), outDir }),
    })
    expect(missing.missingSources).toEqual(["claude-code"])
  })

  test("resolves default runtimes and rejects unknown ones at startup", () => {
    expect(resolveCollectWatchRuntimes(undefined)).toEqual(["claude-code", "codex"])
    expect(resolveCollectWatchRuntimes(["codex"])).toEqual(["codex"])
    expect(() => resolveCollectWatchRuntimes(["opencode"])).toThrow("unknown_runtime")
  })
})

describe("collect watch CLI", () => {
  test("runs a single sweep with --once and reports the summary", async () => {
    const { sourceDir, outDir } = writeWatchFixture()
    const result = await runCli([
      "trajectory",
      "collect",
      "watch",
      "--once",
      "--out",
      outDir,
      "--runtime",
      "claude-code",
      "--source",
      sourceDir,
      "--settle-seconds",
      "0",
    ])
    expect(result.success).toBe(true)
    const summary = parseJson(result.stdout) as { exported: number }
    expect(summary.exported).toBe(1)
    expect(existsSync(join(outDir, "claude-code", `${sessionId}.atf.json`))).toBe(true)
  })

  test("rejects --source with multiple runtimes", async () => {
    const { sourceDir, outDir } = writeWatchFixture()
    const result = await runCli([
      "trajectory",
      "collect",
      "watch",
      "--once",
      "--out",
      outDir,
      "--source",
      sourceDir,
    ])
    expect(result.success).toBe(false)
    expect(result.stderr).toContain("--source requires exactly one --runtime")
  })
})

describe("collect launchd service", () => {
  test("renders a KeepAlive launch agent plist around the collect watch command", () => {
    const paths = collectServicePaths("/Users/example")
    expect(paths.plistPath).toBe(`/Users/example/Library/LaunchAgents/${collectServiceLabel}.plist`)

    const plist = renderCollectWatchPlist({
      config: {
        outDir: ".tmp/collected",
        runtimes: ["claude-code", "codex"],
        intervalSeconds: 30,
        settleSeconds: 60,
      },
      executablePath: "/usr/local/bin/bun",
      entryScriptPath: "/repo/src/cli/index.ts",
      workingDirectory: "/repo",
      paths,
    })

    expect(plist).toContain(`<string>${collectServiceLabel}</string>`)
    expect(plist).toContain("<key>RunAtLoad</key>")
    expect(plist).toContain("<key>KeepAlive</key>")
    expect(plist).toContain("<string>/usr/local/bin/bun</string>")
    expect(plist).toContain("<string>/repo/src/cli/index.ts</string>")
    expect(plist).toContain("<string>/repo/.tmp/collected</string>")
    expect(plist).toContain("<string>claude-code</string>")
    expect(plist).toContain("<string>codex</string>")
    expect(plist).toContain("<key>WorkingDirectory</key>")
    expect(plist).toContain("<string>/repo</string>")
    expect(plist).toContain(paths.stdoutLogPath)
  })

  test("service install --dry-run renders the plist without touching launchd", async () => {
    const { outDir } = writeWatchFixture()
    const result = await runCli([
      "trajectory",
      "collect",
      "service",
      "install",
      "--dry-run",
      "--out",
      outDir,
    ])
    expect(result.success).toBe(true)
    const summary = parseJson(result.stdout) as {
      bootstrapped: boolean
      detail: string
      plist: string
    }
    expect(summary.bootstrapped).toBe(false)
    expect(summary.detail).toContain("dry_run")
    expect(summary.plist).toContain("<key>KeepAlive</key>")
    expect(summary.plist).toContain("collect")
  })
})
