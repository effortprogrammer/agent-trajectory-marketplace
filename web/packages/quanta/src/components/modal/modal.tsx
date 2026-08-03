'use client'

import type { ComponentProps, ReactNode, Ref } from 'react'
import { IconChevronLeftMediumOutlined as ChevronLeftIcon } from '@higgsfield-ai/icons/IconChevronLeftMediumOutlined'
import { IconMagnifyingGlass2Outlined as SearchIcon } from '@higgsfield-ai/icons/IconMagnifyingGlass2Outlined'
import { Children, isValidElement, useRef } from 'react'
import { Dialog as Primitive } from '@base-ui/react/dialog'
import type { ClassValue } from '../utils/cx.ts'
import { cx } from '../utils/cx.ts'
import { CloseIcon, closeButton } from '../close-button/index.ts'
import { Icon } from '../icon/index.ts'

/**
 * Modal — Base UI Dialog (focus trap, scroll lock, escape, a11y, portal, and
 * exit-mount timing) skinned with quanta tokens, pixel-matched to the Figma
 * modal system (node 1947:1403). Dialog is centered (no Positioner), so the
 * glass card lives on `Popup` (z-q-modal) and the dim scrim on `Backdrop`.
 *
 * COMPOSITION-FIRST (same rules as Dropdown / NavigationMenu / Sidebar). The
 * component owns the DESIGN — the glass card, the 40px header row, the inset
 * body window, the 48px footer — and every title / control / caption / action is
 * CONTENT you compose. Header and Footer hold ANY nodes:
 *
 *   <Modal.Root>
 *     <Modal.Trigger render={<Button>Open</Button>} />
 *     <Modal.Content size="md">
 *       <Modal.Header>
 *         <Modal.Title>New element</Modal.Title>
 *         <Modal.CloseButton />
 *       </Modal.Header>
 *       <Modal.Body><Modal.Workspace>…</Modal.Workspace></Modal.Body>
 *       <Modal.Footer>
 *         <Modal.FooterCaption>{caption}</Modal.FooterCaption>
 *         <Modal.FooterActions>
 *           <Button variant="secondary">Cancel</Button>
 *           <Button>Confirm</Button>
 *         </Modal.FooterActions>
 *       </Modal.Footer>
 *     </Modal.Content>
 *   </Modal.Root>
 *
 * Header layouts (Figma default / back / search / tabs) are just different
 * compositions: drop a `Title` + `CloseButton`, a `BackButton` inside a
 * `HeaderLead`, a `Search`, or a Tabs pill + `Spacer` + `CloseButton`. Add
 * `flush` to a header whose row/pill spans the full width (search / tabs).
 */

export type ModalSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl'

const SIZE_CLASS = {
  xs: 'q-modal-size-xs',
  sm: 'q-modal-size-sm',
  md: 'q-modal-size-md',
  lg: 'q-modal-size-lg',
  xl: 'q-modal-size-xl',
  '2xl': 'q-modal-size-2xl',
} satisfies Record<ModalSize, string>

export interface ModalOptions {
  size?: ModalSize
}

/** Build the modal popup class string. Also usable to style a non-popup element. */
export function modal(options: ModalOptions = {}, ...extra: ClassValue[]): string {
  const { size = 'md' } = options
  return cx('q-modal', SIZE_CLASS[size], ...extra)
}

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

/* ── Passthrough parts (Base UI owns behavior; quanta only names them). ─────── */
const Root = Primitive.Root
const Trigger = Primitive.Trigger
/** Raw dismiss trigger — wrap a Button via `render`, or pass your own children. */
const Close = Primitive.Close

type TitleProps = Omit<ComponentProps<typeof Primitive.Title>, 'className'> & { className?: string }
function Title({ className, ...props }: TitleProps) {
  return <Primitive.Title className={cx('q-modal-title', className)} {...props} />
}

type DescriptionProps = Omit<ComponentProps<typeof Primitive.Description>, 'className'> & { className?: string }
function Description({ className, ...props }: DescriptionProps) {
  return <Primitive.Description className={cx('q-modal-description', className)} {...props} />
}

type CloseButtonProps = Omit<ComponentProps<typeof Primitive.Close>, 'className'> & { className?: string }
/** Styled round dismiss button (Figma disc) — sits at the trailing end of a header. */
function CloseButton({ className, children, ...props }: CloseButtonProps) {
  return (
    <Primitive.Close aria-label="Close" className={closeButton({}, className)} {...props}>
      {children ?? <Icon as={CloseIcon} size="md" />}
    </Primitive.Close>
  )
}

type BackButtonProps = Omit<ComponentProps<'button'>, 'className'> & { className?: string }
/** Styled round back button (Figma disc) for the "back" header. */
function BackButton({ className, children, type, ...props }: BackButtonProps) {
  return (
    <button type={type ?? 'button'} aria-label="Back" className={closeButton({}, className)} {...props}>
      {children ?? <Icon as={ChevronLeftIcon} size="md" />}
    </button>
  )
}

