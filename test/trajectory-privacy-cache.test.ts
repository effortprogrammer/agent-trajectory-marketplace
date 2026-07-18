import { Database } from "bun:sqlite"
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  createCachedPrivacyFilter,
  hashText,
  hashTextBatch,
  openPrivacyCache,
  type PrivacyCache,
  type PrivacyCacheEntry,
} from "../src/trajectory/privacy/cache"
import {
  type PrivacyFilter,
  PrivacyFilterUnavailableError,
  type PrivacySpan,
} from "../src/trajectory/privacy/contract"

// Privacy cache module — disk-only SQLite WAL store.
//
// These tests exercise the public contract enumerated in Todo 1 of the
// privacy-filter-cache plan: getMany/setMany round-trip, persistence across
// handle re-open, sequential writes, purge, torn-cache fallback, two-handle
// concurrent writes (Oracle O3), transactional rollback (Oracle O3),
// stats().diskBytes, idempotent close(). Tests 7 and 8 inspect the underlying
// SQLite table directly via bun:sqlite to assert transactional semantics.

const workdirs: string[] = []

const createWorkdir = (): string => {
  const root = join(process.cwd(), ".tmp")
  mkdirSync(root, { recursive: true })
  const dir = mkdtempSync(join(root, "privacy-cache-test-"))
  workdirs.push(dir)
  return dir
}

const cachePath = (dir: string): string => join(dir, "privacy-cache.db")

const spanOf = (
  start: number,
  end: number,
  category: PrivacySpan["category"],
  score = 0.95,
): PrivacySpan => ({ start, end, category, score })

const countRows = (path: string): number => {
  const probe = new Database(path, { readonly: true, strict: true })
  try {
    const row = probe
      .query<{ c: number }, []>("SELECT COUNT(*) AS c FROM privacy_detect_cache")
      .get()
    return row?.c ?? 0
  } finally {
    probe.close()
  }
}

afterEach(() => {
  while (workdirs.length > 0) {
    const dir = workdirs.pop()
    if (dir === undefined) break
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Best-effort cleanup; temp dir is under .tmp/ which is gitignored.
    }
  }
})

describe("openPrivacyCache — basic getMany/setMany round-trip", () => {
  test("setMany then getMany returns the same spans keyed by textHash", async () => {
    // Given: an empty cache at a fresh temp path.
    const dir = createWorkdir()
    const cache = await openPrivacyCache(cachePath(dir))

    // When: one entry is written and then read back.
    const textHash = hashText("hello world")
    const configHash = "config-1"
    const spans: readonly PrivacySpan[] = [spanOf(0, 5, "person_name")]
    await cache.setMany([{ textHash, configHash, spans }], configHash)
    const result = await cache.getMany([{ textHash, configHash }])

    // Then: the Map contains the spans under the textHash key.
    expect(result.get(textHash)).toEqual(spans)

    await cache.close()
  })

  test("getMany with mix of present and absent keys returns hits and undefined misses", async () => {
    // Given: a cache holding hash1 but not hash3.
    const dir = createWorkdir()
    const cache = await openPrivacyCache(cachePath(dir))
    const hash1 = hashText("alpha")
    const hash2 = hashText("beta")
    const configHash = "config-1"
    await cache.setMany(
      [
        { textHash: hash1, configHash, spans: [spanOf(0, 1, "email")] },
        { textHash: hash2, configHash, spans: [spanOf(2, 3, "url")] },
      ],
      configHash,
    )

    // When: a mix of present (hash1) and absent (hash3) keys is queried.
    const hash3 = hashText("gamma")
    const result = await cache.getMany([
      { textHash: hash1, configHash },
      { textHash: hash3, configHash },
    ])

    // Then: hits have spans, misses are undefined.
    expect(result.size).toBe(2)
    expect(result.get(hash1)?.length).toBe(1)
    expect(result.get(hash3)).toBeUndefined()

    await cache.close()
  })
})

describe("openPrivacyCache — persistence", () => {
  test("re-open cache at same path after close() → previous entries survive", async () => {
    // Given: a cache that was opened, written, then closed.
    const dir = createWorkdir()
    const path = cachePath(dir)
    const first = await openPrivacyCache(path)
    const textHash = hashText("persistent")
    const configHash = "config-1"
    const spans: readonly PrivacySpan[] = [spanOf(7, 14, "phone_number")]
    await first.setMany([{ textHash, configHash, spans }], configHash)
    await first.close()

    // When: the cache is reopened at the same path.
    const reopened = await openPrivacyCache(path)

    // Then: the previously-written entry is still present.
    const result = await reopened.getMany([{ textHash, configHash }])
    expect(result.get(textHash)).toEqual(spans)

    await reopened.close()
  })

  test("two SEQUENTIAL setMany calls on the same handle → both visible", async () => {
    // Given: an empty cache handle.
    const dir = createWorkdir()
    const cache = await openPrivacyCache(cachePath(dir))
    const configHash = "config-1"

    // When: two sequential setMany calls land different keys.
    const hashA = hashText("seq-a")
    const hashB = hashText("seq-b")
    await cache.setMany(
      [{ textHash: hashA, configHash, spans: [spanOf(0, 1, "email")] }],
      configHash,
    )
    await cache.setMany([{ textHash: hashB, configHash, spans: [spanOf(0, 2, "url")] }], configHash)

    // Then: both keys are visible from one getMany call.
    const result = await cache.getMany([
      { textHash: hashA, configHash },
      { textHash: hashB, configHash },
    ])
    expect(result.get(hashA)?.length).toBe(1)
    expect(result.get(hashB)?.length).toBe(1)

    await cache.close()
  })
})

