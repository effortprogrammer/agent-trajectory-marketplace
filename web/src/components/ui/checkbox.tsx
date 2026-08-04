import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { CheckIcon, MinusIcon } from "lucide-react"

/* Figma Checkbox (page 478:1123): 18/20/24px box, radius 6, brand (lime) or white fill */
const checkboxVariants = cva(
  "peer relative grid shrink-0 place-content-center rounded-[6px] border border-white/20 transition-colors outline-none group-has-disabled/field:opacity-40 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-40 data-checked:border-transparent data-indeterminate:border-transparent aria-invalid:border-destructive",
  {
    variants: {
      size: {
        sm: "size-[18px] [&_svg]:size-3.5",
        md: "size-5 [&_svg]:size-4",
        lg: "size-6 [&_svg]:size-[18px]",
      },
      tone: {
        brand:
          "hover:border-primary/50 focus-visible:ring-primary/20 data-checked:bg-primary data-checked:text-primary-foreground data-indeterminate:bg-primary data-indeterminate:text-primary-foreground",
        white:
          "hover:border-white/50 focus-visible:ring-white/20 data-checked:bg-white data-checked:text-[#131517] data-indeterminate:bg-white data-indeterminate:text-[#131517]",
      },
    },
    defaultVariants: {
      size: "sm",
      tone: "brand",
    },
  }
)

function Checkbox({
  className,
  size = "sm",
  tone = "brand",
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root> &
  VariantProps<typeof checkboxVariants>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      data-size={size}
      data-tone={tone}
      className={cn(checkboxVariants({ size, tone, className }))}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        {props.checked === "indeterminate" ? (
          <MinusIcon strokeWidth={3} />
        ) : (
          <CheckIcon strokeWidth={3} />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox, checkboxVariants }
