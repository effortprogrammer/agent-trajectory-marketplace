'use client'

import type { ComponentProps, ReactElement, ReactNode, Ref } from 'react'
import { useId } from 'react'
import { NavigationMenu as Primitive } from '@base-ui/react/navigation-menu'
import { useRender } from '@base-ui/react/use-render'
import { Divider } from '../divider/index.ts'
import { cx } from '../utils/cx.ts'

/**
 * NavigationMenu — the product header: a logo, a bar of nav items (each either a
 * plain link or a trigger for a morphing mega-menu panel), and a right-side
 * actions cluster. Built on the Base UI `NavigationMenu` primitive (keyboard +
 * roving focus, hover/click open, the shared size-morphing popup, ARIA, portal +
 * positioning), skinned with quanta's `q-nav-*` utilities.
 *
 * COMPOSITION-FIRST (same rules as Dropdown). No `label` / `title` / `subtitle`
 * / `start` / `end` props — every part is a node you compose, so a bar item or
 * a panel row can hold ANY content. The component owns the design (the bar pill,
 * the glass action pills, the accent treatment, the morphing panel, the row
 * shell + 44px media tile); you own the content.
 *
 *   <NavigationMenu.Root>
 *     <NavigationMenu.Logo><Wordmark/></NavigationMenu.Logo>
 *     <NavigationMenu.List>
 *       <NavigationMenu.Item>                         // trigger + panel
 *         <NavigationMenu.Trigger>
 *           <NavigationMenu.ItemIcon><ImageIcon/></NavigationMenu.ItemIcon>
 *           Image
 *         </NavigationMenu.Trigger>
 *         <NavigationMenu.Content>
 *           <NavigationMenu.Menu size="image" layout="columns">…</NavigationMenu.Menu>
 *         </NavigationMenu.Content>
 *       </NavigationMenu.Item>
 *
 *       <NavigationMenu.Item>                          // plain link
 *         <NavigationMenu.Link href="/sc" accent>
 *           <NavigationMenu.ItemIcon><Spark/></NavigationMenu.ItemIcon>
 *           Supercomputer
 *           <Badge variant="nBrand">new</Badge>
 *         </NavigationMenu.Link>
 *       </NavigationMenu.Item>
 *     </NavigationMenu.List>
 *
 *     <NavigationMenu.Actions>
 *       <NavigationMenu.ActionsGroup>
 *         <NavigationMenu.Action iconOnly aria-label="Search"><Search/></NavigationMenu.Action>
 *         <NavigationMenu.Action href="/pricing"><Diamond/>Pricing<Badge>30% OFF</Badge></NavigationMenu.Action>
 *       </NavigationMenu.ActionsGroup>
 *       <NavigationMenu.Separator />
 *       <Avatar … />
 *     </NavigationMenu.Actions>
 *   </NavigationMenu.Root>
 *
 * PANEL ROWS are pure composition too — a `MenuItem` is a styled row that holds
 * whatever parts you nest. A row that contains a `MenuMedia` (the 44px tile)
 * automatically becomes the rich 60px "large" row (`label/md` title, muted
 * description) — driven by the composed content, not a prop.
 */

/** Rows of items a column holds before wrapping to the next column. */
export type NavRows = 1 | 2 | 3 | 4

const ROWS_CLASS = {
  1: 'q-nav-rows-1',
  2: 'q-nav-rows-2',
  3: 'q-nav-rows-3',
  4: 'q-nav-rows-4',
} satisfies Record<NavRows, string>

export type NavMenuSize = 'auto' | 'image' | 'video' | 'audio' | 'plugins'
export type NavMenuLayout = 'grid' | 'columns' | 'custom'

const MENU_SIZE_CLASS = {
  auto: '',
  image: 'q-nav-menu-size-image',
  video: 'q-nav-menu-size-video',
  audio: 'q-nav-menu-size-audio',
  plugins: 'q-nav-menu-size-plugins',
} satisfies Record<NavMenuSize, string>

const MENU_LAYOUT_CLASS = {
  grid: 'q-nav-menu-layout-grid',
  columns: 'q-nav-menu-layout-columns',
  custom: 'q-nav-menu-layout-custom',
} satisfies Record<NavMenuLayout, string>

/* ── Root: the bar primitive + the shared morphing popup shell ─────────────── */

export type NavigationMenuRootProps = Omit<ComponentProps<typeof Primitive.Root>, 'className'> & {
  className?: string
  side?: ComponentProps<typeof Primitive.Positioner>['side']
  align?: ComponentProps<typeof Primitive.Positioner>['align']
  sideOffset?: ComponentProps<typeof Primitive.Positioner>['sideOffset']
  alignOffset?: ComponentProps<typeof Primitive.Positioner>['alignOffset']
  collisionPadding?: ComponentProps<typeof Primitive.Positioner>['collisionPadding']
  container?: ComponentProps<typeof Primitive.Portal>['container']
}