type SearchProps = Omit<ComponentProps<'input'>, 'className' | 'size'> & {
  className?: string
  inputClassName?: string
  icon?: ReactNode
}
/** Search row for the "search" header (magnifier + input). */
function Search({ className, inputClassName, icon, placeholder = 'Search', type, ...props }: SearchProps) {
  return (
    <div className={cx('q-modal-search', className)}>
      <span className="q-modal-search-icon">{icon ?? <Icon as={SearchIcon} size="md" />}</span>
      <input className={cx('q-modal-search-input', inputClassName)} placeholder={placeholder} type={type ?? 'search'} {...props} />
    </div>
  )
}

/* ── Content: Portal + Backdrop + the centered glass Popup ─────────────────── */
type ContentProps = Omit<ComponentProps<typeof Primitive.Popup>, 'className'> & {
  className?: string
  /** Width preset (Figma sizes). Use className/style for one-off dimensions. */
  size?: ModalSize
  backdropClassName?: string
  /** Portal mount node. Defaults to document.body. */
  container?: ComponentProps<typeof Primitive.Portal>['container']
}

function Content({ size = 'md', backdropClassName, container, className, children, initialFocus, ref, ...props }: ContentProps) {
  // Focus the popup itself (not the first tabbable) so opening doesn't ring the ✕.
  const popupRef = useRef<HTMLDivElement>(null)
  return (
    <Primitive.Portal container={container}>
      <Primitive.Backdrop className={cx('q-modal-backdrop', backdropClassName)} />
      <Primitive.Popup
        ref={mergeRefs(popupRef, ref)}
        initialFocus={initialFocus ?? popupRef}
        className={modal({ size }, className)}
        {...props}
      >
        {children}
      </Primitive.Popup>
    </Primitive.Portal>
  )
}

/* ── Header: a 40px row holding composed controls ──────────────────────────── */
type HeaderProps = ComponentProps<'div'> & {
  /** Run the header content flush to the card padding (Figma search / tabs headers). */
  flush?: boolean
}
function Header({ flush = false, className, ...props }: HeaderProps) {
  return <div className={cx('q-modal-header', flush && 'q-modal-header-flush', className)} {...props} />
}

/** Leading group inside a header (e.g. a BackButton + Title) for the "back" layout. */
function HeaderLead({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx('q-modal-header-lead', className)} {...props} />
}

/** Flex spacer — pushes following controls to the trailing end (header or footer). */
function Spacer({ className, ...props }: ComponentProps<'span'>) {
  return <span aria-hidden className={cx('q-modal-spacer', className)} {...props} />
}

/* ── Workspace + Body ──────────────────────────────────────────────────────── */
type WorkspaceProps = ComponentProps<'div'> & {
  /** Apply the default content padding. Set false for edge-to-edge content. */
  padded?: boolean
}

/**
 * The inset "window" — a frosted, lighter pane inside the body. Place a single
 * one to fill the body, or several inside your own layout div (flex row /
 * column / grid) for split layouts like the Figma "Left sidebar" / "Selector".
 */
function Workspace({ className, padded = true, ...props }: WorkspaceProps) {
  return <div className={cx('q-modal-workspace', padded && 'q-modal-workspace-padded', className)} {...props} />
}

type BodyProps = ComponentProps<'div'> & {
  /** Padding for the auto-wrapped single Workspace (ignored when you nest your own). */
  padded?: boolean
}

/**
 * Body — the scrollable region between header and footer. It imposes NO layout:
 * arrange Workspaces however you like, or pass a single `Modal.Workspace`. Plain
 * content with no Workspace anywhere is auto-wrapped in one full Workspace so the
 * window effect still applies. Scrolls (never crops) when content overflows.
 */
function Body({ className, padded = true, children, ...props }: BodyProps) {
  const hasWorkspace = (nodes: ReactNode): boolean =>
    Children.toArray(nodes).some(c =>
      isValidElement(c) && (c.type === Workspace || hasWorkspace((c.props as { children?: ReactNode }).children)),
    )
  return (
    <div className={cx('q-modal-body', className)} {...props}>
      {hasWorkspace(children) ? children : <Workspace padded={padded}>{children}</Workspace>}
    </div>
  )
}

/* ── Footer: a 48px row holding a caption + actions ────────────────────────── */
type FooterProps = ComponentProps<'div'> & {
  /** Stretch the footer for full-width actions (Figma footer type=full). */
  full?: boolean
}
function Footer({ full = false, className, ...props }: FooterProps) {
  return <div className={cx('q-modal-footer', full && 'q-modal-footer-full', className)} {...props} />
}

/** Leading footer caption (muted helper text). */
function FooterCaption({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx('q-modal-caption', className)} {...props} />
}

type FooterActionsProps = ComponentProps<'div'> & {
  /** Stretch the actions to fill the footer width (each child grows equally). */
  full?: boolean
}
/** Trailing footer actions (buttons), pushed to the right by default. */
function FooterActions({ full = false, className, ...props }: FooterActionsProps) {
  return <div className={cx('q-modal-actions', full && 'q-modal-actions-full', className)} {...props} />
}

export const Modal = {
  Root,
  Trigger,
  Close,
  Content,
  Header,
  HeaderLead,
  Spacer,
  Title,
  Description,
  CloseButton,
  BackButton,
  Search,
  Body,
  Workspace,
  Footer,
  FooterCaption,
  FooterActions,
}
