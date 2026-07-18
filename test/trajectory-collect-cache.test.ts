import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

import { hashText, openPrivacyCache } from "../src/trajectory/privacy/cache"
import { cleanupSellerWorkspaces, createWorkspacePath, runCli } from "./trajectory-seller-fixtures"

// CLI subcommand tests for `trajectory collect cache stats|purge` (Todo 4 of
// the privacy-filter-cache plan). Both actions open the SQLite cache directly
// via `openPrivacyCache`. The tests cover:
//   - `cache --help` lists stats and purge, omits warm (dropped per Metis B1/B2)
//   - `stats` on empty cache returns well-formed JSON
//   - `stats` parses `--out` correctly
//   - `stats` on seeded cache reports entries > 0
//   - `purge` reports the pre-purge count and clears entries (verified via stats)
//   - `purge` on empty cache reports `{ purged: 0 }`
//   - adversarial (malformed_input): nonexistent --out exits non-zero with a clear message
//   - adversarial (log_based_success_claims): stats output is single-line parseable JSON

afterEach(cleanupSellerWorkspaces)

// `createWorkspacePath` returns a path under .tmp/trajectory-seller-XXX/workspace
// that does NOT exist on disk yet — callers are responsible for creating it.
const createCacheDir = (): string => {
  const workspace = createWorkspacePath()
  mkdirSync(workspace, { recursive: true })
  return workspace
}

const cacheFile = (dir: string): string => join(dir, "privacy-cache.db")

const seedCache = async (
  dir: string,
  entries: ReadonlyArray<{ text: string; configHash: string }>,
): Promise<void> => {
  const cache = await openPrivacyCache(cacheFile(dir))
  try {
    await cache.setMany(
      entries.map((entry) => ({
        textHash: hashText(entry.text),
        configHash: entry.configHash,
        spans: [{ start: 0, end: 1, category: "email", score: 0.9 }],
      })),
      entries[0]?.configHash ?? "config",
    )
  } finally {
    await cache.close()
  }
}

describe("trajectory collect cache --help", () => {
  test("lists stats and purge and omits warm (dropped per Metis B1/B2)", async () => {
    const result = await runCli(["trajectory", "collect", "cache", "--help"])
    expect(result.success).toBe(true)
    expect(result.stdout).toContain("stats")
    expect(result.stdout).toContain("purge")
    // warm was explicitly dropped from the plan; assert it is NOT advertised.
    expect(result.stdout).not.toMatch(/\bwarm\b/)
  })
})

describe("trajectory collect cache stats", () => {
  test("on empty cache returns well-formed JSON {entries:0, diskBytes:<number>}", async () => {
    const dir = createCacheDir()
    const result = await runCli(["trajectory", "collect", "cache", "stats", "--out", dir])
    expect(result.success).toBe(true)

    const parsed = JSON.parse(result.stdout) as { entries: number; diskBytes: number }
    expect(parsed.entries).toBe(0)
    expect(parsed.diskBytes).toBeGreaterThan(0)
  })

  test("on a seeded cache reports entries > 0", async () => {
    const dir = createCacheDir()
    await seedCache(dir, [
      { text: "seed-text-alpha", configHash: "config-A" },
      { text: "seed-text-bravo", configHash: "config-A" },
    ])

    const result = await runCli(["trajectory", "collect", "cache", "stats", "--out", dir])
    expect(result.success).toBe(true)

    const parsed = JSON.parse(result.stdout) as { entries: number; diskBytes: number }
    expect(parsed.entries).toBeGreaterThanOrEqual(2)
  })

  test("stats output is well-formed JSON with no extra log lines on stdout", async () => {
    // Adversarial class: log_based_success_claims.
    const dir = createCacheDir()
    const result = await runCli(["trajectory", "collect", "cache", "stats", "--out", dir])
    expect(result.success).toBe(true)

    const parsed = JSON.parse(result.stdout) as Record<string, unknown>
    expect(Object.keys(parsed).sort()).toEqual(["diskBytes", "entries"])
  })

  test("with --out pointing at a nonexistent directory exits non-zero with a clear message", async () => {
    // Adversarial class: malformed_input — pass a path whose parent does not
    // exist; the cache module refuses and the CLI surfaces a clear error.
    const parent = createCacheDir()
    const nonexistent = join(parent, "does-not-exist")
    const result = await runCli(["trajectory", "collect", "cache", "stats", "--out", nonexistent])
    expect(result.success).toBe(false)
    expect(result.stderr).toContain("privacy cache parent directory does not exist")
  })
})

describe("trajectory collect cache purge", () => {
  test("clears entries and reports the pre-purge count", async () => {
    const dir = createCacheDir()
    await seedCache(dir, [
      { text: "purge-seed-1", configHash: "config-X" },
      { text: "purge-seed-2", configHash: "config-X" },
    ])

    const purgeResult = await runCli(["trajectory", "collect", "cache", "purge", "--out", dir])
    expect(purgeResult.success).toBe(true)
    const purged = JSON.parse(purgeResult.stdout) as { purged: number }
    expect(purged.purged).toBeGreaterThanOrEqual(2)

    // Then: a follow-up stats call confirms the cache is empty.
    const statsResult = await runCli(["trajectory", "collect", "cache", "stats", "--out", dir])
    expect(statsResult.success).toBe(true)
    const stats = JSON.parse(statsResult.stdout) as { entries: number; diskBytes: number }
    expect(stats.entries).toBe(0)
  })

  test("on an empty cache reports { purged: 0 }", async () => {
    const dir = createCacheDir()
    const result = await runCli(["trajectory", "collect", "cache", "purge", "--out", dir])
    expect(result.success).toBe(true)
    const parsed = JSON.parse(result.stdout) as { purged: number }
    expect(parsed.purged).toBe(0)
  })

  test("purge output is well-formed JSON with no extra log lines on stdout", async () => {
    // Adversarial class: log_based_success_claims.
    const dir = createCacheDir()
    const result = await runCli(["trajectory", "collect", "cache", "purge", "--out", dir])
    expect(result.success).toBe(true)

    const parsed = JSON.parse(result.stdout) as Record<string, unknown>
    expect(Object.keys(parsed)).toEqual(["purged"])
  })
})
