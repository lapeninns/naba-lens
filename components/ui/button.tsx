import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { CheckIcon } from "@phosphor-icons/react/dist/ssr"
import { cva, type VariantProps } from "class-variance-authority"

import { hold } from "@/components/ui/button-hold"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

/*
 * Common Room buttons (DESIGN.md §4). One enabled primary per screen: solid
 * blue, white text, and always asked for by name. A bare Button is the grey
 * secondary. Everything else is quiet (no fill), danger or a link. A disabled
 * button keeps its label, goes grey and stays readable (say why beside it).
 */
// The 1.5px hairlines are drawn on the shadow layer: the edge recipes are
// 1px or 2px, and the spec's disabled and danger edges are 1.5px.
const DISABLED =
  "disabled:bg-surface-2 disabled:text-ink-muted disabled:shadow-[inset_0_0_0_1.5px_var(--line)] aria-disabled:bg-surface-2 aria-disabled:text-ink-muted aria-disabled:shadow-[inset_0_0_0_1.5px_var(--line)]"
const DISABLED_TEXT = "disabled:text-ink-muted aria-disabled:text-ink-muted"
// edge-accent: in dark the fill alone is 2.7:1 on a card, so a lighter 1px
// edge marks the boundary. A disabled button draws its own grey edge.
const PRIMARY = `bg-accent text-on-accent edge-accent hover:bg-accent-hover disabled:inset-ring-0 aria-disabled:inset-ring-0 ${DISABLED}`
const SECONDARY = `bg-surface-2 text-ink hover:bg-raised active:bg-raised aria-expanded:bg-raised ${DISABLED}`
const QUIET = `bg-transparent text-ink hover:bg-surface-2 active:bg-raised aria-expanded:bg-surface-2 ${DISABLED_TEXT}`
// A toggle that is on (`aria-pressed`): the selected look of a pill, soft
// accent with the selected edge. Button adds a tick, so it is not told by
// the fill alone. Switched off, it goes grey like any other button and the
// tick stays. Only the grey and quiet buttons are used as toggles, and only
// a button that is given `aria-pressed` carries these classes.
const PRESSED =
  "aria-pressed:bg-accent-soft aria-pressed:edge-selected aria-pressed:hover:bg-accent-soft aria-pressed:active:bg-accent-soft aria-pressed:disabled:inset-ring-0 aria-pressed:aria-disabled:inset-ring-0"
const TOGGLE: Partial<Record<string, string>> = {
  secondary: `${PRESSED} aria-pressed:disabled:bg-surface-2 aria-pressed:aria-disabled:bg-surface-2`,
  quiet: `${PRESSED} aria-pressed:disabled:bg-transparent aria-pressed:aria-disabled:bg-transparent`,
}
// Danger (DESIGN.md §4, components.md "Button"): no fill, warn words and a
// 1.5px warn edge; the warn tint comes on hover and press. The safe choice
// beside it is the filled grey button, so it stays the heavier of the two.
// The spec's second, solid danger has no name in the six variants and is
// not built.
const DANGER = `bg-transparent text-warn-fg shadow-[inset_0_0_0_1.5px_var(--warn-fg)] hover:bg-warn-bg active:bg-warn-bg ${DISABLED}`
const DANGER_QUIET = `bg-transparent text-warn-fg hover:bg-warn-bg ${DISABLED_TEXT}`
const LINK = `h-auto min-h-0 border-0 bg-transparent px-0 font-bold text-ink underline decoration-[1.5px] underline-offset-4 hover:decoration-[3px] max-md:min-h-11 ${DISABLED_TEXT}`
// A link-style action in a row or notice: looks like `link` but keeps the
// 44px target at every width, since tablets and laptops are touched too.
const ROW_LINK = `h-auto min-h-11 border-0 bg-transparent px-0 font-bold text-ink underline decoration-[1.5px] underline-offset-4 hover:decoration-[3px] ${DISABLED_TEXT}`

