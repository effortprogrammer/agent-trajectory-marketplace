import type {
  RealtimeChainCostEstimate,
  RealtimeChainCostInput,
  RealtimeClient,
  RealtimeCustomStyleListQuery,
  RealtimeCustomStyleListResult,
} from '@higgsfield/fnf/realtime'
import type { FnfScopeOptions } from './keys'
import { queryOptions } from '@tanstack/react-query'
import { fnfKeys } from './keys'

export type RealtimeQueryClient = Pick<RealtimeClient, 'estimateChainCost' | 'listCustomStyles'>

export interface RealtimeQueryOptions extends FnfScopeOptions {
  enabled?: boolean
}

/** Cache one explicit realtime chain-cost estimate. */
export function realtimeChainCostQueryOptions(
  client: Pick<RealtimeQueryClient, 'estimateChainCost'>,
  input: RealtimeChainCostInput,
  opts?: RealtimeQueryOptions,
) {
  return queryOptions<RealtimeChainCostEstimate>({
    queryKey: fnfKeys.realtimeChainCost(input, opts),
    queryFn: () => client.estimateChainCost(input),
    enabled: opts?.enabled,
  })
}

/** Cache one cursor page from the authenticated user's saved custom styles. */
export function realtimeCustomStylesQueryOptions(
  client: Pick<RealtimeQueryClient, 'listCustomStyles'>,
  query: RealtimeCustomStyleListQuery = {},
  opts?: RealtimeQueryOptions,
) {
  return queryOptions<RealtimeCustomStyleListResult>({
    queryKey: fnfKeys.realtimeCustomStyles(query, opts),
    queryFn: () => client.listCustomStyles(query),
    enabled: opts?.enabled,
  })
}
