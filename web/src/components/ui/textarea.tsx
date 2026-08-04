import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        /* Figma TextArea (node 2134:76): white/5 fill, radius 12, min-h 80 */
        "flex field-sizing-content min-h-20 w-full rounded-xl border-[1.5px] border-transparent bg-white/5 px-3 py-2.5 text-base transition-colors outline-none placeholder:text-white/50 hover:bg-white/10 focus-visible:border-ring focus-visible:bg-white/5 focus-visible:hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
