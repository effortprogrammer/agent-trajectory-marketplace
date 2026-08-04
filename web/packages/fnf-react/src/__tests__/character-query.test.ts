import type { Character } from '@higgsfield/fnf/characters'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { characterQueryOptions } from '../character-query'
import { fnfKeys } from '../keys'

function evaluate<T>(fn: unknown, data: T): number | false | undefined {
  return (fn as (query: { state: { data?: T } }) => number | false | undefined)({ state: { data } })
}

const queued: Character = {
  id: '11111111-1111-4111-8111-111111111111',
  type: 'soul_2',
  status: 'queued',
}

describe('character query options', () => {
  it('uses a scoped key and stops polling when character training settles', async () => {
    const client = { get: vi.fn(async () => queued) }
    const options = characterQueryOptions(client, queued.id, { scopeKey: 'u:w' })
    const queryClient = new QueryClient()

    await expect(queryClient.fetchQuery(options)).resolves.toEqual(queued)
    expect(queryClient.getQueryData(fnfKeys.character(queued.id, { scopeKey: 'u:w' }))).toEqual(queued)
    expect(queryClient.getQueryData(fnfKeys.character(queued.id))).toBeUndefined()
    expect(evaluate(options.refetchInterval, queued)).toBe(5000)
    expect(evaluate(options.refetchInterval, { ...queued, status: 'completed' as const })).toBe(false)
    expect(evaluate(options.refetchInterval, { ...queued, status: 'failed' as const })).toBe(false)
  })
})
