import Link from "next/link"
import { CaretDownIcon, UsersIcon } from "@phosphor-icons/react/dist/ssr"

import { AppShell } from "@/components/nabalens/app-shell"
import { IconDisc } from "@/components/nabalens/common-room"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { buttonVariants } from "@/components/ui/button"
import { requireActiveStaff } from "@/lib/auth"
import { listCommunityVenues } from "@/lib/server/community"
import { getMediaActor } from "@/lib/server/media/context"

import { staffShellStatus } from "../_shell/shell-status"
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
  const [people, options, shell] = await Promise.all([
    listPeople(auth.actor, { venueId, department, search: query }),
    listCommunityVenues(auth.actor),
    staffShellStatus(auth.actor, profile),
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
      {...shell}
      userName={profile.displayName}
    >
      {/* Common Room feed: white cards on the grey canvas, one column. */}
      <div className="mx-auto flex w-full max-w-(--size-feed) flex-col gap-(--gutter)">
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
          <PeopleEmpty
            title={empty.title}
            description={empty.description}
            action={isSearching(described) ? clearSearch : undefined}
          />
        ) : (
          <>
            {summary ? (
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1">
                <p role="status" className="text-body text-ink-muted">
                  {summary}
                </p>
                <Link
                  href="/staff/people"
                  className={buttonVariants({
                    variant: "link",
                    className: "w-fit px-0",
                  })}
                >
                  {PEOPLE_COPY.clear}
                </Link>
              </div>
            ) : null}
            <ul
              aria-label="People"
              className="grid min-w-0 divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card"
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
                      className: "w-full",
                    })}
                  >
                    <CaretDownIcon aria-hidden weight="bold" />
                    {PEOPLE_COPY.next}
                  </Link>
                ) : null}
                <p className="font-mono text-meta text-ink-muted tabular-nums">
                  {showingRange(shown, total)}
                </p>
              </div>
            ) : null}
          </>
        )}
      </div>
    </AppShell>
  )
}

/** Nobody to show: a white card with the people disc, why, and what to widen. */
function PeopleEmpty({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div
      data-slot="empty-state"
      className="grid justify-items-center gap-2.5 rounded-card bg-surface px-5 py-8 text-center shadow-card"
    >
      <IconDisc size="lg" className="mb-1 text-ink-muted">
        <UsersIcon />
      </IconDisc>
      <p className="max-w-[32ch] font-display text-section-title text-ink">
        {title}
      </p>
      <p className="max-w-[40ch] text-body text-ink-muted">{description}</p>
      {action ? (
        <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>
      ) : null}
    </div>
  )
}
