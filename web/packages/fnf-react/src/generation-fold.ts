import type { Generation } from '@higgsfield/fnf/client'
import { isTerminalJobStatus } from '@higgsfield/fnf/client'

/**
 * The single write rule for folding a fresh generation snapshot over a cached
 * one — every cache write in this package (`applyGenerations`) goes through
 * it, so poll ticks, set reads and run progress all obey the same two domain
 * guards no matter which source raced which:
 *
 * - **terminal anti-regress**: a stale read (an out-of-order response, a
 *   lagging endpoint) can never roll a settled generation back to pending —
 *   the guard fnf-web hand-rolls as `effectiveStatus` in its job polling.
 * - **identity stability**: when nothing observable changed, the PREVIOUS
 *   object is returned, so reference-equality memoization downstream
 *   (`React.memo` tiles, selectors) survives polling.
 *
 * Pure and tanstack-free on purpose — usable by any cache, not just ours.
 */
export function foldGeneration(prev: Generation | undefined, next: Generation): Generation {
  if (!prev || prev.id !== next.id)
    return next
  if (isTerminalJobStatus(prev.status) && !isTerminalJobStatus(next.status))
    return prev // a stale snapshot can't reopen a settled generation
  if (
    prev.status === next.status
    && prev.results?.rawUrl === next.results?.rawUrl
    && prev.results?.minUrl === next.results?.minUrl
    && prev.failReason === next.failReason
  ) {
    return prev // nothing observable changed — keep the reference stable
  }
  return next
}
