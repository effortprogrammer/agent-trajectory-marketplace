'use client'

import type { ComponentProps, ReactNode, Ref } from 'react'
import { IconCheckmark2MediumOutlined as CheckIcon } from '@higgsfield-ai/icons/IconCheckmark2MediumOutlined'
import { IconChevronRightMediumOutlined as ChevronRightIcon } from '@higgsfield-ai/icons/IconChevronRightMediumOutlined'
import { IconMagnifyingGlass2Outlined as SearchIcon } from '@higgsfield-ai/icons/IconMagnifyingGlass2Outlined'
import {
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Menu as Primitive } from '@base-ui/react/menu'
import { Checkbox } from '../checkbox/index.ts'
import { Divider } from '../divider/index.ts'
import { NotFound } from '../not-found/index.ts'
import { Switch } from '../switch/index.ts'
import { cx } from '../utils/cx.ts'

/**
 * Dropdown — a click-triggered menu on the Base UI `Menu` primitive (roving
 * focus, typeahead, keyboard, ARIA, portal + positioning, submenu timing),
 * skinned with quanta's `q-dropdown-*` presentation utilities (see
 * `dropdown.css`). The row shell reuses the shared `q-menu-item*` primitives
 * (see `menu.css`) so the dropdown and navigation-menu stay visually identical.
 *
 * SLOTS BY DEFAULT, composition when you need it. The common row is one tag —
 * pass `start` / `media` / `title` / `subtitle` / `badge` / `end` and `Item`
 * builds the standard anatomy (and, for `selectable` rows, the indicator) for
 * you. Drop down to the exported parts only for a bespoke layout:
 *
 *   <Dropdown.Root selectionMode="single" onSelected={([id]) => setModel(id)}>
 *     <Dropdown.Trigger render={<Button>Open</Button>} />
 *     <Dropdown.Content withSearch>
 *       <Dropdown.Group>
 *         <Dropdown.Label>Models</Dropdown.Label>
 *
 *         // easy — slot props build the row + indicator
 *         <Dropdown.Item
 *           selectable
 *           media={<img src={cover} />}
 *           title="Soul 2.0"
 *           subtitle="Ultra-real visuals"
 *           badge={<Badge variant="lime" text="new" />}
 *         />
 *         <Dropdown.Item title="Credits" end="2,482 left" />
 *
 *         // full control — compose the parts yourself
 *         <Dropdown.Item value="custom">
 *           <Dropdown.ItemContent>
 *             <Dropdown.ItemTitleRow><Dropdown.ItemTitle>Custom</Dropdown.ItemTitle></Dropdown.ItemTitleRow>
 *           </Dropdown.ItemContent>
 *         </Dropdown.Item>
 *       </Dropdown.Group>
 *     </Dropdown.Content>
 *   </Dropdown.Root>
 *
 * SELECTION STATE just works. A `selectable` Item is stateful on its own — with
 * no `value` and no handlers it toggles internally (keyed by its `title`/text
 * through `Root`, or its own state as a last resort). To be notified, pass ONE
 * handler: `onSelected` on Root (the full `string[]`) or `onCheckedChange` on
 * the Item (that row's boolean). Control it by passing `selected` on Root or
 * `checked` on the Item; either still fires the handlers.
 *
 * `withSearch` on Content adds a filter bar that hides non-matching Items (and
 * empty Groups / Subs) live. An Item's searchable text is its `value` prop, or
 * — when omitted — the plain text extracted from its children.
 */

export type DropdownIndicator = 'check' | 'checkbox' | 'switch'
export type DropdownSelectionMode = 'single' | 'multiple'
export type DropdownContentSurface = 'glass' | 'solid'
export type DropdownContentShape = 'default' | 'panel'
export type DropdownContentSize = 'compact' | 'default' | 'large'

/* ── Search filtering ──────────────────────────────────────────────────────── */

const QueryContext = createContext<string>('')

