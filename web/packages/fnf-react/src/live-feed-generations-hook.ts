'use client'

import type { Generation } from '@higgsfield/fnf/client'
import type { GenerationQueryClient, LiveQueryOptions } from './generation-query'
import { isTerminalJobStatus } from '@higgsfield/fnf/client'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { applyGenerations } from './generation-cache'
import { foldGeneration } from './generation-fold'
import { generationQueryOptions } from './generation-query'

// Restored history can contain many stale non-terminal jobs. Keep observer,
// timer, and request fan-out bounded while still draining targets in feed order.
const MAX_LIVE_FEED_POLL_TARGETS = 20

/**
 * Keep non-terminal generations restored from a feed moving after remount or
 * refresh. Up to 20 unique ids at a time get the normal generation query
 * (seeded from the feed snapshot), and fresh reads re-enter every feed cache
 * through the shared cache door. Feed order is preserved, so later pending
 * items enter as earlier ones settle. Terminal items never allocate observers.
 */
export function useLiveFeedGenerations(
  client: GenerationQueryClient,
  generations: readonly Generation[],
  opts?: LiveQueryOptions,
): void {
  const queryClient = useQueryClient()
  const targets = useMemo(() => liveFeedPollTargets(generations), [generations])
  const snapshots = useQueries({
    queries: targets.map(generation => ({
      ...generationQueryOptions(client, generation.id, opts),
      initialData: generation,
    })),
    combine: combineSnapshots,
  })

  useEffect(() => {
    applyGenerations(
      queryClient,
      snapshots,
      opts?.scopeKey ? { scopeKey: opts.scopeKey } : undefined,
    )
  }, [queryClient, snapshots, opts?.scopeKey])
}

/** Exported from this module for focused tests; the package barrel exposes the hook only. */
export function liveFeedPollTargets(generations: readonly Generation[]): Generation[] {
  const unique = new Map<string, Generation>()
  for (const generation of generations)
    unique.set(generation.id, foldGeneration(unique.get(generation.id), generation))

  const targets: Generation[] = []
  for (const generation of unique.values()) {
    if (isTerminalJobStatus(generation.status))
      continue
    targets.push(generation)
    if (targets.length === MAX_LIVE_FEED_POLL_TARGETS)
      break
  }
  return targets
}

function combineSnapshots(results: Array<{ data?: Generation }>): Generation[] {
  return results.flatMap(result => result.data ? [result.data] : [])
}
