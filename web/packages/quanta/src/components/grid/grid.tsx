'use client'

import type { ComponentProps, CSSProperties } from 'react'
import { Children, isValidElement, useMemo } from 'react'
import { GAP_CLASS, GAP_X_CLASS, GAP_Y_CLASS, type GridGap } from './grid-gap.ts'
import { useFlip } from '../utils/use-flip.ts'
import { cx } from '../utils/cx.ts'

export type { GridGap }

/**
 * Grid — a pure-quanta CSS-grid layout primitive covering "all kinds of grids".
 * No Base UI: it is a thin, token-clean wrapper over `display: grid` that lets
 * you express column counts, auto-fit/auto-fill responsive tracks, gaps, flow,
 * and item alignment without ever inlining an arbitrary value.
 *
 * Parts: `Grid` (the track) + `Grid.Item` (an optional cell that can span).
 *
 *   <Grid cols={3} gap={4}>…</Grid>                  // 3 equal columns
 *   <Grid cols="auto-fit" minColWidth="16rem" gap={4}>…</Grid>  // responsive
 *   <Grid cols={4} gap={3}>
 *     <Grid.Item colSpan={2} rowSpan={2}>featured</Grid.Item>
 *     …
 *   </Grid>
 *
 * Column count is wired through the private `--q-grid-cols` / `--q-grid-min`
 * CSS vars (the sanctioned dynamic-style escape hatch — like `--q-slider-width`),
 * read by the `q-grid` utility. The gap uses the native Tailwind `gap-N` scale
 * (mapped exhaustively below), so spacing stays on the shared spacing scale.
 *
 * RESPONSIVE NOTE: per-breakpoint `cols` objects ({ base, tablet, desktop }) are
 * intentionally OUT OF SCOPE here — use `cols="auto-fit"` + `minColWidth` for
 * fluid layouts (the columns reflow automatically), or set `--q-grid-cols` per
 * breakpoint on a wrapper. FLAGGED in the manifest.
 */

export type GridCols = number | 'auto-fit' | 'auto-fill'
export type GridFlow = 'row' | 'col' | 'dense'
export type GridAlign = 'start' | 'center' | 'end' | 'stretch'
export type GridJustify = 'start' | 'center' | 'end' | 'stretch'
/** 1..12 — the span steps for `Grid.Item`. */
export type GridSpan = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12

export type GridProps = ComponentProps<'div'> & {
  /**
   * A fixed number of equal columns, or `'auto-fit'`/`'auto-fill'` to lay out as
   * many `minColWidth`-wide columns as fit. Defaults to a single column.
   */
  cols?: GridCols
  /** Min column width for `auto-fit`/`auto-fill` tracks. Token-based length. */
  minColWidth?: string
  /** Native Tailwind gap step applied to both axes. Ignored if gapX/gapY set. */
  gap?: GridGap
  /** Native Tailwind column-gap step (overrides `gap` horizontally). */
  gapX?: GridGap
  /** Native Tailwind row-gap step (overrides `gap` vertically). */
  gapY?: GridGap
  /** grid-auto-flow. */
  flow?: GridFlow
  /** align-items. */
  align?: GridAlign
  /** justify-items. */
  justify?: GridJustify
  /**
   * FLIP-animate the cells when the layout changes (reorder / filter / add).
   * Give each animating child a stable `flipKey` (e.g. `Grid.Item flipKey={id}`)
   * so the hook can match cells across renders. Honors `prefers-reduced-motion`.
   */
  animate?: boolean
}

const FLOW_CLASS = {
  row: 'grid-flow-row',
  col: 'grid-flow-col',
  dense: 'grid-flow-row-dense',
} satisfies Record<GridFlow, string>

const ALIGN_CLASS = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
} satisfies Record<GridAlign, string>

const JUSTIFY_CLASS = {
  start: 'justify-items-start',
  center: 'justify-items-center',
  end: 'justify-items-end',
  stretch: 'justify-items-stretch',
} satisfies Record<GridJustify, string>

function Root({
  cols = 1,
  minColWidth,
  gap,
  gapX,
  gapY,
  flow,
  align,
  justify,
  animate = false,
  className,
  style,
  ref,
  children,
  ...props
}: GridProps) {
  const autoTrack = cols === 'auto-fit' || cols === 'auto-fill'

  // FLIP key: the children's flipKey/key sequence. When it changes (reorder /
  // filter / add), useFlip animates the cells from their old boxes; null when
  // not animating, so the effect is a cheap no-op.
  const flipDependency = useMemo(() => {
    if (!animate) return null
    return Children.toArray(children)
      .map(child => (isValidElement(child) ? String((child.props as { flipKey?: unknown }).flipKey ?? child.key ?? '') : ''))
      .join('|')
  }, [animate, children])
  const flipRef = useFlip<HTMLDivElement>(flipDependency)
  // Dynamic track config rides on private CSS vars — the sanctioned escape hatch
  // for values that can't be a static class (precedent: --q-slider-width).
  const gridVars = {
    ...(autoTrack ? null : { '--q-grid-cols': cols }),
    ...(minColWidth != null ? { '--q-grid-min': minColWidth } : null),
  } as CSSProperties

  // Per-axis gap wins over the single `gap` on that axis; fall back to `gap`.
  const gapClasses
    = gapX != null || gapY != null
      ? cx(
          gapX != null ? GAP_X_CLASS[gapX] : gap != null ? GAP_X_CLASS[gap] : undefined,
          gapY != null ? GAP_Y_CLASS[gapY] : gap != null ? GAP_Y_CLASS[gap] : undefined,
        )
      : gap != null
        ? GAP_CLASS[gap]
        : undefined

  return (
    <div
      className={cx(
        'q-grid',
        cols === 'auto-fill' ? 'q-grid-autofill' : autoTrack ? 'q-grid-autofit' : undefined,
        gapClasses,
        flow != null ? FLOW_CLASS[flow] : undefined,
        align != null ? ALIGN_CLASS[align] : undefined,
        justify != null ? JUSTIFY_CLASS[justify] : undefined,
        className,
      )}
      style={{ ...gridVars, ...style }}
      ref={animate ? flipRef : ref}
      {...props}
    >
      {children}
    </div>
  )
}

export type GridItemProps = ComponentProps<'div'> & {
  /** Number of columns this cell spans (1..12). */
  colSpan?: GridSpan
  /** Number of rows this cell spans (1..12). */
  rowSpan?: GridSpan
  /** 1-based column line this cell starts on. */
  colStart?: GridSpan
  /** Stable id for FLIP layout animation (see Grid `animate`). Sets `data-flip-key`. */
  flipKey?: string | number
}

function Item({ colSpan, rowSpan, colStart, flipKey, className, style, ...props }: GridItemProps) {
  // Span/start are positional integers, not on any token scale — they ride on
  // inline grid placement (the sanctioned dynamic-style escape hatch).
  const placement = {
    ...(colSpan != null ? { gridColumn: `span ${colSpan} / span ${colSpan}` } : null),
    ...(rowSpan != null ? { gridRow: `span ${rowSpan} / span ${rowSpan}` } : null),
    ...(colStart != null ? { gridColumnStart: colStart } : null),
  } as CSSProperties

  return (
    <div
      className={cx('q-grid-item', className)}
      style={{ ...placement, ...style }}
      data-flip-key={flipKey != null ? String(flipKey) : undefined}
      {...props}
    />
  )
}

export const Grid = Object.assign(Root, { Item })