/**
 * Render-time match tally. The old static walk (subtreeMatches) couldn't see
 * Items wrapped in custom components, so search broke for every composed row.
 * Instead each Item bumps this counter when it actually renders (matched), and a
 * gate rendered AFTER the list reads the total — works for any composition.
 */
const MatchCountContext = createContext<{ n: number } | null>(null)

/** Per-Group tally (same idea, scoped) so a Group can hide when all ITS rows filter out. */
const GroupCountContext = createContext<{ n: number } | null>(null)

/** Pull the plain text out of an arbitrary ReactNode (best-effort, for search). */
function extractText(node: ReactNode): string {
  if (node == null || node === false || node === true)
    return ''
  if (typeof node === 'string' || typeof node === 'number')
    return String(node)
  if (Array.isArray(node))
    return node.map(extractText).join(' ')
  if (isValidElement(node))
    return extractText((node.props as { children?: ReactNode }).children)
  return ''
}

/** All whitespace-split terms must appear (case-insensitive substring). */
function matchQuery(text: string, query: string): boolean {
  if (!query)
    return true
  const haystack = text.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every(term => haystack.includes(term))
}

/** Searchable / selection-key text for an Item: explicit `value`, else its `title`, else its children. */
function itemText(props: ItemProps): string {
  if (props.value != null)
    return props.value
  const fromTitle = extractText(props.title)
  return fromTitle || extractText(props.children)
}

/* ── Selection state (owned by Root, exposed as `selected: string[]`) ──────── */

interface SelectionContextValue {
  selected: string[]
  isSelected: (value: string) => boolean
  toggle: (value: string, next: boolean) => void
}

const SelectionContext = createContext<SelectionContextValue | null>(null)

interface OpenContextValue {
  open: boolean
  openOnHover: boolean
  scheduleHoverOpen: () => void
  scheduleHoverClose: () => void
  cancelHoverClose: () => void
}

const noop = () => {}

const OpenContext = createContext<OpenContextValue>({
  open: false,
  openOnHover: false,
  scheduleHoverOpen: noop,
  scheduleHoverClose: noop,
  cancelHoverClose: noop,
})

const HOVER_OPEN_DELAY = 80
const HOVER_CLOSE_DELAY = 120

/* ── Per-item state (lets composed parts read the row's selection/disabled) ── */

interface ItemContextValue {
  checked: boolean
  disabled: boolean
  selectable: boolean
  value?: string
}

const ItemContext = createContext<ItemContextValue>({
  checked: false,
  disabled: false,
  selectable: false,
})

/* ── Trigger ──────────────────────────────────────────────────────────────── */

type TriggerProps = Omit<ComponentProps<typeof Primitive.Trigger>, 'className'> & {
  className?: string
}

function Trigger({ className, onPointerEnter, onPointerLeave, ...props }: TriggerProps) {
  const { open, openOnHover, scheduleHoverOpen, scheduleHoverClose, cancelHoverClose } = useContext(OpenContext)
  const handlePointerEnter = useCallback<NonNullable<TriggerProps['onPointerEnter']>>((event) => {
    onPointerEnter?.(event)
    if (!event.defaultPrevented && openOnHover) {
      cancelHoverClose()
      scheduleHoverOpen()
    }
  }, [cancelHoverClose, onPointerEnter, openOnHover, scheduleHoverOpen])
  const handlePointerLeave = useCallback<NonNullable<TriggerProps['onPointerLeave']>>((event) => {
    onPointerLeave?.(event)
    if (!event.defaultPrevented && openOnHover)
      scheduleHoverClose()
  }, [onPointerLeave, openOnHover, scheduleHoverClose])

  return (
    <Primitive.Trigger
      {...props}
      className={cx('q-dropdown-trigger', className)}
      data-open={open ? '' : undefined}
      data-popup-open={open ? '' : undefined}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    />
  )
}

/* ── Root ─────────────────────────────────────────────────────────────────── */

