import type { GalleryItem } from "./types.ts";

/**
 * JustifiedLayoutEngine — a bespoke, out-of-React layout + windowing engine for
 * a Flickr / Google-Photos style justified-masonry gallery.
 *
 * It is a plain TypeScript class with NO React dependency. The React layer feeds
 * it the item list and the current geometry (container width, target row height,
 * gap) and, on every scroll frame, asks it which rows are visible. All of the
 * heavy math — packing items into equal-height rows, justifying each row to the
 * container width, stacking dated groups with headers, binary-searching the
 * visible window, and classifying load tiers by distance from the viewport —
 * lives here, so the React tree only ever renders a screenful of absolutely
 * positioned tiles.
 *
 * ── The justified algorithm ──────────────────────────────────────────────────
 * Pick a target row height `h0`. Each item, scaled to `h0`, has display width
 * `h0 * aspect`. Greedily pack items into a row until their combined natural
 * width (plus gaps) reaches the container width, then solve for the exact row
 * height that makes the row fill the width precisely:
 *
 *     h = (containerWidth - gap * (n - 1)) / Σ aspectᵢ
 *
 * and set each tile width to `h * aspectᵢ`. The final (incomplete) row of a
 * group is left at the target height (never over-stretched) and left-aligned.
 */

/** One tile's resolved rectangle, relative to its row's top-left. */
export interface TileRect {
  /** Index into the flat items array. */
  index: number;
  item: GalleryItem;
  /** Horizontal offset within the content column. */
  x: number;
  width: number;
  height: number;
}

export type LayoutRowType = "header" | "tiles";

/** A laid-out row — either a dated group header or a justified row of tiles. */
export interface LayoutRow {
  type: LayoutRowType;
  /** Absolute top offset within the scrollable content. */
  y: number;
  height: number;
  /** Sequential index among rows (stable key). */
  key: string;
  /** header only — the group label. */
  label?: string;
  /** tiles only — the justified tiles in this row. */
  tiles?: TileRect[];
}

export interface Layout {
  rows: LayoutRow[];
  totalHeight: number;
  /** Number of items covered by this layout (for infinite-scroll bookkeeping). */
  itemCount: number;
}

export interface EngineConfig {
  /** Inner content width in px (viewport clientWidth). */
  containerWidth: number;
  /** Target/base row height in px — the density knob. */
  targetRowHeight: number;
  /** Gap between tiles AND between rows, in px. */
  gap: number;
  /** Header band height in px. */
  headerHeight: number;
  /** Extra space below each group. */
  groupGap: number;
  /**
   * Clamp on the per-row aspect sum before a row is force-closed, so a run of
   * ultra-wide panoramas can't produce a single skyscraper-tall row.
   */
  maxRowHeight: number;
  /**
   * Whether to split items into dated batches with "Today" / "Yesterday" / …
   * headers. When false, every item is packed into ONE continuous justified
   * feed — no headers, no group gaps, no mid-feed left-aligned partial rows.
   */
  grouped: boolean;
}

const DEFAULT_CONFIG: EngineConfig = {
  containerWidth: 0,
  targetRowHeight: 200,
  gap: 6,
  headerHeight: 44,
  groupGap: 20,
  maxRowHeight: 460,
  grouped: true,
};

interface GroupRange {
  id: string;
  label: string;
  start: number;
  end: number; // exclusive
}

export class JustifiedLayoutEngine {
  private items: GalleryItem[] = [];
  private groups: GroupRange[] = [];
  private config: EngineConfig = { ...DEFAULT_CONFIG };
  private layout: Layout = { rows: [], totalHeight: 0, itemCount: 0 };
  /** Per-item resolved geometry, indexed by item index — powers scroll anchoring. */
  private itemTops: number[] = [];
  private itemHeights: number[] = [];
  private dirty = true;

  setItems(items: GalleryItem[]): void {
    this.items = items;
    this.recomputeGroups();
    this.dirty = true;
  }

  /** Returns true if any geometry field actually changed. */
  setConfig(patch: Partial<EngineConfig>): boolean {
    let changed = false;
    let groupingChanged = false;
    for (const key of Object.keys(patch) as (keyof EngineConfig)[]) {
      const next = patch[key];
      if (next != null && next !== this.config[key]) {
        this.config[key] = next as never;
        changed = true;
        if (key === "grouped") groupingChanged = true;
      }
    }
    // Toggling grouping changes the group ranges, not just geometry.
    if (groupingChanged) this.recomputeGroups();
    if (changed) this.dirty = true;
    return changed;
  }

  getConfig(): Readonly<EngineConfig> {
    return this.config;
  }

