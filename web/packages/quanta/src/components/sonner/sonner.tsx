'use client'

import type { ComponentProps, CSSProperties, ReactNode } from 'react'
import { isValidElement } from 'react'
import { Toast as Primitive } from '@base-ui/react/toast'
import { IconCircleCheckOutlined as SuccessGlyph } from '@higgsfield-ai/icons/IconCircleCheckOutlined'
import { IconCircleInfoOutlined as InfoGlyph } from '@higgsfield-ai/icons/IconCircleInfoOutlined'
import { IconCircleXOutlined as ErrorGlyph } from '@higgsfield-ai/icons/IconCircleXOutlined'
import { IconExclamationTriangleOutlined as WarningGlyph } from '@higgsfield-ai/icons/IconExclamationTriangleOutlined'
import { CloseIcon } from '../close-button/index.ts'
import { Icon } from '../icon/index.ts'
import { cx } from '../utils/cx.ts'

/**
 * Sonner — an opinionated toast system on Base UI Toast, skinned with quanta
 * tokens. The imperative `toast()` API (`toast.success(...)`, `toast.promise(...)`)
 * mirrors the `sonner` library: it drives a module-level toast manager, so toasts
 * can be fired from anywhere (event handlers, effects, non-React code). Mount one
 * `<Toaster />` near the app root; Base UI owns timing, stacking, swipe-to-dismiss,
 * focus and a11y — quanta only paints.
 *
 *   import { Toaster, toast } from '@higgsfield/quanta/sonner'
 *   <Toaster position="bottom-right" />
 *   toast.success('Saved', { description: 'Your changes are live.' })
 */

export type SonnerVariant = 'default' | 'success' | 'error' | 'warning' | 'info' | 'loading'
export type SonnerPosition =
  | 'top-left' | 'top-center' | 'top-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'

/** Per-toast payload carried on the Base UI toast `data` bag. */
interface SonnerData {
  variant?: SonnerVariant
  /** A custom leading node (overrides the variant icon). */
  icon?: ReactNode
  /** A custom action node (e.g. a quanta Button) — overrides the simple action button. */
  action?: ReactNode
}

/** The simple built-in action button config (sonner-shaped). */
export interface SonnerActionConfig {
  label: string
  onClick?: () => void
}

/** Distinguish the `{ label, onClick }` config from an arbitrary ReactNode action. */
function isActionConfig(a: ReactNode | SonnerActionConfig): a is SonnerActionConfig {
  return typeof a === 'object' && a !== null && !isValidElement(a) && 'label' in a
}

const VARIANT_CLASS = {
  default: 'q-sonner-default',
  success: 'q-sonner-success',
  error: 'q-sonner-error',
  warning: 'q-sonner-warning',
  info: 'q-sonner-info',
  loading: 'q-sonner-loading',
} satisfies Record<SonnerVariant, string>

type SwipeDirection = 'up' | 'down' | 'left' | 'right'

/** bottom-* swipes down, top-* swipes up; all dismiss horizontally too. */
const SWIPE = {
  'top-left': ['up', 'left'],
  'top-center': ['up'],
  'top-right': ['up', 'right'],
  'bottom-left': ['down', 'left'],
  'bottom-center': ['down'],
  'bottom-right': ['down', 'right'],
} satisfies Record<SonnerPosition, SwipeDirection[]>

/* ── The module-level manager — the imperative API talks to this. ───────────── */
export const sonnerManager = Primitive.createToastManager<SonnerData>()

interface ToastOptions {
  description?: ReactNode
  /** Auto-dismiss delay in ms (0 keeps it until dismissed). */
  duration?: number
  icon?: ReactNode
  /**
   * A trailing action. Either the simple `{ label, onClick }` button, or any
   * `ReactNode` (e.g. a quanta `Button`, a link, or several buttons).
   */
  action?: ReactNode | SonnerActionConfig
  id?: string
}

function emit(variant: SonnerVariant, title: ReactNode, options: ToastOptions = {}): string {
  const { description, duration, icon, action, id } = options
  // The config object → Base UI's built-in Action button (back-compat); any
  // other node → rendered verbatim in the action slot.
  const cfg = action != null && isActionConfig(action) ? action : undefined
  const customAction = action != null && !isActionConfig(action) ? action : undefined
  return sonnerManager.add({
    title,
    description,
    type: variant,
    timeout: duration,
    id,
    data: { variant, icon, action: customAction },
    actionProps: cfg
      ? { children: cfg.label, onClick: cfg.onClick }
      : undefined,
  })
}

