"use client";

import type { ComponentPropsWithRef, ReactElement, ReactNode, Ref } from "react";
import { useRender } from "@base-ui/react/use-render";
import { X as IconCloseOutlined } from "lucide-react";
import { Icon, type IconGlyph } from "@higgsfield/quanta/icon";
import { Media } from "@higgsfield/quanta/media";
import { Typography } from "@higgsfield/quanta/typography";
import { cn } from "@/lib/utils";

/**
 * UploadField — the upload / picker tile shared across every template (Figma SC
 * App Builder image-field, node 3313:51149). Its empty state is an
 * icon-in-a-round-chip over a bold title + muted description; its filled state
 * is a white-ringed media preview with a floating remove (X) button. Quanta
 * primitives (`Icon`, `Media`, `Typography`) + `q-` tokens only.
 *
 * The canonical surface is frosted white-5% glass without an outline, with
 * subtle drop/inset shadows and a raised circular icon chip. Keep all template
 * copies of this file identical.
 *
 * Like every upload surface in the template, the field is ONLY the trigger UI — it
 * must open `AssetLibraryModal` from `@/components/asset-library` (never a custom
 * picker). Pass the empty field as the modal `trigger`, and render the filled
 * field with `preview` + `onRemove` once an asset is picked:
 *
 * ```tsx
 * import { AssetLibraryModal } from '@/components/asset-library'
 * import { UploadField } from '@/components/upload-field'
 * import { Image as IconImageOutlined } from "lucide-react";
 *
 * const [asset, setAsset] = useState<{ src: string, name: string } | null>(null)
 *
 * {asset == null
 *   ? (
 *       <AssetLibraryModal
 *         onSelect={item => setAsset(item)}
 *         trigger={(
 *           <UploadField
 *             render={<button type="button" />}
 *             icon={IconImageOutlined}
 *             title="Upload a reference"
 *             subtitle="PNG or JPG, up to 20MB"
 *           />
 *         )}
 *       />
 *     )
 *   : (
 *       <UploadField
 *         preview={asset.src}
 *         previewAlt={asset.name}
 *         onRemove={() => setAsset(null)}
 *       />
 *     )}
 * ```
 *
 * The host swaps via `render` — keep the default `<div>` for the passive filled
 * tile, or render a `<button>` for the empty trigger (it gains hover + focus
 * affordances from the classes).
 */

export type UploadFieldProps = Omit<ComponentPropsWithRef<"div">, "title"> & {
  /** Leading glyph shown in the round chip above the text (empty state). */
  icon?: IconGlyph;
  /** Bold primary line (empty state). */
  title?: ReactNode;
  /** Muted helper line under the title (empty state). */
  subtitle?: ReactNode;
  /**
   * Filled state. Pass a picked image `src` (rendered as a white-ringed `Media`
   * preview) or a custom node. When set, the icon / title / subtitle empty state
   * is replaced by the preview.
   */
  preview?: ReactNode;
  /** String previews render with the matching Quanta media primitive. */
  previewType?: "image" | "video";
  /** Alt text for the string `preview` image. */
  previewAlt?: string;
  /**
   * Show the floating remove (X) button over the filled tile. Fired when it is
   * clicked. Only rendered together with `preview`.
   */
  onRemove?: () => void;
  /** Swap the host element (e.g. an interactive `<button>` for the modal trigger). */
  render?: ReactElement;
};

export function UploadField({
  icon,
  title,
  subtitle,
  preview,
  previewType = "image",
  previewAlt = "",
  onRemove,
  className,
  render,
  ref,
  ...props
}: UploadFieldProps) {
  const interactive = render != null;
  const filled = preview != null;

  const previewNode =
    typeof preview === "string" ? (
      <div className="overflow-hidden rounded-q-300 border-2 border-white shadow-q-raised">
        <Media ratio="video" rounded="none" className="w-44 max-w-full">
          {previewType === "video" ? (
            <Media.Video src={preview} controls playsInline preload="metadata" />
          ) : (
            <Media.Image src={preview} alt={previewAlt} />
          )}
        </Media>
      </div>
    ) : (
      preview
    );

  return useRender({
    render,
    defaultTagName: "div",
    ref: ref as Ref<Element> | undefined,
    props: {
      className: cn(
        "relative isolate flex min-h-36 flex-1 flex-col items-center justify-center gap-3 overflow-hidden rounded-q-400 px-4 pb-5 pt-6 text-center shadow-[0_2px_4px_-0.5px_rgba(0,0,0,0.12)] transition-[filter] duration-150",
        interactive &&
          "cursor-pointer hover:brightness-110 focus-visible:outline-2 focus-visible:outline-q-border-focus",
        className,
      ),
      children: (
        <>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-[1] rounded-q-400 bg-q-transparent-light-05 backdrop-blur-xl"
          />
          {filled ? (
            <>
              <div className="relative flex items-center justify-center">{previewNode}</div>
              {onRemove != null ? (
                <button
                  type="button"
                  aria-label="Remove"
                  onClick={onRemove}
                  className="absolute right-2 top-2 flex items-center justify-center rounded-q-200 bg-q-transparent-dark-40 p-1.5 backdrop-blur-md transition-colors hover:bg-q-transparent-dark-60 focus-visible:outline-2 focus-visible:outline-q-border-focus"
                >
                  <Icon as={IconCloseOutlined} size="sm" color="primary" />
                </button>
              ) : null}
            </>
          ) : (
            <>
              {icon != null ? (
                <span className="relative flex items-center justify-center rounded-q-full border border-[rgba(197,197,197,0.3)] p-2.5 text-q-icon-primary shadow-[0_20.5px_10.3px_rgba(0,0,0,0.09),0_5px_5.7px_rgba(0,0,0,0.1),inset_0_-0.3px_5.4px_rgba(185,185,185,0.35)]">
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 rounded-q-full bg-q-transparent-light-05"
                  />
                  <Icon as={icon} size="md" className="relative" />
                </span>
              ) : null}
              <div className="relative flex w-full flex-col items-center gap-1">
                {title != null ? (
                  <Typography as="span" variant="body-md-medium" color="primary">
                    {title}
                  </Typography>
                ) : null}
                {subtitle != null ? (
                  <Typography as="span" variant="body-sm-medium" color="secondary">
                    {subtitle}
                  </Typography>
                ) : null}
              </div>
            </>
          )}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_2px_3px_rgba(255,255,255,0.05)]"
          />
        </>
      ),
      ...props,
    },
  });
}
