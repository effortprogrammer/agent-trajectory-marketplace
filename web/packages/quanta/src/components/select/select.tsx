'use client'

import type { ComponentProps, ReactNode, Ref } from 'react'
import { createContext, useContext } from 'react'
import { IconCheckmark2MediumOutlined as CheckIcon } from '@higgsfield-ai/icons/IconCheckmark2MediumOutlined'
import { IconChevronDownMediumOutlined as ChevronIcon } from '@higgsfield-ai/icons/IconChevronDownMediumOutlined'
import { Select as Primitive } from '@base-ui/react/select'
import { cx } from '../utils/cx.ts'

/**
 * Select — a form-field dropdown on the Base UI `Select` primitive (controlled /
 * uncontrolled value, single or `multiple`, keyboard typeahead, ARIA listbox,
 * portal + positioning, hidden form input), skinned with quanta tokens.
 *
 * The TRIGGER looks like an `Input` field: the shared `q-field-control` surface
 * (bordered, ~40px tall, white-5% fill, lime focus ring, red `invalid` ring) with
 * a chevron `Select.Icon` on the right that flips on open and a placeholder when
 * empty. The POPUP is the dropdown glass/solid surface (`q-dropdown-content`),
 * and each option reuses the shared `q-menu-item*` row primitives (see menu.css),
 * so Select and Dropdown stay visually identical.
 *
 * COMPOSITION-FIRST. `Select.Item` renders whatever children you give it — wrap
 * `Select.ItemText` (the label echoed back into the trigger) with any leading
 * icon, badge, or meta, and a trailing check `Select.ItemIndicator` paints
 * automatically when the row is selected. Group options with `Select.Group` +
 * `Select.GroupLabel`, divide with `Select.Separator`:
 *
 *   <Select.Root defaultValue="soul" onValueChange={setModel}>
 *     <Select.Trigger>
 *       <Select.Value placeholder="Choose a model" />
 *       <Select.Icon />
 *     </Select.Trigger>
 *     <Select.Content>
 *       <Select.Group>
 *         <Select.GroupLabel>Models</Select.GroupLabel>
 *         <Select.Item value="soul">
 *           <Select.ItemIcon><HiggsfieldIcon /></Select.ItemIcon>
 *           <Select.ItemText>Soul 2.0</Select.ItemText>
 *           <Select.ItemIndicator />
 *         </Select.Item>
 *       </Select.Group>
 *     </Select.Content>
 *   </Select.Root>
 */

export type SelectSize = 'sm' | 'md' | 'lg'
export type SelectContentSurface = 'glass' | 'solid'
export type SelectContentSize = 'default' | 'picker'

/* ── Root (owns value/open state via Base UI) ──────────────────────────────── */

/**
 * `connected` flows Root → Trigger + Content so both parts coordinate the
 * seamless seam (the popup attaches flush to the field as one surface) without
 * the caller wiring two props.
 */
const SelectUiContext = createContext<{ connected: boolean }>({ connected: false })

type RootProps<Value, Multiple extends boolean | undefined> = Primitive.Root.Props<Value, Multiple> & {
  /**
   * Render the popup as a seamless extension of the trigger: same width, no gap,
   * and merged corners so the field + list read as one continuous surface.
   */
  connected?: boolean
}

/** Groups all parts; passes `value`/`defaultValue`/`onValueChange`/`multiple` straight through. */
function Root<Value, Multiple extends boolean | undefined = false>({ connected = false, ...props }: RootProps<Value, Multiple>) {
  return (
    <SelectUiContext.Provider value={{ connected }}>
      <Primitive.Root {...props} />
    </SelectUiContext.Provider>
  )
}

/* ── Trigger (the form-field surface) ──────────────────────────────────────── */

const TRIGGER_SIZE_CLASS = {
  sm: 'q-select-trigger-sm',
  md: '',
  lg: 'q-select-trigger-lg',
} satisfies Record<SelectSize, string>

