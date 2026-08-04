"use client";

import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * RailFooter — the pinned Generate CTA footer for a creation rail / input panel
 * (the tall `aside.q-card` on the left of the Preset / AI Stylist workspaces).
 *
 * A creation rail scrolls its own content when the chosen input fields are
 * taller than the viewport; the Generate CTA must stay reachable, so it lives
 * in this footer, which is `sticky bottom-0` inside the scrolling rail and
 * backed by a `linear-gradient` scrim (from the rail surface, `q-background-
 * secondary`, up to transparent) so the last fields fade under it instead of
 * being hidden by a hard edge. `mt-auto` makes it settle at the very bottom
 * when everything fits (the scrim then fades over empty space — invisible), and
 * pin over the content when it overflows.
 *
 * Pass the Generate `Button` (with its `{label} {sparkles} {credits}` cost slot)
 * as `children`. The rail itself must be the scroll container — stretch it to
 * the viewport (no `self-start`) and add `overflow-y-auto`:
 *
 *   <aside className={card({ surface: 'solid' }, 'flex flex-col gap-3 overflow-y-auto p-3')}>
 *     …fields…
 *     <RailFooter>
 *       <Button variant="marketingPrimary" size="lg" className="w-full" …>Generate</Button>
 *     </RailFooter>
 *   </aside>
 */
export interface RailFooterProps extends ComponentPropsWithRef<"div"> {
  /** The Generate CTA (a Quanta `marketingPrimary` Button, full-width). */
  children: ReactNode;
}

export function RailFooter({ children, className, ...props }: RailFooterProps) {
  return (
    <div
      className={cn(
        // Pinned to the bottom of the scrolling rail; `mt-auto` drops it to the
        // bottom when content is short. `-mb-3` bleeds past the rail's `p-3`
        // bottom padding so the scrim + CTA sit flush against the card's bottom
        // border instead of floating above it (`pb-3` restores the CTA inset).
        // The gradient scrim (rail surface → transparent) fades the scrolling
        // fields under the CTA.
        "sticky bottom-0 z-10 -mb-3 mt-auto flex flex-col bg-gradient-to-t from-q-background-secondary from-70% to-transparent pt-8 pb-3",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
