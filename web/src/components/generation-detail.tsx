import type { ReactElement, ReactNode } from "react";
import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Download as IconDownloadOutlined } from "lucide-react";
import { Share2 as IconArrowShareRightOutlined } from "lucide-react";
import { ChevronUp as IconChevronTopMediumOutlined } from "lucide-react";
import { Info as IconCircleInfoOutlined } from "lucide-react";
import { Cloud as IconCloudFilled } from "lucide-react";
import { X as IconCrossMediumOutlined } from "lucide-react";
import { Ellipsis as IconDotGrid1x3HorizontalOutlined } from "lucide-react";
import { Heart as IconHeartOutlined } from "lucide-react";
import { Video as IconVideoOutlined } from "lucide-react";
import { Avatar } from "@higgsfield/quanta/avatar";
import { Button } from "@higgsfield/quanta/button";
import { glass } from "@higgsfield/quanta/glass";
import { Icon, type IconGlyph } from "@higgsfield/quanta/icon";
import { Media } from "@higgsfield/quanta/media";
import { Typography } from "@higgsfield/quanta/typography";
import { downloadMedia } from "@/lib/download-media";

/**
 * GenerationDetailModal — the full-screen "Viewer / Image" lightbox that opens
 * when a generation card is clicked (Figma SC App Builder, node 3019:100235).
 *
 * ── Anatomy ──────────────────────────────────────────────────────────────────
 * A full-viewport overlay (NOT a centered card) with three stacked layers:
 *   1. Backdrop — the generation itself, cover-filled, darkened by a scrim and
 *      washed by a heavy backdrop blur so the media reads as frosted glass behind
 *      everything. This is the "lightbox" effect.
 *   2. Stage — the crisp, contained media (image or video) centred in the left
 *      region.
 *   3. Info panel — a frosted glass card pinned to the right holding: an author
 *      row (avatar + name + Share + Close), a collapsible "Details" block
 *      (status / type / size / uploaded / last used + prompt), and a sticky
 *      action footer ("Turn to video" CTA + Download / Like / Share / More).
 *
 * ── Why Base UI Dialog directly (not Quanta `Modal`) ─────────────────────────
 * Quanta's `Modal` paints a centred, width-capped glass CARD (`q-modal`: fixed
 * 50/50 translate, `width: min(...)`, own backdrop-blur, 24px radius). A
 * full-bleed lightbox with an image backdrop + a right-docked panel is a
 * different surface entirely — reusing `Modal.Content` would mean overriding
 * nearly every one of those utilities. So we compose Base UI's `Dialog`
 * primitive (the same one `Modal` wraps — focus trap, scroll lock, escape,
 * a11y, portal, exit-mount timing) directly and skin it with Quanta tokens +
 * Quanta content components (`Media`, `Avatar`, `Button`, `Typography`, `Icon`,
 * and the `glass()` recipe).
 *
 * ── API ──────────────────────────────────────────────────────────────────────
 * Mirrors `AssetLibraryModal({ trigger })`: pass the generation card as
 * `trigger` and (optionally) the `generation` data. Another agent can wire this
 * to the History grid by rendering a card element as the trigger:
 *
 *   <GenerationDetailModal
 *     trigger={<GenerationCard … />}
 *     generation={{ src, mediaType: 'image', author: { name }, prompt, … }}
 *   />
 *
 * ── Fixed layout, configurable content ───────────────────────────────────────
 * This is THE canonical viewer — every finished generation opens through it,
 * and the two-column layout (media stage + right info panel with author row →
 * Details block → Prompt → action footer) never changes. What each surface may
 * customise is the info panel's CONTENT, without touching the layout:
 *   • `detailRows` — replace / add / remove / reorder the Details rows.
 *   • `primaryAction` — swap or hide (`null`) the full-width lime CTA.
 *   • `actions` — swap / add / remove the footer action buttons (`[]` hides).
 * Omit any of these to keep the canonical defaults.
 */

export interface GenerationDetail {
  /** Media source (image or video). Reuse a local `/presets/*` asset. */
  src: string;
  /** Renders a `<video>` when `'video'`, otherwise an `<img>`. Default `'image'`. */
  mediaType?: "image" | "video";
  /** Poster shown before a video plays. */
  poster?: string;
  /** Aspect ratio (width / height) of the crisp preview. Default `2 / 3` (portrait). */
  aspectRatio?: number;
  /** Author shown in the panel header. */
  author?: { name: string; role?: string; avatarSrc?: string };
  /** Storage status label (paired with a cloud glyph). */
  status?: string;
  /** File type, e.g. `JPG` / `MP4`. */
  fileType?: string;
  /** Human file size, e.g. `2.4 MB`. */
  size?: string;
  /** When the asset was created / uploaded. */
  uploadedAt?: string;
  /** When the asset was last used. */
  lastUsedAt?: string;
  /** The generation prompt. */
  prompt?: string;
}