type RootProps = ComponentProps<typeof Primitive.Root> & {
  /** Controlled set of selected item `value`s. Pair with `onSelected`. */
  selected?: string[]
  /** Initial selection for the uncontrolled (internal-state) case. */
  defaultSelected?: string[]
  /** Subscribe to selection changes — fires with the next `string[]`. */
  onSelected?: (selected: string[]) => void
  /** 'multiple' (default) toggles items independently; 'single' keeps one. */
  selectionMode?: DropdownSelectionMode
  /** Open from pointer hover as well as click. Pointer leave closes after a short menu-safe delay. */
  openOnHover?: boolean
}

type RootOpenChangeHandler = NonNullable<RootProps['onOpenChange']>
type RootOpenChangeEvent = Parameters<RootOpenChangeHandler>[1]

/**
 * Root owns selection state. Uncontrolled by default (internal `useState`
 * seeded by `defaultSelected`); pass `selected` to control it. Either way,
 * `onSelected` fires with the next array on every change.
 */
function Root({
  open,
  defaultOpen,
  onOpenChange,
  selected,
  defaultSelected,
  onSelected,
  selectionMode = 'multiple',
  openOnHover = false,
  ...props
}: RootProps) {
  const [internal, setInternal] = useState<string[]>(defaultSelected ?? [])
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false)
  const hoverOpenTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isControlled = selected != null
  const current = isControlled ? selected : internal
  const isOpenControlled = open != null
  const currentOpen = isOpenControlled ? open : internalOpen

  const isSelected = useCallback((value: string) => current.includes(value), [current])

  const toggle = useCallback((value: string, next: boolean) => {
    const compute = (prev: string[]): string[] => {
      if (selectionMode === 'single')
        return next ? [value] : prev.filter(v => v !== value)
      if (next)
        return prev.includes(value) ? prev : [...prev, value]
      return prev.filter(v => v !== value)
    }
    if (isControlled) {
      onSelected?.(compute(current))
    }
    else {
      setInternal((prev) => {
        const nextState = compute(prev)
        onSelected?.(nextState)
        return nextState
      })
    }
  }, [current, isControlled, onSelected, selectionMode])

  const ctx = useMemo<SelectionContextValue>(
    () => ({ selected: current, isSelected, toggle }),
    [current, isSelected, toggle],
  )

  const cancelHoverOpen = useCallback(() => {
    if (hoverOpenTimeoutRef.current == null)
      return
    clearTimeout(hoverOpenTimeoutRef.current)
    hoverOpenTimeoutRef.current = null
  }, [])

  const cancelHoverClose = useCallback(() => {
    if (hoverCloseTimeoutRef.current == null)
      return
    clearTimeout(hoverCloseTimeoutRef.current)
    hoverCloseTimeoutRef.current = null
  }, [])

  const updateOpen = useCallback((next: boolean, event?: RootOpenChangeEvent) => {
    cancelHoverOpen()
    cancelHoverClose()
    if (currentOpen === next)
      return
    if (!isOpenControlled)
      setInternalOpen(next)
    onOpenChange?.(next, event as RootOpenChangeEvent)
  }, [cancelHoverClose, cancelHoverOpen, currentOpen, isOpenControlled, onOpenChange])

  const scheduleHoverOpen = useCallback(() => {
    if (!openOnHover || currentOpen)
      return
    cancelHoverClose()
    cancelHoverOpen()
    hoverOpenTimeoutRef.current = setTimeout(() => {
      hoverOpenTimeoutRef.current = null
      updateOpen(true)
    }, HOVER_OPEN_DELAY)
  }, [cancelHoverClose, cancelHoverOpen, currentOpen, openOnHover, updateOpen])
  const scheduleHoverClose = useCallback(() => {
    if (!openOnHover)
      return
    cancelHoverOpen()
    cancelHoverClose()
    hoverCloseTimeoutRef.current = setTimeout(() => updateOpen(false), HOVER_CLOSE_DELAY)
  }, [cancelHoverClose, cancelHoverOpen, openOnHover, updateOpen])

  const openCtx = useMemo<OpenContextValue>(
    () => ({ open: currentOpen, openOnHover, scheduleHoverOpen, scheduleHoverClose, cancelHoverClose }),
    [cancelHoverClose, currentOpen, openOnHover, scheduleHoverClose, scheduleHoverOpen],
  )

  const handleOpenChange = useCallback<RootOpenChangeHandler>((next, event) => {
    updateOpen(next, event as RootOpenChangeEvent)
  }, [updateOpen])

  useEffect(() => () => {
    cancelHoverOpen()
    cancelHoverClose()
  }, [cancelHoverClose, cancelHoverOpen])

  return (
    <OpenContext.Provider value={openCtx}>
      <SelectionContext.Provider value={ctx}>
        <Primitive.Root open={currentOpen} onOpenChange={handleOpenChange} {...props} />
      </SelectionContext.Provider>
    </OpenContext.Provider>
  )
}

