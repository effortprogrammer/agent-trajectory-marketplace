'use client'

import type { FnfObservabilityOptions } from '@higgsfield/fnf/observability'
import type { GenerationRunClient } from './generation-run'
import type { FnfScopeOptions } from './keys'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useStore } from './external-store-hook'
import { applyGenerations } from './generation-cache'
import { GenerationRun } from './generation-run'
import { useOptionalFnfObservability } from './provider'

export type GenerationRunHookOptions = FnfScopeOptions & {
  observability?: FnfObservabilityOptions
}

/**
 * A submit-to-terminal lifecycle bound to the component (requires a
 * `QueryClientProvider` above). Every run commit folds the live snapshots
 * into the shared query cache through `applyGenerations` — pending tiles
 * tick in any feed/job-set view that holds them, no extra wiring. Which feed
 * should SHOW a fresh submit stays your explicit call: `prependGenerations`.
 * Polling is aborted on unmount (the backend job keeps running — cancel
 * server-side via `client.cancel` if that's the intent).
 *
 * `client` must be referentially stable (module scope / context / useState) —
 * the controller binds to the first one; an inline-created client would be
 * silently ignored after mount.
 *
 *   const run = useGenerationRun(client, { scopeKey })
 *   useEffect(() => { // optimistic tiles: the submit landed, polling begins
 *     if (run.status === 'generating')
 *       prependGenerations(queryClient, { type: 'video' }, run.generations, { scopeKey })
 *   }, [run.status])
 *   <button onClick={() => run.start(input)} disabled={run.isRunning}>
 *   {run.error && <ErrorNote code={run.error.code} />}
 */
export function useGenerationRun<Input>(client: GenerationRunClient<Input>, opts?: GenerationRunHookOptions): GenerationRun<Input> {
  const providerObservability = useOptionalFnfObservability()
  const observability = opts?.observability ?? providerObservability
  // useState, not useMemo: a controller holds state, and useMemo is a cache
  // React may discard — recreation would silently wipe the run.
  const [run] = useState(() => new GenerationRun(client, { observability }))
  const queryClient = useQueryClient()
  useEffect(() => {
    const unsubscribe = run.subscribe(() => applyGenerations(queryClient, run.generations, opts))
    return () => {
      unsubscribe()
      run.abort()
    }
  }, [run, queryClient, opts?.scopeKey])
  return useStore(run)
}