/**
 * A single "label ⋯ value" row in the panel's Details block.
 *
 * The LAYOUT of the block is fixed; only its rows are configurable. Pass
 * `detailRows` to add / remove / reorder rows — omit it to keep the canonical
 * Status / Type / Size / Uploaded / Last used set.
 */
export interface GenerationDetailRow {
  id: string;
  label: string;
  value: ReactNode;
}

/**
 * A footer action button. The FIRST slot renders full-width (the lime CTA is
 * `primaryAction`); each entry here sits in the action row below it. Labeled
 * entries stretch (`flex-1`); `iconOnly` entries stay square.
 *
 * The row's LAYOUT is fixed; only which buttons appear is configurable.
 */
export interface GenerationDetailAction {
  id: string;
  label: string;
  icon: IconGlyph;
  onSelect?: () => void;
  /** Render as a square icon-only button (no label). Default `false`. */
  iconOnly?: boolean;
}

/** The full-width lime CTA above the action row (e.g. "Turn to video"). */
export interface GenerationDetailPrimaryAction {
  label: ReactNode;
  icon?: IconGlyph;
  onSelect?: () => void;
}

export interface GenerationDetailModalProps {
  /** The trigger element (e.g. a generation card). Rendered as the dialog trigger. */
  trigger: ReactElement;
  /** Data shown in the viewer. Falls back to a demo generation when omitted. */
  generation?: GenerationDetail;
  /**
   * Replaces the canonical Details rows (Status / Type / Size / Uploaded /
   * Last used). Same fixed layout — only the rows change. Omit for defaults.
   */
  detailRows?: GenerationDetailRow[];
  /**
   * The full-width lime CTA. Omit for the default "Turn to video"; pass `null`
   * to remove it entirely.
   */
  primaryAction?: GenerationDetailPrimaryAction | null;
  /**
   * The footer action buttons below the CTA. Omit for the default
   * Download / Like / Share / More set; pass `[]` to remove the row.
   */
  actions?: GenerationDetailAction[];
  /** Controlled open state (optional — the dialog self-manages otherwise). */
  open?: boolean;
  /** Open-state change callback (optional). */
  onOpenChange?: (open: boolean) => void;
  /** Start opened (uncontrolled). Handy for previews. */
  defaultOpen?: boolean;
}

// PLACEHOLDER ASSETS — template demo art (see /presets/*.png). When adapting
// this template into a real app, REPLACE media that represents the product
// (hero/example outputs, covers, before/after samples, feed items) with
// bespoke on-brand assets generated via the Higgsfield generation tools.
// Pure style-picker label thumbnails may keep simple placeholder art when
// real output depends on the user's own upload. Grep "PLACEHOLDER ASSETS"
// to find every site.
const DEMO_GENERATION: Required<Omit<GenerationDetail, "poster">> = {
  src: "/presets/how-product-works.png",
  mediaType: "image",
  aspectRatio: 2 / 3,
  author: { name: "retro_strawberry", role: "Author" },
  status: "Uploaded",
  fileType: "JPG",
  size: "2.4 MB",
  uploadedAt: "12.05.2026, 01:22",
  lastUsedAt: "12.05.2026, 16:43",
  prompt:
    "A model in a translucent floral raincoat standing beside pale horses in a windswept meadow, editorial fashion photography, soft daylight.",
};

/** The canonical lime CTA — used when `primaryAction` is omitted. */
const DEFAULT_PRIMARY_ACTION: GenerationDetailPrimaryAction = {
  label: "Turn to video",
  icon: IconVideoOutlined,
};

/** The canonical footer action row — used when `actions` is omitted. */
const DEFAULT_ACTIONS: GenerationDetailAction[] = [
  { id: "download", label: "Download", icon: IconDownloadOutlined },
  { id: "like", label: "Like", icon: IconHeartOutlined, iconOnly: true },
  { id: "share", label: "Share", icon: IconArrowShareRightOutlined, iconOnly: true },
  { id: "more", label: "More", icon: IconDotGrid1x3HorizontalOutlined, iconOnly: true },
];