/* ── Content (Portal + Positioner + Popup, optional search) ────────────────── */

type ContentProps = Omit<ComponentProps<typeof Primitive.Popup>, 'className'> & {
  className?: string
  positionerClassName?: string
  size?: DropdownContentSize
  surface?: DropdownContentSurface
  shape?: DropdownContentShape
  side?: ComponentProps<typeof Primitive.Positioner>['side']
  align?: ComponentProps<typeof Primitive.Positioner>['align']
  sideOffset?: ComponentProps<typeof Primitive.Positioner>['sideOffset']
  alignOffset?: ComponentProps<typeof Primitive.Positioner>['alignOffset']
  collisionPadding?: ComponentProps<typeof Primitive.Positioner>['collisionPadding']
  container?: ComponentProps<typeof Primitive.Portal>['container']
  /** Show a search bar that filters items live. */
  withSearch?: boolean
  searchPlaceholder?: string
  /** Rendered in place of the list when a search filters out every item. */
  notFound?: ReactNode
}

const SIZE_CLASS = {
  compact: 'q-dropdown-content-compact',
  default: '',
  large: 'q-dropdown-content-large',
} satisfies Record<DropdownContentSize, string>

const SURFACE_CLASS = {
  glass: '',
  solid: 'q-dropdown-content-solid',
} satisfies Record<DropdownContentSurface, string>

const SHAPE_CLASS = {
  default: '',
  panel: 'q-dropdown-content-panel',
} satisfies Record<DropdownContentShape, string>

function contentClass(size: DropdownContentSize, surface: DropdownContentSurface, shape: DropdownContentShape, className?: string) {
  return cx('q-dropdown-content', SIZE_CLASS[size], SURFACE_CLASS[surface], SHAPE_CLASS[shape], className)
}

function Content({
  className,
  positionerClassName,
  size = 'default',
  surface = 'glass',
  shape = 'default',
  side = 'bottom',
  align = 'start',
  sideOffset = 4,
  alignOffset,
  collisionPadding,
  container,
  withSearch = false,
  searchPlaceholder = 'Search',
  notFound,
  children,
  onPointerEnter,
  onPointerLeave,
  ...props
}: ContentProps) {
  const { openOnHover, scheduleHoverClose, cancelHoverClose } = useContext(OpenContext)
  const handlePointerEnter = useCallback<NonNullable<ContentProps['onPointerEnter']>>((event) => {
    onPointerEnter?.(event)
    if (!event.defaultPrevented && openOnHover)
      cancelHoverClose()
  }, [cancelHoverClose, onPointerEnter, openOnHover])
  const handlePointerLeave = useCallback<NonNullable<ContentProps['onPointerLeave']>>((event) => {
    onPointerLeave?.(event)
    if (!event.defaultPrevented && openOnHover)
      scheduleHoverClose()
  }, [onPointerLeave, openOnHover, scheduleHoverClose])

  return (
    <Primitive.Portal container={container}>
      <Primitive.Positioner
        className={positionerClassName}
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        collisionPadding={collisionPadding}
      >
        <Primitive.Popup
          className={contentClass(size, surface, shape, className)}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
          {...props}
        >
          <SearchableContent withSearch={withSearch} placeholder={searchPlaceholder} notFound={notFound}>
            {children}
          </SearchableContent>
        </Primitive.Popup>
      </Primitive.Positioner>
    </Primitive.Portal>
  )
}

