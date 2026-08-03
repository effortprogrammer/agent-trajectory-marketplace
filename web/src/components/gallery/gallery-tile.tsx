import { memo, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Heart as IconFavorite } from "lucide-react";
import { Download as IconDownload } from "lucide-react";
import { Copy as IconContentCopy } from "lucide-react";
import { Share2 as IconShare } from "lucide-react";
import { Trash2 as IconDelete } from "lucide-react";
import { GenerationTile } from "@/components/generation-card";
import type { CardAction } from "@/components/generation-card";
import type { TileRect } from "./justified-engine.ts";
import type { GalleryItem, LoadTier } from "./types.ts";

/**
 * One gallery tile. It is absolutely positioned at the engine-computed rect and
 * composed from Quanta primitives:
 *   • `generating` items → `GenerationCard state="generating"` (the pulsing card).
 *   • ready items → a `GenerationCard` (image or hover-to-play video) that is the
 *     trigger of a `GenerationDetailModal`, preserving the click-to-open behavior.
 *
 * Load tiers are driven by the engine. Media remains mounted while its row is
 * windowed so scrolling never swaps completed generations for placeholders.
 */

export interface GalleryTileProps {
  item: GalleryItem;
  rect: TileRect;
  /** Row top, in content coordinates (the rect's x is row-relative). */
  top: number;
  tier: LoadTier;
  reducedMotion: boolean;
}

function rectStyle(rect: TileRect, top: number): CSSProperties {
  return {
    left: rect.x,
    top,
    width: rect.width,
    height: rect.height,
  } as CSSProperties;
}

/** Neutral fallback behind media that has not painted yet. */
function Placeholder() {
  return <span className="qg-placeholder" aria-hidden="true" />;
}

/** Still image with native tier-driven loading and no remount fade. */
function StillMedia({ item, tier }: { item: GalleryItem; tier: LoadTier }) {
  return (
    <>
      <Placeholder />
      <img
        className="absolute inset-0 size-full object-cover"
        src={item.src}
        alt={item.alt}
        loading={tier === "full" ? "eager" : "lazy"}
        decoding="async"
      />
    </>
  );
}

/**
 * Hover-to-play video: poster still by default, plays (muted / looped /
 * playsInline) on hover & focus, pauses and resets on leave. Respects reduced
 * motion — when set, the poster stays put and the clip never autoplays on hover.
 */
function HoverVideo({
  item,
  tier,
  playing,
  reducedMotion,
}: {
  item: GalleryItem;
  tier: LoadTier;
  playing: boolean;
  reducedMotion: boolean;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const active = playing && !reducedMotion;
  const hasPoster = item.src.length > 0;
  const showVideo = active && videoLoaded;

  useEffect(() => {
    const v = ref.current;
    if (v == null) return;
    if (active) {
      void v.play()?.catch(() => {});
    } else {
      v.pause();
      try {
        v.currentTime = 0;
      } catch {}
    }
  }, [active]);

  return (
    <>
      <Placeholder />
      {hasPoster ? (
        <img
          className="absolute inset-0 size-full object-cover"
          src={item.src}
          alt={item.alt}
          loading={tier === "full" ? "eager" : "lazy"}
          decoding="async"
          style={{ opacity: showVideo ? 0 : 1 }}
        />
      ) : null}
      {/* Historical video nodes stay network-idle until explicit hover/focus. */}
      <video
        ref={ref}
        className="absolute inset-0 size-full object-cover"
        muted
        loop
        playsInline
        preload="none"
        poster={hasPoster ? item.src : undefined}
        onLoadedData={() => setVideoLoaded(true)}
        style={{ opacity: showVideo ? 1 : 0 }}
      >
        <source src={item.videoSrc} type="video/mp4" />
      </video>
    </>
  );
}

function GalleryTileComponent({ item, rect, top, tier, reducedMotion }: GalleryTileProps) {
  const [hovered, setHovered] = useState(false);
  const [liked, setLiked] = useState(false);

  if (item.status === "generating") {
    return (
      <GenerationTile
        state="generating"
        ratio="auto"
        className="qg-tile"
        style={rectStyle(rect, top)}
      />
    );
  }

  const isVideo = item.kind === "video";
  const media = isVideo ? (
    <HoverVideo item={item} tier={tier} playing={hovered} reducedMotion={reducedMotion} />
  ) : (
    <StillMedia item={item} tier={tier} />
  );

  // Per-tile affordances. `CardActions` caps the visible controls at 3 (its
  // default `max`): with more than that, the first two render as glass buttons
  // and the rest collapse into the three-dots overflow menu.
  const actions: CardAction[] = [
    {
      id: "like",
      label: liked ? "Unlike" : "Like",
      icon: IconFavorite,
      onSelect: () => setLiked((v) => !v),
    },
    { id: "download", label: "Download", icon: IconDownload },
    {
      id: "copy",
      label: "Copy prompt",
      icon: IconContentCopy,
      onSelect: () => void navigator.clipboard?.writeText(item.prompt),
    },
    { id: "share", label: "Share", icon: IconShare },
    { id: "delete", label: "Delete", icon: IconDelete, danger: true },
  ];

  // The canonical single-generation tile: it owns the full-bleed open trigger and
  // the hover `CardActions` rail (siblings, never nested), so this feed reads the
  // SAME as every other generation card in the app. The feed only supplies the
  // engine-positioned frame + its media (hover-to-play video / tiered still).
  return (
    <GenerationTile
      ratio="auto"
      className="qg-tile"
      style={rectStyle(rect, top)}
      media={media}
      actions={actions}
      generation={{
        src: isVideo ? (item.videoSrc ?? item.src) : item.src,
        poster: isVideo ? item.src : undefined,
        mediaType: isVideo ? "video" : "image",
        aspectRatio: item.width / item.height,
        prompt: item.prompt,
      }}
      openLabel={`Open generation: ${item.prompt}`}
      onMouseEnter={isVideo ? () => setHovered(true) : undefined}
      onMouseLeave={isVideo ? () => setHovered(false) : undefined}
      onFocus={isVideo ? () => setHovered(true) : undefined}
      onBlur={isVideo ? () => setHovered(false) : undefined}
    />
  );
}

export const GalleryTile = memo(GalleryTileComponent);
