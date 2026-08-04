import type { ReactElement, ReactNode } from "react";
import { useMemo, useState } from "react";
import { User as IconCryptopunkOutlined } from "lucide-react";
import { DollarSign as IconDollarOutlined } from "lucide-react";
import { WandSparkles as IconImagineAiFilled } from "lucide-react";
import { BatteryFull as IconBatteryFullFilled } from "lucide-react";
import { Calendar as IconDateYearlyFilled } from "lucide-react";
import { House as IconHomeRoundDoorFilled } from "lucide-react";
import { Search as IconMagnifyingGlassOutlined } from "lucide-react";
import { Play as IconPlayFilled } from "lucide-react";
import { Music as IconTiktokOutlined } from "lucide-react";
import { Video as IconVideoOutlined } from "lucide-react";
import { Button } from "@higgsfield/quanta/button";
import { Icon } from "@higgsfield/quanta/icon";
import { Media } from "@higgsfield/quanta/media";
import { Modal } from "@higgsfield/quanta/modal";
import { Tabs } from "@higgsfield/quanta/tabs";
import { Typography } from "@higgsfield/quanta/typography";

/**
 * TemplatePickerModal — the full-screen "template settings" picker that opens
 * from the Studio prompt box (Figma Marketing-Studio: the settings/Templates
 * control on node 7259:51362 opens this). A glass `Modal` (spirit of the
 * asset-library modal) whose body is a gallery of selectable IMAGE / VIDEO
 * template tiles, filtered by category (All / TikTok / UGC / Commercial) and by
 * media type (All / Image / Video).
 *
 * ── Figma note ────────────────────────────────────────────────────────────────
 * The referenced node (7259:51362) resolves to the Studio *prompt box* itself;
 * Figma exposes no standalone "template modal" node. The tile design is taken
 * verbatim from the Studio gallery cards (node 7137:108927 — brand header,
 * rounded triptych, gradient badge + title/subtitle + lime "Try"), and lifted
 * into a Quanta glass Modal following the asset-library composition. The exported
 * `TemplateCard` + `TEMPLATES` are exported so an in-page
 * gallery and the modal render identical tiles.
 */

// PLACEHOLDER ASSETS — template demo art (see /presets/*.png). When adapting
// this template into a real app, REPLACE media that represents the product
// (hero/example outputs, covers, before/after samples, feed items) with
// bespoke on-brand assets generated via the Higgsfield generation tools.
// Pure style-picker label thumbnails may keep simple placeholder art when
// real output depends on the user's own upload. Grep "PLACEHOLDER ASSETS"
// to find every site.
const THUMBS = [
  "/presets/how-product-works.png",
  "/presets/explain.png",
  "/presets/hyper-motion.png",
  "/presets/cover.png",
] as const;

/** Branded lead-tile gradients (no Quanta gradient token — documented literals). */
const BADGE_GRADIENT = {
  tiktok: "linear-gradient(135deg, rgb(45, 204, 211) 3.87%, rgb(241, 32, 74) 93.45%)",
  blue: "linear-gradient(135deg, rgb(81, 180, 226) 3.87%, rgb(24, 64, 182) 93.45%)",
  pink: "linear-gradient(135deg, rgb(226, 81, 180) 3.87%, rgb(141, 18, 55) 93.45%)",
} as const;

type BadgeGradient = keyof typeof BADGE_GRADIENT;
type LeadGlyph = typeof IconBatteryFullFilled;
export type TemplateCategory = "tiktok" | "ugc" | "commercial";
export type TemplateKind = "image" | "video";

export interface TemplateItem {
  id: string;
  title: string;
  subtitle: string;
  category: TemplateCategory;
  kind: TemplateKind;
  images: [string, string, string];
  icon: LeadGlyph;
  gradient: BadgeGradient;
}

