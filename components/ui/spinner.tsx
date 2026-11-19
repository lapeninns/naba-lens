import { SpinnerGapIcon } from "@phosphor-icons/react/dist/ssr"
import { cva } from "class-variance-authority"

import { cn } from "@/lib/utils"

/*
 * The one spinner (common-room.md §7: a state is always written in words). The
 * glyph is decoration and hidden from assistive technology; the words beside
 * it say what is happening. Where no words are on screen, pass `label` and
 * it is read out as a status. Reduced motion stops the turn (app/globals.css).
 */
const spinnerVariants = cva("shrink-0 motion-safe:animate-spin", {
  variants: {
    size: {
      sm: "size-4.5",
      md: "size-5",
      lg: "size-6",
    },
  },
  defaultVariants: { size: "md" },
})

type SpinnerSize = "sm" | "md" | "lg"

type SpinnerProps = Omit<
  React.ComponentProps<typeof SpinnerGapIcon>,
  "size" | "children"
> & {
  /** sm 18px, md 20px (default), lg 24px. */
  size?: SpinnerSize
  /** Read out as a status when no visible words say what is loading. */
  label?: string
}

function Spinner({ size = "md", label, className, ...props }: SpinnerProps) {
  const glyph = (
    <SpinnerGapIcon
      aria-hidden
      data-slot="spinner"
      data-size={size}
      className={cn(spinnerVariants({ size }), className)}
      {...props}
    />
  )
  if (label === undefined) return glyph
  return (
    <span data-slot="spinner-status" role="status" className="inline-flex">
      {glyph}
      <span className="sr-only">{label}</span>
    </span>
  )
}

export { Spinner }
export type { SpinnerProps, SpinnerSize }
