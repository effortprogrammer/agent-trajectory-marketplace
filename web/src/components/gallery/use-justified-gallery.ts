import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { JustifiedLayoutEngine } from "./justified-engine.ts";
import type { Layout, LayoutRow } from "./justified-engine.ts";
import type { GalleryItem } from "./types.ts";
import { makeOlderBatch } from "./demo-data.ts";

/**
 * Tile-size presets, indexed by the slider step. The slider runs left → right =
 * smaller → LARGER tiles, so this array is ASCENDING: step 0 is the smallest /
 * densest, the last step the largest / least-dense. The value is the target row
 * height in px that the engine packs against. The scale is biased toward larger
 * tiles (base default sits above the old minimum) since the small end read too
 * cramped.
 */
export const DENSITY_ROW_HEIGHTS = [220, 280, 360, 460, 580] as const;
export const DEFAULT_DENSITY = 1;

const GAP = 6;
/** Rows within this many px of the viewport edge are rendered (windowing). */
const OVERSCAN_PX = 400;
/** Load the next batch when the viewport bottom is within this px of the end. */
const INFINITE_MARGIN = 1200;
/** Cap total items so the demo can't grow without bound. */
const MAX_ITEMS = 1400;

interface InfiniteScrollOptions {
  demo?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void | Promise<unknown>;
}

export interface UseJustifiedGalleryResult {
  viewportRef: RefObject<HTMLDivElement | null>;
  layout: Layout;
  /** The [startRow, endRow) slice of rows currently rendered. */
  visibleRows: LayoutRow[];
  /** Current scroll offset (px) — used to classify each tile's load tier. */
  scrollTop: number;
  viewportHeight: number;
  density: number;
  setDensity: (level: number) => void;
  itemCount: number;
  loadingMore: boolean;
}

