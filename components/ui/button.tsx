import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const PRIMARY =
  "bg-accent text-on-accent hover:bg-accent-hover disabled:bg-well disabled:text-ink-muted aria-disabled:bg-well aria-disabled:text-ink-muted"
const SECONDARY =
  "border-line-control bg-panel text-ink hover:bg-fill-hover aria-expanded:bg-fill-hover disabled:bg-transparent disabled:text-ink-subtle"
const QUIET =
  "text-ink hover:bg-fill-hover active:bg-fill-press aria-expanded:bg-fill-hover disabled:text-ink-subtle"
const DANGER =
  "bg-negative-fill text-on-negative-fill hover:shadow-[inset_0_0_0_100vmax_rgba(0,0,0,0.08)] disabled:bg-well disabled:text-ink-muted"
const DANGER_QUIET =
  "text-negative hover:bg-negative-soft focus-visible:outline-negative"
const LINK =
  "h-auto min-h-0 border-0 px-0 text-accent-text underline underline-offset-3 max-md:min-h-11"

/*
 * Sizes follow the input device: below md (phones) a button is 52px with the
 * 17px label and the 12px touch radius; from md up it is the 36px control.
 * `sm` stays 44px on phones (the tap-target floor) for actions inside notices
 * and rows. `default` and `lg` are the compact control at every width.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-control border border-transparent bg-clip-padding font-semibold whitespace-nowrap transition-colors duration-(--duration-quick) ease-(--ease-out) outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid disabled:cursor-not-allowed aria-busy:cursor-progress aria-disabled:cursor-not-allowed aria-invalid:border-negative [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px]",
  {
    variants: {
      variant: {
        default: PRIMARY,
        primary: PRIMARY,
        secondary: SECONDARY,
        outline: SECONDARY,
        quiet: QUIET,
        ghost: QUIET,
        danger: DANGER,
        "danger-quiet": DANGER_QUIET,
        destructive: DANGER_QUIET,
        link: LINK,
      },
      size: {
        default: "h-9 px-3.5 text-label",
        lg: "h-9 px-3.5 text-label",
        xs: "h-7 gap-1 px-2 text-meta-strong [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-11 px-4 text-meta-touch font-semibold md:h-8 md:px-2.5 md:text-meta-strong [&_svg:not([class*='size-'])]:size-[18px] md:[&_svg:not([class*='size-'])]:size-4",
        touch:
          "min-h-13 rounded-touch px-5 text-center text-label-touch whitespace-normal text-balance md:h-9 md:min-h-0 md:rounded-control md:px-3.5 md:text-label md:whitespace-nowrap [&_svg:not([class*='size-'])]:size-[22px] md:[&_svg:not([class*='size-'])]:size-[18px]",
        icon: "size-11 text-ink-muted hover:text-ink md:size-9",
        "icon-xs":
          "size-6 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-11 md:size-8",
        "icon-lg": "size-11 md:size-9",
      },
    },
    compoundVariants: [
      // A link button is text-sized wherever it sits; only its phone target grows.
      { variant: "link", className: "h-auto px-0 md:h-auto md:min-h-0" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
