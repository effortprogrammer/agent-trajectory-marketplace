import type { Generation, ListResult } from '@higgsfield/fnf/client'
import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import type { FnfScopeOptions, JobsQuery } from './keys'
import { foldGeneration } from './generation-fold'
import { fnfKeys } from './keys'

/**
 * The single write door over the QueryClient: fold fresh generation snapshots
 * into EVERY fnf-owned cache entry that holds them — per-job entries, job-set
 * entries, and all feed page lists — in one call. Poll ticks, realtime
 * re-reads and run progress all enter here, so no source can race another
 * past `foldGeneration`'s guards.
 *
 * The door UPDATES, it never seeds: ids no cache holds are ignored (feed
 * membership belongs to fetches and `prependGenerations`), and absent keys
 * are not created. Writes that change nothing bail out, keeping every
 * untouched reference stable.
 *
 * This is the lesson of fnf-web's `AssetCache` made structural: TanStack is a
 * non-normalizing document cache, so one entity lives as copies under many
 * keys — the difference is that here ALL the keys belong to the package and
 * all the surgery lives behind one tested function.
 */
export function applyGenerations(queryClient: QueryClient, generations: Generation[], opts?: FnfScopeOptions): void {
  if (generations.length === 0)
    return
  const byId = new Map(generations.map(g => [g.id, g]))

  for (const g of generations) {
    if (queryClient.getQueryState(fnfKeys.job(g.id, opts))) {
      queryClient.setQueryData<Generation>(fnfKeys.job(g.id, opts), (prev) => {
        const folded = foldGeneration(prev, g)
        return folded === prev ? undefined : folded // undefined bails out — no write, stable reference
      })
    }
    if (g.jobSetId !== undefined && queryClient.getQueryState(fnfKeys.jobSet(g.jobSetId, opts))) {
      queryClient.setQueryData<Generation[]>(fnfKeys.jobSet(g.jobSetId, opts), (prev) => {
        if (!prev)
          return undefined
        let changed = false
        const next = prev.map((member) => {
          const fresh = byId.get(member.id)
          if (!fresh)
            return member
          const folded = foldGeneration(member, fresh)
          if (folded !== member)
            changed = true
          return folded
        })
        return changed ? next : undefined
      })
    }
  }

  queryClient.setQueriesData<InfiniteData<ListResult>>({ queryKey: jobsRootKey(opts) }, (prev) => {
    if (!prev)
      return undefined
    let changed = false
    const pages = prev.pages.map((page) => {
      let pageChanged = false
      const items = page.items.map((item) => {
        const fresh = byId.get(item.id)
        if (!fresh)
          return item
        const folded = foldGeneration(item, fresh)
        if (folded !== item)
          pageChanged = true
        return folded
      })
      if (!pageChanged)
        return page
      changed = true
      return { ...page, items }
    })
    return changed ? { ...prev, pages } : undefined
  })
}

/**
 * Optimistic head insert after a submit — into the ONE feed the caller names.
 * Which feeds should show a fresh submit is product policy, so the fan-out
 * stays an explicit app decision (call it once per feed); ids the feed
 * already holds are skipped. A feed that was never fetched is left alone —
 * its first fetch will include the new jobs anyway.
 */
export function prependGenerations(queryClient: QueryClient, query: JobsQuery, generations: Generation[], opts?: FnfScopeOptions): void {
  queryClient.setQueryData<InfiniteData<ListResult>>(fnfKeys.jobs(query, opts), (prev) => {
    if (!prev || prev.pages.length === 0)
      return undefined
    const seen = new Set(prev.pages.flatMap(page => page.items.map(item => item.id)))
    const fresh = generations.filter(g => !seen.has(g.id))
    if (fresh.length === 0)
      return undefined
    const [head, ...rest] = prev.pages
    return { ...prev, pages: [{ ...head, items: [...fresh, ...head.items] }, ...rest] }
  })
}

export function removeGenerationQueries(queryClient: QueryClient, opts?: FnfScopeOptions): void {
  if (opts?.scopeKey) {
    queryClient.removeQueries({ queryKey: [...fnfKeys.scope(opts.scopeKey), 'job'] })
    queryClient.removeQueries({ queryKey: [...fnfKeys.scope(opts.scopeKey), 'job-set'] })
    queryClient.removeQueries({ queryKey: fnfKeys.scopedJobsRoot(opts.scopeKey) })
    queryClient.removeQueries({ queryKey: [...fnfKeys.scope(opts.scopeKey), 'cost'] })
    return
  }
  queryClient.removeQueries({ queryKey: ['fnf', 'job'] })
  queryClient.removeQueries({ queryKey: ['fnf', 'job-set'] })
  queryClient.removeQueries({ queryKey: fnfKeys.jobsRoot })
  queryClient.removeQueries({ queryKey: ['fnf', 'cost'] })
}

function jobsRootKey(opts?: FnfScopeOptions) {
  return opts?.scopeKey ? fnfKeys.scopedJobsRoot(opts.scopeKey) : fnfKeys.jobsRoot
}
