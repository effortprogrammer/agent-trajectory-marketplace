import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"
import { Spinner } from "@/components/ui/spinner"

/*
 * Figma Marketing Button (node 1533:1490): glossy CTA buttons.
 * Geometry matches the regular Button; the visual layer differs per variant.
 * Hover = white/20 lighten (black/10 darken on the white variant), applied via
 * the ::after overlay. Focus = 2px background gap + 2px lime ring, prepended
 * to each variant's shadow stack. Class strings stay fully literal so the
 * Tailwind scanner can see them.
 */
const marketingButtonVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center overflow-clip font-semibold whitespace-nowrap transition-all outline-none select-none after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "gloss-lime text-[#1a1a1a] shadow-[inset_0_-3px_0_0_#829b19,0_6px_4px_0_rgba(0,0,0,0.25),0_32px_24px_0_rgba(0,0,0,0.15)] hover:after:bg-white/20 focus-visible:shadow-[0_0_0_2px_#131416,0_0_0_4px_#d1fe17,inset_0_-3px_0_0_#829b19,0_6px_4px_0_rgba(0,0,0,0.25),0_32px_24px_0_rgba(0,0,0,0.15)]",
        secondary:
          "bg-white text-[#1a1a1a] shadow-[inset_0_-3px_0_0_rgba(0,0,0,0.32),0_6px_4px_0_rgba(0,0,0,0.25),0_32px_24px_0_rgba(0,0,0,0.15)] hover:after:bg-black/10 focus-visible:shadow-[0_0_0_2px_#131416,0_0_0_4px_#d1fe17,inset_0_-3px_0_0_rgba(0,0,0,0.32),0_6px_4px_0_rgba(0,0,0,0.25),0_32px_24px_0_rgba(0,0,0,0.15)]",
        red: "gloss-pink text-white shadow-[inset_0_-3px_0_0_rgba(0,0,0,0.32),0_6px_4px_0_rgba(0,0,0,0.25),0_32px_24px_0_rgba(0,0,0,0.15)] hover:after:bg-white/20 focus-visible:shadow-[0_0_0_2px_#131416,0_0_0_4px_#d1fe17,inset_0_-3px_0_0_rgba(0,0,0,0.32),0_6px_4px_0_rgba(0,0,0,0.25),0_32px_24px_0_rgba(0,0,0,0.15)]",
        tertiary:
          "border border-white/5 bg-white/5 text-white backdrop-blur-xl shadow-[inset_0_2px_3px_0_rgba(255,255,255,0.05),0_2px_4px_-0.5px_rgba(0,0,0,0.12)] hover:after:bg-white/20 focus-visible:shadow-[0_0_0_2px_#131416,0_0_0_4px_#d1fe17,inset_0_2px_3px_0_rgba(255,255,255,0.05),0_2px_4px_-0.5px_rgba(0,0,0,0.12)]",
        ghost:
          "bg-white/5 text-white backdrop-blur-xl shadow-[inset_0_2px_3px_0_rgba(255,255,255,0.05),0_2px_4px_-0.5px_rgba(0,0,0,0.12)] hover:after:bg-white/20 focus-visible:shadow-[0_0_0_2px_#131416,0_0_0_4px_#d1fe17,inset_0_2px_3px_0_rgba(255,255,255,0.05),0_2px_4px_-0.5px_rgba(0,0,0,0.12)]",
      },
      /* px = container padding + 6px label inset; svg edge margins restore icon padding */
      size: {
        xs: "h-6 min-w-8 gap-1.5 rounded-md px-2.5 text-xs leading-4 [&_svg:first-child]:-ml-1.5 [&_svg:last-child]:-mr-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 min-w-8 gap-1.5 rounded-lg px-3.5 text-sm leading-4 [&_svg:first-child]:-ml-1.5 [&_svg:last-child]:-mr-1.5 [&_svg:not([class*='size-'])]:size-4",
        md: "h-10 min-w-10 gap-1.5 rounded-[10px] px-[18px] text-sm leading-4 [&_svg:first-child]:-ml-1.5 [&_svg:last-child]:-mr-1.5 [&_svg:not([class*='size-'])]:size-5",
        lg: "h-12 min-w-12 gap-1.5 rounded-xl px-[22px] text-base leading-5 [&_svg:first-child]:-ml-1.5 [&_svg:last-child]:-mr-1.5 [&_svg:not([class*='size-'])]:size-6",
        xl: "h-14 min-w-12 gap-1.5 rounded-xl px-[26px] text-lg leading-6 tracking-[-0.4px] [&_svg:first-child]:-ml-1.5 [&_svg:last-child]:-mr-1.5 [&_svg:not([class*='size-'])]:size-6",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
)

