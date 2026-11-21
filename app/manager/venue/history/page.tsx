import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { VenueAccessUnavailable } from "@/components/nabalens/manager/venue-access-unavailable"
import { VenueHistoryPager } from "@/components/nabalens/manager/venue/venue-history-pager"
import { ManagerTabs } from "@/components/nabalens/manager/manager-tabs"
import { LinkSelect } from "@/components/nabalens/link-select"
import { PageHeader } from "@/components/nabalens/page-header"
import { FilterPill, PillGroup } from "@/components/ui/filter-pill"
import { getManagerWorkspace } from "@/lib/auth/manager"
import { HISTORY_SOURCES, isHistorySource } from "@/lib/manager/venue"
import { getVenueHistory } from "@/lib/server/manager/venue"
import { getMediaActor } from "@/lib/server/media/context"

export const metadata = { title: "Venue history" }

/**
 * The venue's change history (spec §7 M5; S2-MGR), newest first, with a
 * filter by kind of change (`?source=`) and paging in place. Second
 * handoff: the three kinds used most are chips, the other six sit in one
 * "More kinds" Select.
 */
const LEADING = ["menu_photo", "fact_check", "menu"] as const
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
  const leading = LEADING.flatMap(
    (key) => HISTORY_SOURCES.find((s) => s.key === key) ?? []
  )
  const more = HISTORY_SOURCES.filter(
    (s) => !(LEADING as readonly string[]).includes(s.key)
  )
  return (
    <div className="grid gap-gutter">
      <PageHeader
        scope={workspace.venue.name}
        venueScope
        title={MANAGER_COPY.venue.title}
        summary={copy.summary}
        className="pb-0 md:pb-0"
      />
      <ManagerTabs section="venue" active="history" />
      <div className="flex flex-wrap items-center gap-2">
        <PillGroup label={copy.kindLabel}>
          <FilterPill
            href={href(null)}
            selected={source === null}
            current="page"
          >
            {copy.all}
          </FilterPill>
          {leading.map((s) => (
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
        <LinkSelect
          aria-label={copy.moreKinds}
          placeholder={copy.moreKinds}
          className="w-auto min-w-44"
          value={more.some((s) => s.key === source) ? source : null}
          options={more.map((s) => ({
            id: s.key,
            name: s.label,
            href: href(s.key),
          }))}
        />
      </div>
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