export function useJustifiedGallery(
  items: GalleryItem[],
  grouped = true,
  { demo = false, hasMore = false, loadingMore = false, onLoadMore }: InfiniteScrollOptions = {},
): UseJustifiedGalleryResult {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<JustifiedLayoutEngine>(null as unknown as JustifiedLayoutEngine);
  if (engineRef.current == null) engineRef.current = new JustifiedLayoutEngine();
  const engine = engineRef.current;

  const [width, setWidth] = useState(0);
  const [density, setDensityState] = useState(DEFAULT_DENSITY);
  // Scroll position is measurement, not render state. Making this state causes
  // every mounted media/dialog tile to rerender on every animation frame.
  const scrollTopRef = useRef(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [range, setRange] = useState({ startRow: 0, endRow: 0 });

  // Infinite-scroll state: appended "older" batches beyond the initial set.
  const [olderItems, setOlderItems] = useState<GalleryItem[]>([]);
  const [demoLoadingMore, setDemoLoadingMore] = useState(false);
  const pageRef = useRef(0);

  const allItems = useMemo(
    () => (demo && olderItems.length > 0 ? [...items, ...olderItems] : items),
    [demo, items, olderItems],
  );

  const targetRowHeight = DENSITY_ROW_HEIGHTS[density] ?? DENSITY_ROW_HEIGHTS[DEFAULT_DENSITY]!;

  // Feed geometry to the engine and (re)compute the layout. The engine caches
  // internally, so this is cheap when nothing changed.
  const layout = useMemo(() => {
    engine.setItems(allItems);
    engine.setConfig({ containerWidth: width, targetRowHeight, gap: GAP, grouped });
    return engine.getLayout();
  }, [engine, allItems, width, targetRowHeight, grouped]);

  // Anchor captured on the last scroll frame (against the pre-change layout) so
  // a density change or resize can re-pin the same item under the viewport.
  const anchorRef = useRef({ index: 0, offset: 0 });

  const readRange = useCallback(() => {
    const el = viewportRef.current;
    if (el == null) return;
    const st = el.scrollTop;
    const vh = el.clientHeight;
    const win = engine.getWindow(st, vh, OVERSCAN_PX);
    scrollTopRef.current = st;
    setViewportHeight(vh);
    setRange((prev) => (prev.startRow === win.startRow && prev.endRow === win.endRow ? prev : win));
  }, [engine]);

  // Measure width + height with a ResizeObserver.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (el == null || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      setWidth(el.clientWidth);
      setViewportHeight(el.clientHeight);
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    setViewportHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // After any re-layout (width / density / items), recompute the window and
  // restore the scroll anchor so the visible content stays stable.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (el == null) return;
    const anchor = anchorRef.current;
    if (anchor.index > 0) {
      const nextTop = engine.getItemTop(anchor.index) + anchor.offset;
      if (Math.abs(nextTop - el.scrollTop) > 0.5) el.scrollTop = nextTop;
    }
    readRange();
    // Depend on the layout object identity, which changes on every recompute.
  }, [engine, layout, readRange]);

  // Keep a stable loader that reads the freshest counts via refs.
  const loadingRef = useRef(false);
  const lastAutoLoadKeyRef = useRef<string | null>(null);
  const countRef = useRef(allItems.length);
  countRef.current = allItems.length;
  const feedEdgeKeyRef = useRef("");
  feedEdgeKeyRef.current = `${allItems.length}:${allItems[0]?.id ?? ""}:${allItems.at(-1)?.id ?? ""}`;

  const triggerLoadMore = useCallback(() => {
    if (loadingRef.current) return;
    if (!demo && (loadingMore || !hasMore || onLoadMore == null)) return;
    if (demo && countRef.current >= MAX_ITEMS) return;
    if (lastAutoLoadKeyRef.current === feedEdgeKeyRef.current) return;
    lastAutoLoadKeyRef.current = feedEdgeKeyRef.current;
    loadingRef.current = true;
    if (demo) {
      setDemoLoadingMore(true);
      window.setTimeout(() => {
        const page = pageRef.current++;
        setOlderItems((prev) => [...prev, ...makeOlderBatch(page)]);
        loadingRef.current = false;
        setDemoLoadingMore(false);
      }, 120);
      return;
    }
    void Promise.resolve(onLoadMore?.())
      .catch(() => undefined)
      .finally(() => {
        loadingRef.current = false;
      });
  }, [demo, hasMore, loadingMore, onLoadMore]);

  // Fill short first pages, but never start before the viewport has geometry.
  useEffect(() => {
    const el = viewportRef.current;
    if (
      el != null &&
      width > 0 &&
      el.clientHeight > 0 &&
      el.scrollTop + el.clientHeight >= layout.totalHeight - INFINITE_MARGIN
    ) {
      triggerLoadMore();
    }
  }, [layout.totalHeight, loadingMore, triggerLoadMore, width]);

  // Scroll handling: rAF-throttled window recompute + infinite-scroll trigger.
  // Scroll position lives in a ref so frames within the same row window do not
  // rerender every mounted media tile.
  useEffect(() => {
    const el = viewportRef.current;
    if (el == null) return;

    let raf = 0;
    const onScroll = () => {
      if (raf !== 0) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const st = el.scrollTop;

        // Capture the anchor for the next density/resize re-layout.
        anchorRef.current = engine.findAnchor(st);

        readRange();

        // Infinite scroll: append an older batch as the bottom nears.
        const nearBottom = st + el.clientHeight >= engine.getLayout().totalHeight - INFINITE_MARGIN;
        if (nearBottom) triggerLoadMore();
      });
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [engine, readRange, triggerLoadMore]);

  const setDensity = useCallback(
    (level: number) => {
      // The anchor was captured on the last scroll frame; refresh it against the
      // live scroll position right now so the re-pin is exact even without a
      // recent scroll event.
      const el = viewportRef.current;
      if (el != null) anchorRef.current = engine.findAnchor(el.scrollTop);
      setDensityState(level);
    },
    [engine],
  );

  const visibleRows = useMemo(
    () => layout.rows.slice(range.startRow, range.endRow),
    [layout, range.startRow, range.endRow],
  );

  return {
    viewportRef,
    layout,
    visibleRows,
    scrollTop: scrollTopRef.current,
    viewportHeight,
    density,
    setDensity,
    itemCount: allItems.length,
    loadingMore: demo ? demoLoadingMore : loadingMore,
  };
}
