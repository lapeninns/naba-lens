import Link from "next/link"

import { logout } from "@/app/_media/actions"
import { AppShell } from "@/components/nabalens/app-shell"
import { EmptyState } from "@/components/nabalens/empty-state"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { buttonVariants } from "@/components/ui/button"
import { requireActiveStaff } from "@/lib/auth"
import { listCommunityVenues } from "@/lib/server/community"
import { getMediaActor } from "@/lib/server/media/context"

import { canManageVenue } from "../can-manage"
import {
  communityFilters,
  searchValue,
  type CommunitySearch,
} from "../community/search"
import { listPeople } from "./directory"
import {
  isSearching,
  noResults,
  PEOPLE_COPY,
  PEOPLE_PAGE_SIZE,
  searchSummary,
  showingRange,
  shownCount,
} from "./people"
import { PeopleSearch } from "./people-search"
import { PersonCard } from "./person-card"

export const metadata = { title: "People · Naba-Lens" }

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<CommunitySearch>
}) {
  const profile = await requireActiveStaff()
  const auth = await getMediaActor("staff")
  if (!auth.ok) throw new Error(auth.message)
  const search = await searchParams
  const { venueId, department } = communityFilters(search)
  const query = searchValue(search.q).trim().slice(0, 80)
  const [people, options, canManage] = await Promise.all([
    listPeople(auth.actor, { venueId, department, search: query }),
    listCommunityVenues(auth.actor),
    canManageVenue(auth.actor),
  ])
  if (!people.ok) throw new Error(people.message)
  if (!options.ok) throw new Error(options.message)
  const venueName =
    options.venues.find((venue) => venue.id === venueId)?.name ?? null
  const described = { query, venueName, department }
  const summary = searchSummary(described)
  const total = people.members.length
  const shown = shownCount(searchValue(search.shown), total)
  const members = people.members.slice(0, shown)
  const params = new URLSearchParams()
  if (venueId) params.set("venue", venueId)
  if (department) params.set("department", department)
  if (query) params.set("q", query)
  const nextParams = new URLSearchParams(params)
  nextParams.set("shown", String(shown + PEOPLE_PAGE_SIZE))
  const empty = noResults(described)
  const clearSearch = (
    <Link
      href="/staff/people"
      className={buttonVariants({ variant: "secondary", size: "sm" })}
    >
      {PEOPLE_COPY.clear}
    </Link>
  )

  return (
    <AppShell
      variant="staff"
      active="people"
      canManage={canManage}
      userName={profile.displayName}
      logoutAction={logout}
    >
      <div className="flex flex-col gap-4">
        <OfflineNotice />
        <PageHeader
          scope={PEOPLE_COPY.scope}
          title={PEOPLE_COPY.title}
          summary={PEOPLE_COPY.summary}
          className="pb-0 md:pb-0"
        />
        <PeopleSearch
          key={params.toString()}
          venues={options.venues}
          venueId={venueId}
          department={department}
          query={query}
        />
        {total === 0 ? (
          <EmptyState
            variant={isSearching(described) ? "filtered" : "done"}
            title={empty.title}
            description={empty.description}
            action={isSearching(described) ? clearSearch : undefined}
          />
        ) : (
          <>
            {summary ? (
              <p
                role="status"
                className="text-body-touch text-ink-muted md:text-body-sm"
              >
                {summary}
              </p>
            ) : null}
            <ul
              aria-label="People"
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            >
              {members.map((member) => (
                <li key={member.id}>
                  <PersonCard member={member} />
                </li>
              ))}
            </ul>
            {total > PEOPLE_PAGE_SIZE ? (
              <div className="grid justify-items-center gap-2">
                {shown < total ? (
                  <Link
                    href={`/staff/people?${nextParams.toString()}`}
                    scroll={false}
                    className={buttonVariants({
                      variant: "secondary",
                      size: "touch",
                      className: "w-full md:w-auto",
                    })}
                  >
                    {PEOPLE_COPY.next}
                  </Link>
                ) : null}
                <p className="text-meta-touch text-ink-muted tabular-nums md:text-meta">
                  {showingRange(shown, total)}
                </p>
              </div>
            ) : null}
            {summary ? (
              <Link
                href="/staff/people"
                className={buttonVariants({
                  variant: "link",
                  className: "w-fit",
                })}
              >
                {PEOPLE_COPY.clear}
              </Link>
            ) : null}
          </>
        )}
      </div>
    </AppShell>
  )
}