  private recomputeGroups(): void {
    // Grouping off → one continuous group over the whole dataset (no headers).
    if (!this.config.grouped) {
      this.groups =
        this.items.length > 0 ? [{ id: "all", label: "", start: 0, end: this.items.length }] : [];
      return;
    }

    const groups: GroupRange[] = [];
    let current: GroupRange | null = null;
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i]!;
      if (current == null || current.id !== item.groupId) {
        if (current != null) current.end = i;
        current = { id: item.groupId, label: item.groupLabel, start: i, end: i + 1 };
        groups.push(current);
      }
    }
    if (current != null) current.end = this.items.length;
    this.groups = groups;
  }

  /** Compute (or return cached) layout for the current items + config. */
  compute(): Layout {
    if (!this.dirty) return this.layout;

    const { containerWidth, targetRowHeight, gap, headerHeight, groupGap, maxRowHeight } =
      this.config;
    const rows: LayoutRow[] = [];
    const itemTops = new Array<number>(this.items.length).fill(0);
    const itemHeights = new Array<number>(this.items.length).fill(0);

    if (containerWidth <= 0) {
      this.layout = { rows: [], totalHeight: 0, itemCount: this.items.length };
      this.itemTops = itemTops;
      this.itemHeights = itemHeights;
      this.dirty = false;
      return this.layout;
    }

    let y = 0;
    let rowKey = 0;

    const { grouped } = this.config;

    for (const group of this.groups) {
      // Group header band — only when dated grouping is enabled.
      if (grouped) {
        rows.push({
          type: "header",
          y,
          height: headerHeight,
          key: `h-${group.id}`,
          label: group.label,
        });
        y += headerHeight;
      }

      // Greedily pack this group's items into justified rows.
      let rowStart = group.start;
      let aspectSum = 0;

      const flushRow = (endExclusive: number, isLastRowOfGroup: boolean) => {
        const n = endExclusive - rowStart;
        if (n <= 0) return;
        const totalGap = gap * (n - 1);
        // The height that makes the row exactly fill the width.
        let rowHeight = (containerWidth - totalGap) / aspectSum;
        // The final partial row of a group is never stretched past the target.
        if (isLastRowOfGroup && rowHeight > targetRowHeight) rowHeight = targetRowHeight;
        // Guard against a run of panoramas producing a razor-thin row, or a
        // single portrait producing a skyscraper.
        rowHeight = Math.min(rowHeight, maxRowHeight);

        const tiles: TileRect[] = [];
        let x = 0;
        for (let i = rowStart; i < endExclusive; i++) {
          const item = this.items[i]!;
          const aspect = item.width / item.height;
          const w = rowHeight * aspect;
          tiles.push({ index: i, item, x, width: w, height: rowHeight });
          itemTops[i] = y;
          itemHeights[i] = rowHeight;
          x += w + gap;
        }
        rows.push({ type: "tiles", y, height: rowHeight, key: `r-${rowKey++}`, tiles });
        y += rowHeight + gap;
      };

      for (let i = group.start; i < group.end; i++) {
        const item = this.items[i]!;
        const aspect = item.width / item.height;
        aspectSum += aspect;
        // Natural width of the row so far at the target height.
        const naturalWidth = targetRowHeight * aspectSum + gap * (i - rowStart);
        if (naturalWidth >= containerWidth) {
          flushRow(i + 1, false);
          rowStart = i + 1;
          aspectSum = 0;
        }
      }
      // Trailing partial row.
      if (rowStart < group.end) flushRow(group.end, true);

      // Remove the trailing inter-row gap, add the group gap instead.
      y = y - gap + groupGap;
    }

    const totalHeight = Math.max(0, y - groupGap);
    this.layout = { rows, totalHeight, itemCount: this.items.length };
    this.itemTops = itemTops;
    this.itemHeights = itemHeights;
    this.dirty = false;
    return this.layout;
  }

  getLayout(): Layout {
    return this.compute();
  }

  /**
   * The visible window: the [startRow, endRow) slice of rows intersecting the
   * viewport expanded by `overscanPx` on each edge. Binary-searches the rows
   * (which are sorted by `y`) so cost is O(log n), independent of dataset size.
   */
  getWindow(
    scrollTop: number,
    viewportHeight: number,
    overscanPx: number,
  ): { startRow: number; endRow: number } {
    const { rows } = this.compute();
    if (rows.length === 0) return { startRow: 0, endRow: 0 };

    const top = scrollTop - overscanPx;
    const bottom = scrollTop + viewportHeight + overscanPx;

    // First row whose bottom edge is past `top`.
    let lo = 0;
    let hi = rows.length - 1;
    let startRow = rows.length;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const row = rows[mid]!;
      if (row.y + row.height >= top) {
        startRow = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }

    // First row whose top edge is at/after `bottom` → the exclusive end.
    lo = 0;
    hi = rows.length - 1;
    let endRow = rows.length;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const row = rows[mid]!;
      if (row.y > bottom) {
        endRow = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }

    return { startRow: Math.min(startRow, rows.length), endRow };
  }

  /** Top offset of an item — used to re-pin the scroll after a re-layout. */
  getItemTop(index: number): number {
    this.compute();
    return this.itemTops[index] ?? 0;
  }

  getItemHeight(index: number): number {
    this.compute();
    return this.itemHeights[index] ?? 0;
  }

  /**
   * The topmost item at least partially visible at `scrollTop`, plus the pixel
   * offset between the viewport top and that item's top. The React layer stores
   * this before a density/resize re-layout and restores it afterwards so the
   * content under the user's eyes stays put (scroll anchoring).
   */
  findAnchor(scrollTop: number): { index: number; offset: number } {
    this.compute();
    if (this.items.length === 0) return { index: 0, offset: 0 };
    // Binary search itemTops for the last item whose top is <= scrollTop.
    let lo = 0;
    let hi = this.itemTops.length - 1;
    let index = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.itemTops[mid]! <= scrollTop) {
        index = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return { index, offset: scrollTop - (this.itemTops[index] ?? 0) };
  }
}
