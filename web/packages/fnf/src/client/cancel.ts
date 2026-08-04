import type { GenerationContext } from './context'
import { ApiJobError } from '../errors'
import { observeAsync } from '../observability'

/**
 * Cancel a running job SERVER-SIDE. This is the counterpart to the client-side
 * `signal` on poll/wait: aborting only stops polling — the backend job keeps
 * running (and burning credits) until cancelled here.
 *
 * Requires the adapter to implement the optional `cancelJob` port method;
 * otherwise throws the typed `cancel_not_supported` error.
 */
export async function cancelGeneration(ctx: GenerationContext, id: string): Promise<void> {
  return observeAsync(ctx.observability, 'fnf.job.cancel', { generation_id: id }, async () => {
    if (!ctx.adapter.cancelJob)
      throw new ApiJobError('cancel_not_supported', 'This backend adapter does not support job cancellation')
    await ctx.adapter.cancelJob(id)
  })
}
