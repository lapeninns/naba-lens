import Link from "next/link"
import type { Icon } from "@phosphor-icons/react"

import { cn } from "@/lib/utils"

export type SideNavItem = {
  id: string
  label: string
  href: string
  icon: Icon
  /**
   * Work waiting on this person (v2 `nl-rail__count`), such as the review
   * queue. The label is read after the number ("photos to review").
   */
  count?: { value: number; label: string }
}

/**
 * v2 SideNav (docs/design-system/v2/components/SideNav, D10): the side rail
 * for managers and admins from bp-desktop (1100px, `desktop:`). Below that
 * width the shells keep their own navigation: the manager's phone TabBar and
 * section row, and the admin's tab bar with More.
 *
 * The rail is `rail` (240px) wide on surface, fixed to the left edge; the
 * shell pads its content column by the same width (`desktop:pl-rail`), so
 * the VenueBar or page header sits beside it. The name at the top is plain
 * text in `title` with no logo. The current item has `aria-current="page"`,
 * a bottle-soft ground and bottle text; hover is surface-hover. Items are
 * one level: no nesting.
 */
export function SideNav({
  label,
  items,
  active,
  homeHref,
  className,
}: {
  /** The navigation's accessible name ("Admin", "Venue workspace"). */
  label: string
  items: SideNavItem[]
  /** The id of the current item; none is current when nothing matches. */
  active: string
  /** Where the name at the top links to. */
  homeHref: string
  className?: string
}) {
  return (
    // The whole rail is the navigation landmark, so the name at the top is
    // reached by landmark too (v2 SideNav example; review Z7).
    <nav
      aria-label={label}
      data-slot="side-nav"
      className={cn(
        "fixed inset-y-0 left-0 z-nav hidden w-rail flex-col gap-4 overflow-y-auto border-r border-line bg-surface px-2 py-4 desktop:flex",
        className
      )}
    >
      <Link
        href={homeHref}
        className="mx-1 self-start rounded-control px-2 type-title text-ink focus-ring outline-none"
      >
        Naba-Lens
      </Link>
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const Icon = item.icon
          const current = item.id === active
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                data-nav-item
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex min-h-10 items-center gap-3 rounded-control px-3 py-2 text-label text-ink-muted focus-ring transition-colors duration-quick outline-none hover:bg-raised hover:text-ink",
                  current &&
                    "bg-accent-soft text-accent-text hover:bg-accent-soft hover:text-accent-text"
                )}
              >
                <Icon aria-hidden className="size-5 shrink-0" />
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {item.label}
                </span>
                {item.count && item.count.value > 0 ? (
                  <span
                    data-slot="side-nav-count"
                    className="ml-auto font-mono text-chip"
                  >
                    <span className="sr-only">, </span>
                    {item.count.value}
                    <span className="sr-only"> {item.count.label}</span>
                  </span>
                ) : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
