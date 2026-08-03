'use client'

import type { ComponentProps, CSSProperties, ReactNode } from 'react'
import { Children } from 'react'
import { Tabs as Primitive } from '@base-ui/react/tabs'
import { cx } from '../utils/cx.ts'
import { type SlotColor, slotStyle } from '../utils/slot.ts'

/**
 * Tabs — Base UI primitive (roving focus, keyboard, ARIA) skinned with quanta.
 * Variants cover the Figma underline tabs, text-pill tabs, and segmented
 * controls. `Tabs.List` includes a Base UI indicator so active states animate
 * between tab positions.
 *
 * Multi-part: `export const Tabs = { Root, List, Tab, Panel }`.
 */

export type TabsVariant = 'underline' | 'pill' | 'segmented' | 'soft'
export type TabsShape = 'rounded' | 'pill' | 'icon'
export type TabsSurface = 'glass' | 'flat'
export type TabsTone = 'default' | 'accent' | 'glass' | 'solid' | 'brandSoft' | 'brand'

const VARIANT_CLASS = {
  underline: 'q-tabs-underline',
  pill: 'q-tabs-pill',
  segmented: 'q-tabs-segmented',
  soft: 'q-tabs-soft',
} satisfies Record<TabsVariant, string>

const SHAPE_CLASS = {
  rounded: 'q-tabs-shape-rounded',
  pill: 'q-tabs-shape-pill',
  icon: 'q-tabs-shape-icon',
} satisfies Record<TabsShape, string>

const SURFACE_CLASS = {
  glass: 'q-tabs-surface-glass',
  flat: 'q-tabs-surface-flat',
} satisfies Record<TabsSurface, string>

const TONE_CLASS = {
  default: 'q-tabs-tone-default',
  accent: 'q-tabs-tone-accent',
  glass: 'q-tabs-tone-glass',
  solid: 'q-tabs-tone-solid',
  brandSoft: 'q-tabs-tone-brand-soft',
  brand: 'q-tabs-tone-brand',
} satisfies Record<TabsTone, string>

export interface TabsOptions {
  color?: SlotColor
  shape?: TabsShape
  surface?: TabsSurface
  tone?: TabsTone
  variant?: TabsVariant
}

export type RootProps = Omit<ComponentProps<typeof Primitive.Root>, 'className'> & {
  className?: string
} & TabsOptions

function Root({
  color = 'brand',
  className,
  shape = 'rounded',
  style,
  surface = 'glass',
  tone,
  variant = 'underline',
  ...props
}: RootProps) {
  const resolvedTone = tone ?? (variant === 'segmented' ? 'glass' : 'default')

  return (
    <Primitive.Root
      style={{ ...slotStyle(color), ...style } as CSSProperties}
      className={cx(
        'q-tabs',
        VARIANT_CLASS[variant],
        SHAPE_CLASS[shape],
        SURFACE_CLASS[surface],
        TONE_CLASS[resolvedTone],
        className,
      )}
      {...props}
    />
  )
}

export type ListProps = Omit<ComponentProps<typeof Primitive.List>, 'className'> & {
  className?: string
  indicator?: boolean
  /** Stretch the list to its container width and size tabs equally. */
  fullWidth?: boolean
  /**
   * Data-driven tabs: renders a `Tabs.Tab` per item instead of composing
   * children. Each item takes the same props as `Tabs.Tab` (`value`, `start`,
   * `end`, `subtitle`, `iconOnly`, `disabled`…) plus `label` for the text.
   * Falls back to `children` when omitted (back-compat).
   */
  items?: TabItem[]
}

function List({ children, items, className, indicator = true, fullWidth = false, ...props }: ListProps) {
  return (
    <Primitive.List
      className={cx('q-tabs-list', fullWidth && 'q-tabs-list-fill', className)}
      {...props}
    >
      {items != null
        ? items.map(({ label, ...tab }, index) => (
            <Tab key={tab.value != null ? String(tab.value) : index} {...tab}>{label}</Tab>
          ))
        : children}
      {indicator ? (
        <Primitive.Indicator
          className="q-tabs-indicator"
          renderBeforeHydration
        />
      ) : null}
    </Primitive.List>
  )
}

export type TabProps = Omit<ComponentProps<typeof Primitive.Tab>, 'className'> & {
  children?: ReactNode
  className?: string
  iconOnly?: boolean
  /** Leading slot (icon / any node). Canonical — matches Button/Chip/Input/Item. */
  start?: ReactNode
  /** Trailing slot (icon / badge / any node), after the label. */
  end?: ReactNode
  /** Muted secondary label rendered after the primary text. */
  subtitle?: ReactNode
  /** @deprecated Use `start`. */
  icon?: ReactNode
  /** @deprecated Use `end`. */
  iconEnd?: ReactNode
  /** @deprecated Use `subtitle`. */
  secondaryText?: ReactNode
  /** Class for the inner content wrapper (gap/padding live here). */
  contentClassName?: string
}

/** A data-driven tab for `Tabs.List items` — every `Tabs.Tab` prop plus `label` (the text). */
export type TabItem = Omit<TabProps, 'children'> & { label?: ReactNode }

/**
 * Wrap each string/number child in a width-locking "ghost" span. The visible
 * text can switch weight (medium ↔ semibold) on selection without changing the
 * box width, because an invisible bold copy reserves the widest footprint via
 * a 1×1 grid stack. This kills the sub-pixel reflow that made the sliding
 * indicator and neighbouring tabs wobble on select. Non-text nodes (icons)
 * pass through untouched.
 */
function lockTextWidth(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === 'string' || typeof child === 'number') {
      return (
        <span className="q-tabs-tab-text" data-text={String(child)}>
          {child}
        </span>
      )
    }
    return child
  })
}

function Tab({
  children,
  className,
  iconOnly = false,
  start,
  end,
  subtitle,
  icon,
  iconEnd,
  secondaryText,
  contentClassName,
  ...props
}: TabProps) {
  // Canonical start/end/subtitle, with the legacy icon/iconEnd/secondaryText
  // names kept as aliases (byte-identical rendering) for back-compat.
  const lead = start ?? icon
  const trail = end ?? iconEnd
  const sub = subtitle ?? secondaryText
  // Slot mode only when a slot prop is supplied. Otherwise render children
  // bare inside the flex content (preserving the icon-as-children pattern used
  // by the underline/pill/segmented variants, where the content gap spaces an
  // inline <Icon/> + label).
  const useSlots = lead != null || trail != null || sub != null
  return (
    <Primitive.Tab
      className={cx(
        'q-tabs-tab',
        iconOnly && 'q-tabs-tab-icon-only',
        className,
      )}
      {...props}
    >
      <span className={cx('q-tabs-tab-content', contentClassName)}>
        {useSlots ? (
          <>
            {lead != null ? <span className="q-tabs-tab-icon">{lead}</span> : null}
            {children != null ? <span className="q-tabs-tab-label">{lockTextWidth(children)}</span> : null}
            {sub != null ? <span className="q-tabs-tab-secondary">{sub}</span> : null}
            {trail != null ? <span className="q-tabs-tab-icon">{trail}</span> : null}
          </>
        ) : (
          lockTextWidth(children)
        )}
      </span>
    </Primitive.Tab>
  )
}

export type PanelProps = Omit<ComponentProps<typeof Primitive.Panel>, 'className'> & { className?: string }

function Panel({ className, ...props }: PanelProps) {
  return (
    <Primitive.Panel
      className={cx('q-tabs-panel', className)}
      {...props}
    />
  )
}

export const Tabs = { Root, List, Tab, Panel }
