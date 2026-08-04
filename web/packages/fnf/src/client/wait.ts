import type { Generation } from '../types'
import type { GenerationContext } from './context'
import { ApiJobError } from '../errors'
import { observeAsync, observeEvent } from '../observability'
import { isTerminal } from '../types'
import { pollGeneration, pollJobSetGroup } from './poll'

export interface WaitOptions {
  /**
   * Fires on EVERY poll tick with the freshly fetched generation (including
   * intermediate and unknown statuses), and once for already-terminal inputs.
   */
  onProgress?: (g: Generation) => void
  /**
   * Reject when any generation — including an already-terminal input — lands
   * on a failure status (`failed`/`nsfw`/`ip_detected`); `canceled` resolves.
   */
  throwOnFail?: boolean
  /** Cancels the wait: pollers stop at the next checkpoint with `JobAbortedError`. */
  signal?: AbortSignal
}

/**
 * Poll a batch to terminal statuses. Generations sharing a `jobSetId` are
 * polled as ONE set (when the adapter implements `getJobSet`): one request per
 * tick per set, and set-only gate fields (fnf's `ip_check_finished`) apply.
 * Generations without a set id — or on adapters without `getJobSet` — fall
 * back to per-job polling.
 *
 * On the first rejection (a `throwOnFail` failure, a timeout, the caller's
 * `signal`, or a network error) the remaining pollers are aborted — no
 * orphaned loops keep hitting the backend after the wait itself has thrown.
 */
export async function waitGenerations(ctx: GenerationContext, generations: Generation[], opts?: WaitOptions): Promise<Generation[]> {
  return observeAsync(ctx.observability, 'fnf.job.wait', { generation_count: generations.length }, async () => {
    const controller = new AbortController()
    const onCallerAbort = (): void => controller.abort()
    if (opts?.signal?.aborted)
      controller.abort()
    else opts?.signal?.addEventListener('abort', onCallerAbort, { once: true })

    const settled = new Map<string, Generation>()
    const checkFail = (done: Generation): Generation => {
    // 'canceled' is deliberately exempt: it's a user action, not a failure.
      if (opts?.throwOnFail && (done.status === 'failed' || done.status === 'nsfw' || done.status === 'ip_detected'))
        throw new ApiJobError('job_failed', done.failReason ?? `Job ${done.id} ${done.status}`, { data: { generation: done } })
      return done
    }

    const onProgress = (g: Generation): void => {
      observeEvent(ctx.observability, 'fnf.job.wait.progress', generationAttributes(g))
      opts?.onProgress?.(g)
    }

    // Partition: already-terminal inputs pass through; pending ones group by
    // job set when the adapter can poll sets, else poll individually.
    const canPollSets = typeof ctx.adapter.getJobSet === 'function'
    const setGroups = new Map<string, Generation[]>()
    const singles: Generation[] = []

    try {
      for (const g of generations) {
        if (isTerminal(g.status)) {
          onProgress(g) // already terminal: observed once, never polled
          checkFail(g) // judged the same as a generation that fails one tick later
          continue
        }
        if (canPollSets && g.jobSetId) {
          const group = setGroups.get(g.jobSetId) ?? []
          group.push(g)
          setGroups.set(g.jobSetId, group)
        }
        else {
          singles.push(g)
        }
      }

      await Promise.all([
        ...[...setGroups.entries()].map(async ([jobSetId, members]) => {
          const done = await pollJobSetGroup(ctx, jobSetId, members, {
            signal: controller.signal,
            // Judge members as they land, not when the whole set settles — a
            // failed member must reject the wait (and abort the set poller)
            // while siblings are still running, matching the singles path.
            onProgress: (g) => {
              onProgress(g)
              if (isTerminal(g.status))
                checkFail(g)
            },
          })
          for (const gen of done) settled.set(gen.id, checkFail(gen))
        }),
        ...singles.map(async (g) => {
          const done = await pollGeneration(ctx, g.id, {
            entry: ctx.registry.get(g.model),
            signal: controller.signal,
            onProgress,
          })
          settled.set(done.id, checkFail(done))
        }),
      ])
    }
    catch (err) {
      controller.abort() // stop the surviving pollers
      throw err
    }
    finally {
      opts?.signal?.removeEventListener('abort', onCallerAbort)
    }

    // Input order preserved; already-terminal inputs pass through unchanged.
    return generations.map(g => settled.get(g.id) ?? g)
  }, {
    successAttributes: done => ({ terminal_count: done.filter(g => isTerminal(g.status)).length }),
  })
}

function generationAttributes(g: Generation): Record<string, string | number | boolean | null> {
  return {
    generation_id: g.id,
    model: g.model,
    type: g.type,
    status: g.status,
    ...(g.jobSetId ? { job_set_id: g.jobSetId } : {}),
  }
}
