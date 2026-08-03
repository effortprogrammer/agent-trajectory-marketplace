'use client'

import type { ComponentProps, ReactNode } from 'react'
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { useRender } from '@base-ui/react/use-render'
import { IconChevronGrabberVerticalOutlined as ChevronGrabberGlyph } from '@higgsfield-ai/icons/IconChevronGrabberVerticalOutlined'
import { IconMagnifyingGlassOutlined as SearchGlyph } from '@higgsfield-ai/icons/IconMagnifyingGlassOutlined'
import { IconPinFilledThin as PinGlyph } from '@higgsfield-ai/icons/IconPinFilledThin'
import { Icon } from '../icon/index.ts'
import { cx } from '../utils/cx.ts'

/**
 * Sidebar — the product navigation rail, pixel-matched to the Figma "Sidebar"
 * system (primitives 2438:253, variants 2441:1407).
 *
 * SLOTS BY DEFAULT, composition when you need it (same rules as Dropdown). The
 * component owns the DESIGN — the rail, the 36px switcher, the row shells, the
 * pin / action overlays, the collapsed icon-strip. A row is one tag: pass
 * `start` / `title` / `meta` / `end` and it builds the anatomy; compose the
 * exported parts (`ItemIcon` / `ItemLabel` / `ItemMeta` / `ItemEnd`) via
 * `children` only for a bespoke layout.
 *
 *   <Sidebar.Root product="cinema-studio">
 *     <Sidebar.Header>
 *       <Sidebar.Switcher>
 *         <Sidebar.Logo><Logo/></Sidebar.Logo>
 *         <Sidebar.Title>Cinema Studio <Sidebar.SwitcherChevron/></Sidebar.Title>
 *       </Sidebar.Switcher>
 *       <Sidebar.Toggle><CollapseIcon/></Sidebar.Toggle>
 *     </Sidebar.Header>
 *
 *     <Sidebar.Body>
 *       <Sidebar.Section>
 *         <Sidebar.SectionItems>
 *           <Sidebar.Item selected start={<HomeIcon/>} title="Home" />
 *         </Sidebar.SectionItems>
 *       </Sidebar.Section>
 *
 *       <Sidebar.Section>
 *         <Sidebar.SectionHeader>
 *           <Sidebar.SectionTitle>Projects</Sidebar.SectionTitle>
 *         </Sidebar.SectionHeader>
 *         <Sidebar.SectionItems>
 *           <Sidebar.Item
 *             variant="project"
 *             start={<Sidebar.ProjectThumbnail src={cover}/>}
 *             title="Blue Horizon"
 *             meta="484"
 *             onPinChange={togglePin}
 *           />
 *         </Sidebar.SectionItems>
 *       </Sidebar.Section>
 *     </Sidebar.Body>
 *
 *     <Sidebar.Footer>
 *       <Sidebar.FooterItem variant="promo" start={<DiamondIcon/>} title="Pricing" end={<Sidebar.PromoBadge/>} />
 *     </Sidebar.Footer>
 *   </Sidebar.Root>
 *
 * Collapsing to the icon strip is BUILT IN: `Sidebar.Toggle` flips the rail with
 * no wiring, the Root owns the state (uncontrolled via `defaultCollapsed`, or
 * controlled via `collapsed` + `onCollapsedChange`), and collapsed labels / meta
 * / actions hide while icons centre. Rows render a `<button>`, an `<a>` when
 * `href` is set, or any element via `render` (Base UI useRender, e.g. a Link).
 */

export type SidebarItemSize = 'md' | 'sm'
export type SidebarItemVariant = 'nav' | 'project'
export type SidebarFooterVariant = 'default' | 'promo' | 'login'
export type SidebarProduct = 'cinema-studio' | 'marketing-studio' | 'supercomputer'
export type SidebarActionVisibility = 'always' | 'hover'

/* ── Collapse state (owned by Root, consumed by Toggle) ────────────────────── */
type SidebarCollapseContextValue = { collapsed: boolean, toggle: () => void }
const SidebarCollapseContext = createContext<SidebarCollapseContextValue | null>(null)

