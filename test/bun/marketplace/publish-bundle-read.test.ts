import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { encodeDatasetManifest } from "../../../src/marketplace/archive-contract"
import {
  PublishBundleError,
  readPublishBundle,
} from "../../../src/marketplace/publish-bundle"
import { writeDatasetZip } from "../../../src/marketplace/stored-zip"

const roots: string[] = []

const archiveForRuntime = (runtime: string): Buffer => {
  const trace = Buffer.from(JSON.stringify({
    runtime,
    status: "collected",
    formatVersion: 2,
    eventCount: 1,
    events: [{
      kind: "message",
      name: "assistant",
      timestamp: "2026-09-01T00:00:00.000Z",
      sourceEventId: "usage-0",
      payload: {
        usage: {
          model: "claude-fable-5",
          inputTokens: 1,
          outputTokens: 1,
        },
      },
    }],
  }), "utf8")
  const label = `s-${"0".repeat(64)}`
  const path = `traces/${label}.atf.json`
  const manifest = encodeDatasetManifest({
    artifacts: [{
      byteCount: trace.length,
      label,
      path,
      sha256: createHash("sha256").update(trace).digest("hex"),
    }],
    formatVersion: 1,
  })
  return writeDatasetZip([
    { data: manifest, name: "dataset-manifest.json" },
    { data: trace, name: path },
  ])
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe("publish bundle stable reads", () => {
  test("derives the candidate digest from the exact returned archive", () => {
    // Given: an unchanged canonical bundle on disk.
    const root = mkdtempSync(join(tmpdir(), "trajectory-publish-stable-read-"))
    roots.push(root)
    const path = join(root, "candidate.zip")
    writeFileSync(path, archiveForRuntime("codex"))

    // When: the descriptor-pinned reader admits it.
    const bundle = readPublishBundle(path)

    // Then: the candidate identity binds to the exact retained bytes.
    expect(String(bundle.candidate.archiveSha256)).toBe(
      createHash("sha256").update(bundle.archive).digest("hex"),
    )
  })

  test("rejects a same-size rewrite after the initial descriptor stat", () => {
    // Given: two independently valid equal-size bundles and a deterministic post-stat rewrite seam.
    const root = mkdtempSync(join(tmpdir(), "trajectory-publish-rewrite-"))
    roots.push(root)
    const path = join(root, "candidate.zip")
    const before = archiveForRuntime("codex")
    const after = archiveForRuntime("agent")
    expect(after.length).toBe(before.length)
    writeFileSync(path, before)
    let hookCalls = 0
    // When: the path is rewritten in place after the open descriptor is first inspected.
    const read = (): void => {
      readPublishBundle(path, {
        afterInitialStat() {
          hookCalls += 1
          writeFileSync(path, after)
        },
      })
    }

    // Then: the version drift is rejected without timing races or polling.
    expect(read).toThrow(PublishBundleError)
    expect(hookCalls).toBe(1)
  })
})
