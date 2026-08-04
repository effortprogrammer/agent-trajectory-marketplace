import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { fnfKeys } from '../keys'
import { realtimeChainCostQueryOptions, realtimeCustomStylesQueryOptions } from '../realtime-query'

describe('realtime query options', () => {
  it('keeps chain-cost caches isolated by user/workspace scope and input', async () => {
    const input = { resolution: '2k' as const, aspectRatio: '16:9' as const }
    const client = {
      estimateChainCost: vi.fn(async () => ({ credits: 1, creditsExact: 0.75 })),
    }
    const queryClient = new QueryClient()

    await expect(queryClient.fetchQuery(realtimeChainCostQueryOptions(client, input, {
      scopeKey: 'u:w',
    }))).resolves.toEqual({ credits: 1, creditsExact: 0.75 })

    expect(fnfKeys.realtimeChainCost(input)).toEqual(['fnf', 'realtime', 'chain-cost', input])
    expect(fnfKeys.realtimeChainCost(input, { scopeKey: 'u:w' })).toEqual([
      'fnf',
      'scope',
      'u:w',
      'realtime',
      'chain-cost',
      input,
    ])
    expect(queryClient.getQueryData(fnfKeys.realtimeChainCost(input, { scopeKey: 'u:w' }))).toEqual({
      credits: 1,
      creditsExact: 0.75,
    })
    expect(queryClient.getQueryData(fnfKeys.realtimeChainCost(input))).toBeUndefined()
  })

  it('caches a custom-style cursor page under its exact query', async () => {
    const page = { items: [], nextCursor: 123.5 }
    const client = { listCustomStyles: vi.fn(async () => page) }
    const query = { cursor: 120, size: 20 }
    const queryClient = new QueryClient()

    await expect(queryClient.fetchQuery(realtimeCustomStylesQueryOptions(client, query))).resolves.toEqual(page)
    expect(client.listCustomStyles).toHaveBeenCalledWith(query)
    expect(queryClient.getQueryData(fnfKeys.realtimeCustomStyles(query))).toEqual(page)
  })
})
