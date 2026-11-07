import { cn } from "@/lib/utils"

/**
 * A section header on the grey canvas (DESIGN.md §4 `.sec-head`): Figtree
 * 21/700 title, an optional link or count on the right, an optional scope
 * line under it. Sits 4px in from the cards' edge, like a feed heading.
 */
export function SectionHeader({
  title,
  as: Element = "h2",
  id,
  action,
  scope,
  className,
}: {
  title: React.ReactNode
  as?: "h2" | "h3"
  id?: string
  /** A link ("See all") or a count on the right. */
  action?: React.ReactNode
  /** A ScopeLabel under the title. */
  scope?: React.ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="cr-section-header"
      className={cn("grid gap-1 px-1 pt-2", className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Element id={id} className="font-display text-section-title text-ink">
          {title}
        </Element>
        {action}
      </div>
      {scope}
    </div>
  )
}