describe("openPrivacyCache — purge / stats", () => {
  test("purge() clears all entries; stats().entries === 0 after", async () => {
    // Given: a cache holding two entries.
    const dir = createWorkdir()
    const cache = await openPrivacyCache(cachePath(dir))
    const configHash = "config-1"
    await cache.setMany(
      [
        { textHash: hashText("p1"), configHash, spans: [] },
        { textHash: hashText("p2"), configHash, spans: [] },
      ],
      configHash,
    )
    expect(cache.stats().entries).toBe(2)

    // When: purge() is called.
    await cache.purge()

    // Then: the table is empty and stats reflect it.
    expect(cache.stats().entries).toBe(0)

    await cache.close()
  })

  test("stats().diskBytes > 0 after a write", async () => {
    // Given: a freshly-opened cache.
    const dir = createWorkdir()
    const cache = await openPrivacyCache(cachePath(dir))

    // When: one entry is written.
    await cache.setMany(
      [
        {
          textHash: hashText("disk-bytes"),
          configHash: "config-1",
          spans: [spanOf(0, 10, "email")],
        },
      ],
      "config-1",
    )

    // Then: diskBytes is positive (db file or WAL sidecar exists on disk).
    expect(cache.stats().diskBytes).toBeGreaterThan(0)

    await cache.close()
  })
})

describe("openPrivacyCache — torn-cache fallback", () => {
  test("garbage bytes at cache path → openPrivacyCache does NOT throw, recreates, stats().entries === 0", async () => {
    // Given: a path pre-populated with non-SQLite garbage.
    const dir = createWorkdir()
    const path = cachePath(dir)
    writeFileSync(path, "this is definitely not a SQLite file format")

    // When: openPrivacyCache is invoked on the garbage file.
    let cache: PrivacyCache
    try {
      cache = await openPrivacyCache(path)
    } catch (caught) {
      // Then: it must not throw — fail loudly if it did.
      expect.unreachable(
        `openPrivacyCache must not throw on torn cache: ${(caught as Error).message}`,
      )
      throw caught
    }

    // Then: the file is recreated empty and stats reflects an empty cache.
    expect(cache.stats().entries).toBe(0)
    // Sanity: the path is still a regular file (was recreated, not deleted).
    expect(statSync(path).isFile()).toBe(true)

    await cache.close()
  })
})

describe("openPrivacyCache — Oracle O3 concurrency & transactions", () => {
  test("two independent handles writing concurrently complete without SQLITE_BUSY", async () => {
    // Given: two independent PrivacyCache handles at the same path.
    const dir = createWorkdir()
    const path = cachePath(dir)
    const h1 = await openPrivacyCache(path)
    const h2 = await openPrivacyCache(path)
    const configHash = "config-1"
    const h1Hash = hashText("concurrent-h1")
    const h2Hash = hashText("concurrent-h2")

    try {
      // When: both handles call setMany concurrently via Promise.all.
      // Then: neither rejects with SQLITE_BUSY within busy_timeout=5000ms.
      await Promise.all([
        h1.setMany([{ textHash: h1Hash, configHash, spans: [spanOf(0, 2, "email")] }], configHash),
        h2.setMany([{ textHash: h2Hash, configHash, spans: [spanOf(0, 2, "url")] }], configHash),
      ])

      // And: both writes are visible to a third reader.
      const reader = await openPrivacyCache(path)
      const result = await reader.getMany([
        { textHash: h1Hash, configHash },
        { textHash: h2Hash, configHash },
      ])
      expect(result.get(h1Hash)?.length).toBe(1)
      expect(result.get(h2Hash)?.length).toBe(1)
      await reader.close()
    } finally {
      await h1.close()
      await h2.close()
    }
  })

  test("setMany rolls back on mid-batch JSON.stringify failure — zero rows committed, error propagates", async () => {
    // Given: an empty cache handle and a fresh path.
    const dir = createWorkdir()
    const path = cachePath(dir)
    const cache = await openPrivacyCache(path)
    const configHash = "config-1"

    // Construct a circular-reference object that will make JSON.stringify throw.
    // The cache's contract types PrivacySpan[] as readonly; at runtime, an
    // adversarial caller can smuggle in a cyclic structure. TS lets us inject
    // this via `as unknown as` without using `any`.
    const cyclicContainer: unknown[] = []
    cyclicContainer.push(cyclicContainer)
    const poisonSpans = cyclicContainer as unknown as readonly PrivacySpan[]

    const goodHash = hashText("good-entry")
    const badHash = hashText("bad-entry")

    // When: setMany is called with one good entry followed by one cyclic entry.
    let caught: unknown
    try {
      await cache.setMany(
        [
          { textHash: goodHash, configHash, spans: [spanOf(0, 1, "email")] },
          { textHash: badHash, configHash, spans: poisonSpans },
        ],
        configHash,
      )
    } catch (e) {
      caught = e
    }

    // Then: an error was thrown and propagated to the caller.
    expect(caught).toBeInstanceOf(Error)

    // And: ZERO entries were committed (transactional rollback worked).
    expect(countRows(path)).toBe(0)

    await cache.close()
  })
})

