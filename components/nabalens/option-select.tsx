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
        // The trigger sizes itself with data-[size=default]:h-8, which beats a
        // plain h-* class; override at the same specificity (44px on phones).
        className={cn(
          "w-full min-w-0 data-[size=default]:h-11 sm:data-[size=default]:h-9",
          className
        )}
        {...aria}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem
            key={item.value}
            value={item.value}
            className="min-h-11 py-2 sm:min-h-0 sm:py-1"
          >
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
