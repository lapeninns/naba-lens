import Link from "next/link"
import { CaretRightIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr"

import type { MenuVenueSummary } from "@/lib/menus/types"
import { cn } from "@/lib/utils"

import { EmptyState } from "../empty-state"
import { formatDate } from "../format"
import { StatusChip } from "../status-chip"
import { plural } from "./copy"
import { MenuVersionStatusBadge } from "./menu-version-status-badge"
import {
  MenuSectionHead,
  menuItemTitleClassName,
  menuListClassName,
  menuMetaClassName,
  menuRowLinkClassName,
} from "./section-head"

type MenuVenueListProps = {
  venues: MenuVenueSummary[]
  getVenueHref: (venueId: string) => string
  className?: string
}

/** Active menus, drafts, waiting suggestions and venues without a menu. */
export function MenuVenueTally({
  venues,
  className,
}: {
  venues: MenuVenueSummary[]
  className?: string
}) {
  const active = venues.filter((v) => v.active).length
  const missing = venues.length - active
  const cells: {
    label: string
    value: React.ReactNode
    attention?: boolean
  }[] = [
    {
      label: "Active menus",
      value: (
        <>
          {active}
          <small className="ml-1 text-meta-touch font-normal text-ink-muted md:text-meta">
            of {venues.length}
          </small>
        </>
      ),
    },
    {
      label: "Drafts",
      value: venues.reduce((n, v) => n + v.draftCount, 0),
    },
    {
      label: "Suggestions waiting",
      value: venues.reduce((n, v) => n + v.openSuggestionCount, 0),
    },
    {
      label: "No active menu",
      value: missing,
      attention: missing > 0,
    },
  ]
  return (
    <dl
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-line bg-line md:grid-cols-4",
        className
      )}
    >
      {cells.map((cell) => (
        <div
          key={cell.label}
          className="grid content-start gap-1 bg-panel px-4 py-3"
        >
          <dt className="text-meta-touch font-semibold text-ink-muted md:text-meta-strong">
            {cell.label}
          </dt>
          <dd
            className={cn(
              "flex items-center gap-1.5 text-count-sm text-ink tabular-nums",
              cell.attention && "text-attention"
            )}
          >
            {cell.attention ? (
              <WarningIcon aria-hidden className="size-5 shrink-0" />
            ) : null}
            {cell.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * Venues with their active menu, drafts and waiting suggestions. No client
 * state, so a Server Component page can pass `getVenueHref` directly.
 */
export function MenuVenueList({
  venues,
  getVenueHref,
  className,
}: MenuVenueListProps) {
  if (venues.length === 0) {
    return (
      <EmptyState
        className={className}
        title="No active venues yet."
        description="Menus appear here once a venue is set up. Venues are added through setup."
      />
    )
  }

  return (
    <section aria-labelledby="menu-venues-title" className={className}>
      <MenuSectionHead
        id="menu-venues-title"
        title="Venues"
        count={plural(venues.length, "venue")}
      />
      <ul aria-label="Venue menus" className={menuListClassName}>
        {venues.map((venue) => {
          const active = venue.active
          return (
            <li key={venue.venueId}>
              <Link
                href={getVenueHref(venue.venueId)}
                className={menuRowLinkClassName}
              >
                <span className="grid min-w-0 flex-1 gap-1">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className={cn("break-words", menuItemTitleClassName)}>
                      {venue.venueName}
                    </span>
                    {active ? (
                      <MenuVersionStatusBadge status="active" />
                    ) : (
                      <StatusChip state="no_active_menu" />
                    )}
                    {venue.draftCount > 0 ? (
                      <MenuVersionStatusBadge status="draft" />
                    ) : null}
                    {venue.openSuggestionCount > 0 ? (
                      <StatusChip tone="neutral">
                        {plural(venue.openSuggestionCount, "suggestion")}
                      </StatusChip>
                    ) : null}
                    {!venue.venueActive ? (
                      <StatusChip tone="closed">Venue inactive</StatusChip>
                    ) : null}
                  </span>
                  <span className={cn("break-words", menuMetaClassName)}>
                    {active
                      ? [
                          active.title,
                          plural(active.itemCount, "item"),
                          active.activatedAt
                            ? `activated ${formatDate(active.activatedAt)}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : `Labels can't name a menu item at ${venue.venueName} until a menu is active`}
                  </span>
                </span>
                <CaretRightIcon
                  className="size-4 shrink-0 text-ink-muted"
                  aria-hidden
                />
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
