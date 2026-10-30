import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeftIcon, CaretRightIcon } from "@phosphor-icons/react/dist/ssr"

import { logout } from "@/app/_media/actions"
import {
  AppShell,
  MenuVersionStatusBadge,
  ProvenanceCard,
  formatDateTime,
  type Option,
} from "@/components/nabalens"
import { buttonVariants } from "@/components/ui/button"
import type { MenuVersionSummary } from "@/lib/menus/types"
import { requireActiveAdmin } from "@/lib/auth"
import { getMediaActor } from "@/lib/server/media/context"
import { getMenuVersion, getVenueMenuOverview } from "@/lib/server/menus"

import { ImportFlow } from "../import-flow"
import { itemOptions } from "../review"
import { NewDraftButtons, SuggestionsPanel } from "../venue-controls"

export const metadata: Metadata = { title: "Menus · NabaLens" }

const versionHref = (id: string) =>
  `/admin/menus/versions/${encodeURIComponent(id)}`

function count(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`
}

function VersionList({
  versions,
  label,
  empty,
}: {
  versions: MenuVersionSummary[]
  label: string
  empty: string
}) {
  if (versions.length === 0)
    return <p className="text-sm text-muted-foreground">{empty}</p>
  return (
    <ul aria-label={label} className="divide-y rounded-lg border bg-card">
      {versions.map((v) => (
        <li key={v.id}>
          <Link
            href={versionHref(v.id)}
            className="flex min-h-14 items-center gap-3 rounded-lg px-3 py-2 outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-4"
          >
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <MenuVersionStatusBadge status={v.status} />
                <span className="min-w-0 font-medium break-words">
                  {v.title}
                </span>
              </span>
              <span className="text-sm text-muted-foreground">
                {[
                  count(v.itemCount, "item"),
                  v.needsReviewCount > 0
                    ? `${v.needsReviewCount} to review`
                    : null,
                  v.status === "retired" && v.retiredAt
                    ? `Retired ${formatDateTime(v.retiredAt)}`
                    : `Updated ${formatDateTime(v.updatedAt)}`,
                  v.createdByName ? `by ${v.createdByName}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <CaretRightIcon
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** One venue: active menu, drafts, import, history and suggestions. */
export default async function VenueMenusPage({
  params,
}: {
  params: Promise<{ venueId: string }>
}) {
  const profile = await requireActiveAdmin()
  const { venueId } = await params
  const auth = await getMediaActor("admin")
  if (!auth.ok) throw new Error("Not authorised.")
  const overview = await getVenueMenuOverview(auth.actor, venueId)
  if (!overview.ok) {
    if (overview.status === 404) notFound()
    throw new Error(overview.message)
  }
  const { venue, active, drafts, history, suggestions } = overview

  // Items of the active menu to link open suggestions to.
  let options: Option[] = []
  if (active && suggestions.some((s) => s.status === "open")) {
    const activeVersion = await getMenuVersion(auth.actor, active.id)
    if (activeVersion.ok)
      options = itemOptions(
        activeVersion.version.document,
        activeVersion.version.archivedItemIds
      )
  }
  const openCount = suggestions.filter((s) => s.status === "open").length

  return (
    <AppShell
      variant="admin"
      active="menus"
      userName={profile.displayName}
      logoutAction={logout}
    >
      <div className="grid gap-8">
        <div className="grid gap-2">
          <Link
            href="/admin/menus"
            className={buttonVariants({
              variant: "ghost",
              className: "h-11 w-fit sm:h-9",
            })}
          >
            <ArrowLeftIcon data-icon="inline-start" aria-hidden />
            All venues
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold break-words">{venue.name}</h1>
            {!venue.active ? (
              <span className="inline-flex h-5 items-center rounded-sm bg-muted px-1.5 text-xs font-medium text-muted-foreground">
                Venue inactive
              </span>
            ) : null}
          </div>
          <p className="max-w-prose text-sm text-muted-foreground">
            This venue&apos;s menu is used to label its photos and videos.
            Activating a menu does not publish it or change any venue website.
          </p>
        </div>

        <section aria-labelledby="active-title" className="grid gap-3">
          <h2 id="active-title" className="text-lg font-medium">
            Active menu
          </h2>
          {active ? (
            <div className="grid gap-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="min-w-0">
                  <span className="font-medium break-words">
                    {active.title}
                  </span>{" "}
                  <span className="text-sm text-muted-foreground">
                    {count(active.sectionCount, "section")},{" "}
                    {count(active.itemCount, "item")}
                  </span>
                </p>
                <Link
                  href={versionHref(active.id)}
                  className={buttonVariants({
                    variant: "outline",
                    className: "h-11 w-fit sm:h-9",
                  })}
                >
                  View active menu
                </Link>
              </div>
              <ProvenanceCard version={active} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No active menu. Staff can still add content types and notes to
              their photos and videos.
            </p>
          )}
        </section>

        <section aria-labelledby="drafts-title" className="grid gap-3">
          <h2 id="drafts-title" className="text-lg font-medium">
            Drafts
          </h2>
          <VersionList
            versions={drafts}
            label="Drafts"
            empty="No drafts. Start one below or import a file."
          />
          <NewDraftButtons venueId={venue.id} hasActive={!!active} />
        </section>

        <ImportFlow venueId={venue.id} hasActive={!!active} />

        <section aria-labelledby="suggestions-title" className="grid gap-3">
          <h2 id="suggestions-title" className="text-lg font-medium">
            Missing-item suggestions{" "}
            <span className="text-muted-foreground">({openCount} open)</span>
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            Staff suggest items that are not on the menu. Link a suggestion to
            an item of the active menu, or dismiss it. A suggestion never adds
            an item by itself.
          </p>
          <SuggestionsPanel suggestions={suggestions} itemOptions={options} />
        </section>

        <section aria-labelledby="history-title" className="grid gap-3">
          <h2 id="history-title" className="text-lg font-medium">
            History
          </h2>
          <VersionList
            versions={history}
            label="Retired and discarded versions"
            empty="No retired or discarded versions."
          />
        </section>
      </div>
    </AppShell>
  )
}
