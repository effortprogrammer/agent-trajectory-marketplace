'use client'

import type { ComponentProps, ReactNode } from 'react'
import { createContext, useContext } from 'react'
import { Drawer as Primitive } from '@base-ui/react/drawer'
import { cx } from '../utils/cx.ts'
import { CloseIcon, closeButton } from '../close-button/index.ts'
import { Icon } from '../icon/index.ts'

/**
 * Vault — an edge-docked, swipeable drawer / sheet on Base UI Drawer (the Vaul
 * model), skinned with quanta tokens. Base UI owns the drag physics, snap points,
 * focus trap, scroll lock and a11y; quanta paints the surface and docks it to a
 * chosen edge. Composition mirrors Modal: Root / Trigger / Content / Header /
 * Body / Footer.
 *
 *   <Vault.Root side="bottom">
 *     <Vault.Trigger render={<Button>Open</Button>} />
 *     <Vault.Content>
 *       <Vault.Header title="Filters" />
 *       <Vault.Body>…</Vault.Body>
 *       <Vault.Footer actions={<Button>Apply</Button>} />
 *     </Vault.Content>
 *   </Vault.Root>
 */

export type VaultSide = 'bottom' | 'top' | 'left' | 'right'

/** side → which edge the popup docks to + its slide/dismiss gesture. */
const SIDE_CLASS = {
  bottom: 'q-vault-bottom',
  top: 'q-vault-top',
  left: 'q-vault-left',
  right: 'q-vault-right',
} satisfies Record<VaultSide, string>

const SWIPE_DIRECTION = {
  bottom: 'down',
  top: 'up',
  left: 'left',
  right: 'right',
} satisfies Record<VaultSide, 'up' | 'down' | 'left' | 'right'>

const VaultContext = createContext<VaultSide>('bottom')

/* ── Passthrough parts (Base UI owns behavior). ─────────────────────────────── */
const Trigger = Primitive.Trigger
const Close = Primitive.Close

export type VaultRootProps = ComponentProps<typeof Primitive.Root> & { side?: VaultSide }

/** Owns open state + the swipe gesture for the chosen edge. */
function Root({ side = 'bottom', children, ...props }: VaultRootProps) {
  return (
    <VaultContext.Provider value={side}>
      <Primitive.Root swipeDirection={SWIPE_DIRECTION[side]} {...props}>
        {children}
      </Primitive.Root>
    </VaultContext.Provider>
  )
}

type TitleProps = Omit<ComponentProps<typeof Primitive.Title>, 'className'> & { className?: string }
function Title({ className, ...props }: TitleProps) {
  return <Primitive.Title className={cx('q-vault-title', className)} {...props} />
}

type DescriptionProps = Omit<ComponentProps<typeof Primitive.Description>, 'className'> & { className?: string }
function Description({ className, ...props }: DescriptionProps) {
  return <Primitive.Description className={cx('q-vault-description', className)} {...props} />
}

type CloseButtonProps = Omit<ComponentProps<typeof Primitive.Close>, 'className'> & { className?: string }
function CloseButton({ className, children, ...props }: CloseButtonProps) {
  return (
    <Primitive.Close aria-label="Close" className={closeButton({}, className)} {...props}>
      {children ?? <Icon as={CloseIcon} size="md" />}
    </Primitive.Close>
  )
}

export type VaultContentProps = Omit<ComponentProps<typeof Primitive.Popup>, 'className'> & {
  className?: string
  /** Override the side from Root (rarely needed). */
  side?: VaultSide
  /** Show the grab handle. Defaults to true for the `bottom` side. */
  handle?: boolean
  backdropClassName?: string
  container?: ComponentProps<typeof Primitive.Portal>['container']
}

/**
 * Portal + Backdrop + Viewport + the edge-docked, swipeable Popup. The
 * `Drawer.Viewport` is REQUIRED — it's what enables Base UI's swipe/drag,
 * snap-point handling and touch scroll-locking (without it the Popup renders
 * but is undraggable).
 */
function Content({ side: sideProp, handle, backdropClassName, container, className, children, ...props }: VaultContentProps) {
  const ctxSide = useContext(VaultContext)
  const side = sideProp ?? ctxSide
  const showHandle = handle ?? side === 'bottom'
  return (
    <Primitive.Portal container={container}>
      <Primitive.Backdrop className={cx('q-vault-backdrop', backdropClassName)} />
      <Primitive.Viewport className="q-vault-viewport">
        <Primitive.Popup className={cx('q-vault', SIDE_CLASS[side], className)} {...props}>
          {showHandle ? <span className="q-vault-handle" aria-hidden /> : null}
          {children}
        </Primitive.Popup>
      </Primitive.Viewport>
    </Primitive.Portal>
  )
}

export type VaultHeaderProps = Omit<ComponentProps<'div'>, 'title'> & {
  title?: ReactNode
  /** Leading slot — a back button / icon / avatar before the title. Any node. */
  start?: ReactNode
  /** Trailing slot — sits just before the close affordance. Any node. */
  end?: ReactNode
  /** Close affordance: `true` (default button), `false` (none), or a custom node. */
  closeButton?: ReactNode | boolean
}

function Header({ title, start, end, closeButton = true, children, className, ...props }: VaultHeaderProps) {
  const close = closeButton === true ? <CloseButton /> : closeButton === false ? null : closeButton
  const titleNode = title != null ? <Title>{title}</Title> : null
  // start/end flank the title in a leading group (space-between keeps close at
  // the trailing edge). Without a flank slot, the bare title/spacer is unchanged.
  let lead: ReactNode
  if (children != null)
    lead = children
  else if (start != null || end != null)
    lead = <div className="q-vault-header-lead">{start}{titleNode}{end}</div>
  else
    lead = titleNode ?? <span />
  return (
    <div className={cx('q-vault-header', className)} {...props}>
      {lead}
      {close}
    </div>
  )
}

type BodyProps = ComponentProps<'div'>
/** Scrollable content region. */
function Body({ className, ...props }: BodyProps) {
  return <div className={cx('q-vault-body', className)} {...props} />
}

export type VaultFooterProps = ComponentProps<'div'> & {
  caption?: ReactNode
  actions?: ReactNode
  /** Stretch the actions to fill the footer width (full-width sheet buttons). */
  full?: boolean
}
function Footer({ caption, actions, full = false, children, className, ...props }: VaultFooterProps) {
  return (
    <div className={cx('q-vault-footer', className)} {...props}>
      {children ?? (
        <>
          {caption != null ? <span className="q-vault-caption">{caption}</span> : null}
          {actions != null ? <div className={cx('q-vault-actions', full && 'q-vault-actions-full')}>{actions}</div> : null}
        </>
      )}
    </div>
  )
}

export const Vault = {
  Root,
  Trigger,
  Content,
  Header,
  Body,
  Footer,
  Title,
  Description,
  Close,
  CloseButton,
}