/**
 * Renders the `<nav>` bar (logo / list / actions are its children) PLUS the
 * single shared Portal › Positioner › Popup › Viewport that every Item's
 * `Content` morphs into when it opens.
 */
function Root({
  side = 'bottom',
  align = 'center',
  sideOffset = 8,
  alignOffset,
  collisionPadding = 16,
  container,
  className,
  children,
  ...props
}: NavigationMenuRootProps) {
  return (
    <Primitive.Root className={cx('q-nav-root', className)} {...props}>
      {children}
      <Primitive.Portal container={container}>
        <Primitive.Positioner
          className="q-nav-positioner"
          side={side}
          align={align}
          sideOffset={sideOffset}
          alignOffset={alignOffset}
          collisionPadding={collisionPadding}
        >
          <Primitive.Popup className="q-nav-popup">
            <Primitive.Viewport className="q-nav-viewport" />
          </Primitive.Popup>
        </Primitive.Positioner>
      </Primitive.Portal>
    </Primitive.Root>
  )
}

/** Logo slot — content is the dev's. */
function Logo({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx('q-nav-logo', className)} {...props} />
}

type ListProps = Omit<ComponentProps<typeof Primitive.List>, 'className'> & { className?: string }
/** The horizontal bar of items. */
function List({ className, ...props }: ListProps) {
  return <Primitive.List className={cx('q-nav-list', className)} {...props} />
}

/* ── Bar item: a wrapper that holds a Link, or a Trigger + Content ─────────── */

export type NavigationMenuItemProps = Omit<ComponentProps<typeof Primitive.Item>, 'className'> & {
  className?: string
  /** Stable identity for controlled open state; auto-generated otherwise. */
  value?: string
}

/** A single bar slot. Put a `Link` inside for a plain item, or a `Trigger` +
 * `Content` pair for a panel trigger. */
function Item({ value, children, ...props }: NavigationMenuItemProps) {
  const autoId = useId()
  return <Primitive.Item value={value ?? autoId} {...props}>{children}</Primitive.Item>
}

export type NavigationMenuTriggerProps = Omit<ComponentProps<typeof Primitive.Trigger>, 'className'> & {
  className?: string
  /** Lime accent treatment. */
  accent?: boolean
  /** Current-section indication — sets `aria-current="page"` + the active style. */
  active?: boolean
  ref?: Ref<HTMLButtonElement>
}

/** The bar pill that opens a panel. Compose its label/icon/badge as children. */
function Trigger({ className, accent, active, children, ...props }: NavigationMenuTriggerProps) {
  return (
    <Primitive.Trigger
      className={cx('q-nav-item', accent && 'q-nav-item-accent', className)}
      aria-current={active ? 'page' : undefined}
      {...props}
    >
      {children}
    </Primitive.Trigger>
  )
}

type ContentProps = Omit<ComponentProps<typeof Primitive.Content>, 'className'> & { className?: string }
/** The panel mounted when its Item opens — wrap a `Menu` (or any content). */
function Content({ className, ...props }: ContentProps) {
  return <Primitive.Content className={cx('q-nav-content', className)} {...props} />
}

export type NavigationMenuLinkProps = Omit<ComponentProps<typeof Primitive.Link>, 'className'> & {
  className?: string
  /** Lime accent treatment. */
  accent?: boolean
  /** Current-section indication — sets `aria-current="page"` + the active style. */
  active?: boolean
}

/** A plain bar link pill. Compose its label/icon/badge as children. */
function Link({ className, accent, active, children, ...props }: NavigationMenuLinkProps) {
  return (
    <Primitive.Link
      className={cx('q-nav-item', accent && 'q-nav-item-accent', className)}
      aria-current={active ? 'page' : undefined}
      {...props}
    >
      {children}
    </Primitive.Link>
  )
}

/** Leading icon slot for a bar Trigger / Link (24px). */
function ItemIcon({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cx('q-nav-item-icon', className)} {...props} />
}

/* ── Right-side actions ────────────────────────────────────────────────────── */

/** The actions cluster, pushed to the right end of the bar. */
function Actions({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx('q-nav-actions', className)} {...props} />
}

/** A tighter sub-group of adjacent actions. */
function ActionsGroup({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx('q-nav-actions-group', className)} {...props} />
}

export type NavigationMenuActionProps = Omit<ComponentProps<'button'>, 'type'> & {
  /** Square icon-only pill (e.g. search). */
  iconOnly?: boolean
  /** Render an `<a>` instead of a `<button>`. */
  href?: string
  /** Swap the underlying element (e.g. a framework `<Link>` or quanta `Button`). */
  render?: ReactElement
}

/** A glass action pill (search / Pricing / Assets). Content is the dev's. */
function Action({ iconOnly, className, href, render, ...props }: NavigationMenuActionProps) {
  const cls = cx('q-nav-action', iconOnly && 'q-nav-action-icon', className)
  const isNativeButton = render == null && href == null
  return useRender({
    render,
    defaultTagName: href != null ? 'a' : 'button',
    props: {
      className: cls,
      ...(href != null ? { href } : {}),
      ...(isNativeButton ? { type: 'button' as const } : {}),
      ...props,
    },
  })
}

