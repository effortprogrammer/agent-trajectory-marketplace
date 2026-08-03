import type { MediaIssue } from '../groups/media'
import type { MediaInput, PromptInput } from '../types'

/**
 * Issue builders shared by the jobs' `validate` hooks, so the catalog's models
 * emit uniform pydantic-shaped issues instead of each declaration hand-rolling
 * (and slowly drifting) the same snippets. Consumers key on these shapes.
 */

/** `value` (when set) must sit in [min, max] — the batchSize/steps/seed pattern. */
export function intRange(field: string, value: number | null | undefined, min: number, max: number): MediaIssue[] {
  if (value == null || (value >= min && value <= max))
    return []
  return [{ loc: ['settings', field], msg: `${field} must be between ${min} and ${max}` }]
}

/** `value` (when set) must be one of `options` — membership for permissive runtime schemas. */
export function oneOf(field: string, value: unknown, options: readonly unknown[]): MediaIssue[] {
  if (value == null || options.includes(value))
    return []
  return [{ loc: ['settings', field], msg: `${field} must be one of: ${options.join(', ')}` }]
}

/** `prompt.instruction` must contain at least `min` non-whitespace chars. */
export function promptRequired(prompt: PromptInput | undefined, min = 1): MediaIssue[] {
  const raw = prompt?.instruction ?? ''
  if (raw.trim().length >= min)
    return []
  return [{ loc: ['prompt'], msg: 'Prompt is required' }]
}

/** `prompt.instruction` raw length must be below/within `max`, matching product validators. */
export function promptMax(prompt: PromptInput | undefined, max: number, opts: { inclusive?: boolean } = {}): MediaIssue[] {
  const raw = prompt?.instruction ?? ''
  const tooLong = opts.inclusive ? raw.length >= max : raw.length > max
  if (!tooLong)
    return []
  return [{ loc: ['prompt'], msg: `Prompt is too long (max ${max} characters)` }]
}

/** Refs attached under `role` (single or array), absent role = 0. */
export function countRefs(media: MediaInput | undefined, role: string): number {
  const value = media?.[role]
  return Array.isArray(value) ? value.length : value ? 1 : 0
}

/**
 * The product's seed source (fnf-web `randomSeed`): 1…1,000,000 inclusive.
 * Meant as a `z._default(z.number(), randomSeed)` so the wire always carries a
 * seed (prod always sends one) without burdening every caller to invent it.
 */
export function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000) + 1
}
