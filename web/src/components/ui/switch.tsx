"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/* Figma Switch (node 285:266): sm 28×16 / md 40×20 / default 44×24, 2px thumb inset */
function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "md" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full transition-all outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-checked:bg-primary data-unchecked:bg-[#5c626a] data-disabled:cursor-not-allowed data-disabled:opacity-50",
        "data-[size=default]:h-6 data-[size=default]:w-11 data-[size=md]:h-5 data-[size=md]:w-10 data-[size=sm]:h-4 data-[size=sm]:w-7",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block translate-x-0.5 rounded-full bg-white shadow-[0_1px_2px_0_rgba(0,0,0,0.15)] transition-transform data-checked:border data-checked:border-black/12 data-checked:shadow-[0_1px_12px_0_rgba(0,0,0,0.32),0_1px_2px_0_rgba(0,0,0,0.15)]",
          "group-data-[size=default]/switch:size-5 group-data-[size=default]/switch:data-checked:translate-x-[22px] group-data-[size=md]/switch:size-4 group-data-[size=md]/switch:data-checked:translate-x-[22px] group-data-[size=sm]/switch:size-3 group-data-[size=sm]/switch:data-checked:translate-x-3.5"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
