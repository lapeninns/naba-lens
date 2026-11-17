import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type Tone = "warn" | "info"

/**
 * The first item is the lead card (common-room.md §4): a 4px bar along the top in
 * its tone and the page's one blue action. The rest are plain cards with a
 * 4px bar on the left and a grey action.
 */
export function cardClass(primary: boolean, tone?: Tone) {
  return cn(
    "relative grid min-w-0 gap-3 rounded-card bg-surface p-4 shadow-card",
    primary && tone === "warn" && "pt-5 shadow-card rail-top-warn",
    primary && tone === "info" && "pt-5 shadow-card rail-top-info",
    !primary && tone === "warn" && "shadow-card rail-start-warn",
    !primary && tone === "info" && "shadow-card rail-start-info"
  )
}

export function titleClass(primary: boolean) {
  return cn(
    "[overflow-wrap:anywhere] text-ink",
    primary ? "type-section-title" : "text-item-title"
  )
}

/** Kicker on the left, state chip on the right (the lead card's top row). */
export function TopRow({
  kicker,
  chip,
}: {
  kicker?: React.ReactNode
  chip?: React.ReactNode
}) {
  if (!kicker && !chip) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      {kicker ? (
        <span className="min-w-0 text-meta font-semibold [overflow-wrap:anywhere] text-ink-muted">
          {kicker}
        </span>
      ) : (
        <span />
      )}
      {chip}
    </div>
  )
}

export function action(primary: boolean) {
  return buttonVariants({
    variant: primary ? "primary" : "secondary",
    size: primary ? "lg" : "md",
    className: primary ? "w-full" : "w-full sm:w-auto sm:justify-self-start",
  })
}
