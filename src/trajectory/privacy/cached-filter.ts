import type { PrivacyCache, PrivacyCacheEntry } from "./cache"
import { hashTextBatch } from "./cache"
import type { PrivacyFilter, PrivacySpan } from "./contract"

// Cached PrivacyFilter wrapper. Composes the disk cache (./cache.ts) with any
// PrivacyFilter implementation (engine, fake) so that:
//   - Within one detect() batch, identical texts collapse to a single inner
//     call (within-batch dedup).
//   - Across detect() batches, identical (text, configHash) pairs hit the disk
//     cache and skip the inner call entirely (cross-batch reuse).
//
// All spans flowing through this wrapper are in the SAME UTF-16 code-unit
// coordinate system the inner filter produces (see engine-client.ts:38). The
// cache stores them verbatim; if a future engine switches offset systems, the
// cache MUST be purged.
//
// PII safety (Metis N11): no original text crosses the cache boundary — only
// HMAC-SHA256(text) hashes do. The wrapper's OWN contract errors carry only hashes,
// counts, and the configHash; never the original text content. Re-throws from
// the inner filter propagate unchanged (the production inner in engine-client
// .ts never includes input text in its error messages).
export const createCachedPrivacyFilter = (
  inner: PrivacyFilter,
  cache: PrivacyCache,
  configHash: string,
): PrivacyFilter => ({
  detect: async (texts) => {
    let textHashes: string[]
    try {
      textHashes = hashTextBatch(texts)
    } catch {
      // HMAC key initialization failed (e.g., state dir not writable).
      // The cache is always-on with no CLI opt-out, so this catch prevents
      // a filesystem-permission issue from blocking the privacy pass itself
      // (Codex review P2). Bypass the cache and call the inner filter directly.
      return inner.detect(texts)
    }

    let cached: Map<string, readonly PrivacySpan[] | undefined>
    try {
      cached = await cache.getMany(textHashes.map((textHash) => ({ textHash, configHash })))
    } catch {
      cached = new Map()
    }

    // missByText preserves insertion order, so the subsequent inner.detect
    // call receives a deterministic input batch (same input → same order).
    const slots: Array<readonly PrivacySpan[] | undefined> = new Array(texts.length)
    const missByText = new Map<string, { textHash: string; uniqueIndex: number }>()
    for (let i = 0; i < texts.length; i += 1) {
      const text = texts[i]
      const textHash = textHashes[i]
      if (text === undefined || textHash === undefined) {
        throw new Error(
          `privacy_filter_contract_violation: parallel-array desync at index ${i} (configHash=${configHash})`,
        )
      }
      const cachedSpans = cached.get(textHash)
      if (cachedSpans !== undefined) {
        slots[i] = cachedSpans
      } else if (!missByText.has(text)) {
        missByText.set(text, { textHash, uniqueIndex: missByText.size })
      }
    }

    if (missByText.size > 0) {
      const uniqueMissTexts: string[] = [...missByText.keys()]

      // No try/catch wraps inner.detect — PrivacyFilterUnavailableError
      // propagates naturally and we never reach setMany below, so no partial
      // cache write survives an engine failure (Metis B6 / Oracle O3).
      const freshSpans = await inner.detect(uniqueMissTexts)

      // Length invariant — protects the downstream cursor at apply.ts:108-112.
      // Message carries only counts + configHash (no PII).
      if (freshSpans.length !== uniqueMissTexts.length) {
        throw new Error(
          `privacy_filter_contract_violation: inner.detect returned ${freshSpans.length} results for ${uniqueMissTexts.length} unique miss texts (configHash=${configHash})`,
        )
      }

      // tsc noUncheckedIndexedAccess requires per-element guards even though
      // both arrays are length-equal per the check above.
      const newEntries: PrivacyCacheEntry[] = []
      const spansByText = new Map<string, readonly PrivacySpan[]>()
      for (let j = 0; j < uniqueMissTexts.length; j += 1) {
        const text = uniqueMissTexts[j]
        const spans = freshSpans[j]
        if (text === undefined || spans === undefined) {
          throw new Error(
            `privacy_filter_contract_violation: unique miss array desync at index ${j} (configHash=${configHash})`,
          )
        }
        const meta = missByText.get(text)
        if (meta === undefined) {
          throw new Error(
            `privacy_filter_contract_violation: miss map desync at unique index ${j} (configHash=${configHash})`,
          )
        }
        newEntries.push({ textHash: meta.textHash, configHash, spans })
        spansByText.set(text, spans)
      }

      // Awaited inline (NOT fire-and-forget — per Metis B6, the await is
      // load-bearing for SIGTERM survival between detect and commit).
      // setMany is transactional in ./cache.ts, so partial-batch failure rolls
      // back to zero new entries committed.
      // Cache I/O failures (SQLITE_BUSY, disk errors, malformed rows) are
      // caught and swallowed — the fresh spans are still returned to the
      // caller, so a broken cache degrades to uncached behavior, not a
      // permanent session failure (Codex review P2 #1).
      try {
        await cache.setMany(newEntries, configHash)
      } catch {
        // Cache persistence failed; the spans are already in `spansByText`
        // and will be assembled into the result below regardless.
      }

      for (let i = 0; i < texts.length; i += 1) {
        if (slots[i] !== undefined) continue
        const text = texts[i]
        if (text === undefined) continue
        const spans = spansByText.get(text)
        if (spans !== undefined) {
          slots[i] = spans
        }
      }
    }

    // Verifies every slot is filled (invariant for apply.ts:108-112) AND
    // narrows `undefined` out of the slot type so the return matches the
    // PrivacyFilter.detect contract.
    const result: Array<readonly PrivacySpan[]> = []
    for (let i = 0; i < slots.length; i += 1) {
      const spans = slots[i]
      if (spans === undefined) {
        const textHash = textHashes[i] ?? "<missing>"
        throw new Error(
          `privacy_filter_contract_violation: result slot ${i} unfilled after detect (textHash=${textHash}, configHash=${configHash})`,
        )
      }
      result.push(spans)
    }
    return result
  },
})
