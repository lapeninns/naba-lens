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
  /**
   * Id of the checked radio (the first when none is), so a label, an error
   * or focus can reach the group.
   */
  id?: string
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
  id,
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
        "grid auto-cols-fr grid-flow-col gap-1 rounded-round bg-surface-2 p-1",
        className
      )}
    >
      {options.map((option, index) => (
        <label
          key={option.value}
          className="grid min-h-11 cursor-pointer place-items-center rounded-round px-3 py-1 text-center text-label [overflow-wrap:anywhere] text-ink-muted transition-colors duration-(--duration-quick) hover:text-ink has-checked:bg-surface has-checked:text-ink has-checked:shadow-[inset_0_0_0_1.5px_var(--border-strong)] has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus has-focus-visible:outline-solid"
        >
          <input
            type="radio"
            id={
              id &&
              (value === option.value ||
                (index === 0 && !options.some((o) => o.value === value)))
                ? id
                : undefined
            }
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
