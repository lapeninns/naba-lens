import * as React from "react"

import {
  fieldControlVariants,
  isAriaDisabled,
} from "@/components/ui/field-control"
import { cn } from "@/lib/utils"

type TextareaProps = React.ComponentProps<"textarea">

/*
 * Multi-line text (common-room.md §4 Field, `textarea.input`): the shared field
 * recipe, at least three rows and 120px tall, resized downwards only so it
 * never pushes the page sideways. It has one size.
 *
 * `aria-disabled` keeps it in the focus order and makes it read-only, as on
 * Input (common-room.md §7).
 */
function Textarea({
  className,
  rows = 3,
  readOnly,
  "aria-disabled": ariaDisabled,
  ...props
}: TextareaProps) {
  return (
    <textarea
      data-slot="textarea"
      rows={rows}
      aria-disabled={ariaDisabled}
      readOnly={readOnly || isAriaDisabled(ariaDisabled) || undefined}
      className={cn(
        fieldControlVariants({ size: "md" }),
        // Several lines need more room between them than one line does.
        "block min-h-30 resize-y py-3.5 leading-normal",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
export type { TextareaProps }
