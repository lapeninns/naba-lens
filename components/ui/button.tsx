import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { CheckIcon } from "@phosphor-icons/react/dist/ssr"
import { cva, type VariantProps } from "class-variance-authority"

import { hold } from "@/components/ui/button-hold"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

/*
 * v2 Button (docs/design-system/v2/components/Button, D10). Four weights:
 * primary (bottle fill, once per view, always asked for by name), the
 * outlined default (a bare Button: surface with a 1px line-strong edge),
 * quiet (no fill, bottle words) and danger (signal words and edge). A
 * disabled button keeps its label on surface-sunken with a line edge and
 * muted words (say why beside it). Hover is surface-hover, or bottle-strong
 * on the primary.
 */
const DISABLED =
  "disabled:bg-surface-2 disabled:text-ink-muted disabled:inset-ring disabled:inset-ring-line aria-disabled:bg-surface-2 aria-disabled:text-ink-muted aria-disabled:inset-ring aria-disabled:inset-ring-line"
const DISABLED_TEXT = "disabled:text-ink-muted aria-disabled:text-ink-muted"
const PRIMARY = `bg-accent text-on-accent hover:bg-accent-hover active:bg-accent-hover ${DISABLED}`
const SECONDARY = `bg-surface text-ink edge-strong hover:bg-raised active:bg-raised aria-expanded:bg-raised ${DISABLED}`
const QUIET = `bg-transparent text-accent-text hover:bg-raised active:bg-raised aria-expanded:bg-raised ${DISABLED_TEXT}`
// A toggle that is on (`aria-pressed`): the selected look of a pill, soft
// accent with the selected edge. Button adds a tick, so it is not told by
// the fill alone. Switched off, it goes grey like any other button and the
// tick stays. Only the default and quiet buttons are used as toggles, and
// only a button that is given `aria-pressed` carries these classes.
const PRESSED =
  "aria-pressed:bg-accent-soft aria-pressed:edge-selected aria-pressed:hover:bg-accent-soft aria-pressed:active:bg-accent-soft aria-pressed:disabled:inset-ring-0 aria-pressed:aria-disabled:inset-ring-0"
const TOGGLE: Partial<Record<string, string>> = {
  secondary: `${PRESSED} aria-pressed:disabled:bg-surface-2 aria-pressed:aria-disabled:bg-surface-2`,
  quiet: `${PRESSED} aria-pressed:disabled:bg-transparent aria-pressed:aria-disabled:bg-transparent`,
}
// Danger (v2 nl-btn--danger): signal words and a 1px signal edge on the
// surface; hover is surface-hover. The quiet danger drops the edge.
const DANGER = `bg-surface text-signal inset-ring inset-ring-signal hover:bg-raised active:bg-raised ${DISABLED}`
const DANGER_QUIET = `bg-transparent text-signal hover:bg-raised ${DISABLED_TEXT}`
const LINK = `h-auto min-h-0 border-0 bg-transparent px-0 font-semibold text-accent-text underline decoration-1 underline-offset-3 hover:decoration-2 max-md:min-h-11 ${DISABLED_TEXT}`
// A link-style action in a row or notice (v2 nl-row__link): looks like
// `link` but keeps the 44px target at every width, since tablets and
// laptops are touched too.
const ROW_LINK = `h-auto min-h-11 border-0 bg-transparent px-0 font-semibold text-accent-text underline decoration-1 underline-offset-3 hover:decoration-2 ${DISABLED_TEXT}`

/*
 * Sizes (v2 "target-staff" 48px, "target-compact" 40px). md is v2's staff
 * button: 48px, 24px sides. sm is the action inside a notice, row or table,
 * with 16px sides: 48px wherever staff work, at every width. Only inside a
 * manager or admin shell (`data-density="compact"`, set by ManagerShell and
 * the admin AppShell) does it take v2's compact size: 44px on touch widths
 * and 40px from bp-desktop, where managers and admins use a pointer
 * (departure V2-4). A dialog is portalled out of the shell, so its buttons
 * keep 48px. lg is the block action at the foot of a phone screen, the same
 * 48px. `icon` is a 44px square and `icon-lg` a
 * 48px one; both need an aria-label. Labels wrap rather than push a 320px
 * page sideways: `max-w-full` caps a long label at its container, since
 * `shrink-0` alone let a chip in a wrapping row grow past a 320px dialog
 * (S3-R5, D2).
 *
 * A busy button (`loading`) hides its own icon, so the spinner stands in its
 * place and the label does not shift twice.
 */
// v2 target-compact, only inside a manager or admin shell (see Sizes).
const COMPACT =
  "in-data-[density=compact]:min-h-11 desktop:in-data-[density=compact]:min-h-10"

const buttonVariants = cva(
  "group/button inline-flex max-w-full shrink-0 items-center justify-center gap-2 rounded-control border border-transparent bg-clip-padding text-center font-sans text-button text-balance focus-ring transition-[background-color,box-shadow,color] duration-quick ease-out outline-none select-none disabled:cursor-not-allowed aria-disabled:cursor-not-allowed aria-busy:aria-disabled:cursor-progress aria-invalid:edge-invalid [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5 data-loading:[&_svg:not([data-slot=spinner])]:hidden",
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
        sm: `min-h-12 px-4 py-1.5 ${COMPACT}`,
        md: "min-h-12 px-6 py-2",
        lg: "min-h-12 px-6 py-2",
        icon: "size-11",
        "icon-lg": "size-12",
      },
    },
    compoundVariants: [
      // The small icon button's glyph is muted on the outlined and quiet
      // buttons. It is set here, not on the size: a size must not replace
      // the colour a variant gives (on-bottle on primary, signal on danger).
      {
        variant: ["secondary", "quiet"],
        size: "icon",
        className:
          "text-ink-muted hover:text-ink disabled:hover:text-ink-muted aria-disabled:hover:text-ink-muted aria-pressed:text-ink",
      },
      // A link button is text-sized wherever it sits; only its phone target grows.
      {
        variant: "link",
        className:
          "h-auto min-h-0 px-0 py-0 in-data-[density=compact]:min-h-0 md:h-auto md:min-h-0 desktop:in-data-[density=compact]:min-h-0",
      },
      {
        variant: "row-link",
        className:
          "h-auto min-h-11 px-0 py-0 in-data-[density=compact]:min-h-11 desktop:in-data-[density=compact]:min-h-11",
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
 * `aria-disabled` is the preferred way to switch a button off (DESIGN.md §8): it stays in the focus order so the reason beside it can be reached.
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