type TriggerProps = Omit<ComponentProps<typeof Primitive.Trigger>, 'className'> & {
  className?: string
  /** Trigger height/type scale. `md` (40px) is the default Figma field size. */
  size?: SelectSize
  /** Invalid (error) state — paints the red field ring. */
  invalid?: boolean
  /**
   * Skip the field-surface classes entirely — the `render` host owns ALL
   * styling. Use when the trigger is another quanta control, e.g. the builder
   * setting row: `<Select.Trigger bare render={<SettingTrigger label="Voice" />}>`.
   * Base UI still drives `data-popup-open` / `data-placeholder` on the host.
   */
  bare?: boolean
}

function Trigger({ className, size = 'md', invalid = false, bare = false, ...props }: TriggerProps) {
  const { connected } = useContext(SelectUiContext)
  return (
    <Primitive.Trigger
      className={cx(
        !bare && 'q-field-control',
        !bare && 'q-select-trigger',
        !bare && TRIGGER_SIZE_CLASS[size],
        !bare && connected && 'q-select-trigger-connected',
        invalid && 'q-field-control-invalid',
        className,
      )}
      data-invalid={invalid ? '' : undefined}
      {...props}
    />
  )
}

/* ── Value (selected label echoed into the trigger) ────────────────────────── */

type ValueProps = Omit<ComponentProps<typeof Primitive.Value>, 'className'> & {
  className?: string
}

function Value({ className, ...props }: ValueProps) {
  return <Primitive.Value className={cx('q-select-value', className)} {...props} />
}

/* ── Icon (the trigger chevron — flips on open) ────────────────────────────── */

type IconProps = Omit<ComponentProps<typeof Primitive.Icon>, 'className'> & {
  className?: string
}

function Icon({ className, children, ...props }: IconProps) {
  return (
    <Primitive.Icon className={cx('q-select-icon', className)} {...props}>
      {children ?? <ChevronIcon />}
    </Primitive.Icon>
  )
}

/* ── Content (Portal + Positioner + Popup + scrollable List) ───────────────── */

const SURFACE_CLASS = {
  glass: '',
  solid: 'q-dropdown-content-solid',
} satisfies Record<SelectContentSurface, string>

/** `picker` — the builder-picker preset (Duration / Aspect Ratio / Voice rows):
 * compact two-line rows, body-sm titles, accent check. */
const CONTENT_SIZE_CLASS = {
  default: '',
  picker: 'q-select-content-picker',
} satisfies Record<SelectContentSize, string>

type ContentProps = Omit<ComponentProps<typeof Primitive.Popup>, 'className'> & {
  className?: string
  positionerClassName?: string
  surface?: SelectContentSurface
  /** Popup scale: `default` menu rows or the compact `picker` builder rows. */
  size?: SelectContentSize
  side?: ComponentProps<typeof Primitive.Positioner>['side']
  align?: ComponentProps<typeof Primitive.Positioner>['align']
  sideOffset?: ComponentProps<typeof Primitive.Positioner>['sideOffset']
  alignOffset?: ComponentProps<typeof Primitive.Positioner>['alignOffset']
  collisionPadding?: ComponentProps<typeof Primitive.Positioner>['collisionPadding']
  /**
   * Whether the popup overlaps the trigger so the selected row aligns with the
   * trigger value. Off by default so the popup sits below the field like a menu.
   */
  alignItemWithTrigger?: boolean
  container?: ComponentProps<typeof Primitive.Portal>['container']
}

