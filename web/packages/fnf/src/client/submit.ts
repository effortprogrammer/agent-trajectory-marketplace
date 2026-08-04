import type { JobEntry } from '../define-job'
import type { ApiJobErrorJSON } from '../errors'
import type { JobResponse } from '../spec'
import type { Generation, GenerationInput } from '../types'
import type { GenerationContext } from './context'
import { ApiJobError, ConfirmationRejectedError, UnknownSubmitResponseError, ValidationError } from '../errors'
import { observeAsync } from '../observability'
import { buildWireParams, parseGeneration } from '../spec'
import { entryFor } from './context'

export interface SubmitResult {
  generations: Generation[]
  /** Per-job errors from a `count > 1` fan-out where some (but not all) jobs failed. */
  failed?: ApiJobErrorJSON[]
  /** Human-readable summary of a partial failure. */
  warning?: string
}

export type SafeSubmitResult =
  | { ok: true, generations: Generation[], failed?: ApiJobErrorJSON[], warning?: string }
  | { ok: false, error: { code: string, message: string, status?: number, data?: unknown } }

export async function submit(ctx: GenerationContext, input: GenerationInput): Promise<SubmitResult> {
  return observeAsync(ctx.observability, 'fnf.job.submit', {
    model: input.model,
    count: Math.max(1, input.count ?? 1),
  }, async () => {
    const entry = entryFor(ctx, input.model)
    // Parse once (throws ValidationError on bad settings) — the same wire params
    // are reused for every job in the fan-out. Normalization is NOT done here; it
    // is the separate, opt-in `adjust()` step.
    const params = buildWireParams(input, entry)
    const count = Math.max(1, input.count ?? 1)

    // Confirmation tokens are single-use. Reusing one across the client-side
    // fan-out would let only the first request pass, so reject before opening
    // the host's approval UI. Model batchSize remains one confirmed request.
    if (ctx.adapter.confirm && count > 1) {
      throw new ValidationError(
        'Confirmed submissions cannot use count greater than 1 because confirmation tokens are single-use. Use the model settings.batchSize option instead.',
      )
    }

    // The host's confirmation gate runs after validation/wire-building and
    // before any network call. A rejection aborts the whole submit with the
    // typed `confirmation_rejected` error.
    const confirmationToken = await confirmSubmission(ctx, entry.jobSetType, params)

    // `count` is a client-side fan-out: N independent job submissions, orthogonal
    // to the per-model `batch_size` param (already in `params`). Total outputs =
    // count × batch_size. allSettled so one transient failure doesn't discard the
    // jobs that did succeed.
    const settled = await Promise.allSettled(
      Array.from({ length: count }, () => ctx.adapter.createJobs({
        jobSetType: entry.jobSetType,
        params,
        ...(confirmationToken !== undefined ? { confirmationToken } : {}),
      })),
    )
    const generations = settled.flatMap(r => (r.status === 'fulfilled' ? generationsFromBody(r.value, entry, input) : []))
    const failed = settled.flatMap(r => (r.status === 'rejected' ? [asError(r.reason)] : []))

    if (generations.length === 0) {
      // Everything fulfilled but no response shape was recognized (see
      // generationsFromBody) — keep the first body on the error so the
      // unrecognized shape survives toJSON/Comlink for diagnosis.
      const fulfilled = settled.find((r): r is PromiseFulfilledResult<unknown> => r.status === 'fulfilled')
      throw failed[0] ?? new UnknownSubmitResponseError(undefined, fulfilled?.value)
    }

    const result: SubmitResult = { generations }
    if (failed.length > 0) {
      result.failed = failed.map(e => e.toJSON())
      const ranOut = failed.some(e => e.code === 'out_of_credits')
      result.warning = `Submitted ${generations.length} of ${count} requested jobs${ranOut ? ', then ran out of credits' : ''}.`
    }
    return result
  }, {
    successAttributes: result => ({
      generation_count: result.generations.length,
      failed_count: result.failed?.length ?? 0,
    }),
  })
}

async function confirmSubmission(ctx: GenerationContext, jobSetType: string, params: Record<string, unknown>): Promise<string | undefined> {
  if (!ctx.adapter.confirm)
    return undefined
  let token: string | void
  try {
    token = await ctx.adapter.confirm({ jobSetType, params })
  }
  catch (err) {
    // Typed throws (a host may raise its own ApiJobError) pass through; anything
    // else — a plain throw from a dismissed modal — becomes the stable code.
    throw err instanceof ApiJobError ? err : new ConfirmationRejectedError(err instanceof Error ? err.message : undefined)
  }
  return typeof token === 'string' ? token : undefined
}

export async function safeSubmit(ctx: GenerationContext, input: GenerationInput): Promise<SafeSubmitResult> {
  try {
    const result = await submit(ctx, input)
    return {
      ok: true,
      generations: result.generations,
      ...(result.failed ? { failed: result.failed } : {}),
      ...(result.warning ? { warning: result.warning } : {}),
    }
  }
  catch (err) {
    if (err instanceof ApiJobError)
      return { ok: false, error: err.toJSON() }
    return { ok: false, error: { code: 'unexpected', message: err instanceof Error ? err.message : String(err) } }
  }
}

/**
 * Normalize a create response into Generations. Backends differ: some return a
 * bare `string[]` of created job ids, some `{ id, status, … }`,
 * some `{ job_ids: [...] }`. Id-only responses become pending generations that
 * carry the submitted input (so `wait`/`get` can refresh them).
 */
export function generationsFromBody(body: unknown, entry: JobEntry, input: GenerationInput): Generation[] {
  if (Array.isArray(body)) {
    // An array of full job objects (adapters that normalize { job_sets } fan out
    // to these) parses completely; an array of bare ids becomes pendings.
    if (body.length > 0 && body.every(item => isObject(item) && typeof item.id === 'string'))
      return body.map(job => parseGeneration(job as JobResponse, entry))
    return body.filter(isString).map(id => pendingGeneration(id, entry, input))
  }
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>
    const ids = obj.job_ids ?? obj.ids
    if (Array.isArray(ids))
      return ids.filter(isString).map(id => pendingGeneration(id, entry, input))
    if (typeof obj.id === 'string')
      return [parseGeneration(body as JobResponse, entry)]
  }
  return []
}

function pendingGeneration(id: string, entry: JobEntry, input: GenerationInput): Generation {
  return { id, model: entry.jobSetType, type: entry.outputType, status: 'queued', input }
}

function isString(x: unknown): x is string {
  return typeof x === 'string'
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

// 'unexpected' (a local throw), NOT 'unknown' (UnknownSubmitResponseError's code
// for unrecognized backend responses) — consumers handle the two differently.
function asError(err: unknown): ApiJobError {
  return err instanceof ApiJobError ? err : new ApiJobError('unexpected', err instanceof Error ? err.message : String(err))
}
