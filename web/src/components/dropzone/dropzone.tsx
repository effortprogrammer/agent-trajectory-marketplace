"use client";

import type { ComponentPropsWithRef, ReactElement, ReactNode, Ref } from "react";
import { useRender } from "@base-ui/react/use-render";
import { Icon, type IconGlyph } from "@higgsfield/quanta/icon";
import { Typography } from "@higgsfield/quanta/typography";
import { cn } from "@/lib/utils";

/**
 * Dropzone — the canonical labelled file / picker target (Figma SC App Builder
 * image-field, node 3313:51149). Quanta ships no upload surface, so
 * this composes Quanta primitives (`Icon`, `Typography` + `q-` tokens) into the
 * bordered, centered "icon → title → subtitle" tile the app pages use for
 * "Upload Image" / "Select Animal" style inputs.
 *
 *   <Dropzone icon={IconUpload} title="Upload Image"
 *     subtitle="PNG, JPG or Paste from Clipboard" />
 *
 * `border` picks the outline: `dashed` (the primary upload target, default) or
 * `solid` (a secondary picker). The host element swaps via `render` — keep the
 * default `<div>` for a passive tile or render a `<button>` / `<label>` to make
 * the whole area interactive (it gets hover + focus affordances from the classes).
 *
 * Once something is chosen, pass a `preview` node (typically a `DropzonePreview`)
 * to show the AFTER-SELECTION state (Figma node 3309:83654): the same bordered
 * tile now centered on a small preview card. The tile stays interactive, so
 * clicking it re-opens the picker to change the selection.
 */

export type DropzoneBorder = "dashed" | "solid";

const BORDER_CLASS = {
  dashed: "border-dashed",
  solid: "border-solid",
} satisfies Record<DropzoneBorder, string>;

export type DropzoneProps = Omit<ComponentPropsWithRef<"div">, "title"> & {
  /** Leading glyph shown above the text (a lucide / quanta icon). */
  icon?: IconGlyph;
  /** Bold primary line. */
  title?: ReactNode;
  /** Muted helper line under the title. */
  subtitle?: ReactNode;
  /** Outline style — `dashed` upload target (default) or `solid` picker. */
  border?: DropzoneBorder;
  /**
   * After-selection content. When set, the icon / title / subtitle empty state
   * is replaced by this node (a `DropzonePreview` of the chosen image / option),
   * centered in the same bordered tile.
   */
  preview?: ReactNode;
  /** Swap the host element (e.g. an interactive `<button>` / `<label>`). */
  render?: ReactElement;
};

export function Dropzone({
  icon,
  title,
  subtitle,
  border = "dashed",
  preview,
  className,
  render,
  ref,
  ...props
}: DropzoneProps) {
  const interactive = render != null;

  return useRender({
    render,
    defaultTagName: "div",
    ref: ref as Ref<Element> | undefined,
    props: {
      className: cn(
        "relative isolate flex min-h-40 flex-1 flex-col items-center justify-center gap-3 overflow-hidden rounded-q-400 border-[1.5px] border-q-border-default px-4 pb-5 pt-6 text-center shadow-[0_2px_4px_-0.5px_rgba(0,0,0,0.12)] transition-[filter,border-color] duration-150",
        BORDER_CLASS[border],
        interactive &&
          "cursor-pointer hover:border-q-border-strong hover:brightness-110 focus-visible:outline-2 focus-visible:outline-q-border-focus",
        className,
      ),
      children: (
        <>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-[1] rounded-q-400 bg-q-transparent-light-10 backdrop-blur-xl"
          />
          {preview != null ? (
            <div className="relative flex items-center justify-center">{preview}</div>
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
