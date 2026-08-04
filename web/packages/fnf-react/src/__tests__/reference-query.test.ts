import type { Reference } from '@higgsfield/fnf/references'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { referenceQueryOptions, referencesQueryOptions } from '../reference-query'
import { fnfKeys } from '../keys'

function evaluate<T>(fn: unknown, data: T): number | false | undefined {
  return (fn as (query: { state: { data?: T } }) => number | false | undefined)({ state: { data } })
}

const processing: Reference = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Ada',
  category: 'character',
  status: 'processing',
  description: null,
  medias: [],
  videoMedias: [],
}

describe('reference query options', () => {
  it('uses scoped keys and stops polling at a terminal status', async () => {
    const client = { get: vi.fn(async () => processing) }
    const options = referenceQueryOptions(client, processing.id, { scopeKey: 'u:w' })
    const queryClient = new QueryClient()

    await expect(queryClient.fetchQuery(options)).resolves.toEqual(processing)
    expect(queryClient.getQueryData(fnfKeys.reference(processing.id, { scopeKey: 'u:w' }))).toEqual(processing)
    expect(evaluate(options.refetchInterval, processing)).toBe(5000)
    expect(evaluate(options.refetchInterval, { ...processing, status: 'completed' as const })).toBe(false)
  })

  it('caches the authenticated user reference library', async () => {
    const page = { items: [processing] }
    const client = { list: vi.fn(async () => page) }
    const queryClient = new QueryClient()

    await expect(queryClient.fetchQuery(referencesQueryOptions(client, { size: 20 }))).resolves.toEqual(page)
    expect(queryClient.getQueryData(fnfKeys.references({ size: 20 }))).toEqual(page)
  })
})
