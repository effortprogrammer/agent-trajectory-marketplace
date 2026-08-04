import type { Generation } from '@higgsfield/fnf/client'
import type { LiveQueryOptions } from './generation-query'
import { isTerminalJobStatus } from '@higgsfield/fnf/client'
import { queryOptions } from '@tanstack/react-query'
import { DEFAULT_POLL_INTERVAL_MS } from './generation-query'
import { fnfKeys } from './keys'

/** What the job-set query needs from a client — structural on purpose. */
export interface JobSetQueryClient {
  getSet: (jobSetId: string) => Promise<Generation[]>
}

/**
 * One job set (a batch), live until EVERY member settles — one request per
 * tick for the whole batch (`client.getSet`), the same economy `wait`'s
 * set-aware polling has, expressed as a query. Realtime glue is one line:
 * an event for the set is `queryClient.invalidateQueries({ queryKey:
 * fnfKeys.jobSet(id) })` — TanStack dedupes and cancels racing refetches.
 * Defaults are overridable by spreading over the result.
 */
export function jobSetQueryOptions(client: JobSetQueryClient, jobSetId: string, opts?: LiveQueryOptions) {
  return queryOptions({
    queryKey: fnfKeys.jobSet(jobSetId, opts),
    queryFn: () => client.getSet(jobSetId),
    refetchInterval: (query) => {
      if (opts?.intervalMs === false)
        return false
      const members = query.state.data
      return members !== undefined && members.every(g => isTerminalJobStatus(g.status))
        ? false
        : opts?.intervalMs ?? DEFAULT_POLL_INTERVAL_MS
    },
    refetchIntervalInBackground: true,
    staleTime: (query) => {
      const members = query.state.data
      return members !== undefined && members.every(g => isTerminalJobStatus(g.status)) ? Number.POSITIVE_INFINITY : 0
    },
  })
}
