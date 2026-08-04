'use client'

import type { ComponentProps, CSSProperties, MutableRefObject, ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useInView } from '../utils/use-in-view.ts'
import { cx } from '../utils/cx.ts'

/**
 * Media — a pure-quanta presentational surface for images & videos held at a
 * fixed aspect ratio. It is the building block for media grids, video cards, and
 * cover tiles: a clipped `aspect-ratio` box you fill with an `Image`/`Video`, an
 * automatic `Fallback` (mirrors Avatar's onError→fallback flow), an absolutely-
 * positioned `Overlay` (scrims, play buttons, badges), and a `Caption` strip.
 *
 * Composition parts (each replaceable / optional):
 *   • `Media.Root`    — the aspect-ratio box; clips overflow and owns the corner
 *     radius. `ratio` picks a preset (square/video/portrait/wide/auto) or pass a
 *     numeric `ratio` (e.g. `4 / 3`) for a custom value. `rounded` selects a
 *     radius token; children inherit it via `overflow: hidden`.
 *   • `Media.Image`   — `<img>` filling the box; `fit` = object-fit cover|contain,
 *     lazy-loaded by default, calls `onError` → caller can flip to `Fallback`.
 *   • `Media.Video`   — `<video>` filling the box; controls/autoPlay/loop/muted/
 *     poster pass straight through, `fit` = object-fit.
 *   • `Media.Fallback`— the empty / broken-source slot: a tinted box with centered
 *     content (an `<Icon>`, initials, or any node).
 *   • `Media.Overlay` — an absolutely-positioned layer (gradient scrim, centered
 *     play button, top-right badge) the caller fills; `placement` positions it.
 *   • `Media.Caption` — a small label region rendered under / over the media.
 *
 * Tokens only. No Base UI — this is a layout/presentation primitive.
 */

export type MediaRatio = 'square' | 'video' | 'portrait' | 'wide' | 'auto'
export type MediaFit = 'cover' | 'contain'
export type MediaRounded = 'none' | 'sm' | 'md' | 'lg' | 'full'
export type MediaOverlayPlacement = 'fill' | 'top' | 'bottom' | 'center'

// Aspect-ratio presets → the `aspect-*` utility. `auto` opts out (intrinsic).
const RATIO_CLASS = {
  square: 'aspect-square',
  video: 'aspect-video',
  portrait: 'q-media-portrait',
  wide: 'q-media-wide',
  auto: '',
} satisfies Record<MediaRatio, string>

const FIT_CLASS = {
  cover: 'object-cover',
  contain: 'object-contain',
} satisfies Record<MediaFit, string>

// Corner radius → emitted radius utilities (the box clips, so children follow).
const ROUNDED_CLASS = {
  none: 'rounded-q-0',
  sm: 'rounded-q-150',
  md: 'rounded-q-300',
  lg: 'rounded-q-500',
  full: 'rounded-q-full',
} satisfies Record<MediaRounded, string>

const OVERLAY_PLACEMENT_CLASS = {
  fill: 'q-media-overlay-fill',
  top: 'q-media-overlay-top',
  bottom: 'q-media-overlay-bottom',
  center: 'q-media-overlay-center',
} satisfies Record<MediaOverlayPlacement, string>

export type MediaRootProps = Omit<ComponentProps<'div'>, 'children'> & {
  /**
   * Aspect ratio. A preset name, or a number (e.g. `16 / 9`, `4 / 3`) for a
   * custom ratio applied via the `aspect-ratio` CSS property.
   */
  ratio?: MediaRatio | number
  /** Corner radius token. The box clips, so the media follows the curve. */
  rounded?: MediaRounded
  children?: ReactNode
}

function Root({ ratio = 'video', rounded = 'md', className, style, children, ...props }: MediaRootProps) {
  const numeric = typeof ratio === 'number'
  return (
    <div
      className={cx(
        'q-media',
        numeric ? undefined : RATIO_CLASS[ratio],
        ROUNDED_CLASS[rounded],
        className,
      )}
      // The custom-ratio var is the one dynamic value that cannot be a class.
      style={numeric ? ({ '--q-media-ratio': ratio, ...style } as CSSProperties) : style}
      {...props}
    >
      {children}
    </div>
  )
}

export type MediaImageProps = Omit<ComponentProps<'img'>, 'children'> & {
  /** object-fit. `cover` (default) crops to fill; `contain` letterboxes. */
  fit?: MediaFit
}

