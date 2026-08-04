'use client'

import type { ComponentProps, ReactElement, ReactNode } from 'react'
import { Children, cloneElement, isValidElement } from 'react'
import type { ButtonSize, ButtonVariant } from '../button/index.ts'
import type { ClassValue } from '../utils/cx.ts'
import { cx } from '../utils/cx.ts'

export type ButtonGroupOrientation = 'horizontal' | 'vertical'

export interface ButtonGroupOptions {
  /** Layout axis. `horizontal` (default) lays buttons in a row; `vertical` in a column. */
  orientation?: ButtonGroupOrientation
  /**
   * `true` (default) joins the buttons into a segmented control: inner corner
   * radii are removed and adjacent borders collapse onto one shared hairline so
   * only the outer corners stay rounded. `false` renders a spaced row/column
   * with a small gap between independent buttons.
   */
  attached?: boolean
}

/**
 * Orientation → axis class. The literal strings (not a template) are what the
 * Tailwind scanner extracts from this file — see `@source "./button-group.tsx"`
 * in button-group.css. `satisfies Record<…>` keeps the union the single source
 * of truth.
 */
const ORIENTATION_CLASS = {
  horizontal: 'q-button-group-horizontal',
  vertical: 'q-button-group-vertical',
} satisfies Record<ButtonGroupOrientation, string>

/** Build the button-group class string. Also usable to style a non-div host. */
export function buttonGroup(options: ButtonGroupOptions = {}, ...extra: ClassValue[]): string {
  const { orientation = 'horizontal', attached = true } = options
  return cx(
    'q-button-group',
    ORIENTATION_CLASS[orientation],
    attached ? 'q-button-group-attached' : 'q-button-group-spaced',
    ...extra,
  )
}

export type ButtonGroupProps = ComponentProps<'div'> & ButtonGroupOptions & {
  /**
   * Propagate one `size` to every child `<Button>` via `cloneElement`, so the
   * caller sets it once for the whole group. A child's own `size` wins (it is
   * only injected where the child didn't set one).
   */
  size?: ButtonSize
  /** Propagate one `variant` to every child `<Button>` — same precedence as `size`. */
  variant?: ButtonVariant
  /** The grouped buttons. Any node; quanta `<Button>`s get `size`/`variant` injected. */
  children?: ReactNode
}

/** Children that already declare the prop keep their own value; otherwise inject the group default. */
function injectSharedProps(
  children: ReactNode,
  shared: { size?: ButtonSize, variant?: ButtonVariant },
): ReactNode {
  if (shared.size === undefined && shared.variant === undefined) return children
  return Children.map(children, (child) => {
    if (!isValidElement(child)) return child
    const childProps = child.props as { size?: ButtonSize, variant?: ButtonVariant }
    const next: { size?: ButtonSize, variant?: ButtonVariant } = {}
    if (shared.size !== undefined && childProps.size === undefined) next.size = shared.size
    if (shared.variant !== undefined && childProps.variant === undefined) next.variant = shared.variant
    return Object.keys(next).length
      ? cloneElement(child as ReactElement<{ size?: ButtonSize, variant?: ButtonVariant }>, next)
      : child
  })
}

/**
 * ButtonGroup — a pure-quanta layout that groups quanta `<Button>`s into a row
 * or column. Two shapes:
 *
 *   attached (default) → a segmented control: inner radii removed, adjacent
 *     borders collapse to one shared hairline, only the outer corners round.
 *   spaced            → independent buttons with a small gap.
 *
 * It renders a `role="group"` div (pass `aria-label` to name it) and forwards
 * `ref` + `...props` to that div. Set `size` / `variant` once and they propagate
 * to every child `<Button>` (a child's own value wins).
 *
 *   <ButtonGroup aria-label="Text style" variant="outline">
 *     <Button>Bold</Button><Button>Italic</Button><Button>Underline</Button>
 *   </ButtonGroup>
 */
export function ButtonGroup({
  orientation = 'horizontal',
  attached = true,
  size,
  variant,
  className,
  children,
  ...props
}: ButtonGroupProps) {
  return (
    <div
      role="group"
      className={buttonGroup({ orientation, attached }, className)}
      {...props}
    >
      {injectSharedProps(children, { size, variant })}
    </div>
  )
}