/** Holds query state INSIDE the popup so it resets every time the menu reopens. */
function SearchableContent({
  withSearch,
  placeholder,
  notFound,
  children,
}: {
  withSearch: boolean
  placeholder: string
  notFound?: ReactNode
  children: ReactNode
}) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // Keep focus in the search field after Base UI's open-focus settles.
  useEffect(() => {
    if (!withSearch)
      return
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [withSearch])

  if (!withSearch)
    return <>{children}</>

  const focusFirstItem = () => {
    const first = rootRef.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([data-disabled])')
    first?.focus()
  }

  // Fresh per render: Items bump it as they render; SearchEmpty (last) reads it.
  const matchCount = { n: 0 }

  return (
    <div ref={rootRef} className="q-dropdown-search-wrap">
      <div className="q-dropdown-search">
        <span className="q-dropdown-search-icon"><SearchIcon /></span>
        <input
          ref={inputRef}
          className="q-dropdown-search-input"
          placeholder={placeholder}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Base UI's menu treats the popup as a composite widget and
            // preventDefaults typing for typeahead. Keep the input editable by
            // stopping keystrokes from reaching the menu — except navigation
            // keys we explicitly want the menu (or us) to handle.
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              focusFirstItem()
              return
            }
            if (e.key === 'Escape')
              return // let it bubble so the menu closes
            e.stopPropagation()
          }}
        />
      </div>
      <Divider className="shrink-0" />
      <QueryContext.Provider value={query}>
        <MatchCountContext.Provider value={matchCount}>
          {children}
          <SearchEmpty fallback={notFound} />
        </MatchCountContext.Provider>
      </QueryContext.Provider>
    </div>
  )
}

/** Rendered LAST in the search scope, so the match tally is complete: shows the
 * NotFound fallback iff the query matched nothing. Composition-safe — no static
 * introspection of children (which broke for wrapped Items). */
function SearchEmpty({ fallback }: { fallback?: ReactNode }) {
  const query = useContext(QueryContext)
  const matchCount = useContext(MatchCountContext)
  if (query !== '' && matchCount != null && matchCount.n === 0)
    return <>{fallback ?? <NotFound title="No results found" subtitle="Try a different search" />}</>
  return null
}

/* ── Separator ─────────────────────────────────────────────────────────────── */

type SeparatorProps = Omit<ComponentProps<typeof Primitive.Separator>, 'className'> & {
  className?: string
}
function Separator({ className, ...props }: SeparatorProps) {
  return <Primitive.Separator render={<Divider />} className={cx('shrink-0', className)} {...props} />
}

/* ── Group (group; hides itself when filtered empty) ───────────────────────── */

type GroupProps = Omit<ComponentProps<typeof Primitive.Group>, 'className'> & {
  className?: string
}

function Group({ className, children, ...props }: GroupProps) {
  const query = useContext(QueryContext)
  const [empty, setEmpty] = useState(false)
  // A wrapped Item only reveals its match by rendering, so tally the Group's own
  // rendered rows (composition-safe) and hide the group when none survived. The
  // counter is fresh each render; children bump it before this layout effect reads it.
  const groupCount = { n: 0 }
  useLayoutEffect(() => {
    setEmpty(query !== '' && groupCount.n === 0)
  })
  if (empty)
    return null
  return (
    <Primitive.Group className={cx('q-dropdown-group', className)} {...props}>
      <GroupCountContext.Provider value={groupCount}>{children}</GroupCountContext.Provider>
    </Primitive.Group>
  )
}

/** Section label (Figma _MenuLabel). Standalone, or as a Group's heading.
 * Reuses the shared `q-menu-group-label` primitive (also used by cmdk). */
