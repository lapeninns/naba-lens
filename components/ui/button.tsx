import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/*
 * Common Room buttons (DESIGN.md §4). One enabled primary per screen: solid
 * blue, white text. Everything else is a grey button (secondary), a quiet
 * ghost or a link. A disabled button keeps its label, goes grey and stays
 * readable (say why beside it); prefer aria-disabled so it keeps focus.
 */
const DISABLED =
  "disabled:bg-surface-2 disabled:text-ink-muted disabled:shadow-[inset_0_0_0_1.5px_var(--line)] aria-disabled:bg-surface-2 aria-disabled:text-ink-muted aria-disabled:shadow-[inset_0_0_0_1.5px_var(--line)]"
const PRIMARY = `bg-accent text-on-accent hover:bg-accent-hover ${DISABLED}`
const SECONDARY = `bg-surface-2 text-ink hover:bg-raised active:bg-raised aria-expanded:bg-raised ${DISABLED}`
const QUIET =
  "bg-transparent text-ink hover:bg-surface-2 active:bg-raised aria-expanded:bg-surface-2 disabled:text-ink-muted aria-disabled:text-ink-muted"
// Danger: warn tint with a warn edge; the safe choice sits beside it in grey.
const DANGER = `bg-warn-bg text-warn-fg shadow-[inset_0_0_0_1.5px_var(--warn-fg)] hover:shadow-[inset_0_0_0_2.5px_var(--warn-fg)] ${DISABLED}`
const DANGER_QUIET =
  "bg-transparent text-warn-fg hover:bg-warn-bg disabled:text-ink-muted aria-disabled:text-ink-muted"
const LINK =
  "h-auto min-h-0 border-0 bg-transparent px-0 font-bold text-ink underline decoration-[1.5px] underline-offset-4 hover:decoration-[3px] max-md:min-h-11"

/*
 * Sizes (DESIGN.md §2): button 52px, XL 60px, sm 44px (the target floor, for
 * actions inside notices, rows and tables). Every size keeps a 44px target at
 * every width; labels wrap rather than push a 320px page sideways.
 * `default` and `touch` are the same 52px button; `lg` is the 60px XL.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2.5 rounded-control border border-transparent bg-clip-padding text-center font-sans text-button font-bold text-balance transition-[background-color,box-shadow,color] duration-(--duration-quick) ease-(--ease-out) outline-none select-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid active:translate-y-px disabled:cursor-not-allowed disabled:active:translate-y-0 aria-busy:cursor-progress aria-disabled:cursor-not-allowed aria-disabled:active:translate-y-0 aria-invalid:shadow-[inset_0_0_0_2px_var(--warn-fg)] motion-reduce:active:translate-y-0 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[22px]",
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
        default: "min-h-13 px-5 py-2",
        touch: "min-h-13 px-5 py-2",
        lg: "min-h-15 px-6 py-2 text-[1.1875rem]",
        sm: "min-h-11 px-3.5 py-1.5 text-label [&_svg:not([class*='size-'])]:size-5",
        xs: "min-h-11 gap-1.5 px-2.5 py-1 text-label [&_svg:not([class*='size-'])]:size-[18px]",
        icon: "size-11 text-ink-muted hover:text-ink",
        "icon-xs": "size-11 [&_svg:not([class*='size-'])]:size-[18px]",
        "icon-sm": "size-11",
        "icon-lg": "size-12",
      },
    },
    compoundVariants: [
      // A link button is text-sized wherever it sits; only its phone target grows.
      {
        variant: "link",
        className: "h-auto min-h-0 px-0 py-0 md:h-auto md:min-h-0",
      },
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