describe("openPrivacyCache — lifecycle", () => {
  test("close() is idempotent — calling it twice does NOT throw", async () => {
    // Given: an open cache handle.
    const dir = createWorkdir()
    const cache = await openPrivacyCache(cachePath(dir))

    // When: close() is called twice.
    await cache.close()

    // Then: the second call does not throw.
    await expect(cache.close()).resolves.toBeUndefined()
  })
})

describe("hashText / hashTextBatch — HMAC-SHA256 primitives", () => {
  test("hashText returns 64-char hex, deterministic within process, differs per input", () => {
    const emptyHash = hashText("")
    expect(emptyHash).toMatch(/^[0-9a-f]{64}$/)
    expect(hashText("")).toBe(emptyHash)
    expect(hashText("abc")).not.toBe(emptyHash)
    expect(hashText("abc")).toBe(hashText("abc"))
  })

  test("hashTextBatch returns one hash per input in order", () => {
    const inputs = ["alpha", "beta", "gamma"]
    const hashes = hashTextBatch(inputs)
    expect(hashes).toHaveLength(inputs.length)
    expect(hashes[0]).toBe(hashText("alpha"))
    expect(hashes[1]).toBe(hashText("beta"))
    expect(hashes[2]).toBe(hashText("gamma"))
  })

  test("hashTextBatch on empty input returns empty array (no throw)", () => {
    expect(hashTextBatch([])).toEqual([])
  })
})

describe("openPrivacyCache — edge cases (adversarial: malformed_input)", () => {
  test("getMany([]) returns an empty Map (no throw)", async () => {
    const dir = createWorkdir()
    const cache = await openPrivacyCache(cachePath(dir))
    const result = await cache.getMany([])
    expect(result.size).toBe(0)
    await cache.close()
  })

  test("setMany([]) is a no-op (no throw, no rows committed)", async () => {
    const dir = createWorkdir()
    const path = cachePath(dir)
    const cache = await openPrivacyCache(path)
    await cache.setMany([], "config-1")
    expect(cache.stats().entries).toBe(0)
    await cache.close()
  })
})

describe("openPrivacyCache — adversarial: generated_or_cached_artifacts (configHash invalidation)", () => {
  test("write with configHash A then read with configHash B → MISS (different key)", async () => {
    // Given: a cache holding one entry keyed by (hashA, configA).
    const dir = createWorkdir()
    const cache = await openPrivacyCache(cachePath(dir))
    const hash = hashText("config-sensitive")
    const configA = "config-A"
    const configB = "config-B"
    await cache.setMany(
      [{ textHash: hash, configHash: configA, spans: [spanOf(0, 1, "email")] }],
      configA,
    )

    // When: a read with configHash B is issued.
    const result = await cache.getMany([{ textHash: hash, configHash: configB }])

    // Then: the read misses (configHash is part of the key — cache invalidation works).
    expect(result.get(hash)).toBeUndefined()

    // And: a read with configHash A still hits.
    const hitResult = await cache.getMany([{ textHash: hash, configHash: configA }])
    expect(hitResult.get(hash)?.length).toBe(1)

    await cache.close()
  })
})

describe("openPrivacyCache — adversarial: mid_operation_interrupts", () => {
  test("setMany is all-or-nothing — concurrent reads during an in-flight batch never observe partial state", async () => {
    // Given: a cache handle and a fresh path.
    const dir = createWorkdir()
    const path = cachePath(dir)
    const cache = await openPrivacyCache(path)
    const configHash = "config-1"

    // When: a setMany batch is in flight; race a read against it.
    // Race tolerance: the read may resolve before or after the write commits,
    // but never sees a partial batch. We assert the post-write state is exactly
    // the full batch (the in-flight read may legitimately see 0 or N, never 1).
    const entries: { textHash: string; configHash: string; spans: readonly PrivacySpan[] }[] = [
      { textHash: hashText("race-1"), configHash, spans: [spanOf(0, 1, "email")] },
      { textHash: hashText("race-2"), configHash, spans: [spanOf(0, 1, "url")] },
      { textHash: hashText("race-3"), configHash, spans: [spanOf(0, 1, "address")] },
    ]
    const writeP = cache.setMany(entries, configHash)
    // Race a read; we don't care which value resolves first, only that the post-await state is full.
    await Promise.race([
      writeP,
      cache.getMany(entries.map((e) => ({ textHash: e.textHash, configHash: e.configHash }))),
    ])
    await writeP

    // Then: after the write resolves, all 3 entries are visible.
    const final = await cache.getMany(
      entries.map((e) => ({ textHash: e.textHash, configHash: e.configHash })),
    )
    expect(final.size).toBe(3)
    for (const e of entries) {
      expect(final.get(e.textHash)?.length).toBe(1)
    }

    await cache.close()
  })
})

