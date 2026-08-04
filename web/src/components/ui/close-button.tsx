import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/* Figma CloseButton (node 2052:109): outer 24/32/40/48 = inner circle + 4px focus gap */
const closeButtonVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-full bg-white/5 text-foreground transition-colors outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      size: {
        sm: "size-4 [&_svg]:size-3",
        md: "size-6 [&_svg]:size-4",
        lg: "size-8 [&_svg]:size-5",
        xl: "size-10 [&_svg]:size-6",
      },
    },
    defaultVariants: {
      size: "md",
    },
  }
)

function CloseButton({
  className,
  size = "md",
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof closeButtonVariants>) {
  return (
    <button
      type="button"
      data-slot="close-button"
      data-size={size}
      className={cn(closeButtonVariants({ size, className }))}
      {...props}
    >
      <XIcon />
      <span className="sr-only">Close</span>
    </button>
  )
}

export { CloseButton, closeButtonVariants }
