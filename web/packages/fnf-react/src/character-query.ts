import type { Character, CharacterClient } from '@higgsfield/fnf/characters'
import type { FnfScopeOptions } from './keys'
import { queryOptions } from '@tanstack/react-query'
import { DEFAULT_POLL_INTERVAL_MS } from './generation-query'
import { fnfKeys } from './keys'

export type CharacterQueryClient = Pick<CharacterClient, 'get'>

export interface CharacterQueryOptions extends FnfScopeOptions {
  intervalMs?: number | false
}

function isTerminal(character: Character | undefined): boolean {
  return character?.status === 'completed' || character?.status === 'failed'
}

export function characterQueryOptions(
  client: CharacterQueryClient,
  id: string,
  opts?: CharacterQueryOptions,
) {
  return queryOptions({
    queryKey: fnfKeys.character(id, opts),
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
