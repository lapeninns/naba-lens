import Link from "next/link"

import { buttonVariants, type ButtonLook } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/*
 * A link that looks like a button (common-room.md §4): same variants, sizes and
 * data attributes as Button, but a real `<a>`, because it goes somewhere
 * rather than doing something. A link cannot be disabled: when the
 * destination is not available, show the reason in place of the link.
 */
type LinkButtonProps = Omit<React.ComponentProps<typeof Link>, "className"> &
  ButtonLook & {
    /** Layout only: width, margin, alignment. */
    className?: string
  }

function LinkButton({
  className,
  variant = "secondary",
  size = "md",
  ...props
}: LinkButtonProps) {
  return (
    <Link
      data-slot="link-button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { LinkButton }
export type { LinkButtonProps }