function MarketingButton({
  className,
  variant = "primary",
  size = "md",
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof marketingButtonVariants> & {
    asChild?: boolean
    loading?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="marketing-button"
      data-variant={variant}
      data-size={size}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      disabled={disabled || loading}
      className={cn(
        marketingButtonVariants({ variant, size, className }),
        /* loading = "working", not "unavailable": keep full opacity, keep width */
        loading && "pointer-events-none opacity-100!"
      )}
      {...props}
    >
      {/* ponytail: asChild expects a single child, so it skips the spinner overlay */}
      {loading && !asChild ? (
        <>
          <span className="absolute inset-0 z-10 grid place-items-center">
            <Spinner />
          </span>
          <span aria-hidden className="invisible contents">
            {children}
          </span>
        </>
      ) : (
        children
      )}
    </Comp>
  )
}

/* Figma Marketing Button / Special (node 2100:1478): stacked 112px CTA */
const marketingButtonSpecialVariants = cva(
  "relative inline-flex w-28 shrink-0 flex-col items-center justify-center gap-1.5 overflow-clip rounded-xl px-5 py-6 transition-all outline-none select-none after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:transition-colors hover:after:bg-white/20 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "gloss-lime text-[#1a1a1a] shadow-[inset_0_-3px_0_0_rgba(0,0,0,0.32),0_6px_4px_0_rgba(0,0,0,0.25),0_32px_24px_0_rgba(0,0,0,0.15)] focus-visible:shadow-[0_0_0_2px_#131416,0_0_0_4px_#d1fe17,inset_0_-3px_0_0_rgba(0,0,0,0.32),0_6px_4px_0_rgba(0,0,0,0.25),0_32px_24px_0_rgba(0,0,0,0.15)]",
        red: "gloss-pink text-white shadow-[inset_0_-3px_0_0_rgba(0,0,0,0.32),0_6px_4px_0_rgba(0,0,0,0.25),0_32px_24px_0_rgba(0,0,0,0.15)] focus-visible:shadow-[0_0_0_2px_#131416,0_0_0_4px_#d1fe17,inset_0_-3px_0_0_rgba(0,0,0,0.32),0_6px_4px_0_rgba(0,0,0,0.25),0_32px_24px_0_rgba(0,0,0,0.15)]",
      },
    },
    defaultVariants: {
      variant: "primary",
    },
  }
)

function MarketingButtonSpecial({
  className,
  variant = "primary",
  loading = false,
  disabled,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof marketingButtonSpecialVariants> & {
    loading?: boolean
  }) {
  return (
    <button
      data-slot="marketing-button-special"
      data-variant={variant}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      disabled={disabled || loading}
      className={cn(
        marketingButtonSpecialVariants({ variant, className }),
        loading && "pointer-events-none opacity-100!"
      )}
      {...props}
    >
      {loading ? (
        <>
          <span className="absolute inset-0 z-10 grid place-items-center">
            <Spinner className="size-5" />
          </span>
          <span aria-hidden className="invisible contents">
            {children}
          </span>
        </>
      ) : (
        children
      )}
    </button>
  )
}

export {
  MarketingButton,
  MarketingButtonSpecial,
  marketingButtonVariants,
  marketingButtonSpecialVariants,
}
