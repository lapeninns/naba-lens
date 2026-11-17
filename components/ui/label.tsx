import * as React from "react"
import { cn } from "@/lib/utils"

/*
 * The visible name of a control (common-room.md §4 Field): 17px, weight 700.
 * Use FieldLabel inside a field; FormField wires `htmlFor` for you.
 */
function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-label text-ink select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
