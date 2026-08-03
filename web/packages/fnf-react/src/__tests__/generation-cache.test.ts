import type { Generation, ListResult } from '@higgsfield/fnf/client'
import type { InfiniteData } from '@tanstack/react-query'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { applyGenerations, prependGenerations, removeGenerationQueries } from '../generation-cache'
import { fnfKeys } from '../keys'

function gen(id: string, status: Generation['status'], extra?: Partial<Generation>): Generation {
  return { id, model: 'demo', type: 'image', status, input: { model: 'demo', settings: {} }, ...extra }
}

function feedData(pages: Generation[][]): InfiniteData<ListResult> {
  return {
    pages: pages.map((items, at) => ({ items, ...(at < pages.length - 1 ? { cursor: at } : {}) })),
    pageParams: pages.map((_p, at) => (at === 0 ? undefined : at - 1)),
  }
}

describe('applyGenerations — the single write door', () => {
  it('folds one snapshot into EVERY cache entry that holds it: job, job set, all feeds', () => {
    const qc = new QueryClient()
    qc.setQueryData(fnfKeys.job('a'), gen('a', 'queued'))
    qc.setQueryData(fnfKeys.jobSet('set-1'), [gen('a', 'queued', { jobSetId: 'set-1' }), gen('b', 'queued', { jobSetId: 'set-1' })])
    qc.setQueryData(fnfKeys.jobs({ type: 'image' }), feedData([[gen('a', 'queued')]]))
    qc.setQueryData(fnfKeys.jobs({}), feedData([[gen('z', 'completed'), gen('a', 'queued')]]))

    const fresh = gen('a', 'completed', { jobSetId: 'set-1', results: { rawUrl: 'https://x/a.png' } })
    applyGenerations(qc, [fresh])

    expect(qc.getQueryData<Generation>(fnfKeys.job('a'))?.status).toBe('completed')
    expect(qc.getQueryData<Generation[]>(fnfKeys.jobSet('set-1'))?.map(g => g.status)).toEqual(['completed', 'queued'])
    expect(qc.getQueryData<InfiniteData<ListResult>>(fnfKeys.jobs({ type: 'image' }))?.pages[0].items[0].status).toBe('completed')
    expect(qc.getQueryData<InfiniteData<ListResult>>(fnfKeys.jobs({}))?.pages[0].items[1].status).toBe('completed')
  })

  it('updates, never seeds: ids nothing holds are ignored, absent keys are not created', () => {
    const qc = new QueryClient()
    qc.setQueryData(fnfKeys.jobs({}), feedData([[gen('a', 'queued')]]))

    applyGenerations(qc, [gen('stranger', 'completed', { jobSetId: 'set-9' })])

    expect(qc.getQueryData(fnfKeys.job('stranger'))).toBeUndefined()
    expect(qc.getQueryData(fnfKeys.jobSet('set-9'))).toBeUndefined()
    expect(qc.getQueryData<InfiniteData<ListResult>>(fnfKeys.jobs({}))?.pages[0].items.map(g => g.id)).toEqual(['a'])
  })

  it('the terminal anti-regress holds at the door: a stale tick cannot roll back a feed tile', () => {
    const qc = new QueryClient()
    qc.setQueryData(fnfKeys.jobs({}), feedData([[gen('a', 'completed', { results: { rawUrl: 'https://x/a.png' } })]]))

    applyGenerations(qc, [gen('a', 'in_progress')])

    expect(qc.getQueryData<InfiniteData<ListResult>>(fnfKeys.jobs({}))?.pages[0].items[0].status).toBe('completed')
  })

  it('a write that changes nothing bails out — references stay stable for memoization', () => {
    const qc = new QueryClient()
    qc.setQueryData(fnfKeys.jobs({}), feedData([[gen('a', 'in_progress')]]))
    const before = qc.getQueryData<InfiniteData<ListResult>>(fnfKeys.jobs({}))

    applyGenerations(qc, [gen('a', 'in_progress')]) // a tick with no observable change

    expect(qc.getQueryData<InfiniteData<ListResult>>(fnfKeys.jobs({}))).toBe(before)
  })

  it('updates only the named scope when scoped', () => {
    const qc = new QueryClient()
    qc.setQueryData(fnfKeys.job('a'), gen('a', 'queued'))
    qc.setQueryData(fnfKeys.job('a', { scopeKey: 'u:w' }), gen('a', 'queued'))
    qc.setQueryData(fnfKeys.jobs({}, { scopeKey: 'u:w' }), feedData([[gen('a', 'queued')]]))

    applyGenerations(qc, [gen('a', 'completed', { results: { rawUrl: 'https://x/a.png' } })], { scopeKey: 'u:w' })

    expect(qc.getQueryData<Generation>(fnfKeys.job('a'))?.status).toBe('queued')
    expect(qc.getQueryData<Generation>(fnfKeys.job('a', { scopeKey: 'u:w' }))?.status).toBe('completed')
    expect(qc.getQueryData<InfiniteData<ListResult>>(fnfKeys.jobs({}, { scopeKey: 'u:w' }))?.pages[0].items[0].status).toBe('completed')
  })

  it('removes generation queries for one scope without touching profile or other scopes', () => {
    const qc = new QueryClient()
    qc.setQueryData(fnfKeys.job('a', { scopeKey: 'old' }), gen('a', 'queued'))
    qc.setQueryData(fnfKeys.jobs({}, { scopeKey: 'old' }), feedData([[gen('a', 'queued')]]))
    qc.setQueryData(fnfKeys.job('b', { scopeKey: 'new' }), gen('b', 'queued'))
    qc.setQueryData(fnfKeys.profileSnapshot({ scopeKey: 'old' }), { user: null, workspaces: [], currentWorkspace: null, wallet: null, credits: null })

    removeGenerationQueries(qc, { scopeKey: 'old' })

    expect(qc.getQueryData(fnfKeys.job('a', { scopeKey: 'old' }))).toBeUndefined()
    expect(qc.getQueryData(fnfKeys.jobs({}, { scopeKey: 'old' }))).toBeUndefined()
    expect(qc.getQueryData(fnfKeys.job('b', { scopeKey: 'new' }))).toBeDefined()
    expect(qc.getQueryData(fnfKeys.profileSnapshot({ scopeKey: 'old' }))).toBeDefined()
  })
})

