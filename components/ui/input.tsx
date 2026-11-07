import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        // Common Room field: 56px, 8px radius, grey fill, a 1px strong inset edge;
        // invalid is a 2px warn edge and the error under it carries icon + words.
        "h-14 w-full min-w-0 rounded-control border-0 bg-surface-2 px-4 py-2 text-[1.125rem] leading-snug text-ink shadow-[inset_0_0_0_1px_var(--border-strong)] transition-[box-shadow,background-color] outline-none file:mr-3 file:inline-flex file:h-9 file:rounded-control file:border-0 file:bg-surface file:px-3 file:text-label file:text-ink placeholder:text-ink-muted placeholder:opacity-100 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid disabled:cursor-not-allowed disabled:text-ink-muted disabled:shadow-[inset_0_0_0_1px_var(--line)] aria-invalid:shadow-[inset_0_0_0_2px_var(--warn-fg)]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
