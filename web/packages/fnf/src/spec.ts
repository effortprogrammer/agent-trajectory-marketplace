import type { JobEntry } from './define-job'
import type { Generation, GenerationInput, GenerationResults, GenerationStatus, MediaInput, PromptInput } from './types'
import { ApiJobError, ValidationError } from './errors'
import { checkMedia, mediaCodec } from './groups/media'
import { promptCodec } from './groups/prompt'

export interface JobResponse {
  id: string
  job_set_id?: string
  job_set_parent_id?: string | null
  status: string
  result_url?: string | null
  min_result_url?: string | null
  thumbnail_url?: string | null
  params?: Record<string, unknown>
  created_at?: number
  fail_reason?: string | null
}

/**
 * Parse a job's settings (applies schema defaults), wrapping a raw zod failure
 * into the typed `ValidationError` — so callers see a `validation` error with
 * structured issues, not a bare ZodError surfaced as `unknown`. Does NOT
 * snap/normalize values; that is the separate, opt-in `adjust()` step.
 */
export function parseSettings(input: GenerationInput, entry: JobEntry): Record<string, unknown> {
  try {
    return entry.settingsSchema.parse(input.settings ?? {}) as Record<string, unknown>
  }
  catch (err) {
    if (err instanceof ApiJobError)
      throw err
    throw new ValidationError('Invalid settings', (err as { issues?: unknown }).issues ?? String(err))
  }
}

/**
 * Build the wire `params` body posted to the backend (prompt/media envelopes +
 * settings, flattened). No normalization here — settings go as provided (the
 * backend clamps); call `adjust()` first for client-side snapping.
 */
export function buildWireParams(input: GenerationInput, entry: JobEntry): Record<string, unknown> {
  const settings = parseSettings(input, entry)

  // Cardinality + cross-role rules + the job's cross-field validate hook —
  // aggregated, so the caller sees ALL problems at once (unlike fnf-web's
  // first-throw), before any wire building or I/O.
  const issues = [
    ...(entry.media ? checkMedia(entry.media, input.media) : []),
    // validate sees parsed settings (defaults applied) — same contract as credits.
    ...(entry.validate?.({ ...input, settings }) ?? []),
  ]
  if (issues.length > 0)
    throw new ValidationError(issues.map(i => i.msg).join('; '), issues)

  let wire: Record<string, unknown> = {}
  if (entry.prompt)
    Object.assign(wire, promptCodec.serialize(input.prompt ?? {}))
  if (entry.media)
    Object.assign(wire, mediaCodec(entry.media).serialize(input.media ?? {}))
  // Settings: the local key is the wire key unless the job tagged an explicit
  // wire name via `z.wire` (e.g. aspectRatio → aspect_ratio). Explicitly-passed
  // undefined stays off the wire (structured transports would carry the key).
  for (const [key, value] of Object.entries(settings)) {
    if (value === undefined)
      continue
    wire[entry.wireNames[key] ?? key] = value
  }
  // Universal targeting fields (every model accepts them on the wire).
  if (input.folderId)
    wire.folder_id = input.folderId
  if (input.parentId)
    wire.parent_id = input.parentId
  // `count` is NOT a wire param — it's the client-side fan-out handled in submit().
  // `batch_size`, where a model declares it, is an ordinary setting (already above).
  if (input.extra)
    Object.assign(wire, input.extra)
  if (entry.finalize)
    wire = entry.finalize(wire, input)
  return wire
}

export function parseGeneration(job: JobResponse, entry: JobEntry): Generation {
  const stored = job.params ?? {}
  // A lossy finalize (keys deleted/renamed on serialize) gets its inverse
  // applied here, so get-then-resubmit round-trips the original settings
  // instead of falling back to schema defaults.
  const wire = entry.restore ? { ...stored, ...entry.restore(stored) } : stored
  const media = entry.media ? mediaCodec(entry.media) : undefined

  const prompt = entry.prompt ? (promptCodec.parse(wire) as PromptInput) : undefined
  const mediaInput = media ? (media.parse(wire) as MediaInput) : undefined

  const claimed = new Set<string>([
    ...(entry.prompt ? promptCodec.wireKeys : []),
    ...(media ? media.wireKeys : []),
    'folder_id',
    'parent_id',
  ])
  const folderId = typeof wire.folder_id === 'string' ? wire.folder_id : undefined
  const parentId = typeof wire.parent_id === 'string' ? wire.parent_id : undefined
  // Invert the explicit wire names so wire keys map back to local settings keys
  // (with the identity fallback for unmapped/legacy keys).
  const wireToLocal: Record<string, string> = {}
  for (const [local, wireKey] of Object.entries(entry.wireNames))
    wireToLocal[wireKey] = local
  const settings: Record<string, unknown> = {}
  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(wire)) {
    if (claimed.has(key))
      continue
    const local = wireToLocal[key] ?? key
    if (local in entry.settingsMap)
      settings[local] = value
    else extra[key] = value
  }

  const input: GenerationInput = {
    model: entry.jobSetType,
    ...(folderId ? { folderId } : {}),
    ...(parentId ? { parentId } : {}),
    ...(prompt ? { prompt } : {}),
    ...(mediaInput ? { media: mediaInput } : {}),
    settings,
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  }

  const results = buildResults(entry, job)

  return {
    id: job.id,
    ...(job.job_set_id ? { jobSetId: job.job_set_id } : {}),
    ...(job.job_set_parent_id ? { parentJobSetId: job.job_set_parent_id } : {}),
    model: entry.jobSetType,
    type: entry.outputType,
    status: job.status as GenerationStatus,
    input,
    ...(results ? { results } : {}),
    ...(job.fail_reason ? { failReason: job.fail_reason } : {}),
    ...(job.created_at !== undefined ? { createdAt: job.created_at } : {}),
  }
}

function buildResults(entry: JobEntry, job: JobResponse): GenerationResults | undefined {
  if (job.status !== 'completed' || !job.result_url)
    return undefined
  const results: GenerationResults = { rawUrl: job.result_url }
  if (entry.outputType === 'image' && job.min_result_url)
    results.minUrl = job.min_result_url
  if (entry.outputType === 'image' && !job.min_result_url && job.thumbnail_url)
    results.thumbnailUrl = job.thumbnail_url
  if (entry.outputType === 'video' && (job.thumbnail_url || job.min_result_url))
    results.thumbnailUrl = job.thumbnail_url ?? job.min_result_url ?? undefined
  return results
}
