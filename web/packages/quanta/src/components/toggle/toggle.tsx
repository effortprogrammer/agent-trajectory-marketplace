'use client'

import type { ComponentProps, CSSProperties, ReactNode } from 'react'
import { Toggle as Primitive } from '@base-ui/react/toggle'
import { cx } from '../utils/cx.ts'
import { type SlotColor, slotStyle } from '../utils/slot.ts'

/**
 * Toggle — a two-state pressable button (Base UI `Toggle`). When pressed, a soft
 * slot tint (`q-slot-bg-10` + `q-slot-text`) derived from the `color` prop fills
 * it. State comes from Base UI's `data-pressed` attribute.
 *
 * Composable like Button/Chip: the label is `children`; `start` / `end` are
 * optional slots (any node — a leading icon, a trailing count `<Badge>`) that
 * default to nothing. The gap + `& svg` sizing space them; the legacy
 * icon-as-children pattern is byte-for-byte unchanged when no slot is passed.
 * Host element is swappable via Base UI `render` (passes straight through).
 */

export type ToggleSize = 'sm' | 'md' | 'lg'

const SIZE_CLASS = {
  sm: 'q-toggle-sm',
  md: 'q-toggle-md',
  lg: 'q-toggle-lg',
} satisfies Record<ToggleSize, string>

export type ToggleProps = ComponentProps<typeof Primitive> & {
  /** Slot color for the pressed tint. Default 'brand'. */
  color?: SlotColor
  size?: ToggleSize
  /** Leading slot (icon, any node) before the label. */
  start?: ReactNode
  /** Trailing slot (count, badge, any node) after the label. */
  end?: ReactNode
}

export function Toggle({ color = 'brand', size = 'md', start, end, className, style, children, ...props }: ToggleProps) {
  // Slots flank the label only when set; otherwise children render bare so the
  // legacy icon-as-children pattern is unchanged. Gap + `& svg` do the spacing.
  const content = start != null || end != null ? <>{start}{children}{end}</> : children
  return (
    <Primitive
      style={{ ...slotStyle(color), ...style } as CSSProperties}
      className={state => cx(
        'q-toggle',
        SIZE_CLASS[size],
        typeof className === 'function' ? className(state) : className,
      )}
      {...props}
    >
      {content}
    </Primitive>
  )
}
