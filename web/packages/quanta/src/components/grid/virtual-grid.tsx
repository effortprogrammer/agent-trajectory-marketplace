'use client'

import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { GAP_CLASS, GAP_PX, type GridGap } from './grid-gap.ts'
import { useGridVirtualizer } from './use-grid-virtualizer.ts'
import { cx } from '../utils/cx.ts'

/**
 * VirtualGrid — a windowed, data-driven uniform grid for big feeds & galleries.
 * Where `Grid` lays out arbitrary children, VirtualGrid takes an `items` array +
 * `renderItem` and renders ONLY the rows in view (plus `overscan` rows) via
 * `useGridVirtualizer`, so 10k cells cost the same as a screenful.
 *
 *   <VirtualGrid
 *     items={photos} rowHeight={220} minColWidth={180} gap={3} overscan={4}
 *     height="40rem" getKey={p => p.id}
 *     renderItem={p => <Media ratio="square"><Media.Image src={p.src} /></Media>}
 *   />
 *
 * Uniform rows: each cell is laid out at exactly `rowHeight` (`grid-auto-rows`),
 * which is what lets the scroll math stay exact without measuring every cell.
 * Columns are `cols` (fixed) or derived from the measured width + `minColWidth`
 * (ResizeObserver). Pair with `Media.Video autoPlayInView` for a feed that only
 * plays the clips actually on screen.
 */
/** Per-cell render context — lets a cell defer expensive work during fast scroll. */
export type VirtualGridItemMeta = {
  /** True while the user is flinging fast enough to defer image/video/API loads. */
  isScrolling: boolean
}

export type VirtualGridProps<Item> = {
  /** The full dataset. Only the visible window is rendered. */
  items: readonly Item[]
  /**
   * Render one cell (wrapped in a `q-grid-item`). `meta.isScrolling` is true
   * during a fast fling — render a cheap placeholder then and load the real
   * image/video/fetch only when it is false (slow scroll or settled), so a fast
   * scroll fires no requests.
   */
  renderItem: (item: Item, index: number, meta: VirtualGridItemMeta) => ReactNode
  /** Stable React key per item. Defaults to the index. */
  getKey?: (item: Item, index: number) => string | number
  /** Fixed column count. Omit and set `minColWidth` for responsive columns. */
  cols?: number
  /** Min column width in px — columns are derived from the measured width. */
  minColWidth?: number
  /** Cell (row) height in px — drives `grid-auto-rows` and the scroll math. */
  rowHeight: number
  /** Gap on both axes (shared GridGap scale). Default 4. */
  gap?: GridGap
  /** Extra rows rendered above/below the viewport. Default 3. */
  overscan?: number
  /** Scroll speed (px/ms) above which `meta.isScrolling` defers loads. Default 1.5; `0` disables. */
  velocityThreshold?: number
  /** Height of the scroll viewport (CSS length). Default `32rem`. */
  height?: string
  /** Called once per item count when the viewport reaches the end threshold. */
  onEndReached?: () => void
  /** Distance from the viewport end that triggers `onEndReached`. Default 400px. */
  endReachedThresholdPx?: number
  /** Class for the inner grid track. */
  className?: string
  /** Class for the scroll viewport. */
  viewportClassName?: string
  style?: CSSProperties
}

export function VirtualGrid<Item>({
  items,
  renderItem,
  getKey,
  cols,
  minColWidth,
  rowHeight,
  gap = 4,
  overscan = 3,
  velocityThreshold,
  height = '32rem',
  onEndReached,
  endReachedThresholdPx = 400,
  className,
  viewportClassName,
  style,
}: VirtualGridProps<Item>) {
  const gapPx = GAP_PX[gap]

  // Responsive column count derived from the measured viewport width when `cols`
  // isn't fixed — `floor((width + gap) / (minColWidth + gap))`.
  const [width, setWidth] = useState(0)
  const columns
    = cols
      ?? (minColWidth != null && width > 0 ? Math.max(1, Math.floor((width + gapPx) / (minColWidth + gapPx))) : 1)

  const { scrollRef, totalHeight, start, end, offsetY, isScrolling } = useGridVirtualizer<HTMLDivElement>({
    count: items.length,
    columns,
    rowHeight,
    rowGap: gapPx,
    overscan,
    velocityThreshold,
  })
  const endReachedForCount = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (cols != null || minColWidth == null) return
    const el = scrollRef.current
    if (el == null || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [cols, minColWidth, scrollRef])

  useEffect(() => {
    if (!onEndReached) {
      endReachedForCount.current = undefined
      return
    }
    const el = scrollRef.current
    if (el == null) return
    const threshold = Math.max(0, endReachedThresholdPx)
    const maybeReachEnd = () => {
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight
      if (remaining > threshold || endReachedForCount.current === items.length) return
      endReachedForCount.current = items.length
      onEndReached()
    }
    maybeReachEnd()
    el.addEventListener('scroll', maybeReachEnd, { passive: true })
    return () => el.removeEventListener('scroll', maybeReachEnd)
  }, [endReachedThresholdPx, items.length, onEndReached, scrollRef])

  const cells: ReactNode[] = []
  for (let i = start; i < end; i++) {
    const item = items[i]
    if (item === undefined) continue
    cells.push(
      <div key={getKey ? getKey(item, i) : i} className="q-grid-item">
        {renderItem(item, i, { isScrolling })}
      </div>,
    )
  }

  return (
    <div ref={scrollRef} className={cx('q-virtual-grid', viewportClassName)} style={{ height, ...style }}>
      <div className="q-virtual-grid-sizer" style={{ height: totalHeight }}>
        <div
          className={cx('q-grid', 'q-virtual-grid-track', GAP_CLASS[gap], className)}
          style={{
            transform: `translateY(${offsetY}px)`,
            gridAutoRows: `${rowHeight}px`,
            '--q-grid-cols': columns,
          } as CSSProperties}
        >
          {cells}
        </div>
      </div>
    </div>
  )
}
