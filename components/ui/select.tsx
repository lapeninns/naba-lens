"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"
import { CaretDownIcon, CheckIcon, CaretUpIcon } from "@phosphor-icons/react"

import {
  fieldControlVariants,
  type FieldControlSize,
} from "@/components/ui/field-control"
import { OPTION_ITEM_FOCUS } from "@/components/ui/option-item"
import { cn } from "@/lib/utils"

/*
 * Select (DESIGN.md §4 Field; components.md "Select"): a Base UI listbox
 * behind a trigger that is drawn with the shared field recipe, so it sits
 * beside an Input at the same height, width and edge. It is the engine
 * behind OptionSelect; screens use that, or put Select in a FormField, so
 * the trigger has a label.
 */

/** What a FormField hands its control; the trigger is the part that takes it. */
type SelectWiring = {
  "aria-labelledby"?: string
  "aria-describedby"?: string
  "aria-invalid"?: boolean | "true" | "false"
}

const SelectWiringContext = React.createContext<SelectWiring | null>(null)

/*
 * The root draws nothing, so the ARIA wiring a FormField gives it would be
 * lost. It is kept here and put on the trigger, which is the control a
 * screen reader meets. What the trigger sets itself wins.
 */
function Select<Value, Multiple extends boolean | undefined = false>({
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
  ...props
}: SelectPrimitive.Root.Props<Value, Multiple> & SelectWiring) {
  const wiring = React.useMemo<SelectWiring | null>(
    () =>
      labelledBy === undefined &&
      describedBy === undefined &&
      invalid === undefined
        ? null
        : {
            "aria-labelledby": labelledBy,
            "aria-describedby": describedBy,
            "aria-invalid": invalid,
          },
    [labelledBy, describedBy, invalid]
  )
  return (
    <SelectWiringContext.Provider value={wiring}>
      <SelectPrimitive.Root<Value, Multiple> {...props} />
    </SelectWiringContext.Provider>
  )
}

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1 p-1", className)}
      {...props}
    />
  )
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("flex flex-1 text-left", className)}
      {...props}
    />
  )
}

function SelectTrigger({
  className,
  size = "md",
  children,
  ...props
}: Omit<SelectPrimitive.Trigger.Props, "aria-disabled"> & {
  /** sm 44px, md 56px (default), lg 60px: the same heights as Input. */
  size?: FieldControlSize
  /*
   * No `aria-disabled`: on its own it would grey the trigger and still open
   * the list. Switch the whole Select off with `disabled` and say why
   * beside it.
   */
}) {
  const wiring = React.useContext(SelectWiringContext)
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      {...wiring}
      className={cn(
        fieldControlVariants({ size }),
        // Open is told by the popup under it as well as by the darker fill.
        "flex cursor-default items-center justify-between gap-2 text-left select-none data-placeholder:text-ink-muted data-popup-open:bg-raised *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={
          <CaretDownIcon
            aria-hidden
            className={cn(
              "pointer-events-none text-ink",
              size === "sm" ? "size-5" : "size-6"
            )}
          />
        }
      />
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  alignItemWithTrigger = true,
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<
    SelectPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
  >) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className="isolate z-overlay"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          data-align-trigger={alignItemWithTrigger}
          className={cn(
            "relative isolate z-overlay max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-card bg-surface p-1 text-ink shadow-float duration-quick data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn(
        "px-3 py-2 text-meta font-semibold text-ink-muted",
        className
      )}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        // The chosen option has a tint and a tick, so it is never colour
        // alone; a long name wraps instead of widening the popup.
        "relative flex min-h-11 w-full cursor-default items-center gap-2 rounded-control py-2 pr-10 pl-3 text-body outline-hidden select-none focus:bg-surface-2 focus:text-ink not-data-[variant=destructive]:focus:**:text-ink data-highlighted:bg-surface-2 data-selected:bg-accent-soft data-disabled:pointer-events-none data-disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        OPTION_ITEM_FOCUS,
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex min-w-0 flex-1 gap-2 wrap-anywhere">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-3 flex size-5 items-center justify-center text-select" />
        }
      >
        <CheckIcon aria-hidden className="pointer-events-none" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-line", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "top-0 z-local flex w-full cursor-default items-center justify-center bg-surface py-1 [&_svg:not([class*='size-'])]:size-5",
        className
      )}
      {...props}
    >
      <CaretUpIcon aria-hidden />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "bottom-0 z-local flex w-full cursor-default items-center justify-center bg-surface py-1 [&_svg:not([class*='size-'])]:size-5",
        className
      )}
      {...props}
    >
      <CaretDownIcon aria-hidden />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
