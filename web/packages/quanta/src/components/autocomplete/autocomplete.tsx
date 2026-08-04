'use client'

import type { ComponentProps, ReactNode, RefObject } from 'react'
import { createContext, useContext, useRef } from 'react'
import { Autocomplete as Primitive } from '@base-ui/react/autocomplete'
import { IconCrossMediumOutlined as ClearIcon } from '@higgsfield-ai/icons/IconCrossMediumOutlined'
import { IconMagnifyingGlass2Outlined as SearchIcon } from '@higgsfield-ai/icons/IconMagnifyingGlass2Outlined'
import { Icon } from '../icon/index.ts'
import { NotFound } from '../not-found/index.ts'
import { cx } from '../utils/cx.ts'

/**
 * Autocomplete — a filter-as-you-type combobox on the Base UI `Autocomplete`
 * primitive (which owns filtering, roving highlight, keyboard nav, ARIA, the
 * portal + positioning, and all `data-*` state). Quanta only paints: the input
 * is the canonical quanta field surface (white-5%, radius 12, lime focus ring),
 * and the popup reuses the dropdown glass card + shared `q-menu-item*` rows (see
 * `autocomplete.css`, `dropdown.css`, `menu.css`).
 *
 * COMPOSITION-FIRST (same contract as Dropdown / Command). `Autocomplete.Item`
 * is a styled row that renders whatever children you give it — typically a bare
 * label, or the shared `q-menu-item*` parts (icon / label / description /
 * trailing) for richer rows. Base UI does the matching from the `items` prop on
 * `Root`; the `List` renders the filtered subset:
 *
 *   <Autocomplete.Root items={fruits}>
 *     <Autocomplete.Input placeholder="Search fruits…" />
 *     <Autocomplete.Content>
 *       <Autocomplete.Empty>No fruits found.</Autocomplete.Empty>
 *       <Autocomplete.List>
 *         {(item: string) => (
 *           <Autocomplete.Item key={item} value={item}>{item}</Autocomplete.Item>
 *         )}
 *       </Autocomplete.List>
 *     </Autocomplete.Content>
 *   </Autocomplete.Root>
 *
 * Pass `value` / `defaultValue` / `onValueChange` / `items` / `filter` /
 * `openOnInputClick` etc. straight through to `Autocomplete.Root` (Base UI).
 * `Autocomplete.Content` bundles the Portal + Positioner + Popup; drop the
 * `List`, `Group`, `GroupLabel`, `Item` and `Empty` inside it.
 */

/* ── Root ────────────────────────────────────────────────────────────────────
 * Passes everything through to Base UI (it owns the value/filter model).
 * `connected` flows Root → Input + Content so the popup attaches flush to the
 * field as one seamless surface (mirrors Select). */
/**
 * `connected` flows to Input + Content; `controlRef` points the Positioner at
 * the FIELD WRAPPER (not the inner Base UI input, which is narrower and inset by
 * the search/clear affixes) so the popup matches the full field width + edge.
 */
const AutocompleteUiContext = createContext<{
  connected: boolean
  controlRef: RefObject<HTMLDivElement | null>
}>({ connected: false, controlRef: { current: null } })

export type AutocompleteRootProps = ComponentProps<typeof Primitive.Root> & {
  /**
   * Render the popup as a seamless extension of the input: same width, no gap,
   * merged corners so the field + list read as one continuous surface.
   */
  connected?: boolean
}

export function AutocompleteRoot({ connected = false, ...props }: AutocompleteRootProps) {
  const controlRef = useRef<HTMLDivElement>(null)
  return (
    <AutocompleteUiContext.Provider value={{ connected, controlRef }}>
      <Primitive.Root {...props} />
    </AutocompleteUiContext.Provider>
  )
}

/* ── Input ───────────────────────────────────────────────────────────────────
 * The quanta field surface (q-field-control) wrapping the Base UI Input, with a
 * leading search icon and an auto-hiding Clear button. Both icon slots are
 * overridable; `clear={false}` removes the clear affordance. */
export type AutocompleteInputProps =
  Omit<ComponentProps<typeof Primitive.Input>, 'className'> & {
    className?: string
    /** Class for the field-surface wrapper that holds the icon + input + clear. */
    controlClassName?: string
    /** Leading slot (20px). Defaults to a search icon; pass `null` to remove. */
    start?: ReactNode
    /** Show the auto-hiding Base UI Clear button (default true). */
    clear?: boolean
    /** Accessible label for the clear button. */
    clearLabel?: string
  }

