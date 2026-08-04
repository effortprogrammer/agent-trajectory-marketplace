import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        /* Figma TextField (node 342:1354): white/5 fill, radius 10, 1.5px lime focus border */
        "h-10 w-full min-w-0 rounded-[10px] border-[1.5px] border-transparent bg-white/5 px-3 py-2 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-white/50 hover:bg-white/10 focus-visible:border-ring focus-visible:bg-white/5 focus-visible:hover:bg-white/5 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