describe('prependGenerations — explicit optimistic insert', () => {
  it('inserts fresh submits at the head of the named feed, deduplicated', () => {
    const qc = new QueryClient()
    qc.setQueryData(fnfKeys.jobs({ type: 'video' }), feedData([[gen('old', 'completed')]]))

    prependGenerations(qc, { type: 'video' }, [gen('new', 'queued'), gen('old', 'completed')])

    const items = qc.getQueryData<InfiniteData<ListResult>>(fnfKeys.jobs({ type: 'video' }))?.pages[0].items
    expect(items?.map(g => g.id)).toEqual(['new', 'old'])
  })

  it('a feed that was never fetched is left alone — its first fetch includes the new jobs anyway', () => {
    const qc = new QueryClient()

    prependGenerations(qc, { type: 'video' }, [gen('new', 'queued')])

    expect(qc.getQueryData(fnfKeys.jobs({ type: 'video' }))).toBeUndefined()
  })

  it('targets ONLY the named feed — fan-out across feeds is the app\'s explicit policy', () => {
    const qc = new QueryClient()
    qc.setQueryData(fnfKeys.jobs({ type: 'video' }), feedData([[]]))
    qc.setQueryData(fnfKeys.jobs({}), feedData([[]]))

    prependGenerations(qc, { type: 'video' }, [gen('new', 'queued')])

    expect(qc.getQueryData<InfiniteData<ListResult>>(fnfKeys.jobs({ type: 'video' }))?.pages[0].items).toHaveLength(1)
    expect(qc.getQueryData<InfiniteData<ListResult>>(fnfKeys.jobs({}))?.pages[0].items).toHaveLength(0)
  })

  it('can optimistically insert into a scoped feed', () => {
    const qc = new QueryClient()
    qc.setQueryData(fnfKeys.jobs({ type: 'video' }, { scopeKey: 'u:w' }), feedData([[]]))

    prependGenerations(qc, { type: 'video' }, [gen('new', 'queued')], { scopeKey: 'u:w' })

    expect(qc.getQueryData<InfiniteData<ListResult>>(fnfKeys.jobs({ type: 'video' }, { scopeKey: 'u:w' }))?.pages[0].items).toHaveLength(1)
    expect(qc.getQueryData(fnfKeys.jobs({ type: 'video' }))).toBeUndefined()
  })
})
