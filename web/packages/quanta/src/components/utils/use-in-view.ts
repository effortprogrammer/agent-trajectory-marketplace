'use client'

import type { RefCallback } from 'react'
import { useCallback, useEffect, useState } from 'react'

/**
 * useInView — reports whether an element is intersecting the viewport (or a
 * scroll `root`) via `IntersectionObserver`, the main-thread-cheap way to drive
 * viewport-only behaviour: lazy reveals, and — the headline use — autoplaying a
 * video only while it is on screen (see `Media.Video autoPlayInView`).
 *
 * SSR / test safe: when `IntersectionObserver` is unavailable it no-ops and
 * reports `inView: false`. Attach the returned `ref` (a ref callback, so it
 * re-observes if the node changes) to the element you want to track.
 */
export type UseInViewOptions = {
  /** Visibility ratio (0..1) at/above which the element counts as in view. Default 0.5. */
  threshold?: number
  /** Grow/shrink the detection box, e.g. `'200px'` to pre-trigger before entry. */
  rootMargin?: string
  /** Scroll container to observe against; defaults to the browser viewport. */
  root?: Element | null
  /** Latch to `true` on first entry and stop observing (one-shot reveals). */
  once?: boolean
}

export function useInView<T extends Element = HTMLElement>(options: UseInViewOptions = {}) {
  const { threshold = 0.5, rootMargin, root = null, once = false } = options
  const [node, setNode] = useState<T | null>(null)
  const [inView, setInView] = useState(false)

  // Ref callback → state so the effect re-observes whenever React swaps the node.
  const ref = useCallback<RefCallback<T>>((next) => setNode(next), [])

  useEffect(() => {
    if (node == null || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry == null) return
        const visible = entry.isIntersecting && entry.intersectionRatio >= threshold
        setInView(visible)
        if (visible && once) observer.disconnect()
      },
      { threshold, rootMargin: rootMargin ?? undefined, root },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [node, threshold, rootMargin, root, once])

  return { ref, inView } as const
}
