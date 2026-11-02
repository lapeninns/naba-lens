import Link from "next/link"
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr"

import { logout } from "@/app/_media/actions"
import { AppShell } from "@/components/nabalens/app-shell"
import { EmptyState } from "@/components/nabalens/empty-state"
import { ProfileAvatar } from "@/components/nabalens/profile-avatar"
import { buttonVariants } from "@/components/ui/button"
import { requireActiveStaff } from "@/lib/auth"
import { departmentLabel } from "@/lib/config/departments"
import {
  listCommunityMembers,
  listCommunityVenues,
} from "@/lib/server/community"
import { getMediaActor } from "@/lib/server/media/context"

import { canManageVenue } from "../can-manage"
import { CommunityFilters } from "../community/community-filters"
import {
  communityFilters,
  searchValue,
  type CommunitySearch,
} from "../community/search"

export const metadata = { title: "People · Naba-Lens" }

const PAGE_SIZE = 24

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
  const parsedOffset = Number(searchValue(search.offset))
  const offset =
    Number.isInteger(parsedOffset) &&
    parsedOffset > 0 &&
    parsedOffset <= 100_000
      ? parsedOffset
      : 0
  const [people, options, canManage] = await Promise.all([
    listCommunityMembers(auth.actor, {
      venueId,
      department,
      search: query,
      offset,
      limit: PAGE_SIZE,
    }),
    listCommunityVenues(auth.actor),
    canManageVenue(auth.actor),
  ])
  if (!people.ok) throw new Error(people.message)
  if (!options.ok) throw new Error(options.message)
  const params = new URLSearchParams()
  if (venueId) params.set("venue", venueId)
  if (department) params.set("department", department)
  if (query) params.set("q", query)
  function pageHref(next: number) {
    const nextParams = new URLSearchParams(params)
    if (next > 0) nextParams.set("offset", String(next))
    return `/staff/people?${nextParams.toString()}`
  }

  return (
    <AppShell
      variant="staff"
      active="people"
      canManage={canManage}
      userName={profile.displayName}
      logoutAction={logout}
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-muted-foreground">
            Lapen Inns community
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Meet our people
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Find colleagues across our venues and take a look at their work.
          </p>
        </div>
        <CommunityFilters
          key={params.toString()}
          action="/staff/people"
          venues={options.venues}
          venueId={venueId}
          department={department}
          query={query}
        />
        {people.members.length ? (
          <ul
            aria-label="Colleagues"
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            {people.members.map((member) => (
              <li key={member.id}>
                <Link
                  href={`/staff/people/${member.id}`}
                  className="flex h-full flex-col gap-4 rounded-xl border bg-card p-5 transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <ProfileAvatar
                      name={member.displayName}
                      src={member.avatarUrl}
                      className="size-12"
                    />
                    <div className="min-w-0">
                      <h2 className="font-semibold break-words">
                        {member.displayName}
                      </h2>
                      {member.jobTitle ? (
                        <p className="text-sm text-muted-foreground">
                          {member.jobTitle}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                    <p>{member.venueName ?? "No venue assigned"}</p>
                    {member.department ? (
                      <p>{departmentLabel(member.department)}</p>
                    ) : null}
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">
                      {member.mediaCount}{" "}
                      {member.mediaCount === 1 ? "upload" : "uploads"}
                    </span>
                    <span className="inline-flex items-center gap-1 font-medium">
                      View portfolio{" "}
                      <ArrowRightIcon className="size-4" aria-hidden />
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No colleagues match these filters."
            description="Try a different name, venue or team."
          />
        )}
        {offset > 0 || people.nextOffset !== null ? (
          <nav aria-label="People pages" className="flex justify-between gap-3">
            {offset > 0 ? (
              <Link
                href={pageHref(Math.max(0, offset - PAGE_SIZE))}
                className={buttonVariants({
                  variant: "outline",
                  size: "touch",
                })}
              >
                Previous people
              </Link>
            ) : (
              <span />
            )}
            {people.nextOffset !== null ? (
              <Link
                href={pageHref(people.nextOffset)}
                className={buttonVariants({
                  variant: "outline",
                  size: "touch",
                })}
              >
                Next people
              </Link>
            ) : null}
          </nav>
        ) : null}
      </div>
    </AppShell>
  )
}