/** A divider — vertical in the bar/actions, reusing the Divider component. */
function Separator({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div className={cx('q-nav-separator', className)} {...props}>
      <Divider orientation="vertical" />
    </div>
  )
}

/* ── Menu: the panel — a 2–4 row grid / columns + optional featured rail ───── */

export type NavigationMenuMenuProps = Omit<ComponentProps<'div'>, 'children'> & {
  /** Rows of items per column before wrapping (1–4; 2–4 typical). Default 2. */
  rows?: NavRows
  /** Figma-sized panel surface. Defaults to content-sized. */
  size?: NavMenuSize
  /** `grid` wraps items; `columns` matches Figma mega menus; `custom` leaves content raw. */
  layout?: NavMenuLayout
  /** Standalone (outside a Root) panel — adds the glass surface + border. */
  standalone?: boolean
  /** Side rail content (promo / imagery / CTA). Any node. */
  featured?: ReactNode
  children?: ReactNode
}

function Menu({ rows = 2, size = 'auto', layout = 'grid', standalone = false, featured, className, children, ...props }: NavigationMenuMenuProps) {
  return (
    <div className={cx('q-nav-menu', standalone && 'q-nav-menu-static', MENU_SIZE_CLASS[size], MENU_LAYOUT_CLASS[layout], className)} {...props}>
      {layout === 'custom'
        ? children
        : (
            <div className={cx(layout === 'columns' ? 'q-nav-menu-columns' : 'q-nav-menu-grid', ROWS_CLASS[rows])}>
              {children}
            </div>
          )}
      {featured != null ? <div className="q-nav-featured">{featured}</div> : null}
    </div>
  )
}

/* ── Group: a labeled cluster of rows (its own full-height column) ─────────── */

function Group({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx('q-nav-group', className)} {...props} />
}

/** Column heading inside a Group. */
function GroupLabel({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx('q-nav-group-label', className)} {...props} />
}

/* ── MenuItem: a composition-only panel row ────────────────────────────────── */

export type NavigationMenuMenuItemProps = {
  href?: string
  render?: ComponentProps<typeof Primitive.Link>['render']
  /** Set false to render a static row (no `NavigationMenu.Link`) outside a Root. */
  interactive?: boolean
  className?: string
  children?: ReactNode
} & Omit<ComponentProps<typeof Primitive.Link>, 'href' | 'render' | 'className'>

/**
 * A panel row. Renders a real `NavigationMenu.Link` (keyboard + active state)
 * and reuses the shared `q-menu-item*` row primitives (see menu.css). Compose
 * any layout from `MenuItemIcon` / `MenuMedia` / `MenuItemContent` /
 * `MenuItemTitle` / `MenuItemDescription` / `MenuItemTrailing`. Include a
 * `MenuMedia` to get the rich 60px row.
 */
function MenuItem({ href, render, interactive = true, className, children, ...props }: NavigationMenuMenuItemProps) {
  const itemClass = cx('q-menu-item', 'q-nav-menu-item', className)

  if (!interactive) {
    const staticProps = props as ComponentProps<'a'>
    return href != null
      ? <a className={itemClass} href={href} {...staticProps}>{children}</a>
      : <div className={itemClass} {...(props as ComponentProps<'div'>)}>{children}</div>
  }

  return (
    <Primitive.Link className={itemClass} href={href} render={render} {...props}>
      {children}
    </Primitive.Link>
  )
}

/** Leading icon (20px) for a default panel row. */
function MenuItemIcon({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cx('q-menu-item-icon', className)} {...props} />
}

/** Leading media tile (44px glass) — its presence makes the row the large row. */
function MenuMedia({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cx('q-nav-menu-media', className)} {...props} />
}

/** Content column — stacks the title row and description. */
function MenuItemContent({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cx('q-menu-item-label', className)} {...props} />
}

function MenuItemTitleRow({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cx('q-menu-item-title-row', className)} {...props} />
}

function MenuItemTitle({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cx('q-menu-item-title', className)} {...props} />
}

function MenuItemDescription({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cx('q-menu-item-description', className)} {...props} />
}

function MenuItemTrailing({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cx('q-menu-item-trailing', className)} {...props} />
}

/** Horizontal separator inside custom NavigationMenu panels. */
function MenuSeparator({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div className={cx('q-nav-menu-separator', className)} {...props}>
      <Divider orientation="horizontal" />
    </div>
  )
}

export const NavigationMenu = {
  Root,
  Logo,
  List,
  Item,
  Trigger,
  Content,
  Link,
  ItemIcon,
  Actions,
  ActionsGroup,
  Action,
  Separator,
  Menu,
  Group,
  GroupLabel,
  MenuItem,
  MenuItemIcon,
  MenuMedia,
  MenuItemContent,
  MenuItemTitleRow,
  MenuItemTitle,
  MenuItemDescription,
  MenuItemTrailing,
  MenuSeparator,
}
