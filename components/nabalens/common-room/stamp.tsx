import { CheckIcon } from "@phosphor-icons/react/dist/ssr"

import { cn } from "@/lib/utils"

import { CHIP_STATES } from "../status-chip"

/**
 * The large Complete stamp on a checklist item header (DESIGN.md §3): ink,
 * 2px radius, a 5px double border, Figtree 21/800 caps. The stamp shape is
 * Complete's alone; the word is the state's own (CSS sets the caps).
 */
export function Stamp({
  children = CHIP_STATES.complete.word,
  className,
}: {
  children?: React.ReactNode
  className?: string
}) {
  return (
    <span
      data-slot="cr-stamp"
      className={cn(
        "inline-flex items-center gap-2 justify-self-start rounded-stamp border-[5px] border-double border-stamp-fg px-3.5 py-1.5 font-display text-[1.3125rem] leading-[1.1] font-extrabold tracking-[0.08em] text-stamp-fg uppercase",
        className
      )}
    >
      <CheckIcon aria-hidden weight="bold" className="size-[22px] shrink-0" />
      <span>{children}</span>
    </span>
  )
}