/* ── Root ──────────────────────────────────────────────────────────────────── */
export type SidebarRootProps = ComponentProps<'aside'> & {
  /** Icon-strip mode (controlled): labels/meta/actions hide and icons center. */
  collapsed?: boolean
  /** Initial collapsed state when uncontrolled (Toggle drives it from here). */
  defaultCollapsed?: boolean
  /** Fires whenever the collapsed state changes (Toggle, or a controlled set). */
  onCollapsedChange?: (collapsed: boolean) => void
  /** Figma product variant; controls the variant rail width only. */
  product?: SidebarProduct
  /** Square corners (docked flush to a screen edge). */
  flush?: boolean
}
function Root({
  collapsed: collapsedProp,
  defaultCollapsed = false,
  onCollapsedChange,
  product,
  flush = false,
  className,
  children,
  ...props
}: SidebarRootProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed)
  const isControlled = collapsedProp != null
  const collapsed = isControlled ? collapsedProp : internalCollapsed

  const setCollapsed = useCallback((next: boolean) => {
    if (!isControlled) setInternalCollapsed(next)
    onCollapsedChange?.(next)
  }, [isControlled, onCollapsedChange])

  const collapseContext = useMemo<SidebarCollapseContextValue>(
    () => ({ collapsed, toggle: () => setCollapsed(!collapsed) }),
    [collapsed, setCollapsed],
  )

  return (
    <SidebarCollapseContext.Provider value={collapseContext}>
      <aside
        data-collapsed={collapsed ? '' : undefined}
        data-product={product}
        className={cx('q-sidebar', collapsed && 'q-sidebar-collapsed', flush && 'q-sidebar-flush', className)}
        {...props}
      >
        {children}
      </aside>
    </SidebarCollapseContext.Provider>
  )
}

/* ── Header: layout slot for the switcher + toggle ─────────────────────────── */
function Header({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx('q-sidebar-header', className)} {...props} />
}

/**
 * The workspace switcher button (compose a Logo + Title inside). When the rail is
 * collapsed the Toggle is hidden, so clicking the switcher (just the logo then)
 * expands the rail — the collapse round-trips with no wiring. A custom `onClick`
 * runs first and can `preventDefault()` to keep the rail collapsed; when expanded
 * the switcher never auto-toggles, so its workspace-switching role is untouched.
 */
function Switcher({ className, type, onClick, ...props }: ComponentProps<'button'>) {
  const collapse = useContext(SidebarCollapseContext)
  return (
    <button
      type={type ?? 'button'}
      className={cx('q-sidebar-switcher', className)}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented && collapse?.collapsed) collapse.toggle()
      }}
      {...props}
    />
  )
}

/** Brand mark slot. */
function Logo({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cx('q-sidebar-logo', className)} {...props} />
}

/** Workspace name (compose a SwitcherChevron after the text if wanted). */
function Title({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cx('q-sidebar-switcher-name', 'text-q-body-sm-medium', className)} {...props} />
}

/** The up/down workspace-switcher chevron. */
function SwitcherChevron({ className }: { className?: string }) {
  return <Icon as={ChevronGrabberGlyph} size="sm" color="secondary" className={cx('q-sidebar-switcher-chevron', className)} />
}

/**
 * Square icon button that collapses / expands the rail. Inside a `Sidebar.Root`
 * it is self-wiring: clicking flips the Root's collapsed state, it carries
 * `aria-expanded`, and an icon-only Toggle gets a default Collapse/Expand label.
 * A custom `onClick` runs first and can `preventDefault()` to suppress the flip.
 */
function Toggle({ className, type, children, onClick, 'aria-label': ariaLabel, ...props }: ComponentProps<'button'>) {
  const collapse = useContext(SidebarCollapseContext)
  // A string child names the button itself; an icon child needs the default label.
  const labelFromText = typeof children === 'string'
  const resolvedLabel = ariaLabel
    ?? (labelFromText || collapse == null ? undefined : collapse.collapsed ? 'Expand sidebar' : 'Collapse sidebar')
  return (
    <button
      type={type ?? 'button'}
      aria-expanded={collapse ? !collapse.collapsed : undefined}
      aria-label={resolvedLabel}
      className={cx('q-sidebar-toggle', className)}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) collapse?.toggle()
      }}
      {...props}
    >
      {children}
    </button>
  )
}

/* ── Body ──────────────────────────────────────────────────────────────────── */
function Body({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx('q-sidebar-body', className)} {...props} />
}

/* ── Search: the filter input row ──────────────────────────────────────────── */
export type SidebarSearchProps = Omit<ComponentProps<'input'>, 'size'> & {
  /** Leading icon, defaults to a magnifier. */
  icon?: ReactNode
  className?: string
  inputClassName?: string
}
function Search({ icon, className, inputClassName, placeholder = 'Search', ...props }: SidebarSearchProps) {
  return (
    <div className={cx('q-sidebar-search', className)}>
      {icon ?? <Icon as={SearchGlyph} size="lg" className="q-sidebar-search-icon" />}
      <input className={cx('q-sidebar-search-input', 'text-q-body-sm-medium', inputClassName)} placeholder={placeholder} {...props} />
    </div>
  )
}

/* ── Section: an optional header + a stack of items ────────────────────────── */
function Section({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx('q-sidebar-section', className)} {...props} />
}

/** The section heading row (compose a SectionTitle + optional SectionActions). */
function SectionHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx('q-sidebar-section-header', className)} {...props} />
}

