"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

import type { Option } from "./types"

type OptionSelectProps = {
  id?: string
  options: Option[]
  value: string | null
  onValueChange: (value: string | null) => void
  /** Label for the empty choice, e.g. "All venues". Omit to require a choice. */
  emptyLabel?: string
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  className?: string
  "aria-label"?: string
  "aria-describedby"?: string
}

const EMPTY = "__none__"

/** Single choice from id/name options, built on the shadcn (Base UI) Select. */
export function OptionSelect({
  id,
  options,
  value,
  onValueChange,
  emptyLabel,
  placeholder = "Choose…",
  disabled,
  invalid,
  className,
  ...aria
}: OptionSelectProps) {
  const items = [
    ...(emptyLabel ? [{ value: EMPTY, label: emptyLabel }] : []),
    ...options.map((o) => ({ value: o.id, label: o.name })),
  ]
  return (
    <Select
      items={items}
      value={value ?? (emptyLabel ? EMPTY : null)}
      onValueChange={(next) =>
        onValueChange(next === EMPTY || next == null ? null : String(next))
      }
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        aria-invalid={invalid || undefined}
        // The trigger is the 56px Common Room field (data-[size=default]).
        className={cn(
          // The kit shows the value as display:flex, which cuts a long name
          // mid-character; block + truncate ends it with an ellipsis.
          "w-full min-w-0 *:data-[slot=select-value]:block *:data-[slot=select-value]:truncate",
          className
        )}
        {...aria}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      {/* Always drop below the taller 56px field. Base UI's item-aligned mode
          lays the list over the trigger and closes on any window resize; the
          old 36-44px trigger near the top fell back to this placement. */}
      <SelectContent alignItemWithTrigger={false}>
        {items.map((item) => (
          <SelectItem
            key={item.value}
            value={item.value}
            className="min-h-11 py-2"
          >
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