function Image({ fit = 'cover', loading = 'lazy', decoding = 'async', className, alt = '', ...props }: MediaImageProps) {
  return (
    <img
      alt={alt}
      loading={loading}
      decoding={decoding}
      className={cx('q-media-fill', FIT_CLASS[fit], className)}
      {...props}
    />
  )
}

export type MediaVideoProps = Omit<ComponentProps<'video'>, 'children'> & {
  /** object-fit. `cover` (default) crops to fill; `contain` letterboxes. */
  fit?: MediaFit
  /**
   * Autoplay (muted) ONLY while the video is on screen, and pause when it scrolls
   * away — the optimized feed/gallery pattern (IntersectionObserver, no scroll
   * listeners). Forces `muted` + `playsInline` (required for programmatic
   * autoplay) and lazies `preload` to `metadata`. Pass `loop` for short clips.
   */
  autoPlayInView?: boolean
  /** Visibility ratio (0..1) at which an `autoPlayInView` clip starts. Default 0.5. */
  inViewThreshold?: number
}

function Video({
  fit = 'cover',
  autoPlayInView = false,
  inViewThreshold = 0.5,
  muted,
  playsInline,
  preload,
  className,
  ref: forwardedRef,
  ...props
}: MediaVideoProps) {
  const { ref: inViewRef, inView } = useInView<HTMLVideoElement>({ threshold: inViewThreshold })
  const videoRef = useRef<HTMLVideoElement | null>(null)

  // Fan the node out to our play/pause ref, the in-view observer, and any
  // forwarded ref — only needed in the autoplay path.
  const setRef = useCallback(
    (node: HTMLVideoElement | null) => {
      videoRef.current = node
      inViewRef(node)
      if (typeof forwardedRef === 'function') forwardedRef(node)
      else if (forwardedRef != null) (forwardedRef as MutableRefObject<HTMLVideoElement | null>).current = node
    },
    [inViewRef, forwardedRef],
  )

  useEffect(() => {
    if (!autoPlayInView) return
    const video = videoRef.current
    if (video == null) return
    if (inView) {
      // Autoplay can reject (no gesture / not muted) — swallow it, the poster shows.
      void video.play()?.catch(() => {})
    } else {
      video.pause()
    }
  }, [autoPlayInView, inView])

  return (
    <video
      ref={autoPlayInView ? setRef : forwardedRef}
      className={cx('q-media-fill', FIT_CLASS[fit], className)}
      muted={autoPlayInView ? true : muted}
      playsInline={autoPlayInView ? true : playsInline}
      preload={preload ?? (autoPlayInView ? 'metadata' : undefined)}
      {...props}
    />
  )
}

export type MediaFallbackProps = ComponentProps<'div'>

/** The empty / broken-source slot — a tinted box with centered content. */
function Fallback({ className, ...props }: MediaFallbackProps) {
  return <div className={cx('q-media-fallback', className)} {...props} />
}

export type MediaOverlayProps = ComponentProps<'div'> & {
  /** Where the overlay sits: full bleed, a top/bottom band, or centered. */
  placement?: MediaOverlayPlacement
}

/** An absolutely-positioned layer — gradient scrim, play button, corner badge. */
function Overlay({ placement = 'fill', className, ...props }: MediaOverlayProps) {
  return <div className={cx('q-media-overlay', OVERLAY_PLACEMENT_CLASS[placement], className)} {...props} />
}

export type MediaCaptionProps = ComponentProps<'div'>

/** A small label region. Compose Typography / Badge / text inside it. */
function Caption({ className, ...props }: MediaCaptionProps) {
  return <div className={cx('q-media-caption', className)} {...props} />
}

export const Media = Object.assign(Root, {
  Root,
  Image,
  Video,
  Fallback,
  Overlay,
  Caption,
})

/**
 * Convenience hook for the broken-source pattern: wire `onError` to flip a flag,
 * then render `Media.Fallback` instead of `Media.Image`. Mirrors Avatar's
 * onError→fallback flow without forcing it on every consumer.
 *
 *   const { failed, onError } = useMediaFallback()
 *   {failed ? <Media.Fallback>…</Media.Fallback>
 *           : <Media.Image src={src} onError={onError} />}
 */
export function useMediaFallback() {
  const [failed, setFailed] = useState(false)
  return { failed, onError: () => setFailed(true), reset: () => setFailed(false) }
}
