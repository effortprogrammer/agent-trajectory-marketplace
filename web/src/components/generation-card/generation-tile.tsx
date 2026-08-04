import type { CSSProperties, FocusEventHandler, MouseEventHandler, ReactNode } from "react";
import { GenerationDetailModal } from "@/components/generation-detail";
import type {
  GenerationDetail,
  GenerationDetailAction,
  GenerationDetailPrimaryAction,
  GenerationDetailRow,
} from "@/components/generation-detail";
import { downloadMedia } from "@/lib/download-media";
import { cn as cx } from "@/lib/utils";
import { GenerationCard } from "./generation-card.tsx";
import type { GenerationCardProps, GenerationCardState } from "./generation-card.tsx";
import { CardActions } from "./card-actions.tsx";
import type { CardAction } from "./card-actions.tsx";

/**
 * GenerationTile — THE single canonical way to render ONE generation anywhere in
 * an app (a feed tile, a wizard result, a hero result, a variation grid cell).
 *
 * It locks in the two lifecycle states AND the hover mechanism so they read the
 * SAME everywhere:
 *   • `generating` → the pulsing `GenerationCard` placeholder (identical always).
 *   • `ready`      → the finished asset with a full-bleed `GenerationDetailModal`
 *     open trigger + the hover `CardActions` rail (≤3 controls, the rest collapse
 *     into a ⋯ menu). Clicking the tile opens the shared lightbox; the rail sits
 *     above it as siblings, never nested buttons.
 *
 * The MECHANISM is fixed (states + open-on-click + the capped hover rail); the
 * SET of actions is chosen PER context (`actions`) and extra overlays — badges,
 * a selection checkbox — compose in via `children`. `GenerationCard` is the
 * low-level primitive this composes; screens use `GenerationTile`, not a
 * hand-rolled hover overlay.
 */
export interface GenerationTileProps {
  /** Lifecycle state — `generating` shows the placeholder, `ready` the asset. */
  state?: GenerationCardState;
  /**
   * Detail descriptor. When set (and `openable` isn't `false`) a full-bleed
   * trigger opens the shared `GenerationDetailModal` on click. `src` falls back
   * to this when omitted.
   */
  generation?: GenerationDetail;
  /** Default image (ready state). Ignored when `media` is set; falls back to `generation.src`. */
  src?: string;
  /** Alt text for the default image. */
  alt?: string;
  /** Custom media node (e.g. a hover-to-play video) instead of the default image. */
  media?: ReactNode;
  /** Aspect ratio, forwarded to the card. */
  ratio?: GenerationCardProps["ratio"];
  /** Optional bottom title over the media scrim (ready state). */
  title?: ReactNode;
  /** Status pill label while generating. */
  generatingLabel?: ReactNode;
  /**
   * Hover action rail (like / download / copy / share / delete …). `CardActions`
   * caps it at 3 visible; extras collapse into a ⋯ menu. The set is contextual,
   * the mechanism is always the same.
   */
  actions?: CardAction[];
  /** Extra overlays inside the frame (badges, a selection checkbox), above the open trigger. */
  children?: ReactNode;
  /** Open the detail lightbox on click. Defaults to `true` when `generation` is provided. */
  openable?: boolean;
  /**
   * Customises the shared lightbox's right panel — same fixed layout, different
   * content. Forwarded to `GenerationDetailModal`; omit for canonical defaults.
   */
  detail?: {
    rows?: GenerationDetailRow[];
    primaryAction?: GenerationDetailPrimaryAction | null;
    actions?: GenerationDetailAction[];
  };
  /** Accessible label for the open trigger. */
  openLabel?: string;
  className?: string;
  style?: CSSProperties;
  onMouseEnter?: MouseEventHandler<HTMLDivElement>;
  onMouseLeave?: MouseEventHandler<HTMLDivElement>;
  /** Forwarded to the open trigger (used e.g. to drive hover-to-play video on keyboard focus). */
  onFocus?: FocusEventHandler<HTMLButtonElement>;
  onBlur?: FocusEventHandler<HTMLButtonElement>;
}

export function GenerationTile({
  state = "ready",
  generation,
  src,
  alt = "",
  media,
  ratio = "auto",
  title,
  generatingLabel = "Generating",
  actions,
  children,
  openable,
  detail,
  openLabel,
  className,
  style,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
}: GenerationTileProps) {
  if (state === "generating") {
    return (
      <GenerationCard
        state="generating"
        ratio={ratio}
        generatingLabel={generatingLabel}
        className={className}
        style={style}
      />
    );
  }

  const canOpen = openable !== false && generation != null;
  const downloadUrl = generation?.src ?? src;
  const resolvedActions = actions?.map((action) =>
    action.id === "download" && action.onSelect == null && downloadUrl
      ? { ...action, onSelect: () => void downloadMedia(downloadUrl) }
      : action,
  );

  return (
    <GenerationCard
      ratio={ratio}
      src={media == null ? (src ?? generation?.src) : undefined}
      alt={alt}
      title={title}
      media={media}
      className={cx("group", className)}
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {canOpen ? (
        <GenerationDetailModal
          generation={generation}
          detailRows={detail?.rows}
          primaryAction={detail?.primaryAction}
          actions={detail?.actions}
          trigger={
            <button
              type="button"
              aria-label={
                openLabel ??
                (generation?.prompt != null
                  ? `Open generation: ${generation.prompt}`
                  : "Open generation")
              }
              className="absolute inset-0 z-[1] cursor-pointer rounded-q-300 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-q-border-focus"
              onFocus={onFocus}
              onBlur={onBlur}
            />
          }
        />
      ) : null}
      {children}
      {resolvedActions != null && resolvedActions.length > 0 ? (
        <CardActions actions={resolvedActions} />
      ) : null}
    </GenerationCard>
  );
}