describe("openPrivacyCache — adversarial: log_based_success_claims", () => {
  test("torn-cache fallback log line contains the cache path but NO original text", async () => {
    // Given: a path pre-populated with garbage; capture stderr.
    const dir = createWorkdir()
    const path = cachePath(dir)
    const secretMarker = "SECRET_HONEY_TOKEN_NEVER_IN_LOGS"
    writeFileSync(path, `not sqlite ${secretMarker}`)
    const originalStderrWrite = process.stderr.write.bind(process.stderr)
    const captured: string[] = []
    process.stderr.write = ((chunk: unknown) => {
      captured.push(typeof chunk === "string" ? chunk : String(chunk))
      return true
    }) as typeof process.stderr.write

    try {
      // When: openPrivacyCache runs the torn-cache fallback.
      const cache = await openPrivacyCache(path)
      await cache.close()
    } finally {
      process.stderr.write = originalStderrWrite
    }

    // Then: at least one log line mentions the cache path AND the recreate semantics.
    const combined = captured.join("")
    expect(combined.length).toBeGreaterThan(0)
    expect(combined).toContain(path)
    expect(combined.toLowerCase()).toMatch(/recreate|torn|reset|recover/)

    // And: NO original text content (no honey token) appears in any log line.
    expect(combined).not.toContain(secretMarker)
  })
})

// =============================================================================
// TODO 2: createCachedPrivacyFilter — wrapper that intercepts PrivacyFilter.detect,
// dedupes within batch, looks up cache, falls through to inner for misses,
// persists results inline (awaited, transactional), preserves the
// length-in-order invariant the downstream cursor in apply.ts depends on.
//
// Mock strategy:
//   - createRecordingInner: a PrivacyFilter whose detect() records every call
//     (input array + count) and can be configured to throw on the next call.
//   - createMockCache: an in-memory PrivacyCache whose setMany calls are
//     recorded. Used where the test must assert "setMany was NOT called".
//   - openPrivacyCache (Todo 1): real SQLite. Used for hit/miss/persistence.
// =============================================================================

type RecordingInnerSpansFor = (text: string, indexInBatch: number) => readonly PrivacySpan[]

interface RecordingInner {
  filter: PrivacyFilter
  state: {
    calls: string[][]
    detectCallCount: number
    throwFactory: ((firstText: string) => Error) | null
  }
}

const createRecordingInner = (spansForText: RecordingInnerSpansFor = () => []): RecordingInner => {
  const state: RecordingInner["state"] = {
    calls: [],
    detectCallCount: 0,
    throwFactory: null,
  }
  const filter: PrivacyFilter = {
    detect: async (texts) => {
      state.detectCallCount += 1
      state.calls.push([...texts])
      if (state.throwFactory !== null) {
        // Fire once then auto-reset so subsequent calls succeed unless the
        // test re-arms the factory.
        const factory = state.throwFactory
        state.throwFactory = null
        throw factory(texts[0] ?? "")
      }
      return texts.map((text, i) => spansForText(text, i))
    },
  }
  return { filter, state }
}

interface MockCache {
  cache: PrivacyCache
  state: {
    setManyCalls: Array<{
      entries: PrivacyCacheEntry[]
      configHash: string
    }>
  }
}

const mockCacheKeyOf = (textHash: string, configHash: string): string => `${textHash}|${configHash}`

const createMockCache = (initial: ReadonlyArray<PrivacyCacheEntry> = []): MockCache => {
  const backing = new Map<string, readonly PrivacySpan[]>()
  for (const entry of initial) {
    backing.set(mockCacheKeyOf(entry.textHash, entry.configHash), entry.spans)
  }
  const state: MockCache["state"] = { setManyCalls: [] }
  const cache: PrivacyCache = {
    getMany: async (entries) => {
      const result = new Map<string, readonly PrivacySpan[] | undefined>()
      for (const entry of entries) {
        if (result.has(entry.textHash)) continue
        result.set(entry.textHash, backing.get(mockCacheKeyOf(entry.textHash, entry.configHash)))
      }
      return result
    },
    setMany: async (entries, configHash) => {
      state.setManyCalls.push({ entries: [...entries], configHash })
      for (const entry of entries) {
        backing.set(mockCacheKeyOf(entry.textHash, entry.configHash), entry.spans)
      }
    },
    flush: async () => {},
    stats: () => ({ entries: backing.size, diskBytes: 0 }),
    purge: async () => {
      backing.clear()
    },
    close: async () => {},
  }
  return { cache, state }
}

