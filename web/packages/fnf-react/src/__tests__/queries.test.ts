import type { Generation, ListOptions, ListResult } from '@higgsfield/fnf/client'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { generationQueryOptions } from '../generation-query'
import { jobSetQueryOptions } from '../job-set-query'
import { flattenFeedPages, jobsFeedQueryOptions } from '../jobs-feed-query'
import { fnfKeys } from '../keys'

function gen(id: string, status: Generation['status'], extra?: Partial<Generation>): Generation {
  return { id, model: 'demo', type: 'image', status, input: { model: 'demo', settings: {} }, ...extra }
}

/** Evaluate a refetchInterval/staleTime function the way the query core does. */
function evalWith<T>(fn: unknown, data: T): number | false | undefined {
  return (fn as (query: { state: { data?: T } }) => number | false | undefined)({ state: { data } })
}

describe('generationQueryOptions', () => {
  it('keeps old unscoped key shapes and adds scoped variants additively', () => {
    expect(fnfKeys.job('g1')).toEqual(['fnf', 'job', 'g1'])
    expect(fnfKeys.jobSet('set-1')).toEqual(['fnf', 'job-set', 'set-1'])
    expect(fnfKeys.jobs({ type: 'video' })).toEqual(['fnf', 'jobs', { type: 'video' }])
    expect(fnfKeys.job('g1', { scopeKey: 'u:w' })).toEqual(['fnf', 'scope', 'u:w', 'job', 'g1'])
    expect(fnfKeys.jobSet('set-1', { scopeKey: 'u:w' })).toEqual(['fnf', 'scope', 'u:w', 'job-set', 'set-1'])
    expect(fnfKeys.jobs({ type: 'video' }, { scopeKey: 'u:w' })).toEqual(['fnf', 'scope', 'u:w', 'jobs', { type: 'video' }])
  })

  it('fetches through the client into the contract key', async () => {
    const qc = new QueryClient()
    const data = await qc.fetchQuery(generationQueryOptions({ get: async id => gen(id, 'completed') }, 'g1'))
    expect(data.id).toBe('g1')
    expect(qc.getQueryData(fnfKeys.job('g1'))).toBe(data)
  })

  it('polls at the 5s product cadence while pending, stops at terminal', () => {
    const opts = generationQueryOptions({ get: async id => gen(id, 'queued') }, 'g1')
    expect(evalWith(opts.refetchInterval, undefined)).toBe(5000) // nothing known yet — keep asking
    expect(evalWith(opts.refetchInterval, gen('g1', 'in_progress'))).toBe(5000)
    expect(evalWith(opts.refetchInterval, gen('g1', 'completed'))).toBe(false)
    expect(evalWith(opts.staleTime, gen('g1', 'completed'))).toBe(Number.POSITIVE_INFINITY) // settled = immutable
    expect(evalWith(opts.staleTime, gen('g1', 'queued'))).toBe(0)
  })

  it('the cadence is a default, not a law: intervalMs overrides, false disables', () => {
    const client = { get: async (id: string) => gen(id, 'queued') }
    const custom = generationQueryOptions(client, 'g1', { intervalMs: 1000 })
    expect(evalWith(custom.refetchInterval, gen('g1', 'queued'))).toBe(1000)
    expect(evalWith(custom.refetchInterval, gen('g1', 'completed'))).toBe(false) // stop-at-terminal survives the override
    const off = generationQueryOptions(client, 'g1', { intervalMs: false })
    expect(evalWith(off.refetchInterval, gen('g1', 'queued'))).toBe(false)
  })

  it('uses scoped keys when provided', async () => {
    const qc = new QueryClient()
    const data = await qc.fetchQuery(generationQueryOptions({ get: async id => gen(id, 'completed') }, 'g1', { scopeKey: 'u:w' }))
    expect(qc.getQueryData(fnfKeys.job('g1'))).toBeUndefined()
    expect(qc.getQueryData(fnfKeys.job('g1', { scopeKey: 'u:w' }))).toBe(data)
  })
})

describe('jobSetQueryOptions', () => {
  it('one request per tick for the whole batch; stops when EVERY member settles', async () => {
    let reads = 0
    const client = {
      getSet: async (jobSetId: string) => {
        reads++
        return [gen('a', 'completed', { jobSetId }), gen('b', 'in_progress', { jobSetId })]
      },
    }
    const qc = new QueryClient()
    const opts = jobSetQueryOptions(client, 'set-1')
    const members = await qc.fetchQuery(opts)

    expect(reads).toBe(1)
    expect(members.map(g => g.id)).toEqual(['a', 'b'])
    expect(evalWith(opts.refetchInterval, members)).toBe(5000) // b is still running
    expect(evalWith(opts.refetchInterval, [gen('a', 'completed'), gen('b', 'failed')])).toBe(false)
  })
})

describe('jobsFeedQueryOptions', () => {
  function listClient(pages: Record<string, ListResult>) {
    const calls: Array<ListOptions | undefined> = []
    return {
      calls,
      list: async (opts?: ListOptions) => {
        calls.push(opts)
        return pages[String(opts?.cursor)]
      },
    }
  }

  it('walks the cursor: the query is the identity, the cursor is the page param (verbatim to list)', async () => {
    const client = listClient({
      undefined: { items: [gen('a', 'completed')], cursor: 'c1' },
      c1: { items: [gen('b', 'completed')] },
    })
    const qc = new QueryClient()
    const data = await qc.fetchInfiniteQuery({ ...jobsFeedQueryOptions(client, { type: 'video', size: 2 }), pages: 2 })

    expect(client.calls[0]).toEqual({ type: 'video', size: 2 })
    expect(client.calls[1]).toEqual({ type: 'video', size: 2, cursor: 'c1' })
    expect(data.pages.map(p => p.items[0].id)).toEqual(['a', 'b'])
    expect(qc.getQueryData(fnfKeys.jobs({ type: 'video', size: 2 }))).toBe(data)
  })

  it('the last page (no cursor) ends the walk', async () => {
    const client = listClient({ undefined: { items: [gen('a', 'completed')] } })
    const qc = new QueryClient()
    const data = await qc.fetchInfiniteQuery({ ...jobsFeedQueryOptions(client), pages: 5 })
    expect(data.pages).toHaveLength(1) // no next cursor — stop, whatever `pages` asked
  })

  it('keeps scoped feeds separate from unscoped feeds', async () => {
    const client = listClient({ undefined: { items: [gen('a', 'completed')] } })
    const qc = new QueryClient()
    const data = await qc.fetchInfiniteQuery({ ...jobsFeedQueryOptions(client, { type: 'image' }, { scopeKey: 'u:w' }), pages: 1 })

    expect(qc.getQueryData(fnfKeys.jobs({ type: 'image' }))).toBeUndefined()
    expect(qc.getQueryData(fnfKeys.jobs({ type: 'image' }, { scopeKey: 'u:w' }))).toBe(data)
  })
})

describe('flattenFeedPages', () => {
  it('deduplicates across pages: FIRST position, LATEST-fetched value', () => {
    const flat = flattenFeedPages({
      pages: [
        { items: [gen('a', 'queued'), gen('b', 'completed')] },
        { items: [gen('a', 'completed'), gen('c', 'completed')] }, // 'a' slid onto page 2, fetched later
      ],
      pageParams: [undefined, 'c1'],
    })
    expect(flat.map(g => g.id)).toEqual(['a', 'b', 'c']) // position from the first sighting
    expect(flat[0].status).toBe('completed') // value from the latest fetch
  })
})
