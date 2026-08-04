"use client";

import type { ComponentProps, ReactElement, ReactNode, Ref } from "react";
import { useRender } from "@base-ui/react/use-render";
import { Loader } from "@higgsfield/quanta/loader";
import { Media } from "@higgsfield/quanta/media";
import { Typography } from "@higgsfield/quanta/typography";
import { cn as cx } from "@/lib/utils";

/**
 * GenerationCard — a single generation result tile for feed / history grids
 * (Figma Supercomputer-2 "Feed/Card" 2001:84301 + Cinema-Studio-V4 generating
 * state 20037:25838). It composes `Media` (a fixed-ratio, radius/300 clipped
 * box) into the two states a generation moves through:
 *
 *   • `ready` (default) — the finished asset: a cover `Media.Image` (or any
 *     custom `media` node — e.g. a `Media.Video`), with an optional bottom
 *     `title` over the media scrim.
 *   • `generating` — the in-progress placeholder: a dark canvas with a brand
 *     gradient glow pulsing at the TOP of the card and a "Generating" status
 *     pill (spinner + brand label). The pulse is a CSS animation that honors
 *     `prefers-reduced-motion`.
 *
 *   <GenerationCard src={cover} alt="Pool float" />
 *   <GenerationCard state="generating" ratio="portrait" />
 *
 * Tokens only, composition-first: `media` swaps the default image, `children`
 * compose extra overlays inside the frame, and the host element is swappable via
 * `render` (Base UI `useRender`) for clickable tiles.
 */

export type GenerationCardState = "ready" | "generating";

export type GenerationCardProps = Omit<ComponentProps<"div">, "title"> & {
  /** Lifecycle state — `ready` shows the asset, `generating` the pulsing placeholder. */
  state?: GenerationCardState;
  /** Image source for the default `Media.Image` (ready state). Ignored when `media` is set. */
  src?: string;
  /** Alt text for the default image. */
  alt?: string;
  /** Aspect ratio, forwarded to `Media` (default `video`). */
  ratio?: ComponentProps<typeof Media>["ratio"];
  /** Custom media node (a `Media.Video`, a fallback…) instead of the default image. */
  media?: ReactNode;
  /** Optional bottom title, over the media scrim. Ready state only. */
  title?: ReactNode;
  /** Status pill label shown while generating. Default `Generating`. */
  generatingLabel?: ReactNode;
  /** Extra overlay content composed inside the frame. */
  children?: ReactNode;
  /** Swap the host element — `<button>`/`<a>`/`<Link>` for clickable tiles. */
  render?: ReactElement;
  ref?: Ref<Element>;
};

/** The pulsing top glow + "Generating" status pill (Cinema-Studio-V4 20037:25838). */
function GeneratingOverlay({ label }: { label: ReactNode }) {
  return (
    <span className="q-generation-card-generating">
      <span className="q-generation-card-glow" aria-hidden="true" />
      <span className="q-generation-card-status">
        {/* Loader owns role="status" + aria-label; the label text is its visible echo. */}
        <Loader
          variant="circle"
          size="xs"
          color="brand"
          aria-label={typeof label === "string" ? label : "Generating"}
        />
        <Typography as="span" variant="body-sm-medium" color="brand" aria-hidden="true">
          {label}
        </Typography>
      </span>
    </span>
  );
}

function GenerationCard({
  state = "ready",
  src,
  alt = "",
  ratio = "video",
  media,
  title,
  generatingLabel = "Generating",
  className,
  children,
  render,
  ref,
  ...props
}: GenerationCardProps) {
  const generating = state === "generating";

  const content = (
    <>
      <Media ratio={ratio} rounded="md" className="q-generation-card-media">
        {generating
          ? (media ?? <Media.Fallback className="q-generation-card-canvas" />)
          : (media ?? (src != null ? <Media.Image src={src} alt={alt} /> : <Media.Fallback />))}
      </Media>
      {!generating && title != null ? (
        <Media.Overlay placement="bottom" className="q-generation-card-caption">
          <Typography
            as="span"
            variant="body-sm-semi-bold"
            color="primary"
            className="q-generation-card-title"
          >
            {title}
          </Typography>
        </Media.Overlay>
      ) : null}
      {generating ? <GeneratingOverlay label={generatingLabel} /> : null}
      {children}
    </>
  );

  return useRender({
    render,
    defaultTagName: "div",
    ref: ref as Ref<Element> | undefined,
    props: {
      className: cx("q-generation-card", className),
      "data-state": state,
      children: content,
      ...props,
    },
  });
}

export { GenerationCard };