function SectionTitle({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cx('q-sidebar-section-title', 'text-q-label-xs-medium', className)} {...props} />
}

/** Trailing section-header actions (search / sort / add icon buttons). */
function SectionActions({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cx('q-sidebar-section-actions', className)} {...props} />
}

/** The items stack inside a Section. */
function SectionItems({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx('q-sidebar-section-items', className)} {...props} />
}

/* ── Row parts (compose any row out of these) ──────────────────────────────── */
function ItemIcon({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cx('q-sidebar-icon', className)} {...props} />
}

function ItemLabel({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cx('q-sidebar-label', 'text-q-body-sm-medium', className)} {...props} />
}

function ItemMeta({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cx('q-sidebar-meta', 'text-q-caption-sm-regular', className)} {...props} />
}

function ItemEnd({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cx('q-sidebar-end', className)} {...props} />
}

/** A bare icon button for section-header / row actions (e.g. a menu trigger). */
function ActionButton({ className, type, ...props }: ComponentProps<'button'>) {
  return <button type={type ?? 'button'} className={cx('q-sidebar-action-button', className)} {...props} />
}

/* ── Row slots (the ergonomic default; compose the parts directly for full control) ── */
type RowSlotProps = {
  /** Leading icon — `ItemIcon` slot. */
  start?: ReactNode
  /** Row label — `ItemLabel` slot. */
  title?: ReactNode
  /** Trailing count — `ItemMeta` slot. */
  meta?: ReactNode
  /** Trailing content (pin, collaborators, badge) — `ItemEnd` slot. */
  end?: ReactNode
}

/** Build a row body from slots; falls back to `children` when no slot is set (back-compat). */
function rowBody({ start, title, meta, end }: RowSlotProps, children: ReactNode): ReactNode {
  if (start == null && title == null && meta == null && end == null)
    return children
  return (
    <>
      {start != null ? <ItemIcon>{start}</ItemIcon> : null}
      {title != null ? <ItemLabel>{title}</ItemLabel> : null}
      {meta != null ? <ItemMeta>{meta}</ItemMeta> : null}
      {end != null ? <ItemEnd>{end}</ItemEnd> : null}
    </>
  )
}

/* ── Item: a row from slot props, or composed parts ────────────────────────── */
type RowOwnProps = {
  /** Interactive row action rendered as a sibling overlay, not inside the row button. */
  action?: ReactNode
  /** Whether the sibling row action is always visible or revealed on row hover/focus. */
  actionVisibility?: SidebarActionVisibility
  /** Link target: renders an `<a>` instead of a `<button>`. */
  href?: string
  /** Swap the host element (Base UI useRender, e.g. a router Link). */
  render?: useRender.RenderProp
}
type RowProps = Omit<ComponentProps<'button'>, 'title'> & RowOwnProps

export type SidebarItemProps = RowProps & RowSlotProps & {
  size?: SidebarItemSize
  /** Figma row primitive: NavItem or ProjectItem. */
  variant?: SidebarItemVariant
  selected?: boolean
  /** Pinned visual state — controlled. Omit (with `onPinChange`) to let the row manage its own pin. */
  pinned?: boolean
  /** Enable a pin toggle (a pin button that reveals on hover). `(next) => void`. */
  onPinChange?: (pinned: boolean) => void
}

/**
 * A sidebar row. The common row is one tag — pass `start` / `title` / `meta` /
 * `end` slot props and the row builds the standard anatomy; compose `ItemIcon` /
 * `ItemLabel` / `ItemMeta` / `ItemEnd` (via `children`) for a bespoke layout.
 * Renders a `<button>`, an `<a>` when `href` is set, or any element via `render`.
 * Pass `onPinChange` for a hover-revealed pin toggle (it self-manages its pinned
 * state when `pinned` is omitted), or `action` for a sibling overlay control.
 */