function Label({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx('q-menu-group-label', className)} {...props} />
}

/* ── Item parts (compose any row layout; all forward className/children) ───── */

type PartProps = ComponentProps<'span'>

function ItemIcon({ className, ...props }: PartProps) {
  return <span className={cx('q-menu-item-icon', className)} {...props} />
}

/** Leading media tile (image/icon, 36px) for rich rows. */
function ItemMedia({ className, ...props }: PartProps) {
  return <span className={cx('q-dropdown-item-media', className)} {...props} />
}

/** Content column — stacks the title row and description (Figma 2px gap). */
function ItemContent({ className, ...props }: PartProps) {
  return <span className={cx('q-menu-item-label', className)} {...props} />
}

function ItemTitleRow({ className, ...props }: PartProps) {
  return <span className={cx('q-menu-item-title-row', className)} {...props} />
}

function ItemTitle({ className, ...props }: PartProps) {
  return <span className={cx('q-menu-item-title', className)} {...props} />
}

function ItemDescription({ className, ...props }: PartProps) {
  return <span className={cx('q-menu-item-description', className)} {...props} />
}

/** Inline meta inside the title row (e.g. a count). */
function ItemMeta({ className, ...props }: PartProps) {
  return <span className={cx('q-dropdown-item-meta', className)} {...props} />
}

/** Trailing slot — count, indicator, chevron, button… (pushed to the right). */
function ItemTrailing({ className, ...props }: PartProps) {
  return <span className={cx('q-menu-item-trailing', className)} {...props} />
}

/** Small inset metadata chip. */
function ItemMetaChip({ className, ...props }: PartProps) {
  return <span className={cx('q-dropdown-meta-chip', className)} {...props} />
}

/** Submenu affordance chevron for use inside a SubTrigger's ItemTrailing. */
function ItemSubChevron({ className }: { className?: string }) {
  return <ChevronRightIcon className={cx('q-dropdown-check', className)} />
}

/**
 * Selection indicator for a `selectable` Item. Reads the row's checked state
 * from context, so place it anywhere (typically inside ItemTrailing). The
 * `indicator` style mirrors a real Checkbox / Switch, or a trailing check.
 */
function ItemIndicator({ indicator = 'check' }: { indicator?: DropdownIndicator }) {
  const { checked } = useContext(ItemContext)
  if (indicator === 'checkbox')
    return <Checkbox checked={checked} size="sm" tabIndex={-1} aria-hidden className="pointer-events-none" />
  if (indicator === 'switch')
    return <Switch checked={checked} size="small" tabIndex={-1} aria-hidden className="pointer-events-none" />
  return checked ? <CheckIcon className="q-dropdown-check" /> : null
}

/* ── Item (one styled, stateful, composition-only row) ─────────────────────── */

type ItemProps = Omit<ComponentProps<typeof Primitive.Item>, 'className' | 'title'> & {
  className?: string
  ref?: Ref<HTMLDivElement>
  /** Stable identity for search + Root selection. Defaults to the row's `title` / text. */
  value?: string
  /** Stateful selectable row (stays open on toggle) instead of a plain action. */
  selectable?: boolean
  disabled?: boolean
  /** Destructive row — red title + icon (Figma _MenuActions "Delete"). */
  danger?: boolean
  /** Controlled checked state (wins over Root / internal state). */
  checked?: boolean
  /** Notified on every toggle of a selectable row — controlled or not. */
  onCheckedChange?: ComponentProps<typeof Primitive.CheckboxItem>['onCheckedChange']
  /** Action handler for non-selectable items (closes on click). */
  onSelect?: ComponentProps<typeof Primitive.Item>['onClick']
  // ── Slot props: the ergonomic default. Pass any of these and the row builds
  //    the standard anatomy for you; pass `children` instead for full control. ──
  /** Leading icon — small `ItemIcon` slot. */
  start?: ReactNode
  /** Leading 36px media tile (`ItemMedia` slot). Wins over `start`. */
  media?: ReactNode
  /** Primary line. Providing any slot prop switches the row to slot rendering. */
  title?: ReactNode
  /** Secondary line under the title. */
  subtitle?: ReactNode
  /** Inline node beside the title (badge, count…). */
  badge?: ReactNode
  /** Trailing content (shortcut, meta…). A selectable row's indicator is appended automatically. */
  end?: ReactNode
  /** Selection indicator style for a selectable slot row. */
  indicator?: DropdownIndicator
  children?: ReactNode
}

