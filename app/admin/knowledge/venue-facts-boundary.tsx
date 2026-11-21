"use client"

import { usePathname } from "next/navigation"

import { AdminErrorPage, AdminLoadingPage } from "../_components/admin-boundary"
import {
  ADMIN_SECTION_TITLES,
  AdminTabs,
  VENUE_FACTS_PICKS,
  VenueFactsPicks,
} from "../_components/admin-tabs"

/** The Venue facts view a /admin/knowledge path shows, and its words. */
function useVenueFactsView() {
  const pathname = usePathname() ?? ""
  const pick =
    VENUE_FACTS_PICKS.find((p) => pathname.startsWith(p.href)) ??
    VENUE_FACTS_PICKS[0]
  const detail = pathname.startsWith(`${VENUE_FACTS_PICKS[1].href}/`)
  return { pick, detail }
}

function frameOf(view: ReturnType<typeof useVenueFactsView>) {
  // One import (runs/[runId]) is a detail page of Imports.
  return view.detail
    ? {
        section: "settings" as const,
        title: "The import",
        back: { href: view.pick.href, label: view.pick.label },
      }
    : {
        section: "settings" as const,
        title: ADMIN_SECTION_TITLES.settings,
        tabs: (
          <div className="grid gap-3">
            <AdminTabs set="settings" active="venue-facts" />
            <VenueFactsPicks active={view.pick.id} />
          </div>
        ),
      }
}

/**
 * Settings › Venue facts boundaries (redesign R5): the Settings title, tabs
 * and pick of the view that failed or is loading, never "Library".
 */
export function VenueFactsError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  const view = useVenueFactsView()
  return (
    <AdminErrorPage
      {...frameOf(view)}
      what={`${view.pick.label} couldn't be loaded`}
      error={error}
      retry={retry}
    />
  )
}

export function VenueFactsLoading() {
  const view = useVenueFactsView()
  return (
    <AdminLoadingPage
      {...frameOf(view)}
      label={`Loading ${view.pick.label.toLowerCase()}…`}
    />
  )
}
