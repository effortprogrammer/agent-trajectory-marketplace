'use client'

import type { ChangeEvent, ComponentProps, KeyboardEvent, ReactNode, Ref } from 'react'
import { IconMagnifyingGlass2Outlined as SearchIcon } from '@higgsfield-ai/icons/IconMagnifyingGlass2Outlined'
import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ModalSize } from '../modal/index.ts'
import { Divider } from '../divider/index.ts'
import { Icon } from '../icon/index.ts'
import type { InputProps } from '../input/index.ts'
import { Input } from '../input/index.ts'
import { Kbd } from '../kbd/index.ts'
import { Modal } from '../modal/index.ts'
import { cx } from '../utils/cx.ts'

/**
 * Command (cmdk) — a fast, filterable command palette skinned with quanta
 * tokens. Hand-rolled (like the `cmdk` library) for an always-open, inline,
 * grouped, keyboard-driven list: fuzzy filtering, roving arrow-key navigation,
 * groups with headings, empty + loading states, per-item detail / action, and an
 * optional `⌘K` Dialog shell composed from Modal (Base UI Dialog owns the
 * overlay, focus trap and a11y through the shared modal).
 *
 * COMPOSITION-FIRST (same rules as Dropdown). `Command.Item` is a styled,
 * stateful row that renders whatever children you give it — it owns the
 * registry / filtering / highlight / selection behaviour, but makes NO
 * assumption about the shape of your data. Build any row out of the exported
 * parts (`ItemIcon` / `ItemContent` / `ItemTitle` / `ItemDescription` /
 * `ItemTrailing`), exactly like `Dropdown.Item`:
 *
 *   <Command.Dialog shortcut="mod+k" label="Command menu">
 *     <Command.Input placeholder="Type a command…" />
 *     <Command.List>
 *       <Command.Empty>No results.</Command.Empty>
 *       <Command.Group heading="Actions">
 *         <Command.Item onSelect={…}>
 *           <Command.ItemIcon><Icon><Plus/></Icon></Command.ItemIcon>
 *           <Command.ItemTitle>New file</Command.ItemTitle>
 *           <Command.ItemTrailing><Command.Shortcut>⌘N</Command.Shortcut></Command.ItemTrailing>
 *         </Command.Item>
 *       </Command.Group>
 *     </Command.List>
 *   </Command.Dialog>
 *
 * An Item's searchable text is its `value` prop, or — when omitted — the plain
 * text of its children; `keywords` adds extra search terms. `Command.Root`
 * accepts a custom `filter`, `loading` (suppresses Empty), and `loop` (default).
 */

/* ── Fuzzy match: substring (strong) or subsequence (weak); empty query = all. */
function score(query: string, text: string): number {
  if (!query) return 1
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (t.includes(q)) return 2
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length ? 1 : 0
}

/** Best-effort plain text from an arbitrary node (for matching). */
function nodeText(node: ReactNode): string {
  if (node == null || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join(' ')
  if (isValidElement(node)) return nodeText((node.props as { children?: ReactNode }).children)
  return ''
}

/** Scores an item against the query. >0 keeps the item (and orders by strength). */
export type CommandFilter = (value: string, search: string, keywords: string) => number
const defaultFilter: CommandFilter = (value, search, keywords) => score(search, `${value} ${keywords}`.trim())

/** Populate every ref in `refs` with the same node (object or callback refs). */
function mergeRefs<T>(...refs: (Ref<T> | undefined)[]) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (typeof ref === 'function')
        ref(node)
      else if (ref)
        (ref as { current: T | null }).current = node
    }
  }
}

interface ItemMeta { id: string, value: string, keywords: string, groupId: string | null, disabled: boolean }

interface CommandContextValue {
  query: string
  matched: Set<string>
  loading: boolean
  activeId: string | null
  setActiveId: (id: string | null) => void
  register: (meta: ItemMeta, onSelect?: () => void) => () => void
  select: (id: string) => void
  groupHasMatch: (groupId: string) => boolean
  listId: string
  /** Detail node of the currently-active item (for the optional detail pane). */
  activeDetail: ReactNode
  setActiveDetail: (node: ReactNode) => void
  /** Footer action label of the currently-active (hovered/highlighted) item. */
  activeAction: ReactNode
  setActiveAction: (node: ReactNode) => void
}

