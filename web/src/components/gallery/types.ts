/**
 * Data model for the justified-masonry History gallery.
 *
 * A `GalleryItem` is a single generation. Its REAL pixel dimensions
 * (`width` / `height`) drive the justified layout — the engine derives each
 * tile's aspect ratio from these, never from a hard-coded ratio — so the demo
 * set deliberately mixes portrait, landscape, square and panoramic media.
 */

export type MediaKind = "image" | "video";
export type ItemStatus = "ready" | "generating";

export interface GalleryItem {
  /** Stable id — used as the React key. */
  id: string;
  /** `image` renders an `<img>`, `video` renders a hover-to-play `<video>` + poster. */
  kind: MediaKind;
  /** Lifecycle — `ready` shows the asset, `generating` shows the pulsing card. */
  status: ItemStatus;
  /** The still source: the image for `image`, the poster frame for `video`. */
  src: string;
  /** Video source (only meaningful when `kind === 'video'`). */
  videoSrc?: string;
  /** REAL intrinsic width in px — the numerator of the tile aspect ratio. */
  width: number;
  /** REAL intrinsic height in px — the denominator of the tile aspect ratio. */
  height: number;
  /** The generation prompt (shown in the detail modal + used as the a11y label). */
  prompt: string;
  /** Accessible alt text for the still. */
  alt: string;
  /** Which dated batch this item belongs to (e.g. `today`). */
  groupId: string;
  /** Human batch label rendered as the section header (e.g. `Today`). */
  groupLabel: string;
}

/** How near a tile is to the viewport — drives the load tier (quality upgrade). */
export type LoadTier = "full" | "near" | "far";
