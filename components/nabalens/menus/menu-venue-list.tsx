import Link from "next/link"
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr"

import type { MenuVenueSummary } from "@/lib/menus/types"
import { cn } from "@/lib/utils"

import { formatDate } from "../format"
import { plural } from "./copy"
import { MenuVersionStatusBadge } from "./menu-version-status-badge"

type MenuVenueListProps = {
  venues: MenuVenueSummary[]
  getVenueHref: (venueId: string) => string
  className?: string
}

/**
 * Venues with their active catalogue, drafts and open suggestions. No client
 * state, so a Server Component page can pass `getVenueHref` directly.
 */
export function MenuVenueList({
  venues,
  getVenueHref,
  className,
}: MenuVenueListProps) {
  if (venues.length === 0) {
    return (
      <p
        className={cn(
          "rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground",
          className
        )}
      >
        No venues yet.
      </p>
    )
  }

  return (
    <ul
      aria-label="Venue menus"
      className={cn("divide-y rounded-lg border bg-card", className)}
    >
      {venues.map((venue) => {
        const active = venue.active
        return (
          <li key={venue.venueId}>
            <Link
              href={getVenueHref(venue.venueId)}
              className="flex min-h-16 items-center gap-3 rounded-lg px-3 py-3 outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-4"
            >
              <span className="grid min-w-0 flex-1 gap-1">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="truncate font-medium">
                    {venue.venueName}
                  </span>
                  {!venue.venueActive ? (
                    <span className="inline-flex h-5 items-center rounded-sm bg-muted px-1.5 text-xs font-medium text-muted-foreground">
                      Venue inactive
                    </span>
                  ) : null}
                </span>
                {active ? (
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                    <MenuVersionStatusBadge status="active" />
                    <span className="min-w-0 truncate text-foreground">
                      {active.title}
                    </span>
                    <span>
                      {[
                        active.activatedAt
                          ? `Activated ${formatDate(active.activatedAt)}`
                          : null,
                        plural(active.itemCount, "item"),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    No active menu. Staff can still add content types and notes.
                  </span>
                )}
                {venue.draftCount > 0 || venue.openSuggestionCount > 0 ? (
                  <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    {venue.draftCount > 0 ? (
                      <span>{plural(venue.draftCount, "draft")}</span>
                    ) : null}
                    {venue.openSuggestionCount > 0 ? (
                      <span className="font-medium text-warning">
                        {plural(venue.openSuggestionCount, "open suggestion")}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </span>
              <CaretRightIcon
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
