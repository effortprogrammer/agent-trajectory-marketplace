'use client'

import type { ComponentProps, ReactNode } from 'react'
import { createContext, useContext } from 'react'
import { Tooltip as Primitive } from '@base-ui/react/tooltip'
import { cx } from '../utils/cx.ts'

/**
 * Tooltip — a hover/focus popup on the Base UI `Tooltip` primitive (open timing,
 * focus/hover triggers, ARIA, portal + collision-aware positioning), skinned
 * with quanta's `q-tooltip-*` presentation utilities (see `tooltip.css`).
 *
 * COMPOSITION-FIRST. The parts mirror Base UI: `Tooltip.Provider` (optional,
 * groups delay so adjacent tooltips open instantly), `Tooltip.Root` (open state
 * + delay), `Tooltip.Trigger` (anchor — `render` any element/quanta component),
 * `Tooltip.Content` (the popup; bundles Portal → Positioner → Popup and an
 * optional Arrow). The skin is the standard small inverted surface
 * (`background-inverse` + `text-inverse`).
 *
 *   <Tooltip.Root>
 *     <Tooltip.Trigger render={<Button iconOnly aria-label="Settings"><Icon><GearIcon /></Icon></Button>} />
 *     <Tooltip.Content>Settings</Tooltip.Content>
 *   </Tooltip.Root>
 *
 * Wrap a cluster of triggers in `Tooltip.Provider` to share the open delay:
 *
 *   <Tooltip.Provider delay={300}>
 *     <Tooltip.Root>…</Tooltip.Root>
 *     <Tooltip.Root>…</Tooltip.Root>
 *   </Tooltip.Provider>
 */

export type TooltipSide = NonNullable<ComponentProps<typeof Primitive.Positioner>['side']>
export type TooltipAlign = NonNullable<ComponentProps<typeof Primitive.Positioner>['align']>

/* ── Provider (optional shared-delay grouping) ─────────────────────────────── */

export type TooltipProviderProps = ComponentProps<typeof Primitive.Provider>

function Provider(props: TooltipProviderProps) {
  return <Primitive.Provider {...props} />
}

/* Delay flows Root → Trigger via context so callers set it once on Root. */
const DelayContext = createContext<{ delay?: number, closeDelay?: number }>({})

/* ── Root (open state + per-trigger delay convenience) ─────────────────────── */

export type TooltipRootProps = Omit<ComponentProps<typeof Primitive.Root>, 'children'> & {
  /** Trigger + Content. */
  children?: ReactNode
  /** Delay (ms) before opening on hover. Default 600 (Base UI). */
  delay?: number
  /** Delay (ms) before closing after the pointer leaves. Default 0. */
  closeDelay?: number
  /** Allow hovering into the popup itself without closing. */
  hoverable?: boolean
}

/**
 * Root groups the parts and owns open state. `delay` / `closeDelay` are forwarded
 * to the Trigger (where Base UI reads them); `hoverable` maps to Base UI's
 * `disableHoverablePopup` (inverted), defaulting to a non-hoverable tooltip.
 */
function Root({ delay, closeDelay, hoverable = false, children, ...props }: TooltipRootProps) {
  return (
    <Primitive.Root disableHoverablePopup={!hoverable} {...props}>
      <DelayContext.Provider value={{ delay, closeDelay }}>{children}</DelayContext.Provider>
    </Primitive.Root>
  )
}

/* ── Trigger ───────────────────────────────────────────────────────────────── */

export type TooltipTriggerProps = Omit<ComponentProps<typeof Primitive.Trigger>, 'className'> & {
  className?: string
}

/**
 * Trigger is a pure anchor: Base UI renders the caller's element (via `render`),
 * which owns all presentation, so there is no `q-tooltip-trigger` skin — any
 * `className` is forwarded straight through.
 */
function Trigger({ className, delay, closeDelay, ...props }: TooltipTriggerProps) {
  const ctx = useContext(DelayContext)
  return (
    <Primitive.Trigger
      className={className}
      delay={delay ?? ctx.delay}
      closeDelay={closeDelay ?? ctx.closeDelay}
      {...props}
    />
  )
}

/* ── Content (Portal → Positioner → Popup, optional Arrow) ─────────────────── */

export type TooltipContentProps = Omit<ComponentProps<typeof Primitive.Popup>, 'className'> & {
  className?: string
  positionerClassName?: string
  side?: TooltipSide
  align?: TooltipAlign
  sideOffset?: ComponentProps<typeof Primitive.Positioner>['sideOffset']
  alignOffset?: ComponentProps<typeof Primitive.Positioner>['alignOffset']
  collisionPadding?: ComponentProps<typeof Primitive.Positioner>['collisionPadding']
  container?: ComponentProps<typeof Primitive.Portal>['container']
  /** Render a pointing arrow on the anchored side. */
  arrow?: boolean
  /** Keep the popup mounted while hidden (e.g. for exit animations). */
  keepMounted?: boolean
}

function Content({
  className,
  positionerClassName,
  side = 'top',
  align = 'center',
  sideOffset = 6,
  alignOffset,
  collisionPadding = 8,
  container,
  arrow = false,
  keepMounted,
  children,
  ...props
}: TooltipContentProps) {
  return (
    <Primitive.Portal container={container} keepMounted={keepMounted}>
      <Primitive.Positioner
        className={cx('q-tooltip-positioner', positionerClassName)}
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        collisionPadding={collisionPadding}
      >
        <Primitive.Popup role="tooltip" className={cx('q-tooltip', className)} {...props}>
          {children}
          {arrow ? <Primitive.Arrow className="q-tooltip-arrow" /> : null}
        </Primitive.Popup>
      </Primitive.Positioner>
    </Primitive.Portal>
  )
}

export const Tooltip = {
  Provider,
  Root,
  Trigger,
  Content,
}