const DEFAULT_START = <Icon size="md"><SearchIcon /></Icon>

export function AutocompleteInput({
  className,
  controlClassName,
  start = DEFAULT_START,
  clear = true,
  clearLabel = 'Clear',
  ...props
}: AutocompleteInputProps) {
  const { connected, controlRef } = useContext(AutocompleteUiContext)
  return (
    <div ref={controlRef} className={cx('q-field-control', 'q-autocomplete-control', connected && 'q-autocomplete-control-connected', controlClassName)}>
      {start != null ? <span className="q-field-affix">{start}</span> : null}
      <Primitive.Input
        className={cx('q-field-input', className)}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        {...props}
      />
      {clear
        ? (
            <Primitive.Clear
              className="q-autocomplete-clear"
              aria-label={clearLabel}
              render={<button type="button" />}
            >
              <Icon size="sm"><ClearIcon /></Icon>
            </Primitive.Clear>
          )
        : null}
    </div>
  )
}

/* ── Content ───────────────────────────────────────────────────────────────────
 * Portal + Positioner + glass Popup, mirroring Dropdown.Content. The popup reuses
 * the dropdown glass surface (q-dropdown-content) so menus stay visually
 * identical. `solid` swaps the frosted glass for an opaque surface. */
export type AutocompleteContentProps =
  Omit<ComponentProps<typeof Primitive.Popup>, 'className'> & {
    className?: string
    /** Opaque surface instead of frosted glass. */
    solid?: boolean
    /** Side offset of the popup from the input (px). */
    sideOffset?: number
    /** Class for the Base UI Positioner. */
    positionerClassName?: string
    /** Portal container. */
    container?: ComponentProps<typeof Primitive.Portal>['container']
  }

export function AutocompleteContent({
  className,
  solid = false,
  sideOffset,
  positionerClassName,
  container,
  children,
  ...props
}: AutocompleteContentProps) {
  const { connected, controlRef } = useContext(AutocompleteUiContext)
  // Connected = the popup NESTS the field (mirrors Select): a wider rounded card
  // that overlaps + sits BEHIND the input (the input keeps the higher z-index and
  // stays typable on top), centred, with top padding so the rows clear the input.
  // Pull it up over the 40px field. Base UI Combobox REQUIRES the Portal, so the
  // popup stays portaled and the input wins via z-index in the root stacking
  // context. The floating glass keeps its 6px gap.
  const resolvedSideOffset = sideOffset ?? (connected ? -48 : 6)
  return (
    <Primitive.Portal container={container}>
      <Primitive.Positioner
        anchor={controlRef}
        className={cx('q-autocomplete-positioner', connected && 'q-autocomplete-positioner-connected', positionerClassName)}
        align={connected ? 'center' : undefined}
        sideOffset={resolvedSideOffset}
      >
        <Primitive.Popup
          className={cx(
            'q-dropdown-content',
            'q-autocomplete-content',
            solid && 'q-dropdown-content-solid',
            connected && 'q-autocomplete-content-connected',
            className,
          )}
          {...props}
        >
          {children}
        </Primitive.Popup>
      </Primitive.Positioner>
    </Primitive.Portal>
  )
}

/* ── List ──────────────────────────────────────────────────────────────────── */
export type AutocompleteListProps = Omit<ComponentProps<typeof Primitive.List>, 'className'> & {
  className?: string
}

export function AutocompleteList({ className, ...props }: AutocompleteListProps) {
  return <Primitive.List className={cx('q-autocomplete-list', className)} {...props} />
}

/* ── Item ──────────────────────────────────────────────────────────────────────
 * The shared menu-row shell (q-menu-item). Base UI owns highlight / disabled /
 * click selection + data-* state; compose any row inside it with the shared
 * `q-menu-item*` parts. */
export type AutocompleteItemProps =
  Omit<ComponentProps<typeof Primitive.Item>, 'className'> & {
    className?: string
  }

export function AutocompleteItem({ className, ...props }: AutocompleteItemProps) {
  return <Primitive.Item className={cx('q-menu-item', className)} {...props} />
}

