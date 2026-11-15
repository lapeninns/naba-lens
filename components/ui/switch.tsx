"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

/*
 * Switch (DESIGN.md §2 and §7): an on or off setting that takes effect at
 * once. One size: a 52 x 32px track whose hit area reaches 64 x 44px. On is
 * the person's selection mark (select) with the thumb at the end; off is
 * grey with a strong edge and the thumb at the start, so the state is a
 * position as well as a colour. Always put a label beside it.
 *
 * Unavailable: pass `aria-disabled` with a reason beside it
 * (`aria-describedby`). The switch then stays focusable and cannot be
 * changed. `disabled` also works but takes it out of the tab order.
 */
function Switch({
  className,
  readOnly,
  "aria-disabled": ariaDisabled,
  ...props
}: Omit<SwitchPrimitive.Root.Props, "className"> & { className?: string }) {
  const blocked = ariaDisabled === true || ariaDisabled === "true"
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size="md"
      // Left out when unset: an explicit `undefined` would wipe the
      // aria-disabled Base UI sets itself on a `disabled` switch.
      {...(blocked ? { "aria-disabled": true } : null)}
      // Read-only is how Base UI keeps a switch focusable but fixed.
      readOnly={readOnly || blocked}
      className={cn(
        "peer group/switch relative inline-flex h-8 w-13 shrink-0 items-center rounded-round border-0 focus-ring transition-colors duration-quick outline-none after:absolute after:-inset-1.5",
        "data-checked:bg-select data-unchecked:bg-surface-2 data-unchecked:edge-strong hover:data-unchecked:bg-raised",
        "aria-invalid:edge-invalid aria-invalid:data-unchecked:edge-invalid",
        // Unavailable: grey, never faded, and the thumb still shows on or off.
        "aria-disabled:cursor-not-allowed aria-disabled:data-checked:bg-edge-strong aria-disabled:data-unchecked:bg-surface-2 aria-disabled:data-unchecked:edge",
        "data-disabled:cursor-not-allowed data-disabled:data-checked:bg-edge-strong data-disabled:data-unchecked:bg-surface-2 data-disabled:data-unchecked:edge",
        "aria-disabled:hover:data-unchecked:bg-surface-2 data-disabled:hover:data-unchecked:bg-surface-2",
        // Forced colours drop the fill and the edge: keep an outline.
        "forced-colors:border",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-6 rounded-round bg-surface shadow-control transition-transform duration-quick group-active/switch:scale-90 group-aria-disabled/switch:scale-100 group-data-disabled/switch:scale-100 forced-colors:border-12 data-checked:translate-x-6 data-unchecked:translate-x-1 forced-colors:data-unchecked:translate-x-0.5"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
