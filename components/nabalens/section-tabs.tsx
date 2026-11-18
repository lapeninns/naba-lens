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
 * the scope in `label` ("Manage The Railway"). v2 Tabs (`nl-tabs`, D10):
 * label type in ink-muted, 24px apart on a line, the current view in ink
 * with a 3px bottle bar; a count after the label. On phones
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
      <ul className="flex gap-6">
        {tabs.map((tab) => {
          const current = tab.id === active
          return (
            <li key={tab.id} className="flex-none">
              <Link
                href={tab.href}
                data-nav-item
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-12 items-center gap-2 text-label whitespace-nowrap text-ink-muted shadow-[inset_0_-3px_0_transparent] focus-ring-inset transition-colors duration-quick outline-none hover:text-ink",
                  current &&
                    "text-ink shadow-[inset_0_-3px_0_var(--accent-text)]"
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
