import type { ReactNode } from "react";
import { Icon, type IconGlyph } from "@higgsfield/quanta/icon";
import { Media } from "@higgsfield/quanta/media";
import { Typography } from "@higgsfield/quanta/typography";
import { cn } from "@/lib/utils";

/**
 * DropzonePreview — the small preview card shown inside a `Dropzone` once a
 * selection is made (Figma App-detail after-selection state, node 3309:83654).
 * Two flavours, chosen by whether `label` is set:
 *
 *   • plain (no `label`) — the uploaded image: a ~100px white-ringed thumbnail
 *     with a raised shadow (the "Upload Image" tile once a photo is picked).
 *   • captioned (`label` set) — the chosen option: a ~88px white-ringed, slightly
 *     tilted card with a blurred dark scrim carrying a glyph + name (the
 *     "Select Animal" tile once an animal is picked).
 *
 * Quanta `Media` / `Icon` / `Typography` + `q-` tokens only.
 */

export interface DropzonePreviewProps {
  /** Preview image source. */
  src: string;
  /** Alt text (defaults to the string `label`, else empty). */
  alt?: string;
  /** Overlay caption — set it for the tilted, scrimmed "selected option" card. */
  label?: ReactNode;
  /** Small glyph shown above the caption in the overlay. */
  icon?: IconGlyph;
  className?: string;
}

export function DropzonePreview({ src, alt, label, icon, className }: DropzonePreviewProps) {
  const captioned = label != null;
  const altText = alt ?? (typeof label === "string" ? label : "");

  return (
    <div
      className={cn(
        "overflow-hidden border-2 border-white",
        captioned ? "size-22 -rotate-4 rounded-q-400" : "size-25 rounded-q-500 shadow-q-raised",
        className,
      )}
    >
      <Media ratio="square" rounded="none" className="size-full">
        <Media.Image src={src} alt={altText} />
        {captioned ? (
          <Media.Overlay
            placement="center"
            className="flex-col gap-1.5 bg-q-transparent-dark-40 px-3 py-2 backdrop-blur-md"
          >
            {icon != null ? <Icon as={icon} size="sm" color="primary" /> : null}
            <Typography
              as="span"
              variant="caption-xs-medium"
              color="primary"
              className="text-center"
            >
              {label}
            </Typography>
          </Media.Overlay>
        ) : null}
      </Media>
    </div>
  );
}
