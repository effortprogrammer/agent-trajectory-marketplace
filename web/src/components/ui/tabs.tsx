"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

/*
 * Figma Segmented Control (node 3330:741) + Tabs (node 3448:624).
 * variant: glass|flat|bare = segmented surfaces, underline = tabs with
 * baseline divider. size/shape/tone are forwarded to triggers as data attrs.
 */
const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
        underline:
          "rounded-none border-b border-white/5 bg-transparent p-0 group-data-horizontal/tabs:h-auto",
        glass:
          "border border-white/5 bg-white/5 shadow-[0_2px_4px_-0.5px_rgba(0,0,0,0.12),inset_0_2px_3px_0_rgba(255,255,255,0.05)] backdrop-blur-xl group-data-horizontal/tabs:h-auto",
        flat: "border border-white/5 bg-white/5 group-data-horizontal/tabs:h-auto",
        bare: "bg-transparent p-0 group-data-horizontal/tabs:h-auto",
      },
      size: {
        sm: "",
        md: "",
      },
      shape: {
        rounded: "",
        pill: "",
      },
      tone: {
        subtle: "",
        solid: "",
        "brand-soft": "",
        brand: "",
      },
    },
    compoundVariants: [
      { variant: ["glass", "flat"], size: "md", className: "gap-1.5 rounded-2xl p-1.5" },
      { variant: ["glass", "flat"], size: "sm", className: "gap-1 rounded-xl p-1" },
      { variant: ["glass", "flat"], shape: "pill", className: "rounded-full" },
      { variant: ["bare", "underline"], size: "md", className: "gap-1.5" },
      { variant: ["bare", "underline"], size: "sm", className: "gap-1" },
    ],
    defaultVariants: {
      variant: "default",
      size: "md",
      shape: "rounded",
      tone: "subtle",
    },
  }
)

const SEGMENTED = ["glass", "flat", "bare"]

function TabsList({
  className,
  variant = "default",
  size = "md",
  shape = "rounded",
  tone = "subtle",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      data-size={size}
      data-shape={shape}
      data-tone={tone}
      {...(SEGMENTED.includes(variant!) && { "data-segmented": "" })}
      className={cn(tabsListVariants({ variant, size, shape, tone }), className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        /* segmented (glass|flat|bare): Figma _Segment (node 3326:699) */
        "group-data-segmented/tabs-list:flex-none group-data-segmented/tabs-list:text-white/50 group-data-segmented/tabs-list:hover:text-white group-data-segmented/tabs-list:data-active:border-transparent group-data-segmented/tabs-list:data-active:bg-transparent group-data-segmented/tabs-list:data-active:text-white group-data-segmented/tabs-list:data-active:shadow-none",
        "group-data-segmented/tabs-list:group-data-[size=md]/tabs-list:h-10 group-data-segmented/tabs-list:group-data-[size=md]/tabs-list:rounded-[10px] group-data-segmented/tabs-list:group-data-[size=md]/tabs-list:px-3 group-data-segmented/tabs-list:group-data-[size=md]/tabs-list:text-sm group-data-segmented/tabs-list:group-data-[size=md]/tabs-list:has-[>svg:only-child]:w-10 group-data-segmented/tabs-list:group-data-[size=md]/tabs-list:has-[>svg:only-child]:px-0 group-data-segmented/tabs-list:group-data-[size=md]/tabs-list:[&_svg:not([class*='size-'])]:size-5",
        "group-data-segmented/tabs-list:group-data-[size=sm]/tabs-list:h-8 group-data-segmented/tabs-list:group-data-[size=sm]/tabs-list:rounded-lg group-data-segmented/tabs-list:group-data-[size=sm]/tabs-list:gap-1 group-data-segmented/tabs-list:group-data-[size=sm]/tabs-list:px-2 group-data-segmented/tabs-list:group-data-[size=sm]/tabs-list:text-xs group-data-segmented/tabs-list:group-data-[size=sm]/tabs-list:has-[>svg:only-child]:w-8 group-data-segmented/tabs-list:group-data-[size=sm]/tabs-list:has-[>svg:only-child]:px-0",
        "group-data-segmented/tabs-list:group-data-[shape=pill]/tabs-list:rounded-full",
        /* selected fills by tone (segmented only) */
        "group-data-segmented/tabs-list:group-data-[tone=subtle]/tabs-list:data-active:glass-sheen group-data-segmented/tabs-list:group-data-[tone=subtle]/tabs-list:data-active:border-white/5 group-data-segmented/tabs-list:group-data-[tone=subtle]/tabs-list:data-active:shadow-[0_2px_2px_rgba(0,0,0,0.12),inset_0_2px_3px_0_rgba(255,255,255,0.05)]",
        "group-data-segmented/tabs-list:group-data-[tone=solid]/tabs-list:data-active:bg-white group-data-segmented/tabs-list:group-data-[tone=solid]/tabs-list:data-active:text-[#131517]",
        "group-data-segmented/tabs-list:group-data-[tone=brand-soft]/tabs-list:data-active:bg-primary/15 group-data-segmented/tabs-list:group-data-[tone=brand-soft]/tabs-list:data-active:text-primary",
        "group-data-segmented/tabs-list:group-data-[tone=brand]/tabs-list:data-active:bg-primary group-data-segmented/tabs-list:group-data-[tone=brand]/tabs-list:data-active:text-primary-foreground",
        /* underline: Figma Tabs (node 3448:624) + _Tab (node 3437:354) */
        "group-data-[variant=underline]/tabs-list:h-auto group-data-[variant=underline]/tabs-list:flex-none group-data-[variant=underline]/tabs-list:rounded-none group-data-[variant=underline]/tabs-list:border-0 group-data-[variant=underline]/tabs-list:text-[#626262] group-data-[variant=underline]/tabs-list:hover:text-foreground group-data-[variant=underline]/tabs-list:data-active:border-transparent group-data-[variant=underline]/tabs-list:data-active:bg-transparent group-data-[variant=underline]/tabs-list:data-active:text-white group-data-[variant=underline]/tabs-list:data-active:shadow-none group-data-[variant=underline]/tabs-list:after:bg-white group-data-[variant=underline]/tabs-list:group-data-horizontal/tabs:after:bottom-0 group-data-[variant=underline]/tabs-list:data-active:after:opacity-100",
        "group-data-[variant=underline]/tabs-list:group-data-[size=md]/tabs-list:px-2 group-data-[variant=underline]/tabs-list:group-data-[size=md]/tabs-list:py-5 group-data-[variant=underline]/tabs-list:group-data-[size=md]/tabs-list:text-base",
        "group-data-[variant=underline]/tabs-list:group-data-[size=sm]/tabs-list:px-1.5 group-data-[variant=underline]/tabs-list:group-data-[size=sm]/tabs-list:py-4 group-data-[variant=underline]/tabs-list:group-data-[size=sm]/tabs-list:text-sm",
        "group-data-[variant=underline]/tabs-list:group-data-[tone=brand]/tabs-list:data-active:bg-transparent group-data-[variant=underline]/tabs-list:group-data-[tone=brand]/tabs-list:data-active:text-primary group-data-[variant=underline]/tabs-list:group-data-[tone=brand]/tabs-list:after:bg-primary",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