const CommandContext = createContext<CommandContextValue | null>(null)
function useCommand() {
  const ctx = useContext(CommandContext)
  if (!ctx) throw new Error('Command parts must be used within <Command>')
  return ctx
}

/* The group a nested Item belongs to (null at top level). */
const GroupContext = createContext<string | null>(null)

export interface CommandProps extends Omit<ComponentProps<'div'>, 'onSelect'> {
  /** Controlled search value. */
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  /** Disable built-in filtering (caller filters items themselves). */
  shouldFilter?: boolean
  /** Custom scorer: `(value, search, keywords) => number`; >0 keeps the item. */
  filter?: CommandFilter
  /** Async state — keeps `Command.Empty` hidden while results are loading. */
  loading?: boolean
  /** Arrow-key navigation wraps past the ends (default true). */
  loop?: boolean
  /** Accessible label for the listbox. */
  label?: string
}

/** Root: owns search + the item registry + keyboard navigation. */
function CommandRoot({
  value,
  defaultValue = '',
  onValueChange,
  shouldFilter = true,
  filter,
  loading = false,
  loop = true,
  label = 'Command menu',
  className,
  children,
  ...props
}: CommandProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultValue)
  const query = value ?? uncontrolled
  const setQuery = useCallback((q: string) => {
    if (value === undefined) setUncontrolled(q)
    onValueChange?.(q)
  }, [value, onValueChange])

  const listId = useId()
  const registry = useRef(new Map<string, ItemMeta>())
  const selects = useRef(new Map<string, () => void>())
  const [version, setVersion] = useState(0)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeDetail, setActiveDetail] = useState<ReactNode>(null)
  const [activeAction, setActiveAction] = useState<ReactNode>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const register = useCallback((meta: ItemMeta, onSelect?: () => void) => {
    registry.current.set(meta.id, meta)
    if (onSelect) selects.current.set(meta.id, onSelect)
    setVersion(v => v + 1)
    return () => {
      registry.current.delete(meta.id)
      selects.current.delete(meta.id)
      setVersion(v => v + 1)
    }
  }, [])

  const matched = useMemo(() => {
    const set = new Set<string>()
    const scorer = filter ?? defaultFilter
    for (const [id, meta] of registry.current) {
      if (!shouldFilter || scorer(meta.value, query, meta.keywords) > 0) set.add(id)
    }
    return set
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, version, shouldFilter, filter])

  const groupHasMatch = useCallback((groupId: string) => {
    for (const [id, meta] of registry.current) {
      if (meta.groupId === groupId && matched.has(id)) return true
    }
    return false
  }, [matched])

  const select = useCallback((id: string) => {
    if (registry.current.get(id)?.disabled) return
    selects.current.get(id)?.()
  }, [])

  /** Visible item ids in DOM order (source of truth for nav). */
  const visibleIds = useCallback(() => {
    const root = listRef.current
    if (!root) return [] as string[]
    return Array.from(root.querySelectorAll<HTMLElement>('[data-command-item]:not([hidden]):not([aria-disabled="true"])'))
      .map(el => el.id)
  }, [])

  // Reset / clamp the active item whenever the visible set changes.
  useEffect(() => {
    const ids = visibleIds()
    if (ids.length === 0) { setActiveId(null); return }
    setActiveId(prev => (prev && ids.includes(prev) ? prev : ids[0]))
  }, [matched, visibleIds])

  // Keep the active item scrolled into view.
  useEffect(() => {
    if (!activeId) return
    const el = listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(activeId)}`)
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [activeId])

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    const ids = visibleIds()
    if (ids.length === 0) return
    const i = activeId ? ids.indexOf(activeId) : -1
    const goNext = () => {
      const next = i + 1
      setActiveId(ids[next >= ids.length ? (loop ? 0 : ids.length - 1) : next])
    }
    const goPrev = () => {
      const prev = i - 1
      setActiveId(ids[prev < 0 ? (loop ? ids.length - 1 : 0) : prev])
    }
    // Vim-style navigation: Ctrl+n / Ctrl+p (down / up).
    if (e.ctrlKey && (e.key === 'n' || e.key === 'p')) {
      e.preventDefault()
      e.key === 'n' ? goNext() : goPrev()
    }
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      goNext()
    }
    else if (e.key === 'ArrowUp') {
      e.preventDefault()
      goPrev()
    }
    else if (e.key === 'Home') {
      e.preventDefault()
      setActiveId(ids[0])
    }
    else if (e.key === 'End') {
      e.preventDefault()
      setActiveId(ids[ids.length - 1])
    }
    else if (e.key === 'Enter' && activeId) {
      e.preventDefault()
      select(activeId)
    }
  }, [activeId, loop, select, visibleIds])

  const ctx = useMemo<CommandContextValue>(() => ({
    query, matched, loading, activeId, setActiveId, register, select, groupHasMatch, listId,
    activeDetail, setActiveDetail, activeAction, setActiveAction,
  }), [query, matched, loading, activeId, register, select, groupHasMatch, listId, activeDetail, activeAction])

  return (
    <CommandContext.Provider value={ctx}>
      <div
        className={cx('q-command', className)}
        onKeyDown={onKeyDown}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        {...props}
      >
        <SearchSync query={query} setQuery={setQuery} listId={listId} label={label} listRef={listRef}>
          {children}
        </SearchSync>
      </div>
    </CommandContext.Provider>
  )
}

/* Carries search wiring down to Input/List via a tiny secondary context. */
interface SearchCtx {
  query: string
  setQuery: (q: string) => void
  listId: string
  label: string
  listRef: React.RefObject<HTMLDivElement | null>
}
const SearchContext = createContext<SearchCtx | null>(null)
function SearchSync({ children, ...ctx }: SearchCtx & { children: ReactNode }) {
  return <SearchContext.Provider value={ctx}>{children}</SearchContext.Provider>
}

export type CommandInputProps = Omit<InputProps, 'value' | 'onChange'>

/** The search box — drives the filter; arrow keys navigate the list. */
export function CommandInput({
  start = <Icon size="md"><SearchIcon /></Icon>,
  className,
  placeholder = 'Type a command or search…',
  ...props
}: CommandInputProps) {
  const search = useContext(SearchContext)
  const { activeId, listId } = useCommand()
  const setSearchQuery = search?.setQuery
  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setSearchQuery?.(event.target.value)
  }, [setSearchQuery])

  if (!search) throw new Error('Command.Input must be used within <Command>')

  return (
    <div className="q-command-input-row">
      <Input
        {...props}
        className={className}
        value={search.query}
        onChange={handleChange}
        placeholder={placeholder}
        start={start}
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={activeId ?? undefined}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
      />
    </div>
  )
}

export type CommandListProps = ComponentProps<'div'>

/** Scrollable listbox region. */
export function CommandList({ ref, className, children, ...props }: CommandListProps) {
  const search = useContext(SearchContext)
  if (!search) throw new Error('Command.List must be used within <Command>')
  return (
    <div
      ref={mergeRefs(search.listRef, ref)}
      id={search.listId}
      role="listbox"
      aria-label={search.label}
      className={cx('q-command-list', className)}
      {...props}
    >
      {children}
    </div>
  )
}

export type CommandEmptyProps = ComponentProps<'div'>

/** Shown only when the query matches nothing — and never while loading. */
export function CommandEmpty({ className, children = 'No results found.', ...props }: CommandEmptyProps) {
  const { matched, loading } = useCommand()
  if (loading || matched.size > 0) return null
  return <div className={cx('q-command-empty', className)} role="presentation" {...props}>{children}</div>
}

export type CommandLoadingProps = ComponentProps<'div'>

/** Render inside the list while results load (pair with `loading` on Command). */
export function CommandLoading({ className, children = 'Loading…', ...props }: CommandLoadingProps) {
  return <div className={cx('q-command-loading', className)} role="presentation" {...props}>{children}</div>
}

export type CommandGroupProps = ComponentProps<'div'> & { heading?: ReactNode }

/** A labelled group; hides itself (and its heading) when nothing inside matches. */
export function CommandGroup({ heading, className, children, ...props }: CommandGroupProps) {
  const groupId = useId()
  const { groupHasMatch } = useCommand()
  const visible = groupHasMatch(groupId)
  return (
    <GroupContext.Provider value={groupId}>
      <div className={cx('q-command-group', className)} role="group" hidden={!visible} {...props}>
        {heading != null ? <div className="q-command-group-heading" aria-hidden>{heading}</div> : null}
        {children}
      </div>
    </GroupContext.Provider>
  )
}

export interface CommandItemProps extends Omit<ComponentProps<'div'>, 'onSelect' | 'title'> {
  /** Rich content shown in `<Command.Detail>` while this item is active. */
  detail?: ReactNode
  /** Footer action label shown in `<Command.Action>` while this item is hovered/active (e.g. "Open dashboard"). */
  action?: ReactNode
  /** Explicit search text (overrides the text extracted from children). */
  value?: string
  /** Extra search terms beyond the children's text. */
  keywords?: string
  disabled?: boolean
  onSelect?: () => void
}

/**
 * A selectable command row. Compose it from the exported parts (`ItemIcon` /
 * `ItemContent` / `ItemTitle` / `ItemDescription` / `ItemTrailing`), mirroring
 * `Dropdown.Item`. It registers itself for keyboard navigation and filters
 * itself out when it doesn't match the query (matched on its children's text +
 * `keywords`, or an explicit `value`).
 */
export function CommandItem({
  detail,
  action,
  value,
  keywords,
  disabled = false,
  onSelect,
  className,
  children,
  ...props
}: CommandItemProps) {
  const id = useId()
  const groupId = useContext(GroupContext)
  const { matched, activeId, setActiveId, register, select, setActiveDetail, setActiveAction } = useCommand()
  const resolvedValue = value ?? nodeText(children)
  const resolvedKeywords = keywords ?? ''

  useLayoutEffect(() => {
    return register({ id, value: resolvedValue, keywords: resolvedKeywords, groupId, disabled }, onSelect)
    // re-register when the searchable text / disabled / group changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, resolvedValue, resolvedKeywords, groupId, disabled])

  const visible = matched.has(id)
  const active = activeId === id

  // When this item becomes active (hover or keyboard), publish its detail to
  // <Command.Detail> and its action label to <Command.Action>.
  useEffect(() => {
    if (active) {
      setActiveDetail(detail ?? null)
      setActiveAction(action ?? null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  return (
    <div
      id={id}
      data-command-item=""
      role="option"
      aria-selected={active}
      aria-disabled={disabled || undefined}
      data-active={active || undefined}
      hidden={!visible}
      className={cx('q-command-item', className)}
      onPointerMove={() => { if (!disabled) setActiveId(id) }}
      onClick={() => select(id)}
      {...props}
    >
      {children}
    </div>
  )
}

/* ── Item parts (compose any row layout; all forward className/children) ─────── */

type PartProps = ComponentProps<'span'>

/** Leading slot — icon, avatar, dot, etc. */
export function CommandItemIcon({ className, ...props }: PartProps) {
  return <span className={cx('q-command-item-icon', className)} {...props} />
}

/** Content column — stacks the title and description. Optional: a bare
 * `Command.ItemTitle` works too (it grows + truncates on its own). */
export function CommandItemContent({ className, ...props }: PartProps) {
  return <span className={cx('q-command-item-content', className)} {...props} />
}

/** Primary label. */
export function CommandItemTitle({ className, ...props }: PartProps) {
  return <span className={cx('q-command-item-title', className)} {...props} />
}

/** Secondary line under the title. */
export function CommandItemDescription({ className, ...props }: PartProps) {
  return <span className={cx('q-command-item-description', className)} {...props} />
}

/** Trailing slot — shortcut, badge, chevron, count… (pushed to the right). */
export function CommandItemTrailing({ className, ...props }: PartProps) {
  return <span className={cx('q-command-item-trailing', className)} {...props} />
}

export function CommandSeparator({ className, ...props }: ComponentProps<'div'>) {
  // The Divider component draws the etched line; this wrapper owns the spacing.
  return (
    <div className={cx('q-command-separator', className)} {...props}>
      <Divider />
    </div>
  )
}

/**
 * A keyboard-shortcut pill in an item's trailing slot. Composes the canonical
 * `Kbd` (the cmdk shortcut has no bespoke design — reuse Kbd rather than
 * reinvent the pill). For multi-key combos joined by a separator use
 * `KbdSequence` directly in the item's `ItemTrailing`.
 */
export function CommandShortcut(props: ComponentProps<typeof Kbd>) {
  return <Kbd {...props} />
}

/* ── Two-pane layout (optional: list sidebar + detail panel) ──────────────────── */

export type CommandBodyProps = ComponentProps<'div'>
/** Row region between Input and Footer — holds the List (left) + Detail (right). */
export function CommandBody({ className, ...props }: CommandBodyProps) {
  return <div className={cx('q-command-body', className)} {...props} />
}

export type CommandDetailProps = ComponentProps<'div'>
/**
 * Right pane — renders the active item's `detail`. Renders nothing (so the list
 * goes full-width) when the active item carries no `detail`.
 *
 * Its content lives in an absolutely-positioned scroll layer, so the pane
 * contributes ZERO height to the row: the LIST pane sizes the palette and the
 * detail fills that height + scrolls. That's what keeps showing/hiding it from
 * resizing the modal — without which a tall detail grows the centered modal,
 * shifts the row under the cursor, and ping-pongs the hover (the detail
 * appearing/disappearing loop). Self-contained: drop it straight into
 * `Command.Body`, no second `Modal.Workspace` needed.
 */
export function CommandDetail({ className, ...props }: CommandDetailProps) {
  const { activeId, activeDetail } = useCommand()
  if (!activeId || activeDetail == null) return null
  // Rendered as the shared Modal.Workspace surface (a frosted pane, matching the
  // list) — so the two-pane layout stays on-design — with the content in an
  // absolute scroll layer so the pane contributes ZERO height: the LIST sizes the
  // palette, this never does (no hover taper/loop). Drop it straight into
  // `Command.Body`; it self-wraps and removes itself for items without a detail.
  return (
    <Modal.Workspace padded={false} className={cx('q-command-detail', className)} {...props}>
      <div className="q-command-detail-scroll">{activeDetail}</div>
    </Modal.Workspace>
  )
}

export type CommandFooterProps = ComponentProps<'div'> & {
  /** Leading footer label/caption when Command.Footer is rendered in Command.Dialog. */
  caption?: ReactNode
  /** Trailing footer actions when Command.Footer is rendered in Command.Dialog. */
  actions?: ReactNode
  /** Stretch footer actions when rendered by Modal.Footer. */
  full?: boolean
}
/** Bottom bar — e.g. brand on the left, an Enter-to-confirm action on the right. */
export function CommandFooter({ caption, actions, full: _full, children, className, ...props }: CommandFooterProps) {
  return (
    <div className={cx('q-command-footer', className)} {...props}>
      {children ?? (
        <>
          {caption != null ? <span className="q-command-footer-caption">{caption}</span> : <span aria-hidden />}
          {actions != null ? <span className="q-command-footer-actions">{actions}</span> : null}
        </>
      )}
    </div>
  )
}

export interface CommandActionProps extends ComponentProps<'button'> {
  /** Label shown when no active item provides an `action` (e.g. "Select"). */
  fallback?: ReactNode
}
/**
 * Footer confirm button. Shows the active item's `action` label (falling back to
 * `fallback`) followed by `children` (typically a `<Kbd>`), and runs the active
 * item on click — the click equivalent of pressing Enter.
 */
export function CommandAction({ fallback, className, children, ...props }: CommandActionProps) {
  const { activeId, select, activeAction } = useCommand()
  const label = activeAction ?? fallback
  return (
    <button
      type="button"
      className={cx('q-command-action', className)}
      onClick={() => { if (activeId) select(activeId) }}
      disabled={!activeId}
      {...props}
    >
      {label != null ? <span className="q-command-action-label">{label}</span> : null}
      {children}
    </button>
  )
}

/* ── Dialog shell (⌘K palette) ─────────────────────────────────────────────── */

function matchShortcut(e: globalThis.KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.toLowerCase().split('+')
  const key = parts[parts.length - 1]
  const needMod = parts.includes('mod') || parts.includes('cmd') || parts.includes('ctrl') || parts.includes('meta')
  const mod = e.metaKey || e.ctrlKey
  return e.key.toLowerCase() === key && (needMod ? mod : true)
}

function splitDialogChildren(children: ReactNode) {
  const header: ReactNode[] = []
  const body: ReactNode[] = []
  let footer: Pick<CommandFooterProps, 'actions' | 'caption' | 'children' | 'full'> | null = null

  for (const child of Children.toArray(children)) {
    if (isValidElement(child) && child.type === CommandInput) {
      header.push(child)
    }
    else if (isValidElement(child) && child.type === CommandFooter) {
      const props = child.props as CommandFooterProps
      footer = {
        actions: props.actions ?? props.children,
        caption: props.caption,
        children: props.actions == null ? undefined : props.children,
        full: props.full,
      }
    }
    else {
      body.push(child)
    }
  }

  return { body, footer, header }
}

export interface CommandDialogProps extends CommandProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** Global hotkey to toggle the palette, e.g. `"mod+k"`. */
  shortcut?: string
  /** Modal size preset. */
  size?: ModalSize
  /** Class for the shared Modal.Content shell. */
  className?: string
  backdropClassName?: string
  container?: ComponentProps<typeof Modal.Content>['container']
  initialFocus?: ComponentProps<typeof Modal.Content>['initialFocus']
  finalFocus?: ComponentProps<typeof Modal.Content>['finalFocus']
}

/** The command palette in the shared Modal shell with an optional hotkey. */
export function CommandDialog({
  open,
  defaultOpen = false,
  onOpenChange,
  shortcut,
  size = 'md',
  label = 'Command menu',
  className,
  backdropClassName,
  container,
  initialFocus = true,
  finalFocus,
  children,
  ...commandProps
}: CommandDialogProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen)
  const isOpen = open ?? uncontrolled
  const setOpen = useCallback((next: boolean) => {
    if (open === undefined) setUncontrolled(next)
    onOpenChange?.(next)
  }, [open, onOpenChange])

  useEffect(() => {
    if (!shortcut) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (matchShortcut(e, shortcut)) {
        e.preventDefault()
        setOpen(!isOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shortcut, isOpen, setOpen])

  const { body, footer, header } = splitDialogChildren(children)

  return (
    <CommandRoot label={label} className="q-command-dialog-context" {...commandProps}>
      <Modal.Root open={isOpen} onOpenChange={setOpen}>
        <Modal.Content
          aria-label={label}
          size={size}
          className={className}
          backdropClassName={backdropClassName}
          container={container}
          initialFocus={initialFocus}
          finalFocus={finalFocus}
        >
          <Modal.Header>
            {header.length > 0 ? header : <CommandInput />}
            <Modal.CloseButton />
          </Modal.Header>
          <Modal.Body padded={false}>
            {body}
          </Modal.Body>
          {footer != null
            ? (
                <Modal.Footer full={footer.full}>
                  {footer.children ?? (
                    <>
                      {footer.caption != null ? <Modal.FooterCaption>{footer.caption}</Modal.FooterCaption> : <Modal.Spacer />}
                      {footer.actions != null ? <Modal.FooterActions full={footer.full}>{footer.actions}</Modal.FooterActions> : null}
                    </>
                  )}
                </Modal.Footer>
              )
            : null}
        </Modal.Content>
      </Modal.Root>
    </CommandRoot>
  )
}

/* `Command` is both the inline root and the namespace holding the parts. */
export const Command = Object.assign(CommandRoot, {
  Root: CommandRoot,
  Dialog: CommandDialog,
  Input: CommandInput,
  List: CommandList,
  Empty: CommandEmpty,
  Loading: CommandLoading,
  Group: CommandGroup,
  Item: CommandItem,
  ItemIcon: CommandItemIcon,
  ItemContent: CommandItemContent,
  ItemTitle: CommandItemTitle,
  ItemDescription: CommandItemDescription,
  ItemTrailing: CommandItemTrailing,
  Separator: CommandSeparator,
  Shortcut: CommandShortcut,
  Body: CommandBody,
  Detail: CommandDetail,
  Footer: CommandFooter,
  Action: CommandAction,
})
