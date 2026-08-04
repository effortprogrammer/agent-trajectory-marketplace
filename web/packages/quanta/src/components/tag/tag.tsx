'use client'

import type { ComponentProps, CSSProperties, ReactNode } from 'react'
import { CloseIcon } from '../close-button/index.ts'
import { Icon } from '../icon/index.ts'
import { cx } from '../utils/cx.ts'
import { type SlotColor, slotStyle } from '../utils/slot.ts'

/**
 * Tag — a presentational labeled category, optionally removable. Soft slot tint
 * by default. When `onRemove` is provided, a trailing "✕" button is rendered
 * (a real <button> nested in the <span> container — valid, since the container
 * is non-interactive).
 *
 * Composable like Chip/Button: the label is `children`; `start` / `end` are
 * optional slots (any node — a leading Dot/Avatar/icon, a trailing count Badge)
 * that default to nothing and sit before/after the label. `start`/`end` render
 * only when set, so the legacy `<Tag>Label</Tag>` markup is byte-for-byte
 * unchanged. `end` precedes the remove button when both are present.
 */

export type TagProps = ComponentProps<'span'> & {
  /** Slot color. Default 'neutral'. */
  color?: SlotColor
  /** Leading slot (Dot / Avatar / icon, any node) before the label. */
  start?: ReactNode
  /** Trailing slot (count Badge / Kbd, any node) after the label, before remove. */
  end?: ReactNode
  /** When set, renders a trailing remove button. */
  onRemove?: () => void
  removeLabel?: string
}

export function Tag({ color = 'neutral', start, end, onRemove, removeLabel = 'Remove', className, style, children, ...props }: TagProps) {
  return (
    <span
      style={{ ...slotStyle(color), ...style } as CSSProperties}
      className={cx(
        'inline-flex max-w-full items-center gap-1 rounded-q-150 px-2 py-0.5 align-middle text-q-caption-sm-medium',
        'q-slot-bg-10 q-slot-text',
        className,
      )}
      {...props}
    >
      {start != null ? <span className="inline-flex shrink-0 items-center [&_svg]:size-q-icon-xs">{start}</span> : null}
      <span className="truncate">{children}</span>
      {end != null ? <span className="inline-flex shrink-0 items-center [&_svg]:size-q-icon-xs">{end}</span> : null}
      {onRemove
        ? (
            <button
              type="button"
              onClick={onRemove}
              aria-label={removeLabel}
              className={cx(
                '-mr-0.5 inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-q-100 outline-none transition-colors',
                'hover:q-slot-bg-20 focus-visible:ring-2 focus-visible:q-slot-ring-40',
              )}
            >
              <Icon as={CloseIcon} size="xs" />
            </button>
          )
        : null}
    </span>
  )
}