function Item(props: ItemProps) {
  const {
    className,
    value,
    selectable = false,
    disabled,
    danger = false,
    checked,
    onCheckedChange,
    onSelect,
    start,
    media,
    title,
    subtitle,
    badge,
    end,
    indicator = 'check',
    children,
    ...rest
  } = props

  const query = useContext(QueryContext)
  const selection = useContext(SelectionContext)
  const matchCount = useContext(MatchCountContext)
  const groupCount = useContext(GroupCountContext)
  // Internal fallback state so a `selectable` row works with NO value/handlers.
  const [selfChecked, setSelfChecked] = useState(false)
  const disabledState = disabled === true

  // Filter when searching.
  if (query && !matchQuery(itemText(props), query))
    return null

  // Survived the filter (or not searching) → tally for the NotFound gate
  // (top-level) and for its Group (so an all-filtered group hides itself).
  if (matchCount)
    matchCount.n++
  if (groupCount)
    groupCount.n++

  // Slot rendering activates only when a slot is passed; otherwise `children`
  // render verbatim (back-compat with the fully-composed API).
  const hasSlots = title != null || subtitle != null || start != null || media != null || badge != null || end != null
  const body = hasSlots
    ? (
        <>
          {media != null ? <ItemMedia>{media}</ItemMedia> : start != null ? <ItemIcon>{start}</ItemIcon> : null}
          {title != null || subtitle != null || badge != null
            ? (
                <ItemContent>
                  <ItemTitleRow>
                    {title != null ? <ItemTitle>{title}</ItemTitle> : null}
                    {badge}
                  </ItemTitleRow>
                  {subtitle != null ? <ItemDescription>{subtitle}</ItemDescription> : null}
                </ItemContent>
              )
            : null}
          {end != null || selectable
            ? <ItemTrailing>{end}{selectable ? <ItemIndicator indicator={indicator} /> : null}</ItemTrailing>
            : null}
        </>
      )
    : children

  // Non-selectable → plain action item (closes on click, no selection state).
  if (!selectable) {
    return (
      <ItemContext.Provider value={{ checked: false, disabled: disabledState, selectable: false, value }}>
        <Primitive.Item className={cx('q-menu-item', danger && 'q-menu-item-danger', className)} disabled={disabled} onClick={onSelect} {...rest}>
          {body}
        </Primitive.Item>
      </ItemContext.Provider>
    )
  }

  // Selectable → stateful checkbox row, stays open on toggle. The checked state
  // lives in (priority): the controlled `checked` prop → Root, keyed by the
  // resolved value → the row's own internal state. `onCheckedChange` always
  // fires, so a consumer only ever needs to pass a handler (never wire state).
  const resolvedValue = itemText(props)
  const controlled = checked !== undefined
  const rootKeyed = !controlled && selection != null && resolvedValue !== ''
  const resolvedChecked = controlled ? checked : rootKeyed ? selection!.isSelected(resolvedValue) : selfChecked
  const handleCheckedChange: NonNullable<ItemProps['onCheckedChange']> = (next, event) => {
    if (rootKeyed)
      selection!.toggle(resolvedValue, next)
    else if (!controlled)
      setSelfChecked(next)
    onCheckedChange?.(next, event)
  }

  return (
    <ItemContext.Provider value={{ checked: resolvedChecked, disabled: disabledState, selectable: true, value: value ?? (resolvedValue || undefined) }}>
      <Primitive.CheckboxItem
        className={cx('q-menu-item', danger && 'q-menu-item-danger', className)}
        checked={resolvedChecked}
        onCheckedChange={handleCheckedChange}
        disabled={disabled}
        closeOnClick={false}
        {...rest}
      >
        {body}
      </Primitive.CheckboxItem>
    </ItemContext.Provider>
  )
}

