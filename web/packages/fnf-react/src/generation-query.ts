import type { Generation } from '@higgsfield/fnf/client'
import type { FnfScopeOptions } from './keys'
import { isTerminalJobStatus } from '@higgsfield/fnf/client'
import { queryOptions } from '@tanstack/react-query'
import { fnfKeys } from './keys'

/** What the generation query needs from a client — structural on purpose. */
export interface GenerationQueryClient {
  get: (id: string) => Promise<Generation>
}

/**
 * The product's job-polling cadence (fnf-web `use-job-status-polling`:
 * react-query `refetchInterval: 5000`, in background too).
 */
export const DEFAULT_POLL_INTERVAL_MS = 5000

export interface LiveQueryOptions extends FnfScopeOptions {
  /**
   * Poll cadence while non-terminal (default `DEFAULT_POLL_INTERVAL_MS`);
   * `false` turns polling off without losing the stop-at-terminal rule for
   * anything you keep. For full control, spread your own `refetchInterval`
   * over the returned options instead.
   */
  intervalMs?: number | false
}

/**
 * One generation, live until it settles: polls at `intervalMs` while the
 * status is non-terminal (in background too — uploads/long videos outlive a
 * focused tab), then stops and becomes immutable (`staleTime: Infinity` once
 * terminal). Every default is overridable by spreading over the result:
 *
 *   useQuery(generationQueryOptions(client, id))
 *   useSuspenseQuery({ ...generationQueryOptions(client, id), refetchInterval: false })
 */
export function generationQueryOptions(client: GenerationQueryClient, id: string, opts?: LiveQueryOptions) {
  return queryOptions({
    queryKey: fnfKeys.job(id, opts),
    queryFn: () => client.get(id),
    refetchInterval: (query) => {
      if (opts?.intervalMs === false)
        return false
      const generation = query.state.data
      return generation !== undefined && isTerminalJobStatus(generation.status)
        ? false
        : opts?.intervalMs ?? DEFAULT_POLL_INTERVAL_MS
    },
    refetchIntervalInBackground: true,
    staleTime: (query) => {
      const generation = query.state.data
      return generation !== undefined && isTerminalJobStatus(generation.status) ? Number.POSITIVE_INFINITY : 0
    },
  })
}
