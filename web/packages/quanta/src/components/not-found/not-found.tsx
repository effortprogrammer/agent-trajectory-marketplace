'use client'

import type { ComponentProps, ReactElement, ReactNode, Ref } from 'react'
import { useRender } from '@base-ui/react/use-render'
import type { TypographyVariant } from '../typography/index.ts'
import { Typography } from '../typography/index.ts'
import { cx } from '../utils/cx.ts'

/**
 * NotFound — a standalone empty / zero-results state primitive. Every slot is
 * a free ReactNode for full control:
 *
 *   <NotFound
 *     icon={<SearchIcon />}
 *     title="No results found"
 *     subtitle="Try a different search term"
 *     actions={<Button size="sm">Clear filters</Button>}
 *   />
 *
 * Matched to the Figma "Menu / Empty" state but framework-agnostic — drop it
 * into a menu, panel, list, or any container that needs an empty state.
 *
 * `size` scales the glass icon tile, icon and typography (sm / md / lg).
 * `variant` controls the surface: `plain` (transparent, drops into an existing
 * surface), `card` (its own frosted-glass panel) or `outline` (a subtle dashed
 * drop-zone). The glassy icon tile is identical across every size and variant.
 *
 * The host element is swappable via `render` (Base UI useRender) — e.g. make
 * the `outline` drop-zone a `<button>` / `<label>` upload trigger.
 */

export type NotFoundSize = 'sm' | 'md' | 'lg'
export type NotFoundVariant = 'plain' | 'card' | 'outline'

const SIZE_CLASS = {
  sm: 'q-not-found-sm',
  md: 'q-not-found-md',
  lg: 'q-not-found-lg',
} satisfies Record<NotFoundSize, string>

const VARIANT_CLASS = {
  plain: 'q-not-found-plain',
  card: 'q-not-found-card',
  outline: 'q-not-found-outline',
} satisfies Record<NotFoundVariant, string>

// Per-size composite typography for the title / subtitle lines — exact
// equivalents of the former `q-not-found-{title,subtitle}` @apply rules (which
// stepped the composite by size via descendant selectors). Now funneled through
// <Typography> so the type lives in one place.
const TITLE_VARIANT = {
  sm: 'caption-xs-medium',
  md: 'caption-sm-medium',
  lg: 'body-sm-medium',
} satisfies Record<NotFoundSize, TypographyVariant>

const SUBTITLE_VARIANT = {
  sm: 'caption-xs-regular',
  md: 'caption-sm-regular',
  lg: 'body-sm-regular',
} satisfies Record<NotFoundSize, TypographyVariant>

export type NotFoundProps = Omit<ComponentProps<'div'>, 'title'> & {
  /** Leading icon node — wrapped in the glass tile. Any ReactNode. */
  icon?: ReactNode
  /** Primary line. Any ReactNode. */
  title?: ReactNode
  /** Secondary line. Any ReactNode. */
  subtitle?: ReactNode
  /** Trailing CTA cluster (e.g. a quanta Button). Any ReactNode. */
  actions?: ReactNode
  /** Scale of the tile, icon and text. Defaults to `md`. */
  size?: NotFoundSize
  /** Surface treatment — keeps the glassy tile in every case. Defaults to `plain`. */
  variant?: NotFoundVariant
  /** Swap the root element/component (e.g. a `<button>` / `<label>` drop-zone). Defaults to `<div>`. */
  render?: ReactElement
}

export function NotFound({ icon, title, subtitle, actions, size = 'md', variant = 'plain', className, children, render, ref, ...props }: NotFoundProps) {
  // `ref` must go to useRender's dedicated `ref` option — it is NOT picked up
  // from `props`, so spreading it there would drop it (it would never reach the
  // rendered root / `render` element).
  return useRender({
    render,
    defaultTagName: 'div',
    ref: ref as Ref<Element> | undefined,
    props: {
      className: cx('q-not-found', SIZE_CLASS[size], VARIANT_CLASS[variant], className),
      children: (
        <>
          {icon != null ? <span className="q-not-found-icon">{icon}</span> : null}
          {(title != null || subtitle != null) ? (
            <span className="q-not-found-text">
              {title != null ? <Typography as="span" variant={TITLE_VARIANT[size]} color="secondary">{title}</Typography> : null}
              {subtitle != null ? <Typography as="span" variant={SUBTITLE_VARIANT[size]} color="tertiary">{subtitle}</Typography> : null}
            </span>
          ) : null}
          {actions != null ? <span className="q-not-found-actions">{actions}</span> : null}
          {children}
        </>
      ),
      ...props,
    },
  })
}