/** Imperative toast API (sonner-shaped). */
export const toast = Object.assign(
  (title: ReactNode, options?: ToastOptions) => emit('default', title, options),
  {
    success: (title: ReactNode, options?: ToastOptions) => emit('success', title, options),
    error: (title: ReactNode, options?: ToastOptions) => emit('error', title, options),
    warning: (title: ReactNode, options?: ToastOptions) => emit('warning', title, options),
    info: (title: ReactNode, options?: ToastOptions) => emit('info', title, options),
    loading: (title: ReactNode, options?: ToastOptions) => emit('loading', title, { duration: 0, ...options }),
    message: (title: ReactNode, options?: ToastOptions) => emit('default', title, options),
    dismiss: (id?: string) => sonnerManager.close(id),
    /** Pending → resolved/rejected, sonner-style. */
    promise: <T,>(
      promise: Promise<T>,
      msgs: { loading: ReactNode, success: ReactNode | ((v: T) => ReactNode), error: ReactNode | ((e: unknown) => ReactNode) },
    ) => sonnerManager.promise(promise, {
      loading: msgs.loading as string,
      success: msgs.success as never,
      error: msgs.error as never,
    }),
  },
)

function Glyph({ variant }: { variant: SonnerVariant }) {
  // The status glyphs come from @higgsfield-ai/icons; <Icon size="md"> = 20px,
  // matching the previous `size-5`. Decorative — the toast title carries meaning.
  switch (variant) {
    case 'success':
      return <Icon as={SuccessGlyph} size="md" />
    case 'error':
      return <Icon as={ErrorGlyph} size="md" />
    case 'warning':
      return <Icon as={WarningGlyph} size="md" />
    case 'info':
      return <Icon as={InfoGlyph} size="md" />
    case 'loading':
      // Hand-rolled spinner (not a glyph from the icon package): keep the inline
      // SVG so its custom q-sonner-spinner animation + currentColor strokes stay.
      return <svg viewBox="0 0 20 20" fill="none" aria-hidden className="size-5 q-sonner-spinner"><circle cx="10" cy="10" r="8" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" /><path d="M18 10a8 8 0 0 0-8-8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
    default:
      return null
  }
}

/* ── The rendered toast + the viewport ─────────────────────────────────────── */
function SonnerToast({ toast: t, swipe }: { toast: Primitive.Root.ToastObject<SonnerData>, swipe: SwipeDirection[] }) {
  const variant = (t.data?.variant ?? t.type ?? 'default') as SonnerVariant
  const icon = t.data?.icon ?? <Glyph variant={variant} />
  const actionNode = t.data?.action
  return (
    <Primitive.Root toast={t} swipeDirection={swipe} className={cx('q-sonner', VARIANT_CLASS[variant])}>
      {icon ? <span className="q-sonner-icon">{icon}</span> : null}
      <div className="q-sonner-text">
        <Primitive.Title className="q-sonner-title" />
        <Primitive.Description className="q-sonner-description" />
      </div>
      {actionNode != null
        ? <div className="q-sonner-action-slot">{actionNode}</div>
        : t.actionProps ? <Primitive.Action className="q-sonner-action" /> : null}
      <Primitive.Close className="q-sonner-close" aria-label="Dismiss"><Icon as={CloseIcon} size="sm" /></Primitive.Close>
    </Primitive.Root>
  )
}

function ToastList({ swipe }: { swipe: SwipeDirection[] }) {
  const { toasts } = Primitive.useToastManager()
  return toasts.map(t => <SonnerToast key={t.id} toast={t as Primitive.Root.ToastObject<SonnerData>} swipe={swipe} />)
}

export interface ToasterProps extends Omit<ComponentProps<typeof Primitive.Viewport>, 'children' | 'className'> {
  position?: SonnerPosition
  /** Max simultaneously-visible toasts; older ones collapse behind / queue. Default 3. */
  limit?: number
  /** Default auto-dismiss in ms. Default 5000. */
  duration?: number
  /**
   * Expand the stack by default. When false (default) toasts collapse into a
   * peeking pile and expand on hover / focus (Sonner behaviour).
   */
  expand?: boolean
  /** Gap between toasts when expanded, in px. Default 14. */
  gap?: number
  className?: string
}

/**
 * Mount once near the app root. Toasts collapse into a glassy stack and expand
 * on hover/focus (or always, with `expand`). `limit` caps the visible pile;
 * Base UI owns the stack offsets, swipe-to-dismiss, timing, focus and a11y.
 */
export function Toaster({ position = 'bottom-right', limit = 3, duration = 5000, expand = false, gap, className, style, ...props }: ToasterProps) {
  const viewportStyle = gap == null
    ? style
    : { ...style, ...({ '--q-sonner-gap': `${gap}px` } as Record<string, string>) } as CSSProperties
  return (
    <Primitive.Provider toastManager={sonnerManager} limit={limit} timeout={duration}>
      <Primitive.Portal>
        <Primitive.Viewport
          data-position={position}
          data-expand={expand ? '' : undefined}
          style={viewportStyle}
          className={cx('q-sonner-viewport', className)}
          {...props}
        >
          <ToastList swipe={SWIPE[position]} />
        </Primitive.Viewport>
      </Primitive.Portal>
    </Primitive.Provider>
  )
}
