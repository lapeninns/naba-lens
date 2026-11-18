import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { CheckIcon, MinusIcon } from "@phosphor-icons/react/dist/ssr"

import { cn } from "@/lib/utils"

/*
 * Checkbox (common-room.md §4 "checkbox", §2 "Blue is rationed"): a 24px box in a
 * 44px target. Empty it has a strong edge; ticked it fills with `select`, the
 * colour kept for a choice the person made, and shows a tick. The tick or the
 * dash carries the state, so it never rests on colour alone.
 *
 * The mark has no words of its own. Give it a name: wrap it in a <label>,
 * point `aria-labelledby` at one, or use OptionRow, which does both.
 *
 * Forced colours remove fills and the edge (it is drawn as a shadow), so the
 * box takes an outline there and the tick is drawn in the text colour.
 */
const MARK =
  "relative inline-flex size-6 shrink-0 items-center justify-center bg-surface text-on-select edge-strong transition-[background-color,box-shadow] duration-quick ease-out outline-none select-none after:absolute after:-inset-2.5 forced-colors:outline forced-colors:outline-1 forced-colors:-outline-offset-1"

// A second state on the same element is written as a stacked variant, so it
// wins over the single-state rule whatever order the stylesheet puts them in.
const DISABLED =
  "aria-disabled:cursor-not-allowed aria-disabled:bg-surface-2 aria-disabled:text-ink-muted aria-disabled:edge aria-disabled:data-checked:bg-surface-2 aria-disabled:data-checked:edge aria-disabled:data-indeterminate:bg-surface-2 aria-disabled:data-indeterminate:edge"

const INVALID =
  "aria-invalid:edge-invalid aria-invalid:data-checked:edge-invalid aria-invalid:data-indeterminate:edge-invalid"

const checkboxClass = cn(
  MARK,
  "group/checkbox rounded-square data-indeterminate:bg-select data-indeterminate:inset-ring-select data-checked:bg-select data-checked:inset-ring-select",
  INVALID,
  DISABLED
)

function isTrue(value: boolean | "true" | "false" | undefined) {
  return value === true || value === "true"
}

type CheckboxProps = Omit<
  CheckboxPrimitive.Root.Props,
  "className" | "children"
> & {
  /** Layout only: margin, alignment. */
  className?: string
  /**
   * Where the focus ring is drawn. `parent` leaves it to a row or tile that
   * carries `focus-ring-within`, so the two do not draw one inside the other.
   */
  focus?: "own" | "parent"
}

/*
 * `aria-disabled` is the preferred way to switch it off (common-room.md §4, §7):
 * the box stays in the focus order, so the reason beside it can be reached,
 * and it does not change when pressed. `disabled` takes it out of the focus
 * order and out of the form, as a native checkbox would.
 */
function Checkbox({
  className,
  focus = "own",
  readOnly,
  "aria-disabled": ariaDisabled,
  ...props
}: CheckboxProps) {
  const held = isTrue(ariaDisabled)
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(checkboxClass, focus === "own" && "focus-ring", className)}
      readOnly={readOnly || held}
      // Left out when unset, so Base UI's own aria-disabled is kept.
      {...(held ? { "aria-disabled": true } : null)}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="pointer-events-none flex items-center justify-center"
      >
        <CheckIcon
          aria-hidden
          weight="bold"
          className="size-4.5 group-data-indeterminate/checkbox:hidden"
        />
        <MinusIcon
          aria-hidden
          weight="bold"
          className="hidden size-4.5 group-data-indeterminate/checkbox:block"
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox, DISABLED as CHOICE_DISABLED, MARK as CHOICE_MARK }
export type { CheckboxProps }
