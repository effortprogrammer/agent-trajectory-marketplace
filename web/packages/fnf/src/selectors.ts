import type { JobEntry } from './define-job'
import type { Generation, GenerationResults, GenerationStatus, MediaRef, OutputType } from './types'
import { isTerminal, TERMINAL_STATUSES } from './types'

/**
 * Selectors — pure, tree-shakeable derivations over the read model, so the
 * production layer doesn't re-derive them ad-hoc in every component
 * (`results?.raw?.url ?? min`, status bucketing, kind-by-extension, …).
 */

// ── urls ──

/** The full-quality result url, when the generation has produced one. */
export function getRawUrl(generation: Generation): string | undefined {
  return generation.results?.rawUrl
}

/** The best url for a grid/preview: min → thumbnail → raw. */
export function getPreviewUrl(generation: Generation): string | undefined {
  const results = generation.results
  return results?.minUrl ?? results?.thumbnailUrl ?? results?.rawUrl
}

// ── status ──

/** The three buckets UI actually branches on. */
export type JobPhase = 'progress' | 'failed' | 'completed'

const FAILED_STATUSES: ReadonlySet<GenerationStatus> = new Set(
  [...TERMINAL_STATUSES].filter(status => status !== 'completed'),
)

/**
 * Bucket a status (or generation) into the UI phases: anything non-terminal —
 * including statuses this SDK build doesn't know yet — is `progress`.
 */
export function getJobPhase(source: Generation | GenerationStatus): JobPhase {
  const status = typeof source === 'string' ? source : source.status
  if (status === 'completed')
    return 'completed'
  return FAILED_STATUSES.has(status) ? 'failed' : 'progress'
}

/** Terminal = the backend will not change this job again (completed OR failed). */
export function isTerminalJobStatus(status: GenerationStatus): boolean {
  return isTerminal(status)
}

/**
 * Failed-family terminal statuses (failed / nsfw / canceled / ip_detected).
 * NOTE: broader than `wait({ throwOnFail })`, which deliberately exempts
 * `canceled` (a user action, not a failure) — and than the product's fail
 * bucket (failed/nsfw/ip_detected). Here `canceled` still buckets as 'failed'
 * because the UI phases have nowhere else terminal-but-not-completed to go.
 */
export function isFailedJobStatus(status: GenerationStatus): boolean {
  return FAILED_STATUSES.has(status)
}

// ── predicates over the read model (UI branches + TS narrowing) ──

/** The generation finished successfully. */
export function isCompleted(generation: Generation): boolean {
  return generation.status === 'completed'
}

/** The generation ended in a failed-family status (failed/nsfw/canceled/ip_detected). */
export function isFailed(generation: Generation): boolean {
  return FAILED_STATUSES.has(generation.status)
}

/** Still in flight — the backend will keep changing it. */
export function isGenerating(generation: Generation): boolean {
  return !isTerminal(generation.status)
}

/** NARROWING guard: after it, `generation.results` is non-optional — no `?.` in render code. */
export function hasResult(generation: Generation): generation is Generation & { results: GenerationResults } {
  return generation.results != null
}

/**
 * NARROWING guard by model: after `isFromJob(gen, seedance2_0)`, `gen.input` is
 * typed as that model's submit input — `gen.input.settings.duration`
 * autocompletes. The runtime check is just the model discriminator; the typed
 * view is sound because parse round-trips the declared shape.
 */
export function isFromJob<Type extends string, Settings, Env>(
  generation: Generation,
  entry: JobEntry<Type, Settings, Env>,
): generation is Generation & { model: Type, input: Generation['input'] & Env & { model: Type, settings: Settings } } {
  return generation.model === entry.jobSetType
}

// ── media kind ──

const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'm4v', 'avi', 'mkv'])
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'heic', 'heif', 'bmp', 'svg'])

/**
 * The visual kind of a url / media ref / generation: a Generation answers from
 * its declared output type; urls answer by extension (query/hash stripped);
 * anything unrecognizable is undefined.
 */
export function getMediaType(source: string | MediaRef | Generation | undefined): OutputType | undefined {
  if (source == null)
    return undefined
  if (typeof source === 'object' && 'status' in source)
    return source.type
  const url = typeof source === 'string' ? source : source.url
  if (!url)
    return undefined
  const path = url.split(/[?#]/)[0]
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  if (VIDEO_EXTENSIONS.has(extension))
    return 'video'
  if (IMAGE_EXTENSIONS.has(extension))
    return 'image'
  return undefined
}
