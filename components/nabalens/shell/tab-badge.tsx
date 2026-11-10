import { cn } from "@/lib/utils"

/**
 * A count on a tab. On the phone bar (`tab`) it sits just right of the
 * icon's centre and is capped at "9+", so a two-digit count stays inside a
 * 62px tab at 320px; `inline` follows a desktop tab's label. The full number
 * is still read out. `unknown` is a neutral "?" for a count that couldn't be
 * read, never a missing or smaller number.
 */
export function TabBadge({
  count,
  label,
  unknown = false,
  placement = "tab",
  className,
}: {
  count?: number
  /** Accessible text after the number, e.g. "things to do". */
  label: string
  unknown?: boolean
  placement?: "tab" | "inline"
  className?: string
}) {
  const known = !unknown && count !== undefined && count > 0
  if (!known && !unknown) return null
  return (
    <span
      data-slot="count"
      data-tone={unknown ? "neutral" : "warn"}
      className={cn(
        "inline-grid place-items-center rounded-round font-mono leading-none font-bold tabular-nums",
        placement === "tab"
          ? "absolute top-1 left-[calc(50%+2px)] h-[22px] min-w-[22px] px-[5px] text-[0.875rem] ring-2 ring-surface"
          : "-ml-0.5 h-[26px] min-w-[26px] px-[7px] text-[1.0625rem]",
        unknown ? "bg-ink-muted text-surface" : "bg-warn-fg text-surface",
        className
      )}
    >
      {unknown ? (
        <>
          <span className="sr-only">, </span>
          <span aria-hidden>?</span>
          <span className="sr-only">{BADGE_UNKNOWN}</span>
        </>
      ) : (
        count! > 9 ? (
          <>
            <span aria-hidden>9+</span>
            <span className="sr-only">{`, ${count} ${label}`}</span>
          </>
        ) : (
          <>
            <span className="sr-only">, </span>
            {count}
            <span className="sr-only"> {label}</span>
          </>
        )
      )}
    </span>
  )
}

export const BADGE_UNKNOWN = "couldn't check"
