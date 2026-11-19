import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import {
  fieldControlVariants,
  isAriaDisabled,
  type FieldControlSize,
} from "@/components/ui/field-control"
import { cn } from "@/lib/utils"

type InputProps = Omit<React.ComponentProps<"input">, "size"> & {
  /** sm 44px, md 48px (default), lg 48px. Replaces the native character-count `size`. */
  size?: FieldControlSize
}

/*
 * Text input (v2 Field): the shared field recipe, at least 48px
 * tall and full width. Put it in a FormField so it has a label, and so its
 * hint and error are linked.
 *
 * Prefer `aria-disabled` to `disabled` (common-room.md §7): the field stays in the
 * focus order, so the reason beside it can be reached. It is made read-only
 * here, because `aria-disabled` alone does not stop typing.
 */
function Input({
  className,
  type,
  size = "md",
  readOnly,
  "aria-disabled": ariaDisabled,
  ...props
}: InputProps) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      data-size={size}
      aria-disabled={ariaDisabled}
      readOnly={readOnly || isAriaDisabled(ariaDisabled) || undefined}
      className={cn(
        fieldControlVariants({ size }),
        // A file input's own button, drawn as a small grey control.
        "file:mr-3 file:inline-flex file:h-9 file:rounded-control file:border-0 file:bg-surface file:px-3 file:text-label file:text-ink",
        className
      )}
      {...props}
    />
  )
}

export { Input }
export type { InputProps }
