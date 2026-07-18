import { Database } from "bun:sqlite"
import { createHmac, randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import type { PrivacySpan } from "./contract"

// Per-text-leaf disk-only SQLite WAL cache for the privacy-filter pass.
// Stores only HMAC-SHA256(text) + configHash + JSON-of-spans — NEVER the original
// text (PII safety invariant). The cache keys on (text_hash, config_hash) so
// a threshold/category change automatically invalidates prior results without
// any explicit eviction logic.
//
// Concurrency: WAL + PRAGMA busy_timeout=5000 lets future parallel collector
// workers share the file without SQLITE_BUSY failures under the standard
// 5s SQLite wait window. setMany is awaited + transactional so partial-batch
// failures roll back and SIGTERM between caller and commit doesn't leave
// half-written state.
//
// Cached spans are in the SAME UTF-16 code-unit coordinate system as fresh
// engine output (see engine-client.ts:38). If a future engine switches to a
// different offset system, the cache MUST be invalidated; this assumption is
// pinned here so the dependency is obvious.

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS privacy_detect_cache (
    text_hash TEXT NOT NULL,
    config_hash TEXT NOT NULL,
    spans TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (text_hash, config_hash)
  ) WITHOUT ROWID
`

const SELECT_SPANS_SQL =
  "SELECT spans FROM privacy_detect_cache WHERE text_hash = ? AND config_hash = ?"

const INSERT_IGNORE_SQL =
  "INSERT OR IGNORE INTO privacy_detect_cache (text_hash, config_hash, spans, created_at) VALUES (?, ?, ?, ?)"

const COUNT_SQL = "SELECT COUNT(*) AS c FROM privacy_detect_cache"

const DELETE_ALL_SQL = "DELETE FROM privacy_detect_cache"

export type PrivacyCacheEntry = Readonly<{
  textHash: string
  configHash: string
  spans: readonly PrivacySpan[]
}>

export type PrivacyCacheLookup = Readonly<{ textHash: string; configHash: string }>

export interface PrivacyCache {
  // Lookup entries by (textHash, configHash). The returned Map is keyed by
  // textHash; misses are present as the key with value `undefined` so callers
  // can distinguish "looked up and missed" from "never looked up".
  getMany(
    entries: ReadonlyArray<PrivacyCacheLookup>,
  ): Promise<Map<string, readonly PrivacySpan[] | undefined>>
  // Persist entries in ONE SQLite transaction with INSERT OR IGNORE. The
  // outer configHash argument is the batch's config identifier (every entry's
  // configHash must match it). Rolls back on any failure; the awaited promise
  // resolves only after the WAL commit, so SIGTERM between caller and commit
  // never observes half-written state.
  setMany(entries: ReadonlyArray<PrivacyCacheEntry>, configHash: string): Promise<void>
  // No-op for SQLite (signature kept for future stores that buffer writes).
  flush(): Promise<void>
  // Returns current row count and on-disk footprint (db + WAL + SHM sidecars).
  stats(): { entries: number; diskBytes: number }
  // Clears all entries.
  purge(): Promise<void>
  // Closes the SQLite handle. Idempotent — safe to call multiple times.
  close(): Promise<void>
}

const isErrorWithCode = (error: unknown, code: string): boolean =>
  error instanceof Error && "code" in error && error.code === code

// SQLite reports a torn / unopenable file via these codes. Anything else
// (e.g. SQLITE_CANTOPEN from a missing parent dir, SQLITE_BUSY from another
// writer holding the lock past busy_timeout) is a real error we must surface.
const isTornCacheError = (error: unknown): boolean =>
  isErrorWithCode(error, "SQLITE_CORRUPT") ||
  isErrorWithCode(error, "SQLITE_NOTADB") ||
  isErrorWithCode(error, "SQLITE_IOERR_SHORT_READ") ||
  isErrorWithCode(error, "SQLITE_IOERR_CORRUPTFS")

const removeSidecars = (dbPath: string): void => {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const candidate = `${dbPath}${suffix}`
    if (existsSync(candidate)) {
      try {
        unlinkSync(candidate)
      } catch {
        // Best-effort cleanup; the open() below recreates whatever it needs.
      }
    }
  }
}

const openAndTune = (dbPath: string): Database => {
  const db = new Database(dbPath, { strict: true })
  db.run("PRAGMA journal_mode=WAL")
  db.run("PRAGMA synchronous=NORMAL")
  // Without busy_timeout, two parallel writers racing for WAL's single-writer
  // lock would fail immediately with SQLITE_BUSY instead of waiting up to 5s
  // for the holder to release. 5000ms is the SQLite-recommended floor for
  // short transactions; the resident collector and parallel-worker successor
  // both rely on this.
  db.run("PRAGMA busy_timeout=5000")
  db.run(CREATE_TABLE_SQL)
  return db
}

const logTornCacheRecovery = (dbPath: string, reason: string): void => {
  // Log path + reason only — NEVER the file contents (the file may contain
  // garbage, but it might also be a torn real cache whose body we shouldn't
  // echo to stderr). Per Metis N11, no original text in any log line.
  process.stderr.write(
    `privacy cache: torn or unreadable SQLite file at ${dbPath} (${reason}); recreating empty cache\n`,
  )
}

const openWithTornCacheFallback = (dbPath: string): Database => {
  try {
    return openAndTune(dbPath)
  } catch (caught: unknown) {
    if (!isTornCacheError(caught)) {
      throw caught
    }
    const reason = caught instanceof Error ? caught.message : "unknown"
    logTornCacheRecovery(dbPath, reason)
    removeSidecars(dbPath)
    // Second attempt on a now-empty path — this must succeed or the disk is
    // genuinely broken and the error surfaces to the caller as a real I/O
    // fault rather than a torn-cache condition.
    return openAndTune(dbPath)
  }
}

const computeDiskBytes = (dbPath: string): number => {
  let total = 0
  for (const suffix of ["", "-wal", "-shm"]) {
    const candidate = `${dbPath}${suffix}`
    if (existsSync(candidate)) {
      try {
        total += statSync(candidate).size
      } catch {
        // Race with another process removing sidecars; treat as zero bytes.
      }
    }
  }
  return total
}

const createPrivacyCache = (db: Database, dbPath: string): PrivacyCache => {
  let closed = false
  return {
    async getMany(
      entries: ReadonlyArray<PrivacyCacheLookup>,
    ): Promise<Map<string, readonly PrivacySpan[] | undefined>> {
      const result = new Map<string, readonly PrivacySpan[] | undefined>()
      if (entries.length === 0) {
        return result
      }
      const select = db.query<{ spans: string }, [string, string]>(SELECT_SPANS_SQL)
      for (const entry of entries) {
        if (result.has(entry.textHash)) {
          // First lookup wins for duplicate textHash within one batch.
          continue
        }
        const row = select.get(entry.textHash, entry.configHash)
        if (row === null || row === undefined) {
          result.set(entry.textHash, undefined)
        } else {
          const parsed = JSON.parse(row.spans) as readonly PrivacySpan[]
          result.set(entry.textHash, parsed)
        }
      }
      return result
    },

    async setMany(entries: ReadonlyArray<PrivacyCacheEntry>, _configHash: string): Promise<void> {
      if (entries.length === 0) {
        return
      }
      // Pre-serialize spans BEFORE entering the transaction so a JSON failure
      // (cyclic structure, BigInt, etc.) throws before any INSERT runs —
      // guaranteeing zero rows committed on a mid-batch serialization failure.
      const now = Date.now()
      const serialized: ReadonlyArray<{ textHash: string; configHash: string; spans: string }> =
        entries.map((entry) => ({
          textHash: entry.textHash,
          configHash: entry.configHash,
          spans: JSON.stringify(entry.spans),
        }))

      const insert = db.query<unknown, [string, string, string, number]>(INSERT_IGNORE_SQL)
      const writeBatch = db.transaction((): void => {
        for (const row of serialized) {
          insert.run(row.textHash, row.configHash, row.spans, now)
        }
      })
      writeBatch()
    },

    async flush(): Promise<void> {
      // SQLite writes are committed inline by the transaction above; nothing
      // to drain. Kept for parity with future buffered store backends.
    },

    stats(): { entries: number; diskBytes: number } {
      const row = db.query<{ c: number }, []>(COUNT_SQL).get()
      return {
        entries: row?.c ?? 0,
        diskBytes: computeDiskBytes(dbPath),
      }
    },

    async purge(): Promise<void> {
      db.run(DELETE_ALL_SQL)
    },

    async close(): Promise<void> {
      if (closed) {
        return
      }
      closed = true
      // bun:sqlite's close is itself idempotent, but the flag short-circuits
      // any further state inspection on a half-closed handle.
      try {
        db.close()
      } catch {
        // Best-effort; if the underlying handle is already torn down by the
        // SQLite runtime, the call is still considered a success.
      }
    },
  }
}

export const openPrivacyCache = async (cachePath: string): Promise<PrivacyCache> => {
  // The caller is responsible for choosing a path under a writable dir. We
  // don't auto-create the parent; if it doesn't exist, the open surfaces
  // SQLITE_CANTOPEN and the caller's contract is "tell me a valid path".
  const parentDir = dirname(cachePath)
  if (!existsSync(parentDir)) {
    throw new Error(`privacy cache parent directory does not exist: ${parentDir}`)
  }
  const db = openWithTornCacheFallback(cachePath)
  return createPrivacyCache(db, cachePath)
}

// Per-installation HMAC key for text hashing. Stored OUTSIDE the workspace
// (Codex review P2 #2: unsalted sha256 was offline-guessable via dictionary
// attack if the cache file leaked). The key lives in the OS state directory,
// NOT next to the cache DB — an attacker who copies .tmp/collected/privacy-
// cache.db does not get the key, so the stored HMAC digests are not
// reversible without the key file.
let cachedHmacKey: Buffer | undefined

const getCacheHmacKey = (): Buffer => {
  if (cachedHmacKey !== undefined) return cachedHmacKey
  const keyDir = join(homedir(), ".local", "state", "agent-trajectory-marketplace")
  const keyPath = join(keyDir, "privacy-cache.key")
  try {
    cachedHmacKey = readFileSync(keyPath)
    return cachedHmacKey
  } catch {
    cachedHmacKey = randomBytes(32)
    mkdirSync(keyDir, { recursive: true })
    writeFileSync(keyPath, cachedHmacKey, { mode: 0o600 })
    return cachedHmacKey
  }
}

export const hashText = (text: string): string =>
  createHmac("sha256", getCacheHmacKey()).update(text).digest("hex")

export const hashTextBatch = (texts: readonly string[]): string[] => {
  const key = getCacheHmacKey()
  const out: string[] = new Array(texts.length)
  for (let i = 0; i < texts.length; i += 1) {
    const text = texts[i]
    if (text === undefined) {
      continue
    }
    out[i] = createHmac("sha256", key).update(text).digest("hex")
  }
  return out
}

// Re-exported here so callers have a single import surface for the privacy
// cache layer: storage (above) + wrapper (./cached-filter.ts). Implementation
// lives in a sibling file to keep this module under the 250-LOC reviewer
// working-memory ceiling.
export { createCachedPrivacyFilter } from "./cached-filter"
