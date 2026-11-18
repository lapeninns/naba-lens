"use client"

import * as React from "react"
import { Radio } from "@base-ui/react/radio"
import { RadioGroup } from "@base-ui/react/radio-group"
import { ProhibitIcon } from "@phosphor-icons/react/dist/ssr"
import { cva } from "class-variance-authority"

import { segmentClass } from "@/components/ui/toggle"
import { cn } from "@/lib/utils"

/*
 * Common Room segmented control (common-room.md §4): one choice of a few, drawn
 * as a grey track with the chosen segment raised. It is a radio group (Base
 * UI RadioGroup): one tab stop, arrow keys move and choose, and with `name`
 * the value is sent with a native form. Segments are 48px wherever staff
 * work, 44px only inside a manager or admin shell (`data-density="compact"`,
 * V2-4), and their labels wrap rather than push the page sideways.
 */
const trackVariants = cva(
  "group/segmented min-w-0 gap-1 bg-surface-2 p-1 aria-invalid:edge-invalid",
  {
    variants: {
      // full: equal columns across the space given. fit: as wide as the words.
      width: {
        full: "grid w-full auto-cols-fr grid-flow-col",
        fit: "inline-grid w-fit max-w-full auto-cols-auto grid-flow-col",
      },
      // One column where the labels are too long to sit side by side
      // (common-room.md §4, the manage facts block on a phone).
      stack: {
        never: "rounded-round",
        phone: "rounded-round max-md:grid-flow-row max-md:rounded-card",
        always: "grid-flow-row rounded-card",
      },
    },
    defaultVariants: { width: "full", stack: "never" },
  }
)

type SegmentedControlWidth = "full" | "fit"
type SegmentedControlStack = "never" | "phone" | "always"

type SegmentedControlOption<Value extends string = string> = {
  value: Value
  label: React.ReactNode
  /** Decorative: the label carries the meaning. */
  icon?: React.ReactNode
  disabled?: boolean
}

type SegmentedControlProps<Value extends string = string> = {
  /** Accessible name of the group, such as "Media" or "Appearance". */
  label?: string
  /** Id of a visible label for the group; takes the place of `label`. */
  "aria-labelledby"?: string
  /** Id of help or an error message for the group. */
  "aria-describedby"?: string
  /** Marks the track; the message it is described by says what is wrong. */
  "aria-invalid"?: boolean | "true" | "false"
  id?: string
  /** The form field the chosen value is sent as. */
  name?: string
  /** Id of the form, when the control sits outside it. */
  form?: string
  /** The segments. Leave out to pass SegmentedControlItem children. */
  options?: readonly SegmentedControlOption<Value>[]
  /** Controlled value. One that matches no segment leaves none chosen. */
  value?: Value
  /** Starting value when uncontrolled. */
  defaultValue?: Value
  onValueChange?: (value: Value) => void
  width?: SegmentedControlWidth
  stack?: SegmentedControlStack
  /** Switches every segment off. */
  disabled?: boolean
  required?: boolean
  /** Layout only: width, margin, grid placement. */
  className?: string
  children?: React.ReactNode
}

function SegmentedControl<Value extends string = string>({
  label,
  "aria-labelledby": labelledBy,
  options,
  onValueChange,
  width = "full",
  stack = "never",
  className,
  children,
  ...props
}: SegmentedControlProps<Value>) {
  return (
    <RadioGroup<Value>
      data-slot="segmented-control"
      data-size="sm"
      data-width={width}
      data-stack={stack}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      onValueChange={onValueChange ? (next) => onValueChange(next) : undefined}
      className={cn(trackVariants({ width, stack }), className)}
      {...props}
    >
      {options
        ? options.map((option) => (
            <SegmentedControlItem
              key={option.value}
              value={option.value}
              icon={option.icon}
              disabled={option.disabled}
            >
              {option.label}
            </SegmentedControlItem>
          ))
        : children}
    </RadioGroup>
  )
}

type SegmentedControlItemProps = {
  value: string
  /** Decorative: the label carries the meaning. */
  icon?: React.ReactNode
  disabled?: boolean
  "aria-describedby"?: string
  id?: string
  /** Layout only. */
  className?: string
  children: React.ReactNode
}

/*
 * A segment that is switched off keeps its label and swaps its icon for a
 * "not allowed" mark, so the state is not told by grey alone (common-room.md §7).
 */
function SegmentedControlItem({
  icon,
  className,
  children,
  ...props
}: SegmentedControlItemProps) {
  return (
    <Radio.Root
      data-slot="segmented-control-item"
      nativeButton
      render={<button type="button" />}
      className={cn(
        segmentClass,
        "min-w-0 group-data-[stack=always]/segmented:rounded-control max-md:group-data-[stack=phone]/segmented:rounded-control",
        className
      )}
      {...props}
    >
      <ProhibitIcon
        aria-hidden
        data-slot="segmented-control-off"
        className="hidden group-data-disabled/segment:inline"
      />
      {icon ? (
        <span
          aria-hidden
          data-slot="segmented-control-icon"
          className="contents group-data-disabled/segment:hidden"
        >
          {icon}
        </span>
      ) : null}
      <span data-slot="segmented-control-label" className="min-w-0">
        {children}
      </span>
    </Radio.Root>
  )
}

export { SegmentedControl, SegmentedControlItem }
export type {
  SegmentedControlItemProps,
  SegmentedControlOption,
  SegmentedControlProps,
  SegmentedControlStack,
  SegmentedControlWidth,
}
