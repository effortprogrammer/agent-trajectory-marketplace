import type { ReactNode } from "react";
import { Typography } from "@higgsfield/quanta/typography";
import { cn as cx } from "@/lib/utils";

export interface ScreenEmptyStateContent {
  images: readonly [string, string, string];
  title: ReactNode;
  description: ReactNode;
}

export interface ScreenEmptyStateProps extends ScreenEmptyStateContent {
  action?: ReactNode;
  className?: string;
}

/**
 * Shared full-screen empty state from SC App Builder (Figma 3543:3851).
 * The preview must use representative generations from the current app.
 */
export function ScreenEmptyState({
  images,
  title,
  description,
  action,
  className,
}: ScreenEmptyStateProps) {
  return (
    <div
      className={cx(
        "relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-q-background-primary px-6 py-12 text-center",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.08) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          maskImage: "radial-gradient(ellipse 70% 65% at 50% 50%, #000 0%, transparent 78%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 70% 65% at 50% 50%, #000 0%, transparent 78%)",
        }}
      />

      <div className="relative flex w-full max-w-[444px] flex-col items-center gap-6">
        <div className="relative h-[105px] w-full max-w-[444px]" aria-hidden>
          <div className="absolute left-0 top-2.5 h-[85px] w-[38%] overflow-hidden rounded-q-400 opacity-70">
            <img src={images[0]} alt="" className="size-full object-cover" />
            <span className="absolute inset-0 bg-q-transparent-dark-30" />
          </div>
          <div className="absolute right-0 top-2.5 h-[85px] w-[38%] overflow-hidden rounded-q-400 opacity-70">
            <img src={images[2]} alt="" className="size-full object-cover" />
            <span className="absolute inset-0 bg-q-transparent-dark-30" />
          </div>
          <div className="absolute inset-y-0 left-1/2 z-[1] w-[41.5%] -translate-x-1/2 overflow-hidden rounded-[20px] border border-q-border-subtle bg-q-transparent-light-05 shadow-[inset_0_0_20px_rgba(255,255,255,0.48),0_8px_24px_rgba(0,0,0,0.24)]">
            <img src={images[1]} alt="" className="size-full object-cover" />
          </div>
        </div>

        <div className="flex flex-col items-center gap-1">
          <Typography as="h2" variant="body-md-semi-bold" color="primary">
            {title}
          </Typography>
          <Typography as="p" variant="body-sm-regular" color="tertiary">
            {description}
          </Typography>
        </div>

        {action != null ? <div className="flex items-center justify-center">{action}</div> : null}
      </div>
    </div>
  );
}
