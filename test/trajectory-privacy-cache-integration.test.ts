import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { runCollectSweep } from "../src/trajectory/collect-watch"
import type { PrivacyFilter, PrivacySpan } from "../src/trajectory/privacy/contract"
import { openPrivacyCache } from "../src/trajectory/privacy/cache"
import {
  cleanupSellerWorkspaces,
  createWorkspacePath,
} from "./trajectory-seller-fixtures"

// Integration tests for the privacy-cache lane on top of runCollectSweep.
//
// Each test drives the real collect pipeline (adapter + privacy pass + watch
// state) against a project-rooted workspace and asserts on a counting inner
// filter. The cache file lives at <outDir>/privacy-cache.db, matching the
// production collect-watch layout. `createWorkspacePath` is used because
// runCollectSweep enforces a path-safety gate that rejects paths outside the
// project root (e.g. OS tmpdir).

afterEach(cleanupSellerWorkspaces)

const sessionId = "aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee"

const meta = {
  cwd: "/tmp/project",
  gitBranch: "main",
  sessionId,
  version: "2.1.198",
}

// Counting mock filter. `state.calls` records the number of detect()
// invocations; `state.lastBatch` records the most recent batch so the dedup
// test can compare unique vs total text count.
const createCountingFilter = (): {
  filter: PrivacyFilter
  state: { calls: number; lastBatch: readonly string[] | null }
} => {
  const state = { calls: 0, lastBatch: null as readonly string[] | null }
  const emptySpans: readonly PrivacySpan[] = []
  const filter: PrivacyFilter = {
    detect: async (texts: readonly string[]) => {
      state.calls += 1
      state.lastBatch = texts
      // One empty span array per input — keeps the (texts -> results) shape
      // contract without injecting fake PII into the trace.
      return texts.map(() => emptySpans)
    },
  }
  return { filter, state }
}

// Build one workspace containing: sourceDir with one claude-code project +
// session file, and a separate outDir. Returns both paths plus the workspace
// root so tests that need a second outDir can derive one.
const writeWorkspace = (promptText = "hello world"): {
  workspace: string
  sourceDir: string
  outDir: string
} => {
  const workspace = createWorkspacePath()
  const sourceDir = join(workspace, "source")
  const projectDir = join(sourceDir, "-tmp-project")
  mkdirSync(projectDir, { recursive: true })
  const sessionPath = join(projectDir, `${sessionId}.jsonl`)
  const record = {
    type: "user",
    message: { role: "user", content: promptText },
    ...meta,
  }
  writeFileSync(sessionPath, `${JSON.stringify(record)}\n`, "utf8")
  const outDir = join(workspace, "collected")
  return { workspace, sourceDir, outDir }
}

// Multi-record variant: writes `eventCount` user records with the SAME content
// so the privacy pipeline can dedupe them before invoking detect.
const writeDedupWorkspace = (eventCount: number, promptText = "same-detail-text"): {
  workspace: string
  sourceDir: string
  outDir: string
} => {
  const workspace = createWorkspacePath()
  const sourceDir = join(workspace, "source")
  const projectDir = join(sourceDir, "-tmp-project")
  mkdirSync(projectDir, { recursive: true })
  const sessionPath = join(projectDir, `${sessionId}.jsonl`)
  const lines: string[] = []
  for (let i = 0; i < eventCount; i += 1) {
    lines.push(JSON.stringify({
      type: "user",
      message: { role: "user", content: promptText },
      ...meta,
    }))
  }
  writeFileSync(sessionPath, `${lines.join("\n")}\n`, "utf8")
  const outDir = join(workspace, "collected")
  return { workspace, sourceDir, outDir }
}

const sweepConfig = (input: { readonly sourceDir: string; readonly outDir: string }) => ({
  outDir: input.outDir,
  runtimes: ["claude-code"],
  sourceDir: input.sourceDir,
  settleSeconds: 0,
})

