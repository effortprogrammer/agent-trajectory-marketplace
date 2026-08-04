'use client'

import type { ComponentProps, ReactNode } from 'react'
import { Avatar as Primitive } from '@base-ui/react/avatar'
import { Dot, type DotColor, type DotSize } from '../dot/index.ts'
import { Typography, type TypographyVariant, typography } from '../typography/index.ts'
import { cx } from '../utils/cx.ts'

/**
 * Avatar — circular presence pinned to the Figma "Avatar" component
 * (node 1405:5456). Renders, in priority order, a photo, a custom fallback, or
 * mono-cased initials on a palette-coloured disk; an optional dashed variant is
 * the empty / "add" placeholder.
 *
 * Composable parts (every part is a replaceable node with a default):
 *   • `fallback` — the disk CONTENT slot (defaults to initials from `alt`); pass
 *     any node to override.
 *   • `badge` — the rim slot (defaults to the presence `<Dot>` derived from
 *     `status`); pass any node — a count `<Badge>`, a verified check, a custom
 *     `<Dot>` — to replace it. `status` stays as the convenience default.
 *   • `render` (via Base UI Avatar.Root) swaps the host element.
 */

export type AvatarSize = 'xxs' | '2xs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl'
export type AvatarStatus = 'online' | 'offline' | 'away' | 'busy'
export type AvatarColor =
  | 'neutral'
  | 'orange'
  | 'mint'
  | 'blue'
  | 'pink'
  | 'purple'
  | 'brown'
  | 'yellow'
export type AvatarVariant = 'filled' | 'pending' | 'dashed'

type AvatarSizeKey = Exclude<AvatarSize, '2xs'>

const SIZE_BOX = {
  xxs: 'size-q-500', // 20px
  xs: 'size-q-600', // 24px
  sm: 'size-q-800', // 32px
  md: 'size-q-1000', // 40px
  lg: 'size-q-1200', // 48px
  xl: 'size-q-1400', // 56px
} satisfies Record<AvatarSizeKey, string>

// Initials type ramp — the Typography `variant` is the single source of truth.
// The Root applies it as a class via `typography({ variant })` so a
// consumer-passed `fallback` slot inherits the exact type, and the default
// initials render through <Typography> with the same variant (render-identical).

// Filled-disk ramp — pinned to the Figma "type=text" variants.
const SIZE_TEXT_VARIANT = {
  xxs: 'mono-xs-semi-bold', // 10px
  xs: 'mono-xs-semi-bold', // 10px
  sm: 'mono-sm-semi-bold', // 12px
  md: 'mono-lg-semi-bold', // 16px
  lg: 'mono-lg-semi-bold', // 16px
  xl: 'mono-lg-semi-bold', // 16px
} satisfies Record<AvatarSizeKey, TypographyVariant>

// Dashed-placeholder ramp — Figma's "type=pending" variants use a distinct,
// smaller type scale than the filled disks (md 12 vs 16, lg 14 vs 16, etc.).
const SIZE_TEXT_DASHED_VARIANT = {
  xxs: 'mono-xs-semi-bold', // 10px
  xs: 'mono-sm-semi-bold', // 12px
  sm: 'mono-sm-semi-bold', // 12px
  md: 'mono-sm-semi-bold', // 12px
  lg: 'mono-md-semi-bold', // 14px
  xl: 'mono-lg-semi-bold', // 16px
} satisfies Record<AvatarSizeKey, TypographyVariant>

// Pending ramp stroke weight — Figma uses thin (1px) below md, medium (1.5px) at md+.
const PENDING_BORDER = {
  xxs: 'border-q-thin',
  xs: 'border-q-thin',
  sm: 'border-q-thin',
  md: 'border-q-medium',
  lg: 'border-q-medium',
  xl: 'border-q-medium',
} satisfies Record<AvatarSizeKey, string>

const COLOR_BG = {
  orange: 'bg-q-palette-orange-bg',
  mint: 'bg-q-palette-mint-bg',
  blue: 'bg-q-palette-blue-bg',
  pink: 'bg-q-palette-pink-bg',
  purple: 'bg-q-palette-purple-bg',
  brown: 'bg-q-palette-brown-bg',
  yellow: 'bg-q-brand-yellow',
  neutral: 'bg-q-background-elevated-start',
} satisfies Record<AvatarColor, string>

const COLOR_FG = {
  orange: 'text-q-text-primary',
  mint: 'text-q-palette-mint-text',
  blue: 'text-q-palette-blue-text',
  pink: 'text-q-text-primary',
  purple: 'text-q-text-primary',
  brown: 'text-q-palette-brown-text',
  yellow: 'text-q-text-inverse',
  neutral: 'text-q-text-primary',
} satisfies Record<AvatarColor, string>

