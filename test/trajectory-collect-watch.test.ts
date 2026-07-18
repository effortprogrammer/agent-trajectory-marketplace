import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  collectServiceLabel,
  collectServicePaths,
  renderCollectWatchPlist,
} from "../src/trajectory/collect-service"
import {
  collectWatchSessionFileName,
  collectWatchStateFileName,
  resolveCollectWatchRuntimes,
  runCollectSweep,
} from "../src/trajectory/collect-watch"
import type { PrivacyCache, PrivacyCacheEntry } from "../src/trajectory/privacy/cache"
import {
  type PrivacyFilter,
  PrivacyFilterUnavailableError,
  type PrivacySpan,
} from "../src/trajectory/privacy/contract"
import { noopPrivacyFilter, testPrivacyOptions } from "./privacy-fixtures"
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
  test("encodes session IDs before using them as export filenames", () => {
    const encoded = collectWatchSessionFileName("../../outside/session")
    expect(encoded).toBe("..%2F..%2Foutside%2Fsession")
    expect(encoded).not.toContain("/")
  })

  test("exports new sessions once and skips them until they change", async () => {
    const { sourceDir, sessionPath, outDir } = writeWatchFixture()

    const first = await runCollectSweep(sweepConfig({ sourceDir, outDir }), testPrivacyOptions)
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

    const second = await runCollectSweep(sweepConfig({ sourceDir, outDir }), testPrivacyOptions)
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
    const third = await runCollectSweep(sweepConfig({ sourceDir, outDir }), testPrivacyOptions)
    expect(third).toMatchObject({ exported: 1, unchanged: 0 })
    const regrown = parseJson(readFileSync(exportPath, "utf8")) as {
      events: readonly { detail: string }[]
    }
    expect(JSON.stringify(regrown.events)).toContain("First prompt grew longer")
  })

  test("waits for live sessions to settle before converting them", async () => {
    const { sourceDir, sessionPath, outDir } = writeWatchFixture()
    const freshTime = new Date()
    utimesSync(sessionPath, freshTime, freshTime)

    const summary = await runCollectSweep(
      { ...sweepConfig({ sourceDir, outDir }), settleSeconds: 3_600 },
      testPrivacyOptions,
    )
    expect(summary).toMatchObject({ exported: 0, pendingSettle: 1 })
    expect(existsSync(join(outDir, "claude-code", `${sessionId}.atf.json`))).toBe(false)
  })

  test("records conversion failures without retrying unchanged sessions and survives missing sources", async () => {
    const { sourceDir, outDir } = writeWatchFixture()
    const brokenPath = join(sourceDir, "-tmp-project", "broken-session.jsonl")
    writeFileSync(brokenPath, "torn{\n", "utf8")
    utimesSync(
      brokenPath,
      new Date("2026-07-07T00:00:00.000Z"),
      new Date("2026-07-07T00:00:00.000Z"),
    )

    const first = await runCollectSweep(sweepConfig({ sourceDir, outDir }), testPrivacyOptions)
    expect(first).toMatchObject({ exported: 1, failed: 1 })
    expect(first.failedSessions[0]).toMatchObject({
      sessionId: "broken-session",
      errorCode: "invalid_session",
    })

    const second = await runCollectSweep(sweepConfig({ sourceDir, outDir }), testPrivacyOptions)
    expect(second).toMatchObject({ exported: 0, failed: 0, unchanged: 2 })

    const missing = await runCollectSweep(
      { ...sweepConfig({ sourceDir: join(sourceDir, "does-not-exist"), outDir }) },
      testPrivacyOptions,
    )
    expect(missing.missingSources).toEqual(["claude-code"])
  })

  test("re-exports unchanged sessions when the privacy config changes", async () => {
    const { sourceDir, outDir } = writeWatchFixture()

    const first = await runCollectSweep(sweepConfig({ sourceDir, outDir }), testPrivacyOptions)
    expect(first).toMatchObject({ exported: 1 })

    // Same session bytes, different threshold → stale entry → re-export.
    const second = await runCollectSweep(sweepConfig({ sourceDir, outDir }), {
      ...testPrivacyOptions,
      threshold: 0.9,
    })
    expect(second).toMatchObject({ exported: 1, unchanged: 0 })

    const third = await runCollectSweep(sweepConfig({ sourceDir, outDir }), {
      ...testPrivacyOptions,
      threshold: 0.9,
    })
    expect(third).toMatchObject({ exported: 0, unchanged: 1 })
  })

  test("retries sessions when the privacy filter is unavailable instead of skipping them", async () => {
    const { sourceDir, outDir } = writeWatchFixture()
    const unavailable = {
      filter: {
        detect: () => Promise.reject(new PrivacyFilterUnavailableError("model missing")),
      },
    }

    const first = await runCollectSweep(sweepConfig({ sourceDir, outDir }), unavailable)
    expect(first).toMatchObject({ exported: 0, failed: 1 })
    expect(first.failedSessions[0]).toMatchObject({ errorCode: "privacy_filter_unavailable" })
    // Fail-closed: nothing was written.
    expect(existsSync(join(outDir, "claude-code", `${sessionId}.atf.json`))).toBe(false)

    // The session was not recorded as processed, so a healthy filter picks it
    // up on the next sweep without the session changing.
    const second = await runCollectSweep(sweepConfig({ sourceDir, outDir }), {
      filter: noopPrivacyFilter,
    })
    expect(second).toMatchObject({ exported: 1 })
  })

  test("a disabled-filter sweep does not clobber stamped exports", async () => {
    const { sourceDir, outDir } = writeWatchFixture()

    const first = await runCollectSweep(sweepConfig({ sourceDir, outDir }), testPrivacyOptions)
    expect(first).toMatchObject({ exported: 1 })
    const exportPath = first.exportedSessions[0]?.exportPath
    if (exportPath === undefined) {
      throw new Error("missing export path")
    }
    const stamped = readFileSync(exportPath, "utf8")

    // Debug sweep with the filter off: the unchanged session is skipped, not
    // re-exported unfiltered over the stamped file.
    const second = await runCollectSweep(sweepConfig({ sourceDir, outDir }), {
      enabled: false,
    })
    expect(second).toMatchObject({ exported: 0, unchanged: 1 })
    expect(readFileSync(exportPath, "utf8")).toBe(stamped)
  })

  test("stops the sweep at the first privacy-filter outage instead of failing every session", async () => {
    const { sourceDir, outDir } = writeWatchFixture()
    // A second settled session in the same source dir.
    const otherId = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff"
    const otherPath = join(sourceDir, "-tmp-project", `${otherId}.jsonl`)
    writeFileSync(otherPath, `${transcriptLines("Second prompt").join("\n")}\n`, "utf8")
    utimesSync(
      otherPath,
      new Date("2026-07-07T00:00:00.000Z"),
      new Date("2026-07-07T00:00:00.000Z"),
    )

    const summary = await runCollectSweep(sweepConfig({ sourceDir, outDir }), {
      filter: {
        detect: () => Promise.reject(new PrivacyFilterUnavailableError("model missing")),
      },
    })
    // Exactly one failure is recorded, then the sweep stops early.
    expect(summary).toMatchObject({ exported: 0, failed: 1, privacyFilterUnavailable: true })

    // A healthy filter picks up both sessions on the next sweep.
    const recovered = await runCollectSweep(sweepConfig({ sourceDir, outDir }), {
      filter: noopPrivacyFilter,
    })
    expect(recovered).toMatchObject({ exported: 2 })
  })

  test("stamps exported traces with the privacy pass proof", async () => {
    const { sourceDir, outDir } = writeWatchFixture()
    const summary = await runCollectSweep(sweepConfig({ sourceDir, outDir }), testPrivacyOptions)
    const exportPath = summary.exportedSessions[0]?.exportPath
    if (exportPath === undefined) {
      throw new Error("missing export path")
    }
    const trace = parseJson(readFileSync(exportPath, "utf8")) as {
      privacy?: { modelId: string; schemaVersion: number }
    }
    expect(trace.privacy?.schemaVersion).toBe(1)
    expect(trace.privacy?.modelId).toBe("openai/privacy-filter")
  })

  test("resolves default runtimes and rejects unknown ones at startup", () => {
    expect(resolveCollectWatchRuntimes(undefined)).toEqual([
      "claude-code",
      "codex",
      "hermes",
      "openclaw",
      "opencode",
    ])
    expect(resolveCollectWatchRuntimes(["codex"])).toEqual(["codex"])
    expect(() => resolveCollectWatchRuntimes(["unknown-harness"])).toThrow("unknown_runtime")
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
      // Keep the CLI test model-free; the pass wiring is covered above.
      "--no-privacy-filter",
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
    // Privacy filter is on by default: no disable flag in the argv.
    expect(plist).not.toContain("--no-privacy-filter")
  })

  test("renders privacy overrides into the launch agent argv", () => {
    const paths = collectServicePaths("/Users/example")
    const plist = renderCollectWatchPlist({
      config: {
        outDir: ".tmp/collected",
        runtimes: ["claude-code"],
        intervalSeconds: 30,
        settleSeconds: 60,
        privacyFilter: false,
        privacyThreshold: 0.8,
      },
      executablePath: "/usr/local/bin/bun",
      entryScriptPath: "/repo/src/cli/index.ts",
      workingDirectory: "/repo",
      paths,
    })
    expect(plist).toContain("<string>--no-privacy-filter</string>")
    expect(plist).toContain("<string>--privacy-threshold</string>")
    expect(plist).toContain("<string>0.8</string>")
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

// =============================================================================
// TODO 3 (privacy-filter-cache): runCollectSweep cache lifecycle.
//
// Mock strategy: a MockPrivacyCache with a close-call counter is injected via
// CollectPrivacyOptions.cache.handle (test seam mirroring how `filter` is
// injectable). The sweep wraps its per-session loop in try/finally so the
// handle is released exactly once even when a session throws.
// =============================================================================

const spanOf = (
  start: number,
  end: number,
  category: PrivacySpan["category"],
  score = 0.95,
): PrivacySpan => ({ start, end, category, score })

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

describe("runCollectSweep — privacy cache lifecycle (TODO 3 acceptance 7)", () => {
  test("Oracle O2/Mid-operation interrupts: closes the cache exactly once per sweep on the happy path", async () => {
    // Given: a fixture session and a mock cache handle.
    const { sourceDir, outDir } = writeWatchFixture()
    const mock = createMockCache()

    // When: a sweep runs to completion with the cache enabled.
    const summary = await runCollectSweep(sweepConfig({ sourceDir, outDir }), {
      filter: noopPrivacyFilter,
      cache: {
        enabled: true,
        path: join(outDir, "privacy-cache.db"),
        handle: mock.cache,
      },
    })

    // Then: the sweep exported one session and closed the cache exactly once.
    expect(summary).toMatchObject({ exported: 1 })
    expect(mock.state.closeCalls).toBe(1)
  })

  test("Oracle O2/Mid-operation interrupts: closes the cache exactly once even when a session throws", async () => {
    // Given: a fixture session and an inner filter that throws
    // PrivacyFilterUnavailableError on every call. The sweep catches this,
    // marks the session failed, sets privacyFilterUnavailable, and breaks.
    const { sourceDir, outDir } = writeWatchFixture()
    const mock = createMockCache()
    const throwingFilter: PrivacyFilter = {
      detect: () => Promise.reject(new PrivacyFilterUnavailableError("engine down")),
    }

    // When: the sweep runs against the throwing filter.
    const summary = await runCollectSweep(sweepConfig({ sourceDir, outDir }), {
      filter: throwingFilter,
      cache: {
        enabled: true,
        path: join(outDir, "privacy-cache.db"),
        handle: mock.cache,
      },
    })

    // Then: the sweep recorded the failure AND the finally block closed the
    // cache exactly once (no handle leak despite the throw).
    expect(summary).toMatchObject({ exported: 0, failed: 1, privacyFilterUnavailable: true })
    expect(mock.state.closeCalls).toBe(1)
  })

  test("cache disabled flag → cache is never opened; close NOT called", async () => {
    // Given: a fixture session with cache.enabled = false. The mock handle is
    // passed but should not be touched.
    const { sourceDir, outDir } = writeWatchFixture()
    const mock = createMockCache()

    // When: the sweep runs with the cache flag off.
    const summary = await runCollectSweep(sweepConfig({ sourceDir, outDir }), {
      filter: noopPrivacyFilter,
      cache: { enabled: false, path: join(outDir, "privacy-cache.db"), handle: mock.cache },
    })

    // Then: the sweep exported normally but never touched the mock cache.
    expect(summary).toMatchObject({ exported: 1 })
    expect(mock.state.closeCalls).toBe(0)
    expect(mock.state.setManyCalls).toHaveLength(0)
  })

  test("cache options omitted entirely (existing test paths) → sweep behaves unchanged; no cache touched", async () => {
    // Given: a fixture session and the same privacy options existing tests pass
    // (no `cache` field at all).
    const { sourceDir, outDir } = writeWatchFixture()

    // When: the sweep runs without any cache options.
    const summary = await runCollectSweep(sweepConfig({ sourceDir, outDir }), testPrivacyOptions)

    // Then: the sweep still exports normally (existing behavior preserved).
    expect(summary).toMatchObject({ exported: 1, failed: 0 })
  })

  test("end-to-end (real on-disk cache): second sweep reuses entries — inner filter invoked 0 times on warm pass", async () => {
    // Given: a fixture session and a recording inner filter, with the cache
    // path enabled against a real on-disk SQLite file (no mock handle).
    const { sourceDir, outDir } = writeWatchFixture()
    const cachePath = join(outDir, "privacy-cache.db")
    let innerCalls = 0
    const inner: PrivacyFilter = {
      detect: async (texts) => {
        innerCalls += 1
        return texts.map(() => [spanOf(0, 1, "email", 0.9)])
      },
    }

    // When: two sweeps run back-to-back over the same fixture.
    const first = await runCollectSweep(sweepConfig({ sourceDir, outDir }), {
      filter: inner,
      cache: { enabled: true, path: cachePath },
    })
    const firstInnerCalls = innerCalls
    const second = await runCollectSweep(sweepConfig({ sourceDir, outDir }), {
      filter: inner,
      cache: { enabled: true, path: cachePath },
    })

    // Then: the first sweep exported and hit inner; the second sweep skipped
    // (unchanged), and the on-disk cache file exists.
    expect(first).toMatchObject({ exported: 1 })
    expect(second).toMatchObject({ exported: 0, unchanged: 1 })
    expect(firstInnerCalls).toBeGreaterThan(0)
    expect(existsSync(cachePath)).toBe(true)
  })
})
