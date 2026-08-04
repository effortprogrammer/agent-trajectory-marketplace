import type { Reference, ReferenceClient, ReferenceListQuery } from '@higgsfield/fnf/references'
import type { FnfScopeOptions } from './keys'
import { queryOptions } from '@tanstack/react-query'
import { DEFAULT_POLL_INTERVAL_MS } from './generation-query'
import { fnfKeys } from './keys'

export type ReferenceQueryClient = Pick<ReferenceClient, 'get'>
export type ReferencesQueryClient = Pick<ReferenceClient, 'list'>

export interface ReferenceQueryOptions extends FnfScopeOptions {
  intervalMs?: number | false
}

export interface ReferencesQueryOptions extends FnfScopeOptions {
  enabled?: boolean
}

function isTerminal(reference: Reference | undefined): boolean {
  return reference !== undefined && reference.status !== 'processing' && reference.status !== 'ip_checking'
}

export function referenceQueryOptions(
  client: ReferenceQueryClient,
  id: string,
  opts?: ReferenceQueryOptions,
) {
  return queryOptions({
    queryKey: fnfKeys.reference(id, opts),
    queryFn: () => client.get(id),
    refetchInterval: (query) => {
      if (opts?.intervalMs === false)
        return false
      return isTerminal(query.state.data)
        ? false
        : opts?.intervalMs ?? DEFAULT_POLL_INTERVAL_MS
    },
    refetchIntervalInBackground: true,
    staleTime: query => isTerminal(query.state.data) ? Number.POSITIVE_INFINITY : 0,
  })
}

export function referencesQueryOptions(
  client: ReferencesQueryClient,
  query: ReferenceListQuery = {},
  opts?: ReferencesQueryOptions,
) {
  return queryOptions({
    queryKey: fnfKeys.references(query, opts),
    queryFn: () => client.list(query),
    enabled: opts?.enabled,
  })
}