function Content({
  className,
  positionerClassName,
  surface = 'glass',
  size = 'default',
  side = 'bottom',
  align = 'start',
  sideOffset = 4,
  alignOffset,
  collisionPadding,
  alignItemWithTrigger = false,
  container,
  children,
  ...props
}: ContentProps) {
  const { connected } = useContext(SelectUiContext)
  // Connected = the popup NESTS the field: a wider rounded card that overlaps and
  // sits BEHIND the still-rounded trigger (the field gets a higher z-index), with
  // top padding so the rows clear the field. We pull the popup up over the trigger
  // (negative sideOffset, tuned to the default 40px field) and centre it so the
  // narrower field tucks inside the wider popup. It is rendered WITHOUT the portal
  // so the trigger can paint on top of the popup in the same stacking context.
  const tree = (
    <Primitive.Positioner
      className={cx('q-select-positioner', connected && 'q-select-positioner-connected', positionerClassName)}
      side={side}
      align={connected ? 'center' : align}
      sideOffset={connected ? -48 : sideOffset}
      alignOffset={alignOffset}
      collisionPadding={collisionPadding}
      alignItemWithTrigger={alignItemWithTrigger}
    >
      <Primitive.Popup
        className={cx('q-dropdown-content', 'q-select-content', SURFACE_CLASS[surface], CONTENT_SIZE_CLASS[size], connected && 'q-select-content-connected', className)}
        {...props}
      >
        <Primitive.ScrollUpArrow className="q-select-scroll-arrow q-select-scroll-arrow-up" />
        <Primitive.List className="q-select-list">{children}</Primitive.List>
        <Primitive.ScrollDownArrow className="q-select-scroll-arrow q-select-scroll-arrow-down" />
      </Primitive.Popup>
    </Primitive.Positioner>
  )
  return connected ? tree : <Primitive.Portal container={container}>{tree}</Primitive.Portal>
}

/* ── Group + GroupLabel + Separator ────────────────────────────────────────── */

type GroupProps = Omit<ComponentProps<typeof Primitive.Group>, 'className'> & {
  className?: string
}

function Group({ className, ...props }: GroupProps) {
  return <Primitive.Group className={cx('q-select-group', className)} {...props} />
}

type GroupLabelProps = Omit<ComponentProps<typeof Primitive.GroupLabel>, 'className'> & {
  className?: string
}

function GroupLabel({ className, ...props }: GroupLabelProps) {
  return <Primitive.GroupLabel className={cx('q-menu-group-label', className)} {...props} />
}

type SeparatorProps = Omit<ComponentProps<typeof Primitive.Separator>, 'className'> & {
  className?: string
}

function Separator({ className, ...props }: SeparatorProps) {
  return <Primitive.Separator className={cx('q-select-separator', className)} {...props} />
}

/* ── Item + its composable parts ───────────────────────────────────────────── */

type ItemProps = Omit<ComponentProps<typeof Primitive.Item>, 'className'> & {
  className?: string
  ref?: Ref<HTMLDivElement>
}

function Item({ className, ...props }: ItemProps) {
  return <Primitive.Item className={cx('q-menu-item', 'q-select-item', className)} {...props} />
}

/** Leading icon slot (20px). Reuses the shared menu primitive. */
function ItemIcon({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cx('q-menu-item-icon', className)} {...props} />
}

/**
 * Content column — stacks `ItemText` over `ItemDescription` (shared menu
 * primitive). Use for two-line options like "1 minute / Choose duration…".
 * A `div` (not span): Base UI's `ItemText` renders a div and must nest validly.
 */
function ItemContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx('q-menu-item-label', className)} {...props} />
}

/** Secondary line under the option label. Reuses the shared menu primitive. */
function ItemDescription({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cx('q-menu-item-description', className)} {...props} />
}

type ItemTextProps = Omit<ComponentProps<typeof Primitive.ItemText>, 'className'> & {
  className?: string
}

/** The option label echoed back into the trigger `Value` when selected. */
function ItemText({ className, ...props }: ItemTextProps) {
  return <Primitive.ItemText className={cx('q-select-item-text', className)} {...props} />
}

type ItemIndicatorProps = Omit<ComponentProps<typeof Primitive.ItemIndicator>, 'className'> & {
  className?: string
  children?: ReactNode
}

/** Trailing check — Base UI mounts it only while the row is selected. */
function ItemIndicator({ className, children, ...props }: ItemIndicatorProps) {
  return (
    <Primitive.ItemIndicator className={cx('q-select-item-indicator', className)} {...props}>
      {children ?? <CheckIcon className="q-dropdown-check" />}
    </Primitive.ItemIndicator>
  )
}

export const Select = {
  Root,
  Trigger,
  Value,
  Icon,
  Content,
  Group,
  GroupLabel,
  Separator,
  Item,
  ItemIcon,
  ItemContent,
  ItemText,
  ItemDescription,
  ItemIndicator,
}
