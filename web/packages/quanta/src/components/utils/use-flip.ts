'use client'

import { useLayoutEffect, useRef } from 'react'

/**
 * useFlip — layout (reflow/reorder/filter) animation via the FLIP technique
 * (First, Last, Invert, Play) driven by the Web Animations API.
 *
 * Attach the returned ref to a container; mark each animating child with
 * `data-flip-key="<stable id>"`. Whenever `dependency` changes, the hook reads
 * every child's *last* box (batched, before paint, in `useLayoutEffect`),
 * inverts it to where it *was* with a `transform`, then plays back to `none` —
 * a GPU-cheap transform tween, no layout thrash. New items fade + scale in.
 *
 * Degrades cleanly: no-ops under `prefers-reduced-motion` and where
 * `Element.animate` is unavailable (SSR / older test DOMs), so layout is always
 * correct even when the motion doesn't run.
 */
export type UseFlipOptions = {
  /** Move/enter duration (ms). Default 260. */
  duration?: number
  /** CSS easing for the tween. Default a soft ease-out-back-ish curve. */
  easing?: string
  /** Fade + scale newly-added items in. Default true. */
  animateEnter?: boolean
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

export function useFlip<T extends HTMLElement = HTMLDivElement>(dependency: unknown, options: UseFlipOptions = {}) {
  const { duration = 260, easing = 'cubic-bezier(0.22, 1, 0.36, 1)', animateEnter = true } = options
  const ref = useRef<T>(null)
  const prevRects = useRef<Map<string, DOMRect>>(new Map())
  const isFirstRun = useRef(true)

  useLayoutEffect(() => {
    const container = ref.current
    if (container == null) return

    const items = Array.from(container.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement && child.dataset.flipKey != null,
    )

    // Batch READS (measure every "last" box) before any WRITE, to avoid thrash.
    const nextRects = new Map<string, DOMRect>()
    for (const el of items) nextRects.set(el.dataset.flipKey as string, el.getBoundingClientRect())

    const reduced = typeof matchMedia !== 'undefined' && matchMedia(REDUCED_MOTION).matches
    const canAnimate = typeof items[0]?.animate === 'function'

    if (!isFirstRun.current && !reduced && canAnimate) {
      for (const el of items) {
        const key = el.dataset.flipKey as string
        const last = nextRects.get(key) as DOMRect
        const first = prevRects.current.get(key)

        if (first == null) {
          // New item — fade + scale in (Invert/Play has nothing to invert).
          if (animateEnter) {
            el.animate([{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }], { duration, easing })
          }
          continue
        }

        const dx = first.left - last.left
        const dy = first.top - last.top
        // Invert to the old spot, then Play back to the natural position.
        if (dx !== 0 || dy !== 0) {
          el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration, easing })
        }
      }
    }

    prevRects.current = nextRects
    isFirstRun.current = false
  }, [dependency, duration, easing, animateEnter])

  return ref
}
