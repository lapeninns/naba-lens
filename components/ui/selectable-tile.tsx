"use client"

import { useId, useState } from "react"
import { MinusCircleIcon } from "@phosphor-icons/react/dist/ssr"

import { Checkbox, type CheckboxProps } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"

/*
 * Selectable tile (DESIGN.md §4 "Tile check"): a photo that can be picked.
 * The children are the photo. A tick box sits in a corner on a plate, so it
 * reads on any picture; picked, the box fills and the tile takes the 3px
 * select ring. The whole tile is the target.
 *
 * It is a checkbox, named "Select" or "Selected" and then the label, so the
 * state is in words as well as in the ring. A photo that cannot be used
 * (`ineligible`) shows why and has no control at all.
 *
 * Client only because the name follows the state.
 */
type SelectableTileProps = Omit<
  CheckboxProps,
  "className" | "focus" | "aria-labelledby" | "aria-label" | "indeterminate"
> & {
  /** Names the photo, such as "Bar, photo 2". Read after Select or Selected. */
  label: string
  /** The photo. */
  children: React.ReactNode
  /**
   * Why this photo cannot be picked at all. The tile then has no control,
   * dims the photo and shows these words.
   */
  ineligible?: React.ReactNode
  /** Layout only, on the tile: width, grid placement. */
  className?: string
}

function isTrue(value: boolean | "true" | "false" | undefined) {
  return value === true || value === "true"
}

function SelectableTile({
  label,
  children,
  ineligible,
  className,
  checked: checkedProp,
  defaultChecked = false,
  onCheckedChange,
  ...props
}: SelectableTileProps) {
  const nameId = useId()
  const [own, setOwn] = useState(defaultChecked)
  const checked = checkedProp ?? own

  if (ineligible !== undefined && ineligible !== null && ineligible !== false) {
    return (
      <div
        data-slot="selectable-tile"
        data-ineligible=""
        className={cn("grid min-w-0 content-start gap-1.5", className)}
      >
        <div
          data-slot="selectable-tile-media"
          className="overflow-hidden rounded-card opacity-70 saturate-50"
        >
          {children}
        </div>
        <p
          data-slot="selectable-tile-reason"
          className="flex min-h-11 items-start gap-2 text-meta wrap-break-word text-ink-muted"
        >
          <MinusCircleIcon aria-hidden className="mt-0.5 size-5 shrink-0" />
          <span className="min-w-0">
            <span className="sr-only">{label}: </span>
            {ineligible}
          </span>
        </p>
      </div>
    )
  }

  const off = Boolean(props.disabled) || isTrue(props["aria-disabled"])

  return (
    <label
      data-slot="selectable-tile"
      data-checked={checked ? "" : undefined}
      data-disabled={off ? "" : undefined}
      className={cn(
        "group/tile relative block min-w-0 cursor-pointer overflow-hidden rounded-card focus-ring-within data-disabled:cursor-not-allowed",
        className
      )}
    >
      <div
        data-slot="selectable-tile-media"
        className="group-data-disabled/tile:opacity-55"
      >
        {children}
      </div>
      {/* The ring is its own layer: drawn on the tile it would sit under
          the photo. Forced colours remove it; the ticked box remains. */}
      <span
        aria-hidden
        data-slot="selectable-tile-ring"
        className="pointer-events-none absolute inset-0 rounded-card group-data-checked/tile:ring-selected"
      />
      <span
        data-slot="selectable-tile-plate"
        className="absolute start-1.5 top-1.5 grid size-11 place-items-center rounded-control bg-plate"
      >
        <Checkbox
          {...props}
          focus="parent"
          aria-labelledby={nameId}
          checked={checked}
          onCheckedChange={(next, details) => {
            onCheckedChange?.(next, details)
            if (!details.isCanceled) setOwn(next)
          }}
        />
      </span>
      <span id={nameId} className="sr-only">
        {checked ? "Selected" : "Select"} {label}
      </span>
    </label>
  )
}

export { SelectableTile }
export type { SelectableTileProps }
