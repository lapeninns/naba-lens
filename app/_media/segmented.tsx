"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

type SegmentedProps<Value extends string> = {
  /** Accessible name of the group, e.g. "Media" or "Appearance". */
  label?: string
  /** Id of a visible label for the group; takes the place of `label`. */
  "aria-labelledby"?: string
  /** The form field the checked value submits as. */
  name: string
  options: { value: Value; label: string }[]
  value: Value
  onValueChange: (value: Value) => void
  "aria-describedby"?: string
  className?: string
}

/**
 * A one-of-few choice drawn as joined segments. Native radios underneath, so
 * arrow keys, forms and screen readers behave as a radio group.
 */
export function Segmented<Value extends string>({
  label,
  name,
  options,
  value,
  onValueChange,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
  className,
}: SegmentedProps<Value>) {
  return (
    <div
      role="radiogroup"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className={cn(
        "grid auto-cols-fr grid-flow-col gap-0.5 rounded-control bg-well p-0.5",
        className
      )}
    >
      {options.map((option) => (
        <label
          key={option.value}
          className="grid min-h-11 cursor-pointer place-items-center rounded-chip px-2 py-1 text-center text-label-touch text-ink-muted has-checked:bg-panel has-checked:text-ink has-checked:ring-1 has-checked:ring-line-control has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus md:min-h-8 md:text-label"
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onValueChange(option.value)}
            className="sr-only"
          />
          {option.label}
        </label>
      ))}
    </div>
  )
}
