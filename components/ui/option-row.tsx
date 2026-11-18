import { useId } from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { Checkbox, type CheckboxProps } from "@/components/ui/checkbox"
import { Radio, type RadioProps } from "@/components/ui/radio-group"
import { cn } from "@/lib/utils"

/*
 * Option row (v2 Field `nl-check`, on a surface card): one choice as a full
 * row. The whole row is the label and the target; the mark sits at the
 * leading side, then the label and its hint, then an optional end slot.
 *
 * A chosen row turns accent-soft (bottle-soft) with a selected edge, not a
 * card shadow. The mark still shows the
 * tick or the dot, so the state never rests on the fill. Focus is drawn on
 * the row, not on the mark inside it.
 *
 * `type="radio"` goes inside a RadioGroup; `type="checkbox"` stands alone.
 */
const optionRowVariants = cva(
  // Stacked variants (selected and invalid, disabled and hover) win over the
  // single-state rules whatever order the stylesheet puts them in.
  "group/option-row grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-card bg-surface text-start edge-strong focus-ring-within transition-[background-color,box-shadow] duration-quick ease-out hover:bg-raised has-aria-disabled:cursor-not-allowed has-aria-disabled:bg-surface-2 has-aria-disabled:edge has-aria-disabled:hover:bg-surface-2 has-aria-invalid:edge-invalid has-data-indeterminate:bg-accent-soft has-data-indeterminate:edge-selected has-data-checked:bg-accent-soft has-data-checked:edge-selected has-data-checked:hover:bg-accent-soft has-aria-disabled:has-data-checked:bg-surface-2 has-aria-disabled:has-data-checked:edge has-aria-invalid:has-data-checked:edge-invalid",
  {
    variants: {
      // The same words and heights as every other control: 44, 48, 48px
      // (v2 `nl-check`: the whole 48px row is the target).
      size: {
        sm: "min-h-11 px-3 py-2",
        md: "min-h-12 p-3",
        lg: "min-h-12 px-4 py-3",
      },
    },
    defaultVariants: { size: "md" },
  }
)

type OptionRowSize = NonNullable<VariantProps<typeof optionRowVariants>["size"]>

type OptionRowOwnProps = {
  /** The choice, in a few words. It is the control's name. */
  label: React.ReactNode
  /** A second line that explains the choice. Read out as its description. */
  hint?: React.ReactNode
  /** Why the row cannot be chosen. Shown only while it is switched off. */
  reason?: React.ReactNode
  /** Trailing content such as a count. Words or an icon, not a control. */
  end?: React.ReactNode
  size?: OptionRowSize
  /** Layout only, on the row: width, margin. */
  className?: string
}

type Control<Props> = Omit<
  Props,
  "className" | "focus" | "aria-labelledby" | "aria-describedby"
>

type OptionRowProps = OptionRowOwnProps &
  (
    | ({ type: "radio" } & Control<RadioProps>)
    | ({ type: "checkbox" } & Control<CheckboxProps>)
  )

function isTrue(value: boolean | "true" | "false" | undefined) {
  return value === true || value === "true"
}

function OptionRow({
  label,
  hint,
  reason,
  end,
  size = "md",
  className,
  ...control
}: OptionRowProps) {
  const id = useId()
  const labelId = `${id}-label`
  const hintId = `${id}-hint`
  const reasonId = `${id}-reason`
  const off = Boolean(control.disabled) || isTrue(control["aria-disabled"])
  const showReason = off && reason !== undefined && reason !== null
  const describedBy =
    [hint ? hintId : null, showReason ? reasonId : null]
      .filter(Boolean)
      .join(" ") || undefined

  // The name is the label alone; the hint and the reason are the
  // description. Left to itself the whole row would be read as the name.
  const wiring = {
    focus: "parent",
    "aria-labelledby": labelId,
    "aria-describedby": describedBy,
  } as const

  return (
    <label
      data-slot="option-row"
      data-type={control.type}
      data-size={size}
      className={cn(optionRowVariants({ size }), className)}
    >
      {control.type === "radio" ? (
        <Radio {...withoutType(control)} {...wiring} />
      ) : (
        <Checkbox {...withoutType(control)} {...wiring} />
      )}
      <span data-slot="option-row-text" className="grid min-w-0 gap-0.5">
        <span
          id={labelId}
          data-slot="option-row-label"
          className={cn(
            "wrap-break-word text-ink group-has-aria-disabled/option-row:text-ink-muted",
            size === "sm" ? "text-label" : "text-item-title"
          )}
        >
          {label}
        </span>
        {hint ? (
          <span
            id={hintId}
            data-slot="option-row-hint"
            className="text-meta wrap-break-word text-ink-muted"
          >
            {hint}
          </span>
        ) : null}
        {showReason ? (
          <span
            id={reasonId}
            data-slot="option-row-reason"
            className="text-meta wrap-break-word text-ink"
          >
            {reason}
          </span>
        ) : null}
      </span>
      {end ? (
        <span
          data-slot="option-row-end"
          className="text-meta text-ink-muted [&_svg]:size-5.5"
        >
          {end}
        </span>
      ) : null}
    </label>
  )
}

// `type` picks the control here; neither control takes it as a prop.
function withoutType<Props extends { type: string }>(
  props: Props
): Omit<Props, "type"> {
  const rest: Omit<Props, "type"> & { type?: string } = { ...props }
  delete rest.type
  return rest
}

export { OptionRow, optionRowVariants }
export type { OptionRowProps, OptionRowSize }
