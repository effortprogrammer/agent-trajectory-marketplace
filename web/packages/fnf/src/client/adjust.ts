import type { AdjustKind, Adjustment } from '../normalize'
import type { GenerationInput } from '../types'
import type { GenerationContext } from './context'
import { normalizeSettings } from '../normalize'
import { entryFor } from './context'

/** Result of the standalone `adjust()` step: a normalized input plus the changes made. */
export interface AdjustResult<Input> {
  input: Input
  adjustments: Adjustment[]
}

/**
 * Snap the requested setting kinds (e.g. `'near-aspect-ratio'`) to their nearest
 * allowed values, returning a NEW input plus the list of changes. This is the
 * one place that normalizes — `submit()` deliberately does not, so callers opt in
 * explicitly (UI preview, agent canonicalization) and the submit path stays pure.
 *
 *   const { input, adjustments } = adjust(ctx, raw, ['near-aspect-ratio'])
 *   await submit(ctx, input)
 */
export function adjust(ctx: GenerationContext, input: GenerationInput, kinds: readonly AdjustKind[]): AdjustResult<GenerationInput> {
  const entry = entryFor(ctx, input.model)
  const { settings, adjustments } = normalizeSettings(
    (input.settings ?? {}) as Record<string, unknown>,
    entry.normalizers,
    new Set(kinds),
  )
  return { input: { ...input, settings }, adjustments }
}