/* ── Group / GroupLabel ──────────────────────────────────────────────────────── */
export type AutocompleteGroupProps = Omit<ComponentProps<typeof Primitive.Group>, 'className'> & {
  className?: string
}

export function AutocompleteGroup({ className, ...props }: AutocompleteGroupProps) {
  return <Primitive.Group className={cx('q-autocomplete-group', className)} {...props} />
}

export type AutocompleteGroupLabelProps = Omit<ComponentProps<typeof Primitive.GroupLabel>, 'className'> & {
  className?: string
}

export function AutocompleteGroupLabel({ className, ...props }: AutocompleteGroupLabelProps) {
  return <Primitive.GroupLabel className={cx('q-menu-group-label', className)} {...props} />
}

/** Renders the filtered items of a group (Base UI Collection). No DOM of its own. */
export const AutocompleteCollection = Primitive.Collection
export type AutocompleteCollectionProps = ComponentProps<typeof Primitive.Collection>

/* ── Empty ───────────────────────────────────────────────────────────────────
 * Shown by Base UI only when the filtered list is empty. Defaults to the shared
 * NotFound empty state; pass children to override entirely. */
export type AutocompleteEmptyProps = Omit<ComponentProps<typeof Primitive.Empty>, 'className'> & {
  className?: string
}

export function AutocompleteEmpty({ className, children, ...props }: AutocompleteEmptyProps) {
  return (
    <Primitive.Empty className={cx('q-autocomplete-empty', className)} {...props}>
      {children ?? (
        <NotFound
          size="sm"
          icon={<Icon size="md"><SearchIcon /></Icon>}
          title="No results found"
          subtitle="Try a different search term"
        />
      )}
    </Primitive.Empty>
  )
}

/* ── Clear (standalone) ──────────────────────────────────────────────────────── */
export type AutocompleteClearProps = Omit<ComponentProps<typeof Primitive.Clear>, 'className'> & {
  className?: string
}

export function AutocompleteClear({ className, children, ...props }: AutocompleteClearProps) {
  return (
    <Primitive.Clear
      className={cx('q-autocomplete-clear', className)}
      render={<button type="button" />}
      {...props}
    >
      {children ?? <Icon size="sm"><ClearIcon /></Icon>}
    </Primitive.Clear>
  )
}

/* ── Shared menu-row parts (re-exported for composing rich Items) ─────────────
 * These paint the shared q-menu-item* slots (see menu.css). Use them inside an
 * `Autocomplete.Item` for icon + title + description + trailing rows. */
type PartProps = ComponentProps<'span'>

export function AutocompleteItemIcon({ className, ...props }: PartProps) {
  return <span className={cx('q-menu-item-icon', className)} {...props} />
}
export function AutocompleteItemContent({ className, ...props }: PartProps) {
  return <span className={cx('q-menu-item-label', className)} {...props} />
}
export function AutocompleteItemTitleRow({ className, ...props }: PartProps) {
  return <span className={cx('q-menu-item-title-row', className)} {...props} />
}
export function AutocompleteItemTitle({ className, ...props }: PartProps) {
  return <span className={cx('q-menu-item-title', className)} {...props} />
}
export function AutocompleteItemDescription({ className, ...props }: PartProps) {
  return <span className={cx('q-menu-item-description', className)} {...props} />
}
export function AutocompleteItemTrailing({ className, ...props }: PartProps) {
  return <span className={cx('q-menu-item-trailing', className)} {...props} />
}

/** `Autocomplete` namespace — the parts API. */
export const Autocomplete = Object.assign(AutocompleteRoot, {
  Root: AutocompleteRoot,
  Input: AutocompleteInput,
  Content: AutocompleteContent,
  List: AutocompleteList,
  Item: AutocompleteItem,
  Group: AutocompleteGroup,
  GroupLabel: AutocompleteGroupLabel,
  Collection: AutocompleteCollection,
  Empty: AutocompleteEmpty,
  Clear: AutocompleteClear,
  ItemIcon: AutocompleteItemIcon,
  ItemContent: AutocompleteItemContent,
  ItemTitleRow: AutocompleteItemTitleRow,
  ItemTitle: AutocompleteItemTitle,
  ItemDescription: AutocompleteItemDescription,
  ItemTrailing: AutocompleteItemTrailing,
})
