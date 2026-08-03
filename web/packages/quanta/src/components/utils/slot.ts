import type { CSSProperties } from 'react'

/**
 * The slot color system's TS half (the CSS half is src/css/tailwind/slot.css).
 *
 * A component takes a single semantic `color` prop and spreads `slotStyle(color)`
 * inline, which sets the private `--q-tint*` custom properties. The `q-slot-*`
 * utilities then derive every surface from them.
 *
 * This is the TINT pattern — one of quanta's two coloring models. It fits soft
 * single-accent surfaces (toggle, tag, switch, tabs, progress, loader). Selection
 * controls (checkbox, radio, chip) deliberately use the OTHER model: a per-color
 * `q-<comp>-<color>` utility table setting richer `--q-<comp>-fill/fg/hover/ring`
 * vars (a fill identity + a bespoke glow ring the tint can't express).
 *
 * CONTRACT: every value references an `--hf-color-*` runtime primitive (emitted
 * per data-theme in src/css/theme/color.css), so light/dark is automatic. NEVER
 * use a `--color-q-*` name here — those are @theme inline-only and have no
 * runtime value, so the slot would render unstyled.
 *
 * Resilience: each saturated `--q-tint` carries a nested var() fallback to
 * `brand-primary` (always set by managed themes, the documented default) so a
 * partial `defineTheme()` override degrades gracefully instead of rendering
 * transparent. See quanta-core-plan.md §5.4 / §5.4.1.
 */

export type SlotColor = 'brand' | 'neutral' | 'success' | 'error' | 'warning' | 'info'

/** Guaranteed-present token used as the universal degrade target. */
const FALLBACK = 'var(--hf-color-brand-primary)'

type SlotVars = {
  '--q-tint': string
  '--q-tint-fg': string
  /** Only set when it must differ from `--q-tint` (the utility defaults it to `--q-tint`). */
  '--q-tint-bg'?: string
  /** Only set when it must differ from `--q-tint` (the utility defaults it to `--q-tint`). */
  '--q-tint-border'?: string
}

/** color → the four `--q-tint*` properties (all sourced from `--hf-color-*`). */
export const SLOT: Record<SlotColor, SlotVars> = {
  brand: {
    '--q-tint': 'var(--hf-color-brand-primary)',
    '--q-tint-fg': 'var(--hf-color-text-inverse)',
  },
  neutral: {
    '--q-tint': `var(--hf-color-text-primary, ${FALLBACK})`,
    '--q-tint-bg': `var(--hf-color-background-secondary-strong, ${FALLBACK})`,
    '--q-tint-fg': 'var(--hf-color-text-primary)',
    '--q-tint-border': `var(--hf-color-border-strong, ${FALLBACK})`,
  },
  success: {
    '--q-tint': `var(--hf-color-state-success-fg, ${FALLBACK})`,
    '--q-tint-fg': 'var(--hf-color-text-inverse)',
  },
  error: {
    '--q-tint': `var(--hf-color-state-error-fg, ${FALLBACK})`,
    '--q-tint-fg': 'var(--hf-color-text-inverse)',
  },
  warning: {
    '--q-tint': `var(--hf-color-state-warning-fg, ${FALLBACK})`,
    '--q-tint-fg': 'var(--hf-color-text-inverse)',
  },
  info: {
    '--q-tint': `var(--hf-color-state-info-fg, ${FALLBACK})`,
    '--q-tint-fg': 'var(--hf-color-text-inverse)',
  },
}

/**
 * Inline style object that wires a `color` prop into the slot custom properties.
 * Spread it into a component's `style`, then style surfaces with `q-slot-*`.
 *
 *   style={{ ...slotStyle(color), ...style }}
 */
export function slotStyle(color: SlotColor): CSSProperties {
  return SLOT[color] as CSSProperties
}
