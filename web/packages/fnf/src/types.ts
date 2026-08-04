export type OutputType = 'image' | 'video'

export type MediaFormat = 'wrapped' | 'unwrapped' | 'single'

export type GenerationStatus =
  | 'pending'
  | 'waiting'
  | 'queued'
  | 'in_progress'
  | 'ip_detect'
  | 'completed'
  | 'failed'
  | 'nsfw'
  | 'canceled'
  | 'ip_detected'

export const TERMINAL_STATUSES: ReadonlySet<GenerationStatus> = new Set([
  'completed',
  'failed',
  'nsfw',
  'canceled',
  'ip_detected',
])

export function isTerminal(status: GenerationStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

/**
 * Locally-known facts about a media input (intrinsic size, duration) used by
 * pre-submit validation AND by jobs that derive wire params from intrinsic
 * size (kling's width/height come from the start image; seedance/nano resolve
 * an 'auto' ratio from the first image). The meta OBJECT is never serialized —
 * the codec sends only id/type/url — but attaching it can change what the
 * submitted wire looks like, not just validation outcomes. Populate it from
 * data the app already has, or opt in to `resolveMediaMeta` to measure.
 */
export interface MediaMeta {
  width?: number
  height?: number
  /** Intrinsic duration in seconds (video/audio). */
  durationSec?: number
}

export interface MediaRef {
  id: string
  type: string
  url?: string
  role?: string
  meta?: MediaMeta
}

export interface PromptInput {
  instruction?: string
  enhance?: boolean
  negative?: string
  system?: string
}

export type MediaInput = Record<string, MediaRef | MediaRef[] | undefined>

export interface GenerationInput<S = Record<string, unknown>> {
  model: string
  count?: number
  folderId?: string
  /** Parent job set id — derived jobs (upscale/outpaint/…) link to their source via wire `parent_id`. */
  parentId?: string
  prompt?: PromptInput
  media?: MediaInput
  settings: S
  extra?: Record<string, unknown>
}

export interface GenerationResults {
  rawUrl: string
  minUrl?: string
  thumbnailUrl?: string
}

export interface Generation {
  id: string
  jobSetId?: string
  /** Set when this generation is a derived job (upscale/outpaint/…) of another job set. */
  parentJobSetId?: string
  model: string
  type: OutputType
  status: GenerationStatus
  input: GenerationInput
  results?: GenerationResults
  failReason?: string
  createdAt?: number
}
