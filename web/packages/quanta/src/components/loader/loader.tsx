'use client'

import type { ComponentProps, CSSProperties } from 'react'
import { cx } from '../utils/cx.ts'
import type { SlotColor } from '../utils/slot.ts'
import { slotStyle } from '../utils/slot.ts'

/**
 * Loader — an indeterminate loading indicator, slot-tinted with the quanta
 * colour system (`color` → `slotStyle`, so light/dark and any `defineTheme()`
 * brand are automatic). One component, four motifs that echo the rest of the
 * system:
 *
 *   - `dots`   — four dots blinking in sequence around a circle (the accent).
 *   - `circle` (default) — a spinning ring with an accent arc over a neutral track.
 *   - `stars`  — twinkling sparkles, the marketing/“AI” motif (cf. specialBrand).
 *   - `shine`  — an accent gloss sweeping across a tile (the media-grid shimmer).
 *
 * `role="status"` + `aria-label` announce it to assistive tech; the glyphs are
 * decorative. Motion degrades under `prefers-reduced-motion` and can be turned
 * off per-instance with `animated={false}`.
 */

export type LoaderVariant = 'dots' | 'circle' | 'stars' | 'shine'
export type LoaderSize = 'xxs' | 'xs' | 'sm' | 'md' | 'lg'
export type LoaderColor = SlotColor

const SIZE_CLASS = {
  xxs: 'q-loader-xxs',
  xs: 'q-loader-xs',
  sm: 'q-loader-sm',
  md: 'q-loader-md',
  lg: 'q-loader-lg',
} satisfies Record<LoaderSize, string>

const VARIANT_CLASS = {
  dots: 'q-loader-dots',
  circle: 'q-loader-circle',
  stars: 'q-loader-stars',
  shine: 'q-loader-shine',
} satisfies Record<LoaderVariant, string>

export interface LoaderProps extends Omit<ComponentProps<'div'>, 'color'> {
  variant?: LoaderVariant
  size?: LoaderSize
  color?: LoaderColor
  /** Run the animation. Default true. */
  animated?: boolean
  'aria-label'?: string
}

/** Four-point sparkle (Figma "AI" star). Scales with the loader box. */
function Sparkle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 0c.6 6.7 5.3 11.4 12 12-6.7.6-11.4 5.3-12 12-.6-6.7-5.3-11.4-12-12C6.7 11.4 11.4 6.7 12 0Z" />
    </svg>
  )
}

export function Loader({
  variant = 'circle',
  size = 'md',
  color = 'brand',
  animated = true,
  className,
  style,
  'aria-label': ariaLabel = 'Loading',
  ...props
}: LoaderProps) {
  const common = {
    role: 'status' as const,
    'aria-label': ariaLabel,
    'aria-live': 'polite' as const,
    'data-static': animated ? undefined : '',
    style: { ...slotStyle(color), ...style } as CSSProperties,
    ...props,
  }
  const rootClass = cx('q-loader', VARIANT_CLASS[variant], SIZE_CLASS[size], className)

  if (variant === 'dots') {
    return (
      <div {...common} className={rootClass}>
        {Array.from({ length: 4 }, (_, i) => <span key={i} className="q-loader-dot" />)}
      </div>
    )
  }

  if (variant === 'stars') {
    return (
      <div {...common} className={rootClass}>
        <Sparkle className="q-loader-star q-loader-star-main" />
        <Sparkle className="q-loader-star q-loader-star-sub" />
      </div>
    )
  }

  if (variant === 'shine') {
    // The gloss sweep is a ::after; nothing else to render.
    return <div {...common} className={rootClass} />
  }

  // circle — spinning ring (neutral track + accent arc).
  return (
    <div {...common} className={rootClass}>
      <svg className="q-loader-spinner" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle className="q-loader-spinner-track" cx="12" cy="12" r="9" strokeWidth="2.5" />
        <path className="q-loader-spinner-arc" d="M12 3a9 9 0 0 1 9 9" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </div>
  )
}
