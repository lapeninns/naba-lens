"use client"

import { Separator as SeparatorPrimitive } from "@base-ui/react/separator"
import { cn } from "@/lib/utils"

/** A hairline between two groups (common-room.md §2 Boundaries). Decoration: `line`, never a control's edge. */
function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        "shrink-0 bg-line data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
