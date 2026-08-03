import type { Generation, ListOptions, ListResult } from '@higgsfield/fnf/client'
import type { InfiniteData } from '@tanstack/react-query'
import type { FnfScopeOptions, JobsQuery } from './keys'
import { infiniteQueryOptions } from '@tanstack/react-query'
import { fnfKeys } from './keys'

/** What the feed query needs from a client — structural on purpose. */
export interface JobsFeedQueryClient {
  list: (opts?: ListOptions) => Promise<ListResult>
}

/**
 * A cursor feed as an infinite query. The `query` (filters/size, forwarded to
 * `client.list` VERBATIM) is the cache identity; the cursor is the page param.
 *
 * The feed is door-driven, so pages are fresh forever by default
 * (`staleTime: Infinity`): live updates fold in through `applyGenerations`,
 * fresh submits enter through `prependGenerations`, and the explicit hard
 * refresh is `queryClient.invalidateQueries({ queryKey: fnfKeys.jobs(query) })`.
 * Mount/focus refetches would race those writes — spread your own `staleTime`
 * over the result if you want them back.
 *
 *   const feed = useInfiniteQuery({
 *     ...jobsFeedQueryOptions(client, { type: 'video' }),
 *     select: flattenFeedPages,
 *   })
 *   feed.data?.map(g => <Tile key={g.id} generation={g} />)
 */
export function jobsFeedQueryOptions(client: JobsFeedQueryClient, query: JobsQuery = {}, opts?: FnfScopeOptions) {
  return infiniteQueryOptions({
    queryKey: fnfKeys.jobs(query, opts),
    queryFn: ({ pageParam }) => client.list({ ...query, ...(pageParam !== undefined ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | number | undefined,
    getNextPageParam: lastPage => lastPage.cursor ?? undefined,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/**
 * Pages → one deduplicated list (a `select` for the feed query). An id seen
 * on several pages keeps its FIRST position (head order — where the user
 * already saw it) with the LATEST-fetched value — the fnf-web `MapPool`
 * semantics.
 */
export function flattenFeedPages(data: InfiniteData<ListResult>): Generation[] {
  const seen = new Map<string, Generation>()
  for (const page of data.pages) {
    for (const item of page.items) seen.set(item.id, item)
  }
  return [...seen.values()]
}