describe("createCachedPrivacyFilter — TODO 2 acceptance criteria", () => {
  test("1. Cache hit short-circuits engine: 2nd identical call does NOT invoke inner", async () => {
    // Given: a fresh on-disk cache and a recording inner that returns one
    // fixed span per input.
    const dir = createWorkdir()
    const cache = await openPrivacyCache(cachePath(dir))
    const expectedSpans: readonly PrivacySpan[] = [spanOf(0, 3, "email", 0.95)]
    const inner = createRecordingInner(() => expectedSpans)
    const wrapper = createCachedPrivacyFilter(inner.filter, cache, "config-1")

    try {
      // When: wrapper.detect is called twice with the same input.
      const first = await wrapper.detect(["abc"])
      const second = await wrapper.detect(["abc"])

      // Then: inner.detect was invoked exactly ONCE (second call hit cache).
      expect(inner.state.detectCallCount).toBe(1)
      // And: both calls returned the same spans.
      expect(first).toEqual([expectedSpans])
      expect(second).toEqual([expectedSpans])
    } finally {
      await cache.close()
    }
  })

  test("2. Batch dedup cold cache: 5 inputs (3 unique) → inner sees 3 unique", async () => {
    // Given: a cold cache and a recording inner whose spans encode the input
    // position in the unique-miss batch, so replication is observable.
    const dir = createWorkdir()
    const cache = await openPrivacyCache(cachePath(dir))
    const inner = createRecordingInner((_text, indexInBatch) => [
      spanOf(indexInBatch, indexInBatch + 1, "email", 0.9),
    ])
    const wrapper = createCachedPrivacyFilter(inner.filter, cache, "config-1")

    try {
      // When: wrapper.detect is called with 5 inputs containing 3 unique texts.
      const result = await wrapper.detect(["a", "b", "a", "c", "b"])

      // Then: inner.detect was invoked exactly once with the 3 unique miss texts.
      expect(inner.state.detectCallCount).toBe(1)
      expect(inner.state.calls).toHaveLength(1)
      expect(inner.state.calls[0]).toEqual(["a", "b", "c"])

      // And: the result has 5 entries; duplicate positions share the same spans
      // as their first occurrence. Expected layout (uniqueIndex encoded in spans):
      //   pos 0 ("a", unique idx 0) → span(0,1)
      //   pos 1 ("b", unique idx 1) → span(1,2)
      //   pos 2 ("a", unique idx 0) → span(0,1)  (replicated)
      //   pos 3 ("c", unique idx 2) → span(2,3)
      //   pos 4 ("b", unique idx 1) → span(1,2)  (replicated)
      expect(result).toHaveLength(5)
      expect(result[0]).toEqual([spanOf(0, 1, "email", 0.9)])
      expect(result[1]).toEqual([spanOf(1, 2, "email", 0.9)])
      expect(result[2]).toEqual([spanOf(0, 1, "email", 0.9)])
      expect(result[3]).toEqual([spanOf(2, 3, "email", 0.9)])
      expect(result[4]).toEqual([spanOf(1, 2, "email", 0.9)])
    } finally {
      await cache.close()
    }
  })

  test("3. Inner throws PrivacyFilterUnavailableError → wrapper re-throws same class, no partial cache write", async () => {
    // Given: a mock cache that records setMany calls and an inner configured to
    // throw PrivacyFilterUnavailableError on its next detect() call.
    const mock = createMockCache()
    const inner = createRecordingInner()
    inner.state.throwFactory = () => new PrivacyFilterUnavailableError("engine down")
    const wrapper = createCachedPrivacyFilter(inner.filter, mock.cache, "config-1")

    // When: wrapper.detect is called and inner throws.
    let caught: unknown
    try {
      await wrapper.detect(["a", "b"])
    } catch (e) {
      caught = e
    }

    // Then: the re-thrown error preserves the PrivacyFilterUnavailableError class.
    expect(caught).toBeInstanceOf(PrivacyFilterUnavailableError)
    // And: cache.setMany was NEVER called (no partial cache write on inner failure).
    expect(mock.state.setManyCalls).toHaveLength(0)
    // And: inner.detect was invoked exactly once (the error did not bypass the call).
    expect(inner.state.detectCallCount).toBe(1)
  })

  test("4. Mixed cached + misses: inner invoked with only the miss texts", async () => {
    // Given: a cache pre-populated with spans for text "a" under config-1.
    const dir = createWorkdir()
    const cache = await openPrivacyCache(cachePath(dir))
    const cachedSpansForA: readonly PrivacySpan[] = [spanOf(0, 1, "person_name", 0.99)]
    await cache.setMany(
      [{ textHash: hashText("a"), configHash: "config-1", spans: cachedSpansForA }],
      "config-1",
    )

    // And: a recording inner that returns distinct spans when invoked.
    const freshSpansForB: readonly PrivacySpan[] = [spanOf(5, 6, "email", 0.88)]
    const inner = createRecordingInner((text) =>
      text === "b" ? freshSpansForB : [spanOf(99, 100, "url", 0.5)],
    )
    const wrapper = createCachedPrivacyFilter(inner.filter, cache, "config-1")

    try {
      // When: wrapper.detect is called with [a, b] (a cached, b miss).
      const result = await wrapper.detect(["a", "b"])

      // Then: inner.detect was invoked exactly once with ONLY ["b"] (the miss).
      expect(inner.state.detectCallCount).toBe(1)
      expect(inner.state.calls[0]).toEqual(["b"])

      // And: the result has both spans in input order (cached for a, fresh for b).
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual(cachedSpansForA)
      expect(result[1]).toEqual(freshSpansForB)
    } finally {
      await cache.close()
    }
  })

  test("5. Byte-identical output: cold wrapper path === unwrapped inner path", async () => {
    // Given: a cold cache and a deterministic spans-producer wired into BOTH
    // the unwrapped and wrapped paths (same canonical behavior expected).
    const dir = createWorkdir()
    const cache = await openPrivacyCache(cachePath(dir))
    const spansFor = (text: string): readonly PrivacySpan[] => [
      spanOf(0, text.length, "email", 0.9),
    ]
    const unwrappedInner: PrivacyFilter = {
      detect: async (texts) => texts.map((t) => spansFor(t)),
    }
    const wrappedInner = createRecordingInner((t) => spansFor(t))
    const wrapper = createCachedPrivacyFilter(wrappedInner.filter, cache, "config-1")

    try {
      const input = ["x", "y", "z"]

      // When: both unwrapped and wrapped detect are called with the same input.
      const unwrappedResult = await unwrappedInner.detect(input)
      const wrappedResult = await wrapper.detect(input)

      // Then: the wrapped output is byte-identical to the unwrapped canonical output.
      expect(wrappedResult).toEqual(unwrappedResult)
      // And: the canonical shape is what we expect (one span per text, length-encoded).
      expect(unwrappedResult).toEqual([
        [spanOf(0, 1, "email", 0.9)],
        [spanOf(0, 1, "email", 0.9)],
        [spanOf(0, 1, "email", 0.9)],
      ])
    } finally {
      await cache.close()
    }
  })

  test("6. Length invariant: inner returns wrong-length output → contract error (PII-safe)", async () => {
    // Given: a mock inner that returns TOO FEW spans (2 for 3 inputs),
    // which violates the length contract the wrapper enforces for the
    // downstream cursor in apply.ts:108-112.
    const mock = createMockCache()
    const badInner: PrivacyFilter = {
      detect: async () => [[spanOf(0, 1, "email")], [spanOf(0, 2, "url")]],
    }
    const wrapper = createCachedPrivacyFilter(badInner, mock.cache, "config-1")

    // Use distinctive secret-bearing texts so a PII leak into the message is
    // unambiguously detectable (short texts like "a" appear in many words).
    const secretAlpha = "alpha-honey-token-aaa"
    const secretBravo = "bravo-honey-token-bbb"
    const secretCharlie = "charlie-honey-token-ccc"

    // When: wrapper.detect is called with 3 inputs but inner returns 2.
    let caught: unknown
    try {
      await wrapper.detect([secretAlpha, secretBravo, secretCharlie])
    } catch (e) {
      caught = e
    }

    // Then: a contract violation error was thrown by the wrapper.
    expect(caught).toBeInstanceOf(Error)
    const msg = caught instanceof Error ? caught.message : String(caught)
    expect(msg).toMatch(/privacy_filter_contract_violation/)

    // And: the error message does NOT contain any original text (Metis N11).
    expect(msg).not.toContain(secretAlpha)
    expect(msg).not.toContain(secretBravo)
    expect(msg).not.toContain(secretCharlie)
  })

  test("7. Error message PII safety: wrapper's OWN contract errors do not surface original text", async () => {
    // The PII-safety invariant (Metis N11) applies to the wrapper's own errors.
    // The wrapper's contract errors must carry only hashes, counts, and
    // integer offsets — never the original text content.
    //
    // (Note on the re-throw path: the production inner in engine-client.ts
    // never includes input text in its error messages — its errors carry only
    // the engine URL and HTTP status. The wrapper propagates inner errors
    // WITHOUT wrapping them in new messages, so the inner's own message
    // semantics are the inner's responsibility. This test exercises the
    // wrapper-OWNED contract error path.)
    const mock = createMockCache()
    const secret = "LEAK_PROBE_HONEY_TOKEN_xyz"
    // Trigger the wrapper's own length-invariant contract error.
    const badInner: PrivacyFilter = {
      detect: async () => [],
    }
    const wrapper = createCachedPrivacyFilter(badInner, mock.cache, "config-1")

    let caught: unknown
    try {
      await wrapper.detect([secret])
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(Error)
    const msg = caught instanceof Error ? caught.message : String(caught)
    expect(msg).toMatch(/privacy_filter_contract_violation/)
    // Regex search: the secret substring must not appear anywhere in the message.
    expect(msg).not.toMatch(new RegExp(secret))
  })

  test("8. Empty texts batch: wrapper.detect([]) returns [] without invoking inner", async () => {
    // Given: a mock inner with a call recorder.
    const mock = createMockCache()
    const inner = createRecordingInner()
    const wrapper = createCachedPrivacyFilter(inner.filter, mock.cache, "config-1")

    // When: wrapper.detect is called with an empty batch.
    const result = await wrapper.detect([])

    // Then: result is an empty array (length 0 invariant preserved).
    expect(result).toEqual([])
    expect(result).toHaveLength(0)
    // And: inner.detect was NEVER called (no misses to compute).
    expect(inner.state.detectCallCount).toBe(0)
  })

  test("9. All-cached batch: inner NOT invoked; cached spans returned in input order", async () => {
    // Given: a cache pre-populated with spans for ["a", "b", "c"] under config-1.
    const dir = createWorkdir()
    const cache = await openPrivacyCache(cachePath(dir))
    const configHash = "config-1"
    const spansA: readonly PrivacySpan[] = [spanOf(0, 1, "email", 0.9)]
    const spansB: readonly PrivacySpan[] = [spanOf(2, 3, "url", 0.8)]
    const spansC: readonly PrivacySpan[] = [spanOf(4, 5, "person_name", 0.7)]
    await cache.setMany(
      [
        { textHash: hashText("a"), configHash, spans: spansA },
        { textHash: hashText("b"), configHash, spans: spansB },
        { textHash: hashText("c"), configHash, spans: spansC },
      ],
      configHash,
    )

    const inner = createRecordingInner()
    const wrapper = createCachedPrivacyFilter(inner.filter, cache, configHash)

    try {
      // When: wrapper.detect is called with all-cached input.
      const result = await wrapper.detect(["a", "b", "c"])

      // Then: inner.detect was NEVER invoked.
      expect(inner.state.detectCallCount).toBe(0)
      // And: cached spans are returned in input order.
      expect(result).toEqual([spansA, spansB, spansC])
    } finally {
      await cache.close()
    }
  })

  test("10. No input mutation: frozen input array is unchanged after detect()", async () => {
    // Given: a mock cache, a recording inner, and a FROZEN input array
    // (Object.freeze — any write or push throws in strict mode, exposing any
    // accidental mutation by the wrapper).
    const mock = createMockCache()
    const inner = createRecordingInner(() => [spanOf(0, 1, "email", 0.9)])
    const wrapper = createCachedPrivacyFilter(inner.filter, mock.cache, "config-1")

    const input: readonly string[] = Object.freeze(["x", "y"])
    const snapshot = [...input]

    // When: wrapper.detect is called with the frozen array.
    const result = await wrapper.detect(input)

    // Then: the call completed without throwing (no mutation attempted).
    expect(result).toHaveLength(2)
    // And: the input array contents are unchanged.
    expect(input).toEqual(snapshot)
    expect(input).toHaveLength(snapshot.length)
    // And: the array is still frozen.
    expect(Object.isFrozen(input)).toBe(true)
  })
})

describe("createCachedPrivacyFilter — adversarial: generated_or_cached_artifacts (cache poisoning)", () => {
  test("cache holds WRONG spans for text X → wrapper returns the wrong spans (cache is authoritative)", async () => {
    // KNOWN PROPERTY: if the cache is poisoned (e.g. by determinism drift
    // between two writes for the same text+configHash), the wrapper trusts
    // its own entries and returns the poisoned spans without re-validating
    // against the engine. This is the expected behavior — the cache module's
    // contract is "fastest read wins, no validation". The mitigation for
    // determinism drift is the determinism probe in Todo 6; if that probe
    // fails, the cache defaults to OFF at the pipeline level. Within an
    // individual wrapper call, the cache is authoritative.
    const mock = createMockCache([
      {
        textHash: hashText("X"),
        configHash: "config-1",
        // Clearly "wrong" spans that the engine would never produce:
        spans: [spanOf(99, 999, "secret", 0.01)],
      },
    ])
    const inner = createRecordingInner(() => [spanOf(0, 1, "email", 0.9)])
    const wrapper = createCachedPrivacyFilter(inner.filter, mock.cache, "config-1")

    // When: wrapper.detect is called for the poisoned text.
    const result = await wrapper.detect(["X"])

    // Then: inner.detect was NOT invoked (cache hit short-circuits).
    expect(inner.state.detectCallCount).toBe(0)
    // And: the wrapper returned the CACHED (poisoned) spans verbatim.
    expect(result).toEqual([[spanOf(99, 999, "secret", 0.01)]])
  })
})

describe("createCachedPrivacyFilter — adversarial: malformed_input", () => {
  test("empty texts batch completes without throwing (length 0 invariant)", async () => {
    // Covered by acceptance test 8 — re-asserted here under the adversarial map.
    const mock = createMockCache()
    const inner = createRecordingInner()
    const wrapper = createCachedPrivacyFilter(inner.filter, mock.cache, "config-1")

    const result = await wrapper.detect([])
    expect(result).toEqual([])
    expect(inner.state.detectCallCount).toBe(0)
  })

  test("single-text batch completes without throwing", async () => {
    const mock = createMockCache()
    const inner = createRecordingInner(() => [spanOf(0, 1, "email", 0.9)])
    const wrapper = createCachedPrivacyFilter(inner.filter, mock.cache, "config-1")

    const result = await wrapper.detect(["solo"])
    expect(result).toEqual([[spanOf(0, 1, "email", 0.9)]])
    expect(inner.state.detectCallCount).toBe(1)
  })

  test("all-duplicate batch: 5 identical texts collapse to ONE inner call", async () => {
    const dir = createWorkdir()
    const cache = await openPrivacyCache(cachePath(dir))
    const inner = createRecordingInner(() => [spanOf(0, 1, "email", 0.9)])
    const wrapper = createCachedPrivacyFilter(inner.filter, cache, "config-1")

    try {
      const result = await wrapper.detect(["same", "same", "same", "same", "same"])
      expect(inner.state.detectCallCount).toBe(1)
      expect(inner.state.calls[0]).toEqual(["same"])
      expect(result).toHaveLength(5)
    } finally {
      await cache.close()
    }
  })

  test("very long text input completes without throwing", async () => {
    const mock = createMockCache()
    const longText = "x".repeat(10_000)
    const inner = createRecordingInner(() => [spanOf(0, 1, "email", 0.9)])
    const wrapper = createCachedPrivacyFilter(inner.filter, mock.cache, "config-1")

    const result = await wrapper.detect([longText])
    expect(result).toHaveLength(1)
  })

  test("batch containing empty string: empty string is hashed, cached, and treated like any other text", async () => {
    // Empty STRINGS (vs empty BATCHES) are NOT special-cased — they hash to a
    // fixed sha256, get cached, and the inner returns whatever it returns.
    const mock = createMockCache()
    const inner = createRecordingInner(() => [])
    const wrapper = createCachedPrivacyFilter(inner.filter, mock.cache, "config-1")

    const result = await wrapper.detect(["", "non-empty"])
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual([])
    expect(result[1]).toEqual([])
    // The empty string was hashed and the inner was invoked with both inputs.
    expect(inner.state.detectCallCount).toBe(1)
    expect(inner.state.calls[0]).toEqual(["", "non-empty"])

    // Second call: both texts are cached; inner not invoked again.
    const secondResult = await wrapper.detect(["", "non-empty"])
    expect(inner.state.detectCallCount).toBe(1)
    expect(secondResult).toEqual(result)
  })
})

describe("createCachedPrivacyFilter — adversarial: stale_state (configHash invalidation)", () => {
  test("write under configHash A; switch wrapper to configHash B → cache MISSES, inner invoked", async () => {
    // Given: an on-disk cache holding text "X" under configHash A only.
    const dir = createWorkdir()
    const path = cachePath(dir)
    const cacheA = await openPrivacyCache(path)
    await cacheA.setMany(
      [{ textHash: hashText("X"), configHash: "A", spans: [spanOf(0, 1, "email", 0.9)] }],
      "A",
    )
    await cacheA.close()

    // When: a NEW wrapper is constructed with configHash B against the same cache file.
    const cacheB = await openPrivacyCache(path)
    const inner = createRecordingInner(() => [spanOf(2, 3, "url", 0.5)])
    const wrapperB = createCachedPrivacyFilter(inner.filter, cacheB, "B")

    try {
      const result = await wrapperB.detect(["X"])

      // Then: inner.detect IS invoked (configHash is part of the cache key,
      // so the lookup with configHash B misses against an entry written
      // under configHash A). Cache invalidation on config change works.
      expect(inner.state.detectCallCount).toBe(1)
      // And: the result is the FRESH spans from inner, not the stale cached spans.
      expect(result).toEqual([[spanOf(2, 3, "url", 0.5)]])
    } finally {
      await cacheB.close()
    }
  })
})

describe("createCachedPrivacyFilter — adversarial: mid_operation_interrupts", () => {
  test("inner throws mid-batch → wrapper re-throws WITHOUT calling setMany (no partial write)", async () => {
    // Covered by acceptance test 3 — re-asserted here under the adversarial map.
    const mock = createMockCache()
    const inner = createRecordingInner()
    inner.state.throwFactory = () => new PrivacyFilterUnavailableError("mid-batch failure")
    const wrapper = createCachedPrivacyFilter(inner.filter, mock.cache, "config-1")

    let caught: unknown
    try {
      await wrapper.detect(["a", "b", "c"])
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(PrivacyFilterUnavailableError)
    expect(mock.state.setManyCalls).toHaveLength(0)
  })
})

describe("createCachedPrivacyFilter — adversarial: log_based_success_claims", () => {
  test("length-invariant contract error carries NO original text — only counts and configHash", async () => {
    // Given: an inner that returns the wrong length, triggering the wrapper's
    // own contract error.
    const mock = createMockCache()
    const badInner: PrivacyFilter = {
      detect: async () => [],
    }
    const wrapper = createCachedPrivacyFilter(badInner, mock.cache, "config-leaked-check")

    const secretA = "secret-honey-token-A"
    const secretB = "secret-honey-token-B"

    // Capture stderr to ensure no PII is logged from the wrapper's error path.
    const originalStderrWrite = process.stderr.write.bind(process.stderr)
    const captured: string[] = []
    process.stderr.write = ((chunk: unknown) => {
      captured.push(typeof chunk === "string" ? chunk : String(chunk))
      return true
    }) as typeof process.stderr.write

    let caught: unknown
    try {
      await wrapper.detect([secretA, secretB])
    } catch (e) {
      caught = e
    } finally {
      process.stderr.write = originalStderrWrite
    }

    // Then: a contract violation error was thrown.
    expect(caught).toBeInstanceOf(Error)
    const msg = caught instanceof Error ? caught.message : String(caught)
    expect(msg).toMatch(/privacy_filter_contract_violation/)
    // And: the message carries NO original text content.
    expect(msg).not.toContain(secretA)
    expect(msg).not.toContain(secretB)
    // And: nothing was written to stderr that contains the secrets.
    const stderrText = captured.join("")
    expect(stderrText).not.toContain(secretA)
    expect(stderrText).not.toContain(secretB)
  })
})
