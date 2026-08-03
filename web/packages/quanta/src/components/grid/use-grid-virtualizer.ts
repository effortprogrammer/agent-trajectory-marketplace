'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * useGridVirtualizer — headless windowing for a UNIFORM grid (equal cells). It
 * chunks `count` items into rows of `columns`, then — off the scroll container's
 * `scrollTop`/`clientHeight` — renders only the rows in view plus `overscan`
 * rows above and below. Zero dependencies; the uniform-grid case needs no
 * per-item measurement, just row arithmetic.
 *
 * Attach the returned `scrollRef` to the scroll container (fixed height,
 * `overflow:auto`). Give an inner sizer the returned `totalHeight` so the
 * scrollbar reflects the full set, and translate the rendered block by
 * `offsetY`. Render `items.slice(start, end)`.
 *
 * Scroll handling is rAF-throttled and passive; SSR/test safe (no rAF →
 * synchronous measure).
 */
export type UseGridVirtualizerOptions = {
  /** Total number of items. */
  count: number
  /** Columns per row (>= 1). */
  columns: number
  /** Estimated cell (row) height in px — the row gap is added on top. */
  rowHeight: number
  /** Row gap in px (match the visual gap so the math lines up). Default 0. */
  rowGap?: number
  /** Extra rows rendered above/below the viewport. Default 3. */
  overscan?: number
  /**
   * SUSTAINED scroll speed (px/ms, smoothed) above which `isScrolling` flips true
   * so cells can defer expensive work (image/video/API loads) during a fast
   * fling. Smooth/slow scrolling stays below it (loads keep happening, buffered
   * by `overscan`); as soon as a fast scroll *slows down* the smoothed speed
   * drops back under it and loads resume. Set `0` to never defer. Default 3.
   */
  velocityThreshold?: number
}

export function useGridVirtualizer<T extends HTMLElement = HTMLDivElement>(options: UseGridVirtualizerOptions) {
  const { count, columns, rowHeight, rowGap = 0, overscan = 3, velocityThreshold = 3 } = options
  const scrollRef = useRef<T>(null)

  const cols = Math.max(1, columns)
  const rowStride = rowHeight + rowGap
  const rowCount = Math.ceil(count / cols)
  const totalHeight = rowCount > 0 ? rowCount * rowStride - rowGap : 0

  // Seed with a first window so SSR / first paint shows content immediately.
  const [view, setView] = useState({
    start: 0,
    end: Math.min(count, cols * (overscan + 2)),
    offsetY: 0,
    isScrolling: false,
  })

  useEffect(() => {
    const el = scrollRef.current
    if (el == null) return
    const clock = () => (typeof performance !== 'undefined' ? performance.now() : 0)
    let frame = 0
    let settle: ReturnType<typeof setTimeout> | undefined
    let lastTop = el.scrollTop
    let lastTime = clock()
    let smoothVelocity = 0

    const measure = () => {
      frame = 0
      const scrollTop = el.scrollTop
      const viewport = el.clientHeight || rowStride
      const firstVisible = Math.floor(scrollTop / rowStride)
      const lastVisible = Math.ceil((scrollTop + viewport) / rowStride)
      // Clamp to real rows so a shrunk dataset / over-large scrollTop can't push
      // the window past the end and blank the grid.
      const maxRow = Math.max(0, rowCount - 1)
      const firstRow = Math.min(maxRow, Math.max(0, firstVisible - overscan))
      const lastRow = Math.min(maxRow, lastVisible + overscan)

      // Smoothed scroll speed (px/ms): an EMA so a single-frame spike or the
      // first frame after idle can't trip the gate — only SUSTAINED fast
      // scrolling does, and slowing back down decays it under the threshold so
      // loads resume before the user even stops.
      const time = clock()
      // Floor dt at ~one 120Hz frame so a tiny interval (unthrottled rAF / high-
      // refresh display) can't inflate the speed into a false fast-scroll trip.
      const dt = Math.max(time - lastTime, 8)
      const instant = Math.abs(scrollTop - lastTop) / dt
      lastTop = scrollTop
      lastTime = time
      smoothVelocity = smoothVelocity * 0.7 + instant * 0.3
      const fast = velocityThreshold > 0 && smoothVelocity > velocityThreshold

      const start = firstRow * cols
      const end = Math.min(count, (lastRow + 1) * cols)
      const offsetY = firstRow * rowStride
      // Commit ONLY on a real change — returning the previous reference makes
      // React bail out, so steady/slow scrolling within a row doesn't re-render
      // (and re-run renderItem for) the whole window every frame. This identity
      // churn was what made the cells flash on every scroll move.
      setView(prev =>
        prev.start === start && prev.end === end && prev.offsetY === offsetY && prev.isScrolling === fast
          ? prev
          : { start, end, offsetY, isScrolling: fast },
      )

      // When the fling decays or the user lifts off, clear the flag shortly after
      // so loads resume even if the last sampled frame was still fast.
      if (settle !== undefined) clearTimeout(settle)
      if (fast) settle = setTimeout(() => setView(v => (v.isScrolling ? { ...v, isScrolling: false } : v)), 140)
    }

    const onScroll = () => {
      if (typeof requestAnimationFrame === 'undefined') return measure()
      if (frame === 0) frame = requestAnimationFrame(measure)
    }

    measure()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (frame !== 0 && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(frame)
      if (settle !== undefined) clearTimeout(settle)
    }
  }, [count, cols, rowStride, rowCount, overscan, velocityThreshold])

  return {
    scrollRef,
    totalHeight,
    start: view.start,
    end: view.end,
    offsetY: view.offsetY,
    isScrolling: view.isScrolling,
    rowCount,
    columns: cols,
  }
}
