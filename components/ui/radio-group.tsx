import { Radio as RadioPrimitive } from "@base-ui/react/radio"
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group"
import { CircleIcon } from "@phosphor-icons/react/dist/ssr"

import { CHOICE_DISABLED, CHOICE_MARK } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"

/*
 * Radio group (DESIGN.md §4 "Radio row", §2 "Blue is rationed"): one choice
 * from a few. Each radio is a 24px circle in a 44px target; chosen, its edge
 * and its dot take `select`. The dot carries the state, not the colour.
 *
 * Tab reaches the group once and the arrow keys move the choice (Base UI).
 * Name the group with `aria-labelledby` or `aria-label`, and each radio with
 * a <label> round it, or use OptionRow.
 */
type RadioGroupProps<Value = string> = Omit<
  RadioGroupPrimitive.Props<Value>,
  "className"
> & {
  /** Stacked (the default) or side by side; side by side wraps. */
  orientation?: "vertical" | "horizontal"
  /** Layout only: gap, width, columns. */
  className?: string
}

function RadioGroup<Value = string>({
  className,
  orientation = "vertical",
  ...props
}: RadioGroupProps<Value>) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      data-orientation={orientation}
      aria-orientation={orientation}
      className={cn(
        // Invalid: a warn outline round the choices. The message under the
        // group says what is wrong.
        "group/radio-group flex gap-2 rounded-card aria-invalid:outline-2 aria-invalid:outline-offset-2 aria-invalid:outline-warn-fg data-[orientation=horizontal]:flex-row data-[orientation=horizontal]:flex-wrap data-[orientation=horizontal]:gap-x-6 data-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    />
  )
}

const radioClass = cn(
  CHOICE_MARK,
  "group/radio rounded-round text-select aria-invalid:edge-invalid data-checked:inset-ring-2 data-checked:inset-ring-select aria-invalid:data-checked:edge-invalid",
  CHOICE_DISABLED
)

function isTrue(value: boolean | "true" | "false" | undefined) {
  return value === true || value === "true"
}

type RadioProps<Value = string> = Omit<
  RadioPrimitive.Root.Props<Value>,
  "className" | "children"
> & {
  /** Layout only: margin, alignment. */
  className?: string
  /** `parent` leaves the focus ring to a row with `focus-ring-within`. */
  focus?: "own" | "parent"
}

/*
 * `aria-disabled` marks one radio as unavailable without greying the whole
 * group: it cannot be chosen, and it is announced as unavailable. The arrow
 * keys and Tab skip it, as they skip a `disabled` one (Base UI's roving
 * focus leaves out both), so its reason must be visible text beside it, not
 * something heard only on focus. OptionRow's `reason` does this.
 */
function Radio<Value = string>({
  className,
  focus = "own",
  readOnly,
  "aria-disabled": ariaDisabled,
  ...props
}: RadioProps<Value>) {
  const held = isTrue(ariaDisabled)
  return (
    <RadioPrimitive.Root
      data-slot="radio"
      className={cn(radioClass, focus === "own" && "focus-ring", className)}
      readOnly={readOnly || held}
      {...(held ? { "aria-disabled": true } : null)}
      {...props}
    >
      <RadioPrimitive.Indicator
        data-slot="radio-indicator"
        className="pointer-events-none flex items-center justify-center"
      >
        {/* An icon, not a filled box: forced colours remove fills. */}
        <CircleIcon aria-hidden weight="fill" className="size-3.5" />
      </RadioPrimitive.Indicator>
    </RadioPrimitive.Root>
  )
}

export { Radio, RadioGroup }
export type { RadioGroupProps, RadioProps }