// PLACEHOLDER ASSETS — demo data; replace when adapting (see note above).
export const TEMPLATES: TemplateItem[] = [
  {
    id: "ugc-gadget",
    title: "UGC Gadget save me",
    subtitle: "Turn long videos into short clips",
    category: "ugc",
    kind: "video",
    images: [THUMBS[0], THUMBS[1], THUMBS[2]],
    icon: IconBatteryFullFilled,
    gradient: "tiktok",
  },
  {
    id: "giant-figure",
    title: "Giant figure",
    subtitle: "Product hero, larger than life",
    category: "tiktok",
    kind: "image",
    images: [THUMBS[1], THUMBS[3], THUMBS[0]],
    icon: IconImagineAiFilled,
    gradient: "tiktok",
  },
  {
    id: "classic-modern",
    title: "Classic meets modern",
    subtitle: "Editorial style transfer",
    category: "commercial",
    kind: "image",
    images: [THUMBS[2], THUMBS[0], THUMBS[1]],
    icon: IconDateYearlyFilled,
    gradient: "blue",
  },
  {
    id: "couple-home",
    title: "Couple sharing home",
    subtitle: "Lifestyle story in 3 shots",
    category: "ugc",
    kind: "video",
    images: [THUMBS[3], THUMBS[2], THUMBS[0]],
    icon: IconHomeRoundDoorFilled,
    gradient: "pink",
  },
  {
    id: "unbox-hype",
    title: "Unboxing hype",
    subtitle: "Fast-cut reveal for TikTok",
    category: "tiktok",
    kind: "video",
    images: [THUMBS[0], THUMBS[2], THUMBS[3]],
    icon: IconImagineAiFilled,
    gradient: "tiktok",
  },
  {
    id: "studio-lookbook",
    title: "Studio lookbook",
    subtitle: "Clean commercial catalogue",
    category: "commercial",
    kind: "image",
    images: [THUMBS[1], THUMBS[0], THUMBS[3]],
    icon: IconDateYearlyFilled,
    gradient: "blue",
  },
];

/** 24px branded gradient badge with a white glyph — the Studio card lead tile. */
function GradientBadge({ as, gradient }: { as: LeadGlyph; gradient: BadgeGradient }) {
  return (
    <span className="relative flex items-center justify-center overflow-hidden rounded-q-250 border border-[rgba(197,197,197,0.24)] p-q-200 text-white shadow-[0_4px_4px_rgba(0,0,0,0.08),inset_0_2px_4px_rgba(255,255,255,0.24)]">
      <span
        aria-hidden
        className="absolute inset-0"
        style={{ backgroundImage: BADGE_GRADIENT[gradient] }}
      />
      <span
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-transparent to-white/20 mix-blend-overlay"
      />
      <span
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-transparent to-white/[0.32] mix-blend-hard-light"
      />
      <Icon as={as} size="md" className="relative" />
    </span>
  );
}

const TRIPTYCH_CORNERS = [
  "rounded-tl-q-500 rounded-bl-q-500 rounded-tr-q-150 rounded-br-q-150",
  "rounded-q-150",
  "rounded-tr-q-500 rounded-br-q-500 rounded-tl-q-150 rounded-bl-q-150",
] as const;

/** Centered play badge over the media — shown for `video` templates. */
function PlayBadge() {
  return (
    <Media.Overlay placement="center">
      <span className="flex size-10 items-center justify-center rounded-q-full bg-q-transparent-dark-40 text-white backdrop-blur-sm">
        <Icon as={IconPlayFilled} size="md" />
      </span>
    </Media.Overlay>
  );
}

/**
 * Preview layout of a template tile:
 *   • `single`   — ONE full-width shot (the base tile). Default.
 *   • `triptych` — the 3-shot rounded triptych variation.
 */
export type TemplateCardVariant = "single" | "triptych";

export interface TemplateCardProps {
  template: TemplateItem;
  /** Preview layout. `single` (one full-width image) is the base; `triptych` is the 3-shot variation. */
  variant?: TemplateCardVariant;
  /** Fired by the "Try" action (wire to seed the prompt box / start a generation). */
  onTry?: (template: TemplateItem) => void;
  /** Swap the "Try" label (e.g. "Use"). */
  tryLabel?: ReactNode;
}

/**
 * A single marketing template tile — Figma Marketing-Studio gallery card
 * (7137:108927): co-brand header, a rounded preview (base = one full-width shot;
 * the `triptych` variant shows 3 shots — video templates carry a play badge),
 * and a footer with a gradient category badge, the title/subtitle, and the lime
 * "Try" CTA.
 */
