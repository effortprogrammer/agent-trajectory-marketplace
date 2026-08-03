import type { JobResponse } from '../spec'
import type { Generation } from '../types'
import type { GenerationContext } from './context'
import { ApiJobError } from '../errors'
import { observeAsync } from '../observability'
import { parseGeneration } from '../spec'

/**
 * Fetch ALL jobs of one job set in a single request — the one-shot read
 * counterpart of `pollJobSetGroup`'s tick (same adapter route, same gate
 * semantics, no loop). For callers that schedule reads themselves — a query
 * cache's `refetchInterval`, a realtime-triggered re-read — instead of
 * holding the SDK's poll loop open.
 *
 * Requires an adapter with `getJobSet`; throws the typed `not_supported`
 * otherwise (same contract as `pollJobSetGroup`).
 */
export async function getJobSetGenerations(ctx: GenerationContext, jobSetId: string): Promise<Generation[]> {
  return observeAsync(ctx.observability, 'fnf.job.get_set', { job_set_id: jobSetId }, async () => {
    const getJobSet = ctx.adapter.getJobSet
    if (!getJobSet)
      throw new ApiJobError('not_supported', 'getSet requires an adapter with getJobSet')
    const body = await getJobSet(jobSetId) as (JobResponse & { job_set_type?: string })[]
    return (Array.isArray(body) ? body : []).map((job) => {
      const entry = job.job_set_type ? ctx.registry.get(job.job_set_type) : undefined
      // Fail fast like the singles path (`getGeneration`): an unresolvable type
      // is a local configuration error.
      if (!entry)
        throw new ApiJobError('unknown_model', `Cannot resolve job type for job ${job.id} in set ${jobSetId}: '${job.job_set_type ?? 'unknown'}' is not registered`)
      return parseGeneration(job, entry)
    })
  }, {
    successAttributes: generations => ({ generation_count: generations.length }),
  })
}