function Item({
  action,
  actionVisibility = 'always',
  size = 'md',
  variant = 'nav',
  selected = false,
  pinned,
  onPinChange,
  href,
  render,
  className,
  start,
  title,
  meta,
  end,
  children,
  ...rest
}: SidebarItemProps) {
  const [selfPinned, setSelfPinned] = useState(false)
  const pinnedResolved = pinned ?? selfPinned
  const isLink = href != null
  const main = useRender({
    render,
    defaultTagName: isLink ? 'a' : 'button',
    props: {
      className: cx(
        'q-sidebar-row',
        size === 'sm' ? 'q-sidebar-item-sm' : 'q-sidebar-item',
        variant === 'project' && 'q-sidebar-projectitem',
        selected && 'q-sidebar-selected',
        className,
      ),
      ...(isLink ? { href } : { type: 'button' as const }),
      ...(selected ? { 'aria-current': 'page' as const } : {}),
      ...rest,
      children: rowBody({ start, title, meta, end }, children),
    },
  })
  const hasPin = onPinChange != null
  if (action == null && !hasPin)
    return main

  // Action/pin controls are siblings of the row, never nested inside the row
  // button/link — keeps dropdown triggers and pin buttons valid HTML.
  return (
    <div
      className={cx(
        'q-sidebar-actionrow',
        hasPin && 'q-sidebar-pinrow',
        actionVisibility === 'hover' && 'q-sidebar-actionrow-hover',
        variant === 'project' && 'q-sidebar-actionrow-project',
        selected && 'q-sidebar-actionrow-selected',
        pinnedResolved && 'q-sidebar-pinned',
      )}
    >
      {main}
      {action != null ? <span className="q-sidebar-action">{action}</span> : null}
      {hasPin ? (
        <button
          type="button"
          className="q-sidebar-pin"
          data-pinned={pinnedResolved ? '' : undefined}
          aria-pressed={pinnedResolved}
          aria-label={pinnedResolved ? 'Unpin' : 'Pin'}
          onClick={() => {
            if (pinned == null)
              setSelfPinned(!pinnedResolved)
            onPinChange(!pinnedResolved)
          }}
        >
          <PinGlyph />
        </button>
      ) : null}
    </div>
  )
}

/* ── Footer ────────────────────────────────────────────────────────────────── */
function Footer({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx('q-sidebar-footer', className)} {...props} />
}

export type SidebarFooterItemProps = Omit<RowProps, 'action' | 'actionVisibility'> & RowSlotProps & {
  variant?: SidebarFooterVariant
}
function FooterItem({ variant = 'default', href, render, className, start, title, meta, end, children, ...rest }: SidebarFooterItemProps) {
  const isLink = href != null
  const variantClass = variant === 'promo' ? 'q-sidebar-footeritem-promo' : variant === 'login' ? 'q-sidebar-footeritem-login' : undefined
  return useRender({
    render,
    defaultTagName: isLink ? 'a' : 'button',
    props: {
      className: cx('q-sidebar-row', 'q-sidebar-footeritem', variantClass, className),
      ...(isLink ? { href } : { type: 'button' as const }),
      ...rest,
      children: rowBody({ start, title, meta, end }, children),
    },
  })
}

/* ── Figma composite pieces used inside Sidebar rows ───────────────────────── */
export type SidebarProjectThumbnailProps = ComponentProps<'span'> & {
  src?: string
  alt?: string
  fallback?: ReactNode
}
/**
 * Thumbnail tile. Any corner overlay — e.g. a composed `Sidebar.SharedBadge` —
 * is passed as `children`; the badge is NOT a built-in feature of the thumbnail
 * (the thumb's CSS positions a `.q-sidebar-shared-badge` child at the corner).
 */
function ProjectThumbnail({ src, alt = '', fallback, className, children, ...props }: SidebarProjectThumbnailProps) {
  return (
    <span className={cx('q-sidebar-project-thumb', className)} {...props}>
      {src != null
        ? <img src={src} alt={alt} />
        : <span className="q-sidebar-project-thumb-fallback">{fallback}</span>}
      {children}
    </span>
  )
}

export type SidebarCollaboratorsProps = ComponentProps<'span'> & {
  avatars?: Array<{ src: string, alt?: string }>
  count?: ReactNode
}
function Collaborators({ avatars = [], count, className, ...props }: SidebarCollaboratorsProps) {
  return (
    <span className={cx('q-sidebar-collaborators', className)} {...props}>
      {avatars.map((avatar, index) => (
        <span className="q-sidebar-collaborator-avatar" key={`${avatar.src}-${index}`}>
          <img src={avatar.src} alt={avatar.alt ?? ''} />
        </span>
      ))}
      {count != null ? <span className="q-sidebar-collaborator-count text-q-caption-xs-medium">{count}</span> : null}
    </span>
  )
}

export type SidebarPromoBadgeProps = ComponentProps<'span'>
function PromoBadge({ className, children = '50% OFF', ...props }: SidebarPromoBadgeProps) {
  return (
    <span className={cx('q-sidebar-promo-badge', className)} {...props}>
      {children}
    </span>
  )
}

export const Sidebar = {
  Root,
  Header,
  Switcher,
  Logo,
  Title,
  SwitcherChevron,
  Toggle,
  Body,
  Search,
  Section,
  SectionHeader,
  SectionTitle,
  SectionActions,
  SectionItems,
  Item,
  ItemIcon,
  ItemLabel,
  ItemMeta,
  ItemEnd,
  ActionButton,
  Footer,
  FooterItem,
  ProjectThumbnail,
  Collaborators,
  PromoBadge,
}
