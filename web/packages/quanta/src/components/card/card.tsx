'use client'

import type { ComponentProps, ReactElement, ReactNode, Ref } from 'react'
import { useRender } from '@base-ui/react/use-render'
import { Typography } from '../typography/index.ts'
import type { ClassValue } from '../utils/cx.ts'
import { cx } from '../utils/cx.ts'

/**
 * Card — the reusable glass/solid surface that the overlay components (Modal,
 * Vault, Sonner, Dropdown, cmdk, NavigationMenu) each build inline today. Use
 * it for any panel, popover body, sheet, tile, or section that needs the
 * quanta glass look, instead of re-deriving the recipe.
 *
 *   <Card elevation="raised">
 *     <Card.Header title="Share" description="Anyone with the link"
 *       actions={<Button>Done</Button>} />
 *     <Card.Body>…</Card.Body>
 *     <Card.Footer>…</Card.Footer>
 *   </Card>
 *
 * `surface` = 'glass' (background-glass + 40px blur, no border/shadow — pixel-
 * identical to the Modal popup, default) | 'solid' (opaque secondary, no blur).
 * `elevation` = 'flat' (bare surface, default) | 'raised' (adds the floating
 * drop shadow for popovers/toasts/sheets). All slots are optional — a bare
 * `<Card>` with arbitrary children works too. `card()` is a class-builder for
 * styling a non-div element as a card surface.
 *
 * Host element is swappable via `render` (Base UI useRender) — keep the surface
 * but render a semantic or interactive root:
 *   <Card render={<article/>}>…</Card>
 *   <Card render={<a href="/p"/>}>…</Card>   ·   <Card render={<Link/>}>…</Card>
 */

export type CardSurface = 'glass' | 'solid'
export type CardElevation = 'flat' | 'raised'

export interface CardOptions {
  surface?: CardSurface
  elevation?: CardElevation
}

const SURFACE_CLASS = {
  glass: '',
  solid: 'q-card-solid',
} satisfies Record<CardSurface, string>

const ELEVATION_CLASS = {
  flat: '',
  raised: 'q-card-raised',
} satisfies Record<CardElevation, string>

/** Build the card surface class string — usable to skin any element as a card. */
export function card(options: CardOptions = {}, ...extra: ClassValue[]): string {
  const { surface = 'glass', elevation = 'flat' } = options
  return cx('q-card', SURFACE_CLASS[surface], ELEVATION_CLASS[elevation], ...extra)
}

export type CardProps = Omit<ComponentProps<'div'>, keyof CardOptions> & CardOptions & {
  /**
   * Swap the root element/component while keeping the surface styling — a
   * semantic `<article>` / `<section>`, or a clickable `<a>` / `<button>` /
   * framework `<Link>`. Defaults to a `<div>`.
   */
  render?: ReactElement
}

function Root({ surface, elevation, className, render, ref, ...props }: CardProps) {
  // `ref` must go to useRender's dedicated `ref` option — it is NOT picked up
  // from `props`, so spreading it there would drop it (it would never reach the
  // rendered root / `render` element).
  return useRender({
    render,
    defaultTagName: 'div',
    ref: ref as Ref<Element> | undefined,
    props: { className: card({ surface, elevation }, className), ...props },
  })
}

export type CardHeaderProps = Omit<ComponentProps<'div'>, 'title'> & {
  /** Primary heading. Any node. */
  title?: ReactNode
  /** Secondary line under the title. Any node. */
  description?: ReactNode
  /** Trailing controls (buttons, close, etc.). Any node. */
  actions?: ReactNode
}

function Header({ title, description, actions, children, className, ...props }: CardHeaderProps) {
  return (
    <div className={cx('q-card-header', className)} {...props}>
      {children ?? (
        <>
          {title != null || description != null
            ? (
                <div className="q-card-heading">
                  {title != null ? <Title>{title}</Title> : null}
                  {description != null ? <Description>{description}</Description> : null}
                </div>
              )
            : null}
          {actions != null ? <div className="q-card-actions">{actions}</div> : null}
        </>
      )}
    </div>
  )
}

type DivProps = ComponentProps<'div'>
// Title / Description render through Typography (exact-equivalent of the
// composite + color the q-card-title / q-card-description CSS already applied):
// `as="div"` preserves the original tag, the q-card-* class is kept (recipe /
// external styling + sibling selectors), and className stays last so callers win.
function Title({ className, color: _color, ...props }: DivProps) {
  return <Typography as="div" variant="body-md-semi-bold" color="primary" className={cx('q-card-title', className)} {...props} />
}
function Description({ className, color: _color, ...props }: DivProps) {
  return <Typography as="div" variant="body-sm-regular" color="secondary" className={cx('q-card-description', className)} {...props} />
}
function Body({ className, ...props }: DivProps) {
  return <div className={cx('q-card-body', className)} {...props} />
}

export type CardFooterProps = ComponentProps<'div'> & {
  actions?: ReactNode
}
function Footer({ actions, children, className, ...props }: CardFooterProps) {
  return (
    <div className={cx('q-card-footer', className)} {...props}>
      {children ?? (actions != null ? <div className="q-card-actions">{actions}</div> : null)}
    </div>
  )
}

export const Card = Object.assign(Root, {
  Header,
  Title,
  Description,
  Body,
  Footer,
})