/*
 * Sizes (DESIGN.md §2): sm 44px (the target floor, for actions inside
 * notices, rows and tables), md 52px, lg 60px. The same words mean the same
 * heights on every control. `icon` is a 44px square and `icon-lg` a 48px one;
 * both need an aria-label. Labels wrap rather than push a 320px page sideways.
 *
 * A busy button (`loading`) hides its own icon, so the spinner stands in its
 * place and the label does not shift twice.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2.5 rounded-control border border-transparent bg-clip-padding text-center font-sans text-button font-bold text-balance focus-ring transition-[background-color,box-shadow,color] duration-quick ease-out outline-none select-none active:translate-y-px disabled:cursor-not-allowed disabled:active:translate-y-0 aria-disabled:cursor-not-allowed aria-disabled:active:translate-y-0 aria-busy:aria-disabled:cursor-progress aria-invalid:edge-invalid motion-reduce:active:translate-y-0 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5.5 data-loading:[&_svg:not([data-slot=spinner])]:hidden",
  {
    variants: {
      variant: {
        primary: PRIMARY,
        secondary: SECONDARY,
        quiet: QUIET,
        danger: DANGER,
        "danger-quiet": DANGER_QUIET,
        link: LINK,
        "row-link": ROW_LINK,
      },
      size: {
        sm: "min-h-11 px-3.5 py-1.5 text-label [&_svg:not([class*='size-'])]:size-5",
        md: "min-h-13 px-5 py-2",
        lg: "min-h-15 px-6 py-2 text-heading-sm",
        icon: "size-11",
        "icon-lg": "size-12",
      },
    },
    compoundVariants: [
      // The small icon button's glyph is muted on grey and on no fill. It is
      // set here, not on the size: a size must not replace the colour a
      // variant gives (white on blue, warn on danger).
      {
        variant: ["secondary", "quiet"],
        size: "icon",
        className:
          "text-ink-muted hover:text-ink disabled:hover:text-ink-muted aria-disabled:hover:text-ink-muted aria-pressed:text-ink",
      },
      // A link button is text-sized wherever it sits; only its phone target grows.
      {
        variant: "link",
        className: "h-auto min-h-0 px-0 py-0 md:h-auto md:min-h-0",
      },
      {
        variant: "row-link",
        className: "h-auto min-h-11 px-0 py-0",
      },
    ],
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  }
)

type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>
type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>

const SPINNER_SIZE = {
  sm: "sm",
  md: "md",
  lg: "lg",
  icon: "md",
  "icon-lg": "lg",
} as const satisfies Record<ButtonSize, "sm" | "md" | "lg">

/*
 * A link button (and a row link) is text-sized: it has no icon square.
 * Written into the type so the pair cannot be asked for.
 */
type ButtonLook =
  | { variant?: Exclude<ButtonVariant, "link" | "row-link">; size?: ButtonSize }
  | {
      variant: "link" | "row-link"
      size?: Exclude<ButtonSize, "icon" | "icon-lg">
    }

type ButtonProps = Omit<ButtonPrimitive.Props, "className"> &
  ButtonLook & {
    /** Layout only: width, margin, alignment. */
    className?: string
    /**
     * The action is under way. The button says so (`aria-busy`), stops
     * answering (`aria-disabled`), keeps focus and its label, and shows a
     * spinner where its icon was.
     */
    loading?: boolean
    /** Words shown in place of the label while loading, such as "Saving". */
    loadingLabel?: React.ReactNode
  }

function isTrue(value: boolean | "true" | "false" | undefined) {
  return value === true || value === "true"
}

/*
 * `aria-disabled` is the preferred way to switch a button off (DESIGN.md §4,
 * §7): it stays in the focus order so the reason beside it can be reached.
 * Either `aria-disabled` or `loading` blocks the click here, so a caller
 * does not have to guard its own handler. Other keys still reach the page:
 * a held button inside a dialog must not swallow Escape or the arrow keys.
 *
 * A toggle (`aria-pressed`) that is on gets the selected fill, edge and a
 * tick. For a filter use FilterPill, and for one choice of a few use
 * SegmentedControl; a pressed Button is for a lone on/off action.
 */
function Button({
  className,
  variant = "secondary",
  size = "md",
  loading = false,
  loadingLabel,
  "aria-disabled": ariaDisabled,
  "aria-pressed": ariaPressed,
  onClick,
  children,
  ...props
}: ButtonProps) {
  const held = loading || isTrue(ariaDisabled)
  const pressed = ariaPressed === true || ariaPressed === "true"
  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-loading={loading ? "" : undefined}
      aria-busy={loading || undefined}
      aria-pressed={ariaPressed}
      className={cn(
        buttonVariants({ variant, size }),
        ariaPressed !== undefined && TOGGLE[variant],
        className
      )}
      // Left out when unset, so Base UI's own aria-disabled (a disabled
      // button that stays focusable) is not overwritten with nothing.
      {...(ariaDisabled === undefined && !held
        ? null
        : { "aria-disabled": held || ariaDisabled })}
      {...props}
      onClick={held ? hold : onClick}
    >
      {loading ? <Spinner size={SPINNER_SIZE[size]} /> : null}
      {/* No tick in an icon square: there is no room beside the icon, so an
          icon-only toggle changes its own icon as well. */}
      {pressed && size !== "icon" && size !== "icon-lg" ? (
        <CheckIcon aria-hidden weight="bold" data-slot="button-pressed-mark" />
      ) : null}
      {loading && loadingLabel !== undefined ? loadingLabel : children}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
export type { ButtonLook, ButtonProps, ButtonSize, ButtonVariant }
