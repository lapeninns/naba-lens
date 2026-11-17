"use client"

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/*
 * One segment of a segmented control (common-room.md §4): muted words on the grey
 * track, and the chosen one raised (white fill, control shadow, 1.5px strong
 * edge). The chosen state is read from `aria-checked` (a radio, in
 * SegmentedControl) or `aria-pressed` (a Toggle). Labels wrap. The 1.5px edge
 * has no recipe, so this string is written once, here, and shared.
 */
const segmentClass =
  "group/segment inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-round bg-transparent px-3 py-1 text-center text-label [overflow-wrap:anywhere] text-ink-muted focus-ring transition-[background-color,color,box-shadow] duration-quick outline-none not-data-disabled:hover:text-ink not-data-disabled:not-aria-checked:not-aria-pressed:hover:bg-raised not-data-disabled:not-aria-checked:not-aria-pressed:active:bg-raised aria-checked:bg-surface aria-checked:text-ink aria-checked:shadow-control aria-checked:ring-[1.5px] aria-checked:ring-edge-strong aria-pressed:bg-surface aria-pressed:text-ink aria-pressed:shadow-control aria-pressed:ring-[1.5px] aria-pressed:ring-edge-strong data-disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5"

/*
 * Internal. Toggle and ToggleGroup are the older multi-purpose pair, kept
 * for components/nabalens/library-filters.tsx until it moves over. New code
 * uses SegmentedControl (one choice, radio semantics) or FilterPill (a
 * filter that is on or off). The variant and size names here predate the
 * primitive contract and are not part of it.
 */
const toggleVariants = cva("aria-invalid:edge-invalid", {
  variants: {
    variant: {
      default: `${segmentClass} disabled:opacity-60`,
      outline:
        "group/toggle inline-flex items-center justify-center gap-1.5 rounded-round bg-surface-2 text-center text-label [overflow-wrap:anywhere] text-ink focus-ring transition-[background-color,box-shadow] duration-quick outline-none hover:bg-raised disabled:pointer-events-none disabled:opacity-60 aria-pressed:bg-accent-soft aria-pressed:edge-selected [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
    },
    // A 44px floor at every width that grows when the label wraps.
    size: {
      default:
        "min-h-11 min-w-11 px-3.5 py-1.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
      sm: "min-h-11 min-w-11 px-3 py-1 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-4.5",
      lg: "min-h-12 min-w-12 px-4 py-1.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
})

/** Internal: see the note on `toggleVariants`. */
function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      data-variant={variant}
      data-size={size}
      className={cn(toggleVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { segmentClass, Toggle, toggleVariants }
