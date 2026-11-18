import Link from "next/link"

import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { VenueAccessUnavailable } from "@/components/nabalens/manager/venue-access-unavailable"
import { VenueHistoryPager } from "@/components/nabalens/manager/venue/venue-history-pager"
import { PageHeader } from "@/components/nabalens/page-header"
import { FilterPill, PillGroup } from "@/components/ui/filter-pill"
import { getManagerWorkspace } from "@/lib/auth/manager"
import { HISTORY_SOURCES, isHistorySource } from "@/lib/manager/venue"
import { getVenueHistory } from "@/lib/server/manager/venue"
import { getMediaActor } from "@/lib/server/media/context"

export const metadata = { title: "Venue history" }

/**
 * The venue's change history (spec §7 M5; S2-MGR), newest first, with a
 * filter by kind of change (`?source=`) and paging in place.
 */
export default async function ManagerVenueHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const workspace = await getManagerWorkspace()
  if (workspace.status !== "available")
    return <VenueAccessUnavailable reason={workspace.reason} refreshShell />
  const auth = await getMediaActor("manager")
  if (!auth.ok) {
    if (auth.status === 403)
      return <VenueAccessUnavailable reason="no_grant" refreshShell />
    throw new Error(auth.message)
  }
  const raw = (await searchParams).source
  const source = isHistorySource(raw) ? raw : null
  const result = await getVenueHistory(auth.actor, { source, limit: 30 })
  if (!result.ok) {
    if (result.code === "forbidden")
      return <VenueAccessUnavailable reason="no_grant" refreshShell />
    throw new Error(result.message)
  }
  const copy = MANAGER_COPY.venueHistory
  const href = (key: string | null) =>
    key
      ? `${managerHrefs.venueHistory}?source=${encodeURIComponent(key)}`
      : managerHrefs.venueHistory
  return (
    <div className="grid gap-gutter">
      <PageHeader
        scope={[
          workspace.venue.name,
          <Link
            key="venue"
            href={managerHrefs.venue}
            className="rounded-control underline underline-offset-4 focus-ring"
          >
            {MANAGER_COPY.venue.title}
          </Link>,
        ]}
        venueScope
        title={copy.title}
        summary={copy.summary}
        className="pb-0 md:pb-0"
      />
      <PillGroup label="Kind of change">
        <FilterPill href={href(null)} selected={source === null} current="page">
          {copy.all}
        </FilterPill>
        {HISTORY_SOURCES.map((s) => (
          <FilterPill
            key={s.key}
            href={href(s.key)}
            selected={source === s.key}
            current="page"
          >
            {s.label}
          </FilterPill>
        ))}
      </PillGroup>
      {result.page.items.length === 0 ? (
        <p className="text-body text-ink-muted">{copy.empty}</p>
      ) : (
        <VenueHistoryPager
          key={source ?? "all"}
          items={result.page.items}
          nextCursor={result.page.nextCursor}
          source={source}
        />
      )}
    </div>
  )
}