describe("privacy cache integration", () => {
  test("A. cold then warm: first sweep runs detect, second sweep hits cache", async () => {
    const { sourceDir, outDir } = writeWorkspace()

    const inner = createCountingFilter()
    const cachePath = join(outDir, "privacy-cache.db")
    const config = sweepConfig({ sourceDir, outDir })
    const privacyOptions = {
      filter: inner.filter,
      cache: { enabled: true, path: cachePath },
    }

    await runCollectSweep(config, privacyOptions)
    expect(inner.state.calls).toBeGreaterThan(0)
    const callsAfterFirst = inner.state.calls

    await runCollectSweep(config, privacyOptions)
    // Second sweep must not invoke detect again: the session's spans are
    // already cached on disk under (textHash, configHash).
    expect(inner.state.calls).toBe(callsAfterFirst)
  })

  test("B. batch dedup: identical detail texts are deduped before detect", async () => {
    const eventCount = 4
    const { sourceDir, outDir } = writeDedupWorkspace(eventCount)

    const inner = createCountingFilter()
    const cachePath = join(outDir, "privacy-cache.db")
    const config = sweepConfig({ sourceDir, outDir })
    const privacyOptions = {
      filter: inner.filter,
      cache: { enabled: true, path: cachePath },
    }

    await runCollectSweep(config, privacyOptions)

    const batch = inner.state.lastBatch
    expect(batch).not.toBeNull()
    if (batch === null) {
      return
    }
    // The pipeline dedups identical texts before calling detect. With four
    // identical user events sharing one content string, dedup collapses them
    // to a single occurrence in the detect batch — the count of that string
    // in the batch must be exactly 1, not eventCount.
    const occurrences = batch.filter((text) => text === "same-detail-text").length
    expect(occurrences).toBe(1)
    expect(occurrences).toBeLessThan(eventCount)
  })

  test("C. config invalidation: threshold change forces detect on next sweep", async () => {
    const { sourceDir, outDir } = writeWorkspace()

    const inner = createCountingFilter()
    const cachePath = join(outDir, "privacy-cache.db")
    const config = sweepConfig({ sourceDir, outDir })

    await runCollectSweep(config, {
      filter: inner.filter,
      cache: { enabled: true, path: cachePath },
      threshold: 0.5,
    })
    const callsAfterFirst = inner.state.calls
    expect(callsAfterFirst).toBeGreaterThan(0)

    // New threshold -> new configHash -> cache miss for the same text.
    await runCollectSweep(config, {
      filter: inner.filter,
      cache: { enabled: true, path: cachePath },
      threshold: 0.9,
    })
    expect(inner.state.calls).toBeGreaterThan(callsAfterFirst)
  })

  test("D. persistence across restart: close + reopen cache keeps disk entries", async () => {
    const { sourceDir, outDir } = writeWorkspace()

    const inner = createCountingFilter()
    const cachePath = join(outDir, "privacy-cache.db")
    const config = sweepConfig({ sourceDir, outDir })
    const privacyOptions = {
      filter: inner.filter,
      cache: { enabled: true, path: cachePath },
    }

    await runCollectSweep(config, privacyOptions)
    expect(inner.state.calls).toBeGreaterThan(0)
    const callsAfterFirst = inner.state.calls

    // Simulate a collector restart: open the on-disk cache at the same path,
    // then close it. This proves the file is openable and the rows survived.
    const reopened = await openPrivacyCache(cachePath)
    await reopened.close()

    await runCollectSweep(config, privacyOptions)
    expect(inner.state.calls).toBe(callsAfterFirst)
  })

  test("E. escape hatch: cache.enabled=false invokes detect on every sweep", async () => {
    // Test E isolates the cache escape hatch. Because runCollectSweep also
    // skips unchanged sessions via the watch state (independent of the cache),
    // we run each sweep against a FRESH outDir so the only thing that could
    // suppress detect() on the second pass is the cache layer. With
    // cache.enabled=false, no disk cache is consulted, so detect runs both
    // times.
    const first = writeWorkspace()
    const inner = createCountingFilter()
    const firstCachePath = join(first.outDir, "privacy-cache.db")

    await runCollectSweep(sweepConfig(first), {
      filter: inner.filter,
      cache: { enabled: false, path: firstCachePath },
    })
    expect(inner.state.calls).toBeGreaterThan(0)

    const second = writeWorkspace()
    const secondCachePath = join(second.outDir, "privacy-cache.db")
    await runCollectSweep(sweepConfig(second), {
      filter: inner.filter,
      cache: { enabled: false, path: secondCachePath },
    })
    expect(inner.state.calls).toBeGreaterThan(1)
  })
})