/** Presence colour the Figma dot uses for each avatar status. */
const STATUS_DOT_COLOR = {
  online: 'green',
  away: 'yellow',
  busy: 'red',
  offline: 'grey',
} satisfies Record<AvatarStatus, DotColor>

/** Dot scale the design pairs with each avatar size. */
const STATUS_DOT_SIZE = {
  xxs: 'xs',
  xs: 'xs',
  sm: 'sm',
  md: 'md',
  lg: 'md',
  xl: 'md',
} satisfies Record<AvatarSizeKey, DotSize>

const AUTO: AvatarColor[] = ['orange', 'mint', 'blue', 'pink', 'purple', 'brown', 'yellow']

type AvatarImageProps =
  Omit<ComponentProps<typeof Primitive.Image>, 'alt' | 'children' | 'className' | 'src'> & {
    className?: string
  }

export type AvatarProps = Omit<ComponentProps<typeof Primitive.Root>, 'children'> & {
  size?: AvatarSize
  src?: string
  alt?: string
  fallback?: ReactNode
  color?: AvatarColor
  status?: AvatarStatus
  /**
   * Rim slot. Defaults to the presence `<Dot>` for `status`; pass any node
   * (a `<Badge>`, a verified icon, a custom `<Dot>`) to replace it.
   */
  badge?: ReactNode
  variant?: AvatarVariant
  imageProps?: AvatarImageProps
}

export function Avatar({
  size = 'md',
  src,
  alt,
  fallback,
  color,
  status,
  badge,
  variant = 'filled',
  imageProps,
  className,
  ...props
}: AvatarProps) {
  const sizeKey = normalizeSize(size)
  const pending = variant === 'pending' || variant === 'dashed'
  // Only filled disks read a palette colour — skip the hash for placeholders.
  const avatarColor: AvatarColor = pending ? 'neutral' : (color ?? (src ? 'neutral' : autoColor(alt)))
  // One source for the initials type; the Root paints it (so a custom `fallback`
  // inherits) and the default initials below render with the same variant.
  const textVariant = (pending ? SIZE_TEXT_DASHED_VARIANT : SIZE_TEXT_VARIANT)[sizeKey]
  const textClass = typography({ variant: textVariant })
  const {
    className: imageClassName,
    decoding = 'async',
    loading = 'lazy',
    ...restImageProps
  } = imageProps ?? {}

  return (
    <Primitive.Root
      className={state => cx(
        'relative inline-flex shrink-0 select-none items-center justify-center overflow-visible rounded-q-full',
        SIZE_BOX[sizeKey],
        textClass,
        pending
          ? cx('border-dashed border-q-transparent-light-30 text-q-text-primary', PENDING_BORDER[sizeKey])
          : cx(COLOR_BG[avatarColor], COLOR_FG[avatarColor]),
        typeof className === 'function' ? className(state) : className,
      )}
      {...props}
    >
      {src && !pending
        ? (
            <Primitive.Image
              src={src}
              alt={alt ?? ''}
              loading={loading}
              decoding={decoding}
              className={cx('pointer-events-none absolute inset-0 size-full rounded-q-full object-cover', imageClassName)}
              {...restImageProps}
            />
          )
        : null}

      <Primitive.Fallback className="flex size-full items-center justify-center overflow-hidden rounded-q-full">
        {fallback ?? (
          <Typography as="span" variant={textVariant}>
            {initials(alt, sizeKey)}
          </Typography>
        )}
      </Primitive.Fallback>

      {/* Rim slot: a custom `badge` wins; otherwise the default presence Dot. */}
      {badge != null
        ? <span className="q-avatar-status">{badge}</span>
        : status != null
          ? (
              <Dot
                label={status}
                color={STATUS_DOT_COLOR[status]}
                size={STATUS_DOT_SIZE[sizeKey]}
                className="q-avatar-status"
              />
            )
          : null}
    </Primitive.Root>
  )
}

function normalizeSize(size: AvatarSize): AvatarSizeKey {
  return size === '2xs' ? 'xxs' : size
}

function initials(name: string | undefined, size: AvatarSizeKey): string {
  if (!name)
    return ''
  if (size === 'xs' || size === 'xxs')
    return name.trim()[0]?.toUpperCase() ?? ''
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('')
}

function autoColor(name?: string): AvatarColor {
  if (!name)
    return 'neutral'
  let h = 0
  for (let i = 0; i < name.length; i++)
    h = (Math.imul(h, 31) + name.charCodeAt(i)) >>> 0
  return AUTO[h % AUTO.length]
}
