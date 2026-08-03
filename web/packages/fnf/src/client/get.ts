import type { JobEntry } from '../define-job'
import type { JobResponse } from '../spec'
import type { Generation } from '../types'
import type { GenerationContext } from './context'
import { ApiJobError } from '../errors'
import { observeAsync } from '../observability'
import { parseGeneration } from '../spec'

export async function getGeneration(ctx: GenerationContext, id: string, fallbackEntry?: JobEntry): Promise<Generation> {
  return observeAsync(ctx.observability, 'fnf.job.get', { generation_id: id }, async () => {
    const body = await ctx.adapter.getJob(id) as JobResponse & { job_set_type?: string }
    const entry = (body.job_set_type ? ctx.registry.get(body.job_set_type) : undefined) ?? fallbackEntry
    if (!entry)
      throw new ApiJobError('unknown_model', `Cannot resolve job type for job ${id}`)
    return parseGeneration(body, entry)
  }, {
    successAttributes: generation => ({ model: generation.model, status: generation.status }),
  })
}
