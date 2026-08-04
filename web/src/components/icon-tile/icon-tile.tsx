"use client";

import type { ComponentPropsWithRef } from "react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { icon } from "@higgsfield/quanta/icon";
import { cn as cx } from "@/lib/utils";

export type IconTileGradient =
  | "blue"
  | "teal"
  | "purple"
  | "pink"
  | "orange"
  | "green"
  | "red"
  | "indigo";

export const ICON_TILE_GRADIENT: Record<IconTileGradient, string> = {
  blue: "linear-gradient(135deg, rgb(65, 136, 190) 0%, rgb(14, 39, 114) 100%)",
  teal: "linear-gradient(135deg, rgb(81, 226, 224) 3.8675%, rgb(18, 92, 141) 93.451%)",
  purple: "linear-gradient(135deg, rgb(158, 120, 226) 0%, rgb(63, 26, 130) 100%)",
  pink: "linear-gradient(135deg, rgb(226, 110, 178) 0%, rgb(130, 20, 74) 100%)",
  orange: "linear-gradient(135deg, rgb(245, 168, 88) 0%, rgb(168, 66, 18) 100%)",
  green: "linear-gradient(135deg, rgb(104, 205, 128) 0%, rgb(20, 96, 58) 100%)",
  red: "linear-gradient(135deg, rgb(235, 108, 104) 0%, rgb(140, 22, 34) 100%)",
  indigo: "linear-gradient(135deg, rgb(110, 128, 226) 0%, rgb(30, 34, 130) 100%)",
};

export type IconTileProps = ComponentPropsWithRef<"span"> & {
  /** Phosphor glyph; gradient tiles always use its real filled artwork. */
  as: PhosphorIcon;
  gradient?: IconTileGradient | (string & {});
};

export function IconTile({ as, gradient, className, style, ...props }: IconTileProps) {
  const Glyph = as;
  const isGradient = gradient != null;
  const backgroundImage = isGradient
    ? (ICON_TILE_GRADIENT[gradient as IconTileGradient] ?? gradient)
    : undefined;

  return (
    <span
      className={cx(
        "q-icon-tile",
        isGradient ? "q-icon-tile-gradient" : "q-icon-tile-neutral",
        className,
      )}
      style={isGradient ? { backgroundImage, ...style } : style}
      {...props}
    >
      <Glyph
        weight={isGradient ? "fill" : "regular"}
        aria-hidden
        className={cx(
          icon({ size: "sm", color: isGradient ? undefined : "secondary" }),
          "q-icon-tile-glyph",
        )}
      />
    </span>
  );
}
