'use client'

import type { ComponentProps, ReactNode } from 'react'
import { IconCrossMediumOutlined as CloseIcon } from '@higgsfield-ai/icons/IconCrossMediumOutlined'
import type { ClassValue } from '../utils/cx.ts'
import { cx } from '../utils/cx.ts'
import { Icon, type IconSize } from '../icon/index.ts'

/**
 * CloseButton — the round dismiss control for modals, dialogs, sheets and any
 * overlay, pixel-matched to the Figma "CloseButton" (node 2052:109). A faint
 * disc with a cross glyph: white-5% fill + primary icon at rest, a stronger
 * fill on hover, and a lime focus ring on keyboard focus.
 *
 *   <CloseButton onClick={close} />          // standalone <button>
 *   <Dialog.Close className={closeButton()}/> // style a framework close part
 *
 * Sizes map to the Figma 24 / 32 / 40 / 48 discs (`sm` / `md` / `lg` / `xl`).
 */

export type CloseButtonSize = 'sm' | 'md' | 'lg' | 'xl'

const SIZE_CLASS = {
  sm: 'q-close-sm',
  md: 'q-close-md',
  lg: 'q-close-lg',
  xl: 'q-close-xl',
} satisfies Record<CloseButtonSize, string>

// Disc size → cross-glyph Icon size, matching the Figma 16/20/24/24 glyphs that
// the `--q-close-icon` CSS var previously drove (now owned by <Icon>).
const ICON_SIZE = {
  sm: 'sm',
  md: 'md',
  lg: 'lg',
  xl: 'lg',
} satisfies Record<CloseButtonSize, IconSize>

export interface CloseButtonOptions {
  /** Disc size — Figma 24/32/40/48. Defaults to `md` (32). */
  size?: CloseButtonSize
}

/**
 * Build the close-button class string. Use this to apply the styling to a
 * non-`<button>` close element, e.g. a Base UI `Dialog.Close` / `Toast.Close`.
 */
export function closeButton({ size = 'md' }: CloseButtonOptions = {}, ...extra: ClassValue[]): string {
  return cx('q-close', SIZE_CLASS[size], ...extra)
}

export { CloseIcon }

export type CloseButtonProps = Omit<ComponentProps<'button'>, 'children'> & {
  size?: CloseButtonSize
  /** Override the default cross glyph. */
  children?: ReactNode
}

export function CloseButton({ size = 'md', className, type, children, 'aria-label': ariaLabel, ...props }: CloseButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      aria-label={ariaLabel ?? 'Close'}
      className={closeButton({ size }, className)}
      {...props}
    >
      {children ?? <Icon as={CloseIcon} size={ICON_SIZE[size]} />}
    </button>
  )
}
