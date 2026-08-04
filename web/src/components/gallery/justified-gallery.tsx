import { useMemo } from "react";
import { Loader } from "@higgsfield/quanta/loader";
import { Typography } from "@higgsfield/quanta/typography";
import { GalleryTile } from "./gallery-tile.tsx";
import { DensityControl } from "./density-control.tsx";
import { useJustifiedGallery } from "./use-justified-gallery.ts";
import { useReducedMotion } from "./use-reduced-motion.ts";
import { makeInitialItems } from "./demo-data.ts";
import type { LoadTier } from "./types.ts";
import type { GalleryItem } from "./types.ts";
import "./gallery.css";

/**
 * JustifiedGallery — the virtualized, Flickr-style justified-masonry feed that
 * backs the History tab.
 *
 * Architecture:
 *   • `JustifiedLayoutEngine` (plain TS) owns all layout + windowing math.
 *   • `useJustifiedGallery` wires the engine to scroll / resize / density and
 *     exposes only the visible window of rows.
 *   • This component renders that window as absolutely-positioned `GalleryTile`s
 *     over a fixed-height sizer, so the DOM only ever holds a screenful of tiles
 *     regardless of dataset size.
 */

interface JustifiedGalleryCommonProps {
  /**
   * Split the feed into dated batches with "Today" / "Yesterday" / … headers.
   * Defaults to true; pass `false` for one continuous justified feed with no
   * day separators.
   */
  grouped?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void | Promise<unknown>;
}

export type JustifiedGalleryProps = JustifiedGalleryCommonProps &
  ({ demo: true; items?: never } | { demo?: false; items: GalleryItem[] });

const numberFormat = new Intl.NumberFormat("en-US");

export function JustifiedGallery(props: JustifiedGalleryProps) {
  const { grouped = true } = props;
  const initial = useMemo(
    () => (props.demo ? makeInitialItems() : props.items),
    [props.demo, props.items],
  );
  const reducedMotion = useReducedMotion();

  const {
    viewportRef,
    layout,
    visibleRows,
    scrollTop,
    viewportHeight,
    density,
    setDensity,
    itemCount,
    loadingMore,
  } = useJustifiedGallery(initial, grouped, {
    demo: props.demo === true,
    hasMore: props.hasMore,
    loadingMore: props.loadingMore,
    onLoadMore: props.onLoadMore,
  });

  const viewTop = scrollTop;
  const viewBottom = scrollTop + viewportHeight;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <header className="flex shrink-0 items-center justify-between gap-4 px-0.5">
        <div className="flex items-center gap-2">
          <Typography as="h2" variant="body-sm-semi-bold" color="primary">
            Your generations
          </Typography>
          <Typography as="span" variant="caption-sm-regular" color="tertiary">
            {numberFormat.format(itemCount)}
            {" items"}
          </Typography>
          {loadingMore && (
            <span className="flex items-center gap-1.5 text-q-text-tertiary">
              <Loader variant="circle" size="xs" color="neutral" aria-label="Loading more" />
              <Typography as="span" variant="caption-sm-regular" color="tertiary">
                Loading
              </Typography>
            </span>
          )}
        </div>
        <DensityControl value={density} onChange={setDensity} />
      </header>

      <div ref={viewportRef} className="qg-viewport relative min-h-0 flex-1 overflow-y-auto">
        {itemCount === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
            <Typography as="p" variant="body-md-semi-bold" color="primary">
              No generations yet
            </Typography>
            <Typography as="p" variant="caption-sm-regular" color="secondary">
              Generated results will appear here.
            </Typography>
          </div>
        ) : (
          <div className="relative w-full" style={{ height: layout.totalHeight }}>
            {visibleRows.map((row) => {
              if (row.type === "header") {
                return (
                  <div
                    key={row.key}
                    className="absolute inset-x-0 flex items-end px-0.5 pb-2"
                    style={{ top: row.y, height: row.height }}
                  >
                    <Typography as="h3" variant="caption-sm-medium" color="tertiary">
                      {row.label}
                    </Typography>
                  </div>
                );
              }
              const rowVisible = row.y < viewBottom && row.y + row.height > viewTop;
              const tier: LoadTier = rowVisible ? "full" : "near";
              return row.tiles!.map((rect) => (
                <GalleryTile
                  key={rect.item.id}
                  item={rect.item}
                  rect={rect}
                  top={row.y}
                  tier={tier}
                  reducedMotion={reducedMotion}
                />
              ));
            })}
          </div>
        )}
      </div>
    </div>
  );
}
