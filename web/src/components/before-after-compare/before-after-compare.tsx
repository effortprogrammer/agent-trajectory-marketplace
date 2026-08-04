"use client";

import type { ComponentProps, KeyboardEvent, PointerEvent, ReactNode } from "react";
import { useCallback, useRef, useState } from "react";
import { ChevronLeft as IconChevronLeftOutlined } from "lucide-react";
import { ChevronRight as IconChevronRightOutlined } from "lucide-react";
import { Icon } from "@higgsfield/quanta/icon";
import { Media } from "@higgsfield/quanta/media";
import { Typography } from "@higgsfield/quanta/typography";
import { cn } from "@/lib/utils";

/**
 * BeforeAfterCompare — a draggable before/after image comparison slider. Quanta
 * ships no compare surface, so this composes Quanta primitives (`Media`, `Icon`,
 * `Typography` + `q-` tokens) into the split-view reveal used by the Higgsfield
 * "Skin Enhancer" app hero: the enhanced (`after`) image fills the frame, the
 * original (`before`) image is clipped to the left of a vertical divider, and a
 * white pill handle (chevron-left / chevron-right) drags the divider across.
 *
 *   <BeforeAfterCompare
 *     beforeSrc={original}
 *     afterSrc={enhanced}
 *     beforeLabel="Original"
 *     afterLabel="Enhanced"
 *   />
 *
 * The handle is a real `role="slider"` control: click / drag anywhere on the
 * frame, or focus the handle and use ←/→ (Home/End for the extremes). Dragging
 * uses pointer capture (no window listeners) and reads geometry only from event
 * handlers, so nothing touches `window` during render / SSR.
 */

export interface BeforeAfterCompareProps {
  /** The "before" image (the original) — revealed on the LEFT of the divider. */
  beforeSrc: string;
  /** The "after" image (the enhanced result) — fills the frame behind the divider. */
  afterSrc: string;
  /** Alt text for the before image. */
  beforeAlt?: string;
  /** Alt text for the after image. */
  afterAlt?: string;
  /** Corner chip over the before (left) side. Set `null` to hide. Default "Before". */
  beforeLabel?: ReactNode;
  /** Corner chip over the after (right) side. Set `null` to hide. Default "After". */
  afterLabel?: ReactNode;
  /** Aspect ratio, forwarded to `Media` (default `square`). */
  ratio?: ComponentProps<typeof Media>["ratio"];
  /** Initial divider position, 0–100 (percent from the left). Default 50. */
  defaultPosition?: number;
  className?: string;
}

const clamp = (value: number) => Math.min(100, Math.max(0, value));

/** A small frosted corner label — "Before" / "After". */
function CompareLabel({ side, children }: { side: "left" | "right"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute top-3 z-10 rounded-q-full bg-q-transparent-dark-60 px-2.5 py-1 backdrop-blur-sm",
        side === "left" ? "left-3" : "right-3",
      )}
    >
      <Typography as="span" variant="caption-xs-medium" color="primary" className="uppercase">
        {children}
      </Typography>
    </span>
  );
}

export function BeforeAfterCompare({
  beforeSrc,
  afterSrc,
  beforeAlt = "Before",
  afterAlt = "After",
  beforeLabel = "Before",
  afterLabel = "After",
  ratio = "square",
  defaultPosition = 50,
  className,
}: BeforeAfterCompareProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [position, setPosition] = useState(() => clamp(defaultPosition));

  const updateFromClientX = useCallback((clientX: number) => {
    const frame = frameRef.current;
    if (frame == null) return;
    const rect = frame.getBoundingClientRect();
    if (rect.width === 0) return;
    setPosition(clamp(((clientX - rect.left) / rect.width) * 100));
  }, []);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromClientX(event.clientX);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    updateFromClientX(event.clientX);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case "ArrowLeft":
        setPosition((p) => clamp(p - 2));
        event.preventDefault();
        break;
      case "ArrowRight":
        setPosition((p) => clamp(p + 2));
        event.preventDefault();
        break;
      case "Home":
        setPosition(0);
        event.preventDefault();
        break;
      case "End":
        setPosition(100);
        event.preventDefault();
        break;
    }
  };

  const rounded = Math.round(position);

  return (
    <div
      ref={frameRef}
      className={cn("relative touch-none select-none overflow-hidden rounded-q-300", className)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Base layer — the enhanced "after" image sets the frame aspect. */}
      <Media ratio={ratio} rounded="none" className="w-full">
        <Media.Image src={afterSrc} alt={afterAlt} draggable={false} />
      </Media>

      {/* Reveal layer — the original "before" image, clipped to the left of the divider. */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
        aria-hidden="true"
      >
        <Media.Image src={beforeSrc} alt="" draggable={false} className="size-full object-cover" />
      </div>

      {beforeLabel != null ? <CompareLabel side="left">{beforeLabel}</CompareLabel> : null}
      {afterLabel != null ? <CompareLabel side="right">{afterLabel}</CompareLabel> : null}

      {/* Divider line + draggable handle. */}
      <div className="pointer-events-none absolute inset-y-0 z-10" style={{ left: `${position}%` }}>
        <span
          className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-white/90 shadow-q-overlay"
          aria-hidden="true"
        />
        <button
          type="button"
          role="slider"
          aria-label="Compare before and after"
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={rounded}
          aria-valuetext={`${rounded}% enhanced`}
          onKeyDown={handleKeyDown}
          className="pointer-events-auto absolute top-1/2 left-1/2 flex h-9 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center rounded-q-full bg-white px-1 text-q-icon-inverse shadow-q-overlay transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-q-border-focus motion-reduce:transition-none motion-reduce:hover:scale-100"
        >
          <Icon as={IconChevronLeftOutlined} size="sm" />
          <Icon as={IconChevronRightOutlined} size="sm" />
        </button>
      </div>
    </div>
  );
}
