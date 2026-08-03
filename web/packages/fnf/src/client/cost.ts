import type { GenerationInput } from '../types'
import type { GenerationContext } from './context'
import { observeAsync } from '../observability'
import { buildWireParams, parseSettings } from '../spec'
import { entryFor } from './context'

export interface CostEstimate {
  credits: number
}

export async function estimateCost(ctx: GenerationContext, input: GenerationInput): Promise<CostEstimate> {
  return observeAsync(ctx.observability, 'fnf.job.cost', { model: input.model }, async () => {
    const entry = entryFor(ctx, input.model)
    // Local per-model calculator first (the fnf-web pattern) — instant price for
    // UI previews; the backend is only asked when the model can't price locally.
    // Settings are parsed first so the calculator prices what would actually be
    // submitted (defaults applied, garbage rejected) — same input the backend
    // path prices via buildWireParams.
    if (entry.credits) {
      const local = entry.credits({ ...input, settings: parseSettings(input, entry) })
      if (typeof local === 'number')
        return { credits: local }
    }
    const params = buildWireParams(input, entry)
    const body = (await ctx.adapter.estimateCost({ jobSetType: entry.jobSetType, params }) ?? {}) as {
      credits?: number
      credits_exact?: number
    }
    return { credits: body.credits ?? body.credits_exact ?? 0 }
  }, {
    successAttributes: estimate => ({ credits: estimate.credits }),
  })
}
