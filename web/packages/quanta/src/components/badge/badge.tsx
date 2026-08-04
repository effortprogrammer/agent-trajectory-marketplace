'use client'

import type { ComponentProps, ReactNode } from 'react'
import type { ClassValue } from '../utils/cx.ts'
import { cx } from '../utils/cx.ts'

/**
 * Badge — a small presentational status marker. Figma variants Blue/Lime/Pink/
 * Purple/LimeSubtle are skewed uppercase caps; NBrand/NBlue are compact "new" markers.
 * Two sizes (Figma node 526:456): xs (default) and sm.
 */

export type BadgeVariant = 'blue' | 'lime' | 'pink' | 'purple' | 'limeSubtle' | 'nBrand' | 'nBlue'
export type BadgeSize = 'xs' | 'sm'

export interface BadgeOptions {
  variant?: BadgeVariant
  size?: BadgeSize
}

const VARIANT_CLASS = {
  blue: 'q-badge-blue',
  lime: 'q-badge-lime',
  pink: 'q-badge-pink',
  purple: 'q-badge-purple',
  limeSubtle: 'q-badge-lime-subtle',
  nBrand: 'q-badge-n-brand',
  nBlue: 'q-badge-n-blue',
} satisfies Record<BadgeVariant, string>

const SHAPE_CLASS = {
  blue: 'q-badge-skew',
  lime: 'q-badge-skew',
  pink: 'q-badge-skew',
  purple: 'q-badge-skew',
  limeSubtle: 'q-badge-skew',
  nBrand: 'q-badge-compact',
  nBlue: 'q-badge-compact',
} satisfies Record<BadgeVariant, string>

// xs is the default baked into the shape utilities; only sm adds a marker class.
const SIZE_CLASS = {
  xs: '',
  sm: 'q-badge-sm',
} satisfies Record<BadgeSize, string>

export type BadgeProps = ComponentProps<'span'> & {
  text?: ReactNode
  variant?: BadgeVariant
  size?: BadgeSize
}

export function badge(options: BadgeOptions = {}, ...extra: ClassValue[]): string {
  const { variant = 'blue', size = 'xs' } = options
  return cx('q-badge', SHAPE_CLASS[variant], VARIANT_CLASS[variant], SIZE_CLASS[size], ...extra)
}

export function Badge({ variant = 'blue', size = 'xs', text, className, children, ...props }: BadgeProps) {
  const isCompact = variant === 'nBrand' || variant === 'nBlue'
  const content = children ?? text ?? (isCompact ? 'new' : 'Tag')
  const label = (
    <span className="q-badge-text">
      <span className="q-badge-label">{content}</span>
    </span>
  )

  return (
    <span
      className={badge({ variant, size }, className)}
      {...props}
    >
      <span className="q-badge-frame">
        <span className="q-badge-surface">
          {label}
        </span>
      </span>
    </span>
  )
}
