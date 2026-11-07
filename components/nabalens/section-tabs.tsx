import Link from "next/link"

import { cn } from "@/lib/utils"

import { CountBadge } from "./status-chip"

export type SectionTab = {
  id: string
  label: string
  href: string
  /** Work waiting on this person only, never things that need nothing. */
  count?: { value: number; label: string }
}

/**
 * Links between the views of one scope (a venue's Overview, Review, …). Name
 * the scope in `label` ("Manage The Railway"). Common Room: Figtree labels
 * on a hairline, the current view in accent-text with a 3px bar. On phones
 * the row scrolls sideways rather than wrapping or collapsing into a select. Inline-size
 * containment keeps the unwrapped row from widening an auto grid track above
 * it, which would push a 320px page sideways instead of scrolling the row.
 */
export function SectionTabs({
  label,
  tabs,
  active,
  className,
}: {
  label: string
  tabs: SectionTab[]
  active: string
  className?: string
}) {
  return (
    <nav
      aria-label={label}
      data-slot="section-tabs"
      className={cn(
        "[scrollbar-width:none] overflow-x-auto shadow-[inset_0_-1px_0_var(--line)] contain-inline-size [&::-webkit-scrollbar]:hidden",
        className
      )}
    >
      <ul className="flex gap-1">
        {tabs.map((tab) => {
          const current = tab.id === active
          return (
            <li key={tab.id} className="flex-none">
              <Link
                href={tab.href}
                data-nav-item
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-12 items-center gap-2 rounded-t-control px-3.5 font-display text-tab-label whitespace-nowrap text-ink-muted shadow-[inset_0_-3px_0_transparent] transition-colors duration-(--duration-quick) outline-none hover:bg-surface-2 hover:text-ink focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-focus focus-visible:outline-solid",
                  current &&
                    "font-extrabold text-accent-text shadow-[inset_0_-3px_0_var(--accent-text)] hover:text-accent-text"
                )}
              >
                {tab.label}
                {tab.count ? (
                  <CountBadge count={tab.count.value} label={tab.count.label} />
                ) : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