export function TemplateCard({
  template,
  variant = "single",
  onTry,
  tryLabel = "Try",
}: TemplateCardProps) {
  return (
    <div className="flex flex-col gap-q-200 rounded-q-600 bg-q-transparent-light-05 p-q-200 shadow-[0_2px_6px_rgba(0,0,0,0.15)]">
      <div className="flex h-60 items-stretch gap-1.5">
        {variant === "triptych" ? (
          template.images.map((src, index) => (
            <Media
              key={index}
              ratio="auto"
              rounded="none"
              className={`min-w-0 flex-1 border border-q-border-subtle ${TRIPTYCH_CORNERS[index]}`}
            >
              <Media.Image src={src} alt={`${template.title} — shot ${index + 1}`} />
              {template.kind === "video" && index === 1 ? <PlayBadge /> : null}
            </Media>
          ))
        ) : (
          <Media
            ratio="auto"
            rounded="none"
            className="min-w-0 flex-1 rounded-q-500 border border-q-border-subtle"
          >
            <Media.Image src={template.images[0]} alt={template.title} />
            {template.kind === "video" ? <PlayBadge /> : null}
          </Media>
        )}
      </div>
      <div className="flex items-center gap-3 px-2 py-1">
        <GradientBadge as={template.icon} gradient={template.gradient} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Typography as="span" variant="label-md-medium" color="primary" truncate>
            {template.title}
          </Typography>
          <Typography as="span" variant="caption-sm-regular" color="secondary" truncate>
            {template.subtitle}
          </Typography>
        </div>
        <Button variant="marketingPrimary" size="sm" onClick={() => onTry?.(template)}>
          {tryLabel}
        </Button>
      </div>
    </div>
  );
}

/* ── Filter tabs ──────────────────────────────────────────────────────────── */

const CATEGORY_TABS = [
  { value: "all", label: "All" },
  { value: "tiktok", label: "TikTok", start: <Icon size="sm" as={IconTiktokOutlined} /> },
  { value: "ugc", label: "UGC", start: <Icon size="sm" as={IconCryptopunkOutlined} /> },
  { value: "commercial", label: "Commercial", start: <Icon size="sm" as={IconDollarOutlined} /> },
];

const TYPE_TABS = [
  { value: "all", label: "All" },
  { value: "image", label: "Image", start: <Icon size="sm" as={IconImagineAiFilled} /> },
  { value: "video", label: "Video", start: <Icon size="sm" as={IconVideoOutlined} /> },
];

export interface TemplatePickerModalProps {
  /** The trigger element (e.g. a PromptBox.Pill). Rendered as the Modal trigger. */
  trigger: ReactElement;
  /** Fired when a template's "Try" is clicked (wire to seed the prompt box). */
  onSelect?: (template: TemplateItem) => void;
  /** Start opened (uncontrolled) — handy for previews. */
  defaultOpen?: boolean;
}

export function TemplatePickerModal({ trigger, onSelect, defaultOpen }: TemplatePickerModalProps) {
  const [category, setCategory] = useState("all");
  const [kind, setKind] = useState("all");

  const visible = useMemo(
    () =>
      TEMPLATES.filter(
        (t) =>
          (category === "all" || t.category === category) && (kind === "all" || t.kind === kind),
      ),
    [category, kind],
  );

  return (
    <Modal.Root defaultOpen={defaultOpen}>
      <Modal.Trigger render={trigger} />
      <Modal.Content size="2xl">
        <Modal.Header flush className="px-2 py-1">
          <Tabs.Root variant="pill" value={category} onValueChange={setCategory} className="flex-1">
            <Tabs.List items={CATEGORY_TABS} />
          </Tabs.Root>
          <Modal.CloseButton />
        </Modal.Header>

        <div className="flex items-center justify-between gap-4 px-1 pb-3">
          <Tabs.Root variant="segmented" value={kind} onValueChange={setKind}>
            <Tabs.List items={TYPE_TABS} />
          </Tabs.Root>
          <Button
            variant="tertiary"
            size="sm"
            start={<Icon as={IconMagnifyingGlassOutlined} size="sm" />}
          >
            Search
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid grid-cols-2 gap-5 p-1">
            {visible.map((template) => (
              <TemplateCard key={template.id} template={template} onTry={onSelect} tryLabel="Use" />
            ))}
          </div>
        </div>

        <Modal.Footer>
          <Modal.FooterCaption>
            {visible.length} template
            {visible.length === 1 ? "" : "s"}
          </Modal.FooterCaption>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}