/** A single "label ⋯ value" detail row. `value` may embed an icon/node. */
function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <Typography
        as="span"
        variant="body-sm-regular"
        className="shrink-0 text-q-transparent-light-50"
      >
        {label}
      </Typography>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
        {typeof value === "string" ? (
          <Typography
            as="span"
            variant="body-sm-regular"
            color="primary"
            truncate
            className="text-right"
          >
            {value}
          </Typography>
        ) : (
          value
        )}
      </div>
    </div>
  );
}

function InfoPanel({
  generation,
  detailRows,
  primaryAction,
  actions,
}: {
  generation: GenerationDetail;
  detailRows?: GenerationDetailRow[];
  primaryAction?: GenerationDetailPrimaryAction | null;
  actions?: GenerationDetailAction[];
}) {
  const [detailsOpen, setDetailsOpen] = useState(true);
  const data = {
    ...DEMO_GENERATION,
    ...generation,
    author: { ...DEMO_GENERATION.author, ...generation.author },
  };

  // Fixed layout, configurable content: rows/CTA/actions default to the
  // canonical set but callers may add, remove, or reorder them.
  const rows: GenerationDetailRow[] = detailRows ?? [
    {
      id: "status",
      label: "Status",
      value: (
        <>
          <Icon as={IconCloudFilled} size="sm" color="secondary" />
          <Typography as="span" variant="body-sm-regular" color="primary" truncate>
            {data.status}
          </Typography>
        </>
      ),
    },
    { id: "type", label: "Type", value: data.fileType },
    { id: "size", label: "Size", value: data.size },
    { id: "uploaded", label: "Uploaded", value: data.uploadedAt },
    { id: "lastUsed", label: "Last used", value: data.lastUsedAt },
  ];
  const primary = primaryAction === undefined ? DEFAULT_PRIMARY_ACTION : primaryAction;
  const footerActions = (actions ?? DEFAULT_ACTIONS).map((action) =>
    action.id === "download" && action.onSelect == null
      ? { ...action, onSelect: () => void downloadMedia(data.src) }
      : action,
  );

  return (
    <aside className="flex h-full w-full flex-col gap-2 p-2">
      {/* Author row */}
      <div className="flex items-center gap-2 p-1">
        <Avatar size="sm" src={data.author?.avatarSrc} alt={data.author?.name} color="mint" />
        <div className="flex min-w-0 flex-1 flex-col">
          <Typography as="span" variant="body-sm-medium" color="primary" truncate>
            {data.author?.name}
          </Typography>
          <Typography as="span" variant="caption-xs-regular" color="secondary" truncate>
            {data.author?.role ?? "Author"}
          </Typography>
        </div>
        <Dialog.Close
          aria-label="Close"
          className="flex size-8 shrink-0 items-center justify-center rounded-q-full bg-q-transparent-light-05 text-q-icon-primary transition-colors hover:bg-q-transparent-light-10"
        >
          <Icon as={IconCrossMediumOutlined} size="md" />
        </Dialog.Close>
      </div>

      {/* Details */}
      <div className="flex flex-col gap-2 rounded-q-300 bg-q-transparent-light-05 p-2">
        <button
          type="button"
          onClick={() => setDetailsOpen((o) => !o)}
          className="flex items-center gap-2 px-1 py-1.5"
          aria-expanded={detailsOpen}
        >
          <Icon as={IconCircleInfoOutlined} size="sm" color="secondary" />
          <Typography
            as="span"
            variant="label-xs-medium"
            color="secondary"
            className="flex-1 text-left uppercase"
          >
            Details
          </Typography>
          <Icon
            as={IconChevronTopMediumOutlined}
            size="sm"
            color="secondary"
            className={detailsOpen ? undefined : "rotate-180"}
          />
        </button>

        {detailsOpen ? (
          <>
            {rows.length > 0 ? (
              <div className="flex flex-col gap-1 rounded-q-200 bg-q-transparent-light-05 p-3">
                {rows.map((row) => (
                  <DetailRow key={row.id} label={row.label} value={row.value} />
                ))}
              </div>
            ) : null}

            {data.prompt != null && data.prompt !== "" ? (
              <div className="flex flex-col gap-1 rounded-q-200 bg-q-transparent-light-05 p-3">
                <Typography
                  as="span"
                  variant="body-sm-regular"
                  className="text-q-transparent-light-50"
                >
                  Prompt
                </Typography>
                <Typography as="p" variant="body-sm-regular" color="primary">
                  {data.prompt}
                </Typography>
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      <span aria-hidden className="flex-1" />

      {/* Actions — fixed layout (full-width CTA + a row of buttons), configurable content. */}
      {primary != null || footerActions.length > 0 ? (
        <div className="flex flex-col gap-2 p-2">
          {primary != null ? (
            <Button
              variant="marketingPrimary"
              size="sm"
              className="w-full"
              onClick={primary.onSelect}
              start={primary.icon != null ? <Icon as={primary.icon} size="sm" /> : undefined}
            >
              {primary.label}
            </Button>
          ) : null}
          {footerActions.length > 0 ? (
            <div className="flex items-center gap-2">
              {footerActions.map((action) =>
                action.iconOnly ? (
                  <Button
                    key={action.id}
                    variant="marketingTertiary"
                    size="sm"
                    iconOnly
                    aria-label={action.label}
                    onClick={action.onSelect}
                    start={<Icon as={action.icon} size="sm" />}
                  />
                ) : (
                  <Button
                    key={action.id}
                    variant="marketingTertiary"
                    size="sm"
                    className="flex-1"
                    onClick={action.onSelect}
                    start={<Icon as={action.icon} size="sm" />}
                  >
                    {action.label}
                  </Button>
                ),
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}

export function GenerationDetailModal({
  trigger,
  generation,
  detailRows,
  primaryAction,
  actions,
  open,
  onOpenChange,
  defaultOpen,
}: GenerationDetailModalProps) {
  const data = { ...DEMO_GENERATION, ...generation };

  // The stage frame takes the item's OWN aspect ratio and the media fills it
  // with `cover` — so the frame equals the image ratio and there are no
  // letterbox bars. The ratio-correct box is capped to the stage column by the
  // limiting axis: landscape/square is width-driven (q-media's default 100%
  // width), portrait is height-driven — either way max-h/max-w keep it inside
  // the column so it never overflows or slides under the info panel.
  const stageRatio = data.aspectRatio ?? 2 / 3;
  const stageFrameClass =
    stageRatio >= 1
      ? "max-h-full max-w-full shadow-q-overlay"
      : "h-full max-h-full w-auto! max-w-full shadow-q-overlay";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} defaultOpen={defaultOpen}>
      <Dialog.Trigger render={trigger} />
      <Dialog.Portal>
        <Dialog.Backdrop className="q-modal-backdrop" />
        <Dialog.Popup
          aria-label="Generation preview"
          className="fixed inset-0 z-q-modal flex outline-none transition-opacity duration-200 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
        >
          {/* Layer 1 — frosted media backdrop. A darker scrim (dark-80) + a heavy
           * backdrop blur so everything behind the crisp stage reads as a dark,
           * blurred frost. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden bg-q-background-primary"
          >
            <img src={data.src} alt="" className="absolute inset-0 size-full object-cover" />
            <div className="absolute inset-0 bg-q-transparent-dark-80" />
            <div className="absolute inset-0 backdrop-blur-3xl" />
          </div>

          {/* Layer 2 — crisp stage. min-h-0/min-w-0 + overflow-hidden keep the
           * media inside this flex column so it never bleeds under the panel;
           * the frame carries the item's aspect ratio and the media covers it
           * (no letterbox bars), capped to the column by max-h-full/max-w-full. */}
          <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden p-6">
            {data.mediaType === "video" ? (
              <Media ratio={stageRatio} rounded="md" className={stageFrameClass}>
                <Media.Video src={data.src} poster={data.poster} autoPlayInView loop fit="cover" />
              </Media>
            ) : (
              <Media ratio={stageRatio} rounded="md" className={stageFrameClass}>
                <Media.Image src={data.src} alt="" fit="cover" />
              </Media>
            )}
          </div>

          {/* Layer 3 — info panel */}
          <div className="relative flex w-[366px] shrink-0 p-2">
            <div
              className={glass(
                { blur: "md", rounded: "500" },
                "flex min-h-0 flex-1 flex-col overflow-y-auto",
              )}
            >
              <InfoPanel
                generation={generation ?? DEMO_GENERATION}
                detailRows={detailRows}
                primaryAction={primaryAction}
                actions={actions}
              />
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Standalone demo — renders its own trigger button so the viewer can be
 * previewed without touching shared templates. Import into `main.tsx`
 * temporarily, or drop anywhere for a visual check.
 */
export function GenerationDetailDemo() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-q-background-primary p-8">
      <GenerationDetailModal
        trigger={
          <Button variant="primary" size="md">
            Open generation
          </Button>
        }
      />
    </div>
  );
}

export default GenerationDetailDemo;
