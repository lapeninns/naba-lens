"use client"

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/*
 * Common Room segmented control and select pills (DESIGN.md §4), state in
 * aria-pressed. `default`: a segment (pressed = white, strong edge) for use
 * in a grey track. `outline`: a select pill for filters (pressed =
 * accent-soft with an accent-text inset edge). Labels wrap; nothing scrolls
 * sideways.
 */
const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-1.5 rounded-round text-center text-label leading-tight font-bold whitespace-normal transition-[background-color,color,box-shadow] duration-(--duration-quick) outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid disabled:pointer-events-none disabled:opacity-60 aria-invalid:shadow-[inset_0_0_0_2px_var(--warn-fg)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        default:
          "bg-transparent text-ink-muted hover:bg-raised hover:text-ink aria-pressed:bg-surface aria-pressed:text-ink aria-pressed:shadow-[0_1px_2px_oklch(0.2_0.01_250/0.16),0_0_0_1.5px_var(--border-strong)] data-[pressed]:bg-surface data-[pressed]:text-ink",
        outline:
          "bg-surface-2 text-ink hover:bg-raised aria-pressed:bg-accent-soft aria-pressed:shadow-[inset_0_0_0_1.5px_var(--accent-text)] data-[pressed]:bg-accent-soft",
      },
      // A 44px floor at every width that grows when the label wraps.
      size: {
        default:
          "min-h-11 min-w-11 px-3.5 py-1.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        sm: "min-h-11 min-w-11 px-3 py-1 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-[18px]",
        lg: "min-h-12 min-w-12 px-4 py-1.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
