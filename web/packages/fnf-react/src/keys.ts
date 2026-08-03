import type { ListOptions } from '@higgsfield/fnf/client'

/** The feed page query (filters/size) — the cache owns the cursor. */
export type JobsQuery = Omit<ListOptions, 'cursor'>

export interface FnfScopeOptions {
  scopeKey?: string
}

export interface FnfCreditsKeyOptions extends FnfScopeOptions {
  includeOnDemand?: boolean
}

function scoped(scopeKey: string, segment: string): readonly ['fnf', 'scope', string, string] {
  return ['fnf', 'scope', scopeKey, segment] as const
}

/**
 * The package's query-key namespace — a PUBLIC CONTRACT. Apps invalidate and
 * read by these keys, so their shape is versioned deliberately: always build
 * keys through these factories, never inline the literals. Object segments
 * hash order-independently (TanStack's `hashKey` sorts object keys), so two
 * `jobs({ type: 'video', size: 50 })` calls always hit the same entry.
 */
export const fnfKeys = {
  /** Every fnf-owned cache entry — invalidate this to drop them all. */
  root: ['fnf'] as const,
  /** Every fnf-owned cache entry for one user/workspace scope. */
  scope: (scopeKey: string) => ['fnf', 'scope', scopeKey] as const,
  /** One generation by job id (`client.get`). */
  job: (id: string, opts?: FnfScopeOptions) => opts?.scopeKey ? [...scoped(opts.scopeKey, 'job'), id] as const : ['fnf', 'job', id] as const,
  /** All members of one job set (`client.getSet`). */
  jobSet: (jobSetId: string, opts?: FnfScopeOptions) => opts?.scopeKey ? [...scoped(opts.scopeKey, 'job-set'), jobSetId] as const : ['fnf', 'job-set', jobSetId] as const,
  /** Every feed — the `setQueriesData` target `applyGenerations` patches. */
  jobsRoot: ['fnf', 'jobs'] as const,
  /** Every feed inside one user/workspace scope. */
  scopedJobsRoot: (scopeKey: string) => scoped(scopeKey, 'jobs'),
  /** One feed (a page list) for this query. */
  jobs: (query: JobsQuery = {}, opts?: FnfScopeOptions) => opts?.scopeKey ? [...scoped(opts.scopeKey, 'jobs'), query] as const : ['fnf', 'jobs', query] as const,
  cost: (input: unknown, opts?: FnfScopeOptions) => opts?.scopeKey ? [...scoped(opts.scopeKey, 'cost'), input] as const : ['fnf', 'cost', input] as const,
  character: (id: string, opts?: FnfScopeOptions) => opts?.scopeKey ? [...scoped(opts.scopeKey, 'character'), id] as const : ['fnf', 'character', id] as const,
  reference: (id: string, opts?: FnfScopeOptions) => opts?.scopeKey ? [...scoped(opts.scopeKey, 'reference'), id] as const : ['fnf', 'reference', id] as const,
  references: (query: unknown = {}, opts?: FnfScopeOptions) => opts?.scopeKey ? [...scoped(opts.scopeKey, 'references'), query] as const : ['fnf', 'references', query] as const,
  realtimeRoot: ['fnf', 'realtime'] as const,
  realtime: (opts?: FnfScopeOptions) => opts?.scopeKey ? scoped(opts.scopeKey, 'realtime') : ['fnf', 'realtime'] as const,
  realtimeChainCost: (input: unknown, opts?: FnfScopeOptions) => [...fnfKeys.realtime(opts), 'chain-cost', input] as const,
  realtimeCustomStyles: (query: unknown = {}, opts?: FnfScopeOptions) => [...fnfKeys.realtime(opts), 'custom-styles', query] as const,
  profileRoot: ['fnf', 'profile'] as const,
  profile: (opts?: FnfScopeOptions) => opts?.scopeKey ? scoped(opts.scopeKey, 'profile') : ['fnf', 'profile'] as const,
  profileSnapshot: (opts?: FnfCreditsKeyOptions) => opts?.includeOnDemand === undefined
    ? [...fnfKeys.profile(opts), 'snapshot'] as const
    : [...fnfKeys.profile(opts), 'snapshot', { includeOnDemand: opts.includeOnDemand }] as const,
  profileUser: (opts?: FnfScopeOptions) => [...fnfKeys.profile(opts), 'user'] as const,
  profileWorkspaces: (opts?: FnfScopeOptions) => [...fnfKeys.profile(opts), 'workspaces'] as const,
  profileCurrentWorkspace: (opts?: FnfScopeOptions) => [...fnfKeys.profile(opts), 'current-workspace'] as const,
  profileWallet: (opts?: FnfScopeOptions) => [...fnfKeys.profile(opts), 'wallet'] as const,
  profileCredits: (opts?: FnfCreditsKeyOptions) => opts?.includeOnDemand === undefined
    ? [...fnfKeys.profile(opts), 'credits'] as const
    : [...fnfKeys.profile(opts), 'credits', { includeOnDemand: opts.includeOnDemand }] as const,
}
