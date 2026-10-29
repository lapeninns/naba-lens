"use client"

import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"

import { OptionSelect } from "./option-select"
import type { MediaType, Option } from "./types"

export type LibraryFilterValue = {
  venueId: string | null
  staffId: string | null
  type: MediaType | "all"
}

export const EMPTY_LIBRARY_FILTERS: LibraryFilterValue = {
  venueId: null,
  staffId: null,
  type: "all",
}

type LibraryFiltersProps = {
  venues: Option[]
  staff: Option[]
  /** Controlled; the page keeps this in URL search params. */
  value: LibraryFilterValue
  onChange: (value: LibraryFilterValue) => void
  className?: string
}

const TYPES: { value: LibraryFilterValue["type"]; label: string }[] = [
  { value: "image", label: "Photos" },
  { value: "video", label: "Videos" },
  { value: "all", label: "All" },
]

export function LibraryFilters({
  venues,
  staff,
  value,
  onChange,
  className,
}: LibraryFiltersProps) {
  const active =
    value.venueId !== null || value.staffId !== null || value.type !== "all"
  return (
    <div
      role="group"
      aria-label="Filter library"
      className={cn(
        "grid grid-cols-2 items-center gap-2 md:flex md:flex-wrap md:gap-3",
        className
      )}
    >
      <OptionSelect
        aria-label="Venue"
        options={venues}
        value={value.venueId}
        emptyLabel="All venues"
        onValueChange={(venueId) => onChange({ ...value, venueId })}
        className="md:w-48"
      />
      <OptionSelect
        aria-label="Staff member"
        options={staff}
        value={value.staffId}
        emptyLabel="All staff"
        onValueChange={(staffId) => onChange({ ...value, staffId })}
        className="md:w-48"
      />
      <ToggleGroup
        aria-label="Media type"
        variant="outline"
        spacing={0}
        value={[value.type]}
        onValueChange={(next) => {
          const type = next[0] as LibraryFilterValue["type"] | undefined
          if (type) onChange({ ...value, type })
        }}
        className="col-span-2 w-full md:w-auto"
      >
        {TYPES.map((t) => (
          <ToggleGroupItem
            key={t.value}
            value={t.value}
            className="h-11 flex-1 px-4 sm:h-9 md:flex-none"
          >
            {t.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {active ? (
        <Button
          variant="ghost"
          size="touch"
          onClick={() => onChange(EMPTY_LIBRARY_FILTERS)}
          className="col-span-2 justify-self-start md:ml-auto"
        >
          Clear filters
        </Button>
      ) : null}
    </div>
  )
}
