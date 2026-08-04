import type { JobEntry } from '../define-job'
import type { GenerationInput } from '../types'

/**
 * Fields shared by every submit input, independent of the chosen model.
 * `prompt`/`media` are deliberately NOT here — they are part of a job's
 * envelope and appear only when the job declares them (see `Envelope`).
 */
export interface BaseSubmitFields {
  count?: number
  folderId?: string
  /** Parent job set id — derived jobs (upscale/outpaint/…) link to their source via wire `parent_id`. */
  parentId?: string
  extra?: Record<string, unknown>
}

type InputOf<E> = E extends JobEntry<infer Type, infer Settings, infer Env>
  // A weakly-typed entry (Type = string) widens to the open input WITHOUT
  // collapsing the typed entries next to it in the union.
  ? string extends Type ? GenerationInput : BaseSubmitFields & Env & { model: Type, settings: Settings }
  : never

/**
 * Submit input discriminated by `model`, derived from the registered jobs:
 * `model` autocompletes to a registered jobSetType and `settings` is typed to
 * that model's schema. A dynamically-built entry contributes the open
 * `GenerationInput` branch (autocomplete survives; strictness is per-entry).
 */
export type SubmitInputFor<Jobs extends readonly JobEntry[]> = InputOf<Jobs[number]>