/* ── Submenu (explicit, composable) ────────────────────────────────────────── */

function Sub({ children, ...props }: ComponentProps<typeof Primitive.SubmenuRoot>) {
  // Submenus stay visible during search (their trigger label isn't filtered);
  // nested items self-filter via their own QueryContext when the submenu opens.
  return <Primitive.SubmenuRoot {...props}>{children}</Primitive.SubmenuRoot>
}

type SubTriggerProps = Omit<ComponentProps<typeof Primitive.SubmenuTrigger>, 'className' | 'title'> & {
  className?: string
  disabled?: boolean
  // ── Slot props (same ergonomic default as Item; pass `children` for full control). ──
  /** Leading icon (small `ItemIcon` slot). */
  start?: ReactNode
  /** Primary line. Providing any slot prop switches to slot rendering. */
  title?: ReactNode
  /** Secondary line under the title. */
  subtitle?: ReactNode
  /** Trailing content before the submenu chevron (which is always appended). */
  end?: ReactNode
}

function SubTrigger({ className, disabled, start, title, subtitle, end, children, ...props }: SubTriggerProps) {
  const hasSlots = title != null || subtitle != null || start != null || end != null
  return (
    <Primitive.SubmenuTrigger
      className={cx('q-menu-item', 'q-dropdown-submenu-trigger', className)}
      disabled={disabled}
      {...props}
    >
      {hasSlots
        ? (
            <>
              {start != null ? <ItemIcon>{start}</ItemIcon> : null}
              {title != null || subtitle != null
                ? (
                    <ItemContent>
                      {title != null ? <ItemTitleRow><ItemTitle>{title}</ItemTitle></ItemTitleRow> : null}
                      {subtitle != null ? <ItemDescription>{subtitle}</ItemDescription> : null}
                    </ItemContent>
                  )
                : null}
              <ItemTrailing>{end}<ItemSubChevron /></ItemTrailing>
            </>
          )
        : children}
    </Primitive.SubmenuTrigger>
  )
}

type SubContentProps = Omit<ComponentProps<typeof Primitive.Popup>, 'className'> & {
  className?: string
  /**
   * Gap (px) between the parent menu's outer edge and the nested submenu.
   * Pre-compensated for the parent's 8px content padding. Default 4.
   */
  sideOffset?: number
  /**
   * Cross-axis nudge (px). Defaults to -8 so the submenu's first row lines up
   * with the trigger (cancels the 8px content padding).
   */
  alignOffset?: number
  container?: ComponentProps<typeof Primitive.Portal>['container']
}

function SubContent({ className, sideOffset = 4, alignOffset = -8, container, children, ...props }: SubContentProps) {
  return (
    <Primitive.Portal container={container}>
      <Primitive.Positioner side="right" align="start" sideOffset={sideOffset + 8} alignOffset={alignOffset}>
        <Primitive.Popup className={cx('q-dropdown-content', className)} {...props}>
          {/* Reset the query so sub-items aren't filtered by the parent search. */}
          <QueryContext.Provider value="">{children}</QueryContext.Provider>
        </Primitive.Popup>
      </Primitive.Positioner>
    </Primitive.Portal>
  )
}

export const Dropdown = {
  Root,
  Trigger,
  Content,
  Group,
  Label,
  Separator,
  Item,
  ItemIcon,
  ItemMedia,
  ItemContent,
  ItemTitleRow,
  ItemTitle,
  ItemDescription,
  ItemMeta,
  ItemTrailing,
  ItemMetaChip,
  ItemIndicator,
  ItemSubChevron,
  Sub,
  SubTrigger,
  SubContent,
}
