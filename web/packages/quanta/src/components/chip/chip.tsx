'use client'

import type { ComponentProps, ReactNode } from 'react'
import type { ClassValue } from '../utils/cx.ts'
import { cx } from '../utils/cx.ts'
import type { SlotColor } from '../utils/slot.ts'

/**
 * Chip — a selectable filter pill (a real toggle <button> with `aria-pressed`).
 * When `selected`, the chip takes the SOLID fill of the matching checkbox
 * (e.g. brand → solid #d1fe17 surface with #1a1a1a text). For a removable
 * labeled category use Tag; for a standalone two-state control use Toggle.
 *
 * Composable, like Button: the label is `children`; `start` / `end` are optional
 * slots (any node — a leading icon, a trailing count `<Badge>`) that default to
 * nothing. The gap + `& svg` sizing space them; the legacy icon-as-children
 * pattern (`<Chip><Icon/>Label</Chip>`) is byte-for-byte unchanged when no slot
 * is passed.
 */

export type ChipProps = Omit<ComponentProps<'button'>, 'color'> & {
  /** Semantic color when selected. Default 'brand'. */
  color?: ChipColor
  size?: ChipSize
  selected?: boolean
  /** Leading slot (icon, any node) before the label. */
  start?: ReactNode
  /** Trailing slot (count, badge, any node) after the label. */
  end?: ReactNode
}

export type ChipColor = SlotColor
export type ChipSize = 'xxs' | 'xs' | 'sm' | 'md'

export interface ChipOptions {
  color?: ChipColor
  size?: ChipSize
  selected?: boolean
}

const COLOR_CLASS = {
  brand: 'q-chip-brand',
  neutral: 'q-chip-neutral',
  success: 'q-chip-success',
  error: 'q-chip-error',
  warning: 'q-chip-warning',
  info: 'q-chip-info',
} satisfies Record<ChipColor, string>

const SIZE_CLASS = {
  xxs: 'q-chip-xxs',
  xs: 'q-chip-xs',
  sm: 'q-chip-sm',
  md: 'q-chip-md',
} satisfies Record<ChipSize, string>

export function chip(options: ChipOptions = {}, ...extra: ClassValue[]): string {
  const { color = 'brand', size = 'sm', selected = false } = options
  return cx('q-chip', COLOR_CLASS[color], SIZE_CLASS[size], selected && 'q-chip-selected', ...extra)
}

export function Chip({ color, size, selected = false, className, type, start, end, children, ...props }: ChipProps) {
  // Slots flank the label only when set; otherwise children render bare so the
  // legacy icon-as-children pattern is unchanged. Gap + `& svg` do the spacing.
  const content = start != null || end != null ? <>{start}{children}{end}</> : children
  return (
    <button
      type={type ?? 'button'}
      aria-pressed={selected}
      data-selected={selected ? '' : undefined}
      className={chip({ color, size, selected }, className)}
      {...props}
    >
      {content}
    </button>
  )
}
