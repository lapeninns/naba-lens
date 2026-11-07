"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"
import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        // Track 52x32 (sm 40x24) with a 44px hit area; on = the person's
        // selection mark (--select), off = grey with a strong edge.
        "peer group/switch relative inline-flex shrink-0 items-center rounded-round border-0 transition-colors duration-(--duration-quick) outline-none after:absolute after:-inset-x-1.5 after:-inset-y-1.5 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid aria-invalid:shadow-[inset_0_0_0_2px_var(--warn-fg)] data-[size=default]:h-8 data-[size=default]:w-13 data-[size=sm]:h-6 data-[size=sm]:w-10 data-checked:bg-select data-unchecked:bg-surface-2 data-unchecked:shadow-[inset_0_0_0_1.5px_var(--border-strong)] data-disabled:cursor-not-allowed data-disabled:opacity-60",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-round bg-surface shadow-[0_1px_2px_oklch(0.2_0.01_250/0.3)] transition-transform duration-(--duration-quick) group-data-[size=default]/switch:size-6 group-data-[size=sm]/switch:size-[18px] group-data-[size=default]/switch:data-checked:translate-x-[24px] group-data-[size=sm]/switch:data-checked:translate-x-[19px] group-data-[size=default]/switch:data-unchecked:translate-x-1 group-data-[size=sm]/switch:data-unchecked:translate-x-[3px]"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
