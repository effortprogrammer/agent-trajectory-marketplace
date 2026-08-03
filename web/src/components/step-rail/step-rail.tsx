"use client";

import type { ReactElement, ReactNode } from "react";
import { useRender } from "@base-ui/react/use-render";
import { Check as IconCheckOutlined } from "lucide-react";
import { Icon } from "@higgsfield/quanta/icon";
import { Typography } from "@higgsfield/quanta/typography";
import { cn } from "@/lib/utils";

/**
 * StepRail — a horizontal numbered step indicator for short in-app wizards
 * (modeled on the Higgsfield "Shots" app header: `1 Upload — 2 Grid — 3
 * Upscale`). Quanta ships no stepper, so this composes Quanta primitives
 * (`Icon`, `Typography`) + `q-` tokens into the numbered-badge / connector row.
 *
 * It is IN-APP navigation, not an app header (the Higgsfield host owns the top
 * chrome): a row of numbered badges joined by connector lines. Completed steps
 * show a brand check, the current step a brand-filled number, upcoming steps a
 * muted number. Pass `reachable` to make already-unlocked steps clickable via
 * `onStepChange`; steps outside it render as disabled markers.
 *
 *   <StepRail
 *     steps={[{ id: 'upload', label: 'Upload' }, …]}
 *     current={step}
 *     reachable={['upload', 'grid']}
 *     onStepChange={setStep}
 *   />
 *
 * The host element is swappable via `render` (Base UI `useRender`) for semantics
 * like `<nav>`.
 */

export interface StepRailStep {
  /** Stable id used for selection + React keys. */
  id: string;
  /** Label shown beside the number badge. */
  label: ReactNode;
}

export interface StepRailProps {
  /** Ordered steps, left → right. */
  steps: StepRailStep[];
  /** The active step id. */
  current: string;
  /**
   * Ids the user may jump to (already unlocked). When set, only these steps are
   * clickable; the rest render as passive markers. Omit to make every step
   * clickable.
   */
  reachable?: string[];
  /** Fired when a reachable step is clicked. */
  onStepChange?: (id: string) => void;
  /** Swap the host element (defaults to a `<nav>`). */
  render?: ReactElement;
  className?: string;
}

interface StepBadgeProps {
  index: number;
  state: "complete" | "current" | "upcoming";
}

/** The numbered circle — brand check (complete), brand number (current), muted (upcoming). */
function StepBadge({ index, state }: StepBadgeProps) {
  return (
    <span
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-q-full text-q-body-sm-semi-bold transition-colors",
        state === "upcoming"
          ? "bg-q-transparent-light-10 text-q-text-secondary"
          : "bg-q-brand-primary text-q-text-inverse",
      )}
    >
      {state === "complete" ? <Icon as={IconCheckOutlined} size="sm" /> : index + 1}
    </span>
  );
}

export function StepRail({
  steps,
  current,
  reachable,
  onStepChange,
  render,
  className,
}: StepRailProps) {
  const currentIndex = steps.findIndex((step) => step.id === current);

  const content = steps.map((step, index) => {
    const state =
      index < currentIndex ? "complete" : index === currentIndex ? "current" : "upcoming";
    const canClick = onStepChange != null && (reachable == null || reachable.includes(step.id));

    return (
      <div key={step.id} className="flex min-w-0 items-center gap-3">
        {index > 0 ? (
          <span
            aria-hidden
            className={cn(
              "h-px w-6 shrink-0 transition-colors sm:w-12",
              index <= currentIndex ? "bg-q-brand-primary" : "bg-q-border-subtle",
            )}
          />
        ) : null}
        <button
          type="button"
          disabled={!canClick}
          aria-current={state === "current" ? "step" : undefined}
          onClick={canClick ? () => onStepChange?.(step.id) : undefined}
          className={cn(
            "flex items-center gap-2 rounded-q-full px-1 py-0.5 transition-opacity",
            canClick
              ? "cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-q-border-focus"
              : "cursor-default",
            state === "upcoming" && "opacity-70",
          )}
        >
          <StepBadge index={index} state={state} />
          <Typography
            as="span"
            variant="body-sm-semi-bold"
            color={state === "upcoming" ? "secondary" : "primary"}
            className="hidden truncate sm:inline"
          >
            {step.label}
          </Typography>
        </button>
      </div>
    );
  });

  return useRender({
    render,
    defaultTagName: "nav",
    props: {
      "aria-label": "Progress",
      className: cn("flex items-center justify-center", className),
      children: content,
    },
  });
}
