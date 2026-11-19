import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { FileTextIcon } from "@phosphor-icons/react/dist/ssr"

import {
  AppShell,
  EmptyState,
  MenuSectionHead,
  MenuVersionStatusBadge,
  SOURCE_KIND_LABEL,
  formatDate,
  formatDateTime,
  menuListClassName,
  menuMetaClassName,
  possessive,
  type Option,
} from "@/components/nabalens"
import { ErrorState, ERROR_COPY } from "@/components/nabalens/error-state"
import { PageHeader } from "@/components/nabalens/page-header"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { MenuVersionSummary } from "@/lib/menus/types"
import { requireActiveAdmin } from "@/lib/auth"
import { getMediaActor } from "@/lib/server/media/context"
import {
  getActiveMenuItems,
  getVenueMenuOverview,
  listMenuVenues,
} from "@/lib/server/menus"
import {
  getPackaging,
  listChangeRequests,
  type PackagingItem,
} from "@/lib/server/menus/local"
import { PackagingControl } from "@/components/nabalens/manager/menu/packaging-control"
import { cn } from "@/lib/utils"

import { setPackagingAction } from "../actions"
import { ChangeRequestsPanel } from "../change-requests"
import { RetryButton } from "../retry-button"
import { itemOptions } from "../review"
import {
  SuggestionsPanel,
  VenueMenusView,
  VersionRowActions,
} from "../venue-controls"

export const metadata: Metadata = { title: "Menus" }

const versionHref = (id: string) =>
  `/admin/menus/versions/${encodeURIComponent(id)}`

/** When the version last changed state, in the words of that state. */
function versionWhen(v: MenuVersionSummary): string {
  switch (v.status) {
    case "active":
      return `Activated ${formatDate(v.activatedAt ?? v.updatedAt)}`
    case "retired":
      return `Retired ${formatDate(v.retiredAt ?? v.updatedAt)}`
    case "discarded":
      return `Discarded ${formatDate(v.updatedAt)}`
    default:
      return v.scheduledFor
        ? `Scheduled for ${formatDateTime(v.scheduledFor)}`
        : `Saved ${formatDateTime(v.updatedAt)}`
  }
}

const versionBy = (v: MenuVersionSummary) =>
  (v.status === "active" ? v.activatedByName : null) ?? v.createdByName ?? "—"

function VersionsTable({
  versions,
  venueId,
}: {
  versions: MenuVersionSummary[]
  venueId: string
}) {
  // v2 DataTable (SCREENS A3), framed; phones keep the four-column layout
  // with When, By and Status folded under the title.
  const cell = "px-3 first:pl-4 last:pr-2"
  return (
    <Table framed aria-label="Menu versions">
      <TableHeader>
        <TableRow>
          <TableHead className={cell}>Version</TableHead>
          <TableHead className={cn(cell, "hidden md:table-cell")}>
            Status
          </TableHead>
          <TableHead numeric className={cell}>
            Items
          </TableHead>
          <TableHead className={cn(cell, "hidden md:table-cell")}>
            When
          </TableHead>
          <TableHead className={cn(cell, "hidden md:table-cell")}>By</TableHead>
          <TableHead className={cn(cell, "w-0")}>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {versions.map((v) => {
          const closed = v.status === "retired" || v.status === "discarded"
          return (
            <TableRow key={v.id} className={cn(closed && "text-ink-muted")}>
              <TableCell
                className={cn(
                  cell,
                  "min-w-0 whitespace-normal [&_a]:text-current"
                )}
              >
                <Link
                  href={versionHref(v.id)}
                  className={cn(
                    "rounded-square font-semibold break-words underline decoration-1 underline-offset-4 focus-ring outline-none hover:decoration-2",
                    closed ? "text-ink-muted" : "text-ink"
                  )}
                >
                  {v.title}
                </Link>
                <span className={cn("block md:hidden", menuMetaClassName)}>
                  {versionWhen(v)} · {versionBy(v)}
                </span>
                {/* On phones the status sits under the title and may wrap:
                      "Active · for labelling only" on one line is wider than
                      a 320px table's spare room. */}
                <MenuVersionStatusBadge
                  status={v.status}
                  className="mt-1 whitespace-normal md:hidden"
                />
              </TableCell>
              <TableCell className={cn(cell, "hidden md:table-cell")}>
                <MenuVersionStatusBadge status={v.status} />
              </TableCell>
              <TableCell numeric className={cell}>
                {v.itemCount}
              </TableCell>
              <TableCell
                className={cn(cell, "hidden whitespace-nowrap md:table-cell")}
              >
                {versionWhen(v)}
              </TableCell>
              <TableCell className={cn(cell, "hidden md:table-cell")}>
                {versionBy(v)}
              </TableCell>
              <TableCell className={cell}>
                <VersionRowActions
                  versionId={v.id}
                  title={v.title}
                  venueId={venueId}
                  isActive={v.status === "active"}
                />
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

/** Versions that came from a file, newest first: the import history. */
function ImportHistory({ versions }: { versions: MenuVersionSummary[] }) {
  const imports = versions
    .filter((v) => v.source.kind !== "manual")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  if (imports.length === 0) {
    return (
      <EmptyState
        variant="done"
        title="No files imported yet."
        className="py-0"
      />
    )
  }
  return (
    <ul aria-label="Imported files" className={menuListClassName}>
      {imports.map((v) => (
        <li key={v.id} className="flex items-start gap-3 px-4 py-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-round bg-surface-2 text-ink-muted">
            <FileTextIcon aria-hidden className="size-5" />
          </span>
          <span className="grid min-w-0 gap-0.5">
            <span className="font-mono text-body break-all text-ink">
              {v.source.label ?? SOURCE_KIND_LABEL[v.source.kind]}
            </span>
            <span className={cn("break-words", menuMetaClassName)}>
              {[
                formatDateTime(v.createdAt),
                v.createdByName,
                `became ${v.title}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Items the packaged list shows: drinks, and any item already packaged. */
const packagingRows = (items: PackagingItem[]) =>
  items.filter((i) => i.kind === "drinks" || i.packaged)

/** One venue: versions, import, suggestions and the import history (A13). */
export default async function VenueMenusPage({
  params,
}: {
  params: Promise<{ venueId: string }>
}) {
  const profile = await requireActiveAdmin()
  const { venueId } = await params
  const auth = await getMediaActor("admin")
  if (!auth.ok) throw new Error("Not authorised.")
  const [overview, venueList, requests, packaging] = await Promise.all([
    getVenueMenuOverview(auth.actor, venueId),
    listMenuVenues(auth.actor),
    listChangeRequests(auth.actor, { venueId, status: "open" }),
    getPackaging(auth.actor, venueId),
  ])
  const venues = venueList.ok
    ? venueList.venues.map((v) => ({ id: v.venueId, name: v.venueName }))
    : null

  const shell = (children: React.ReactNode) => (
    <AppShell variant="admin" active="menus" userName={profile.displayName}>
      {children}
    </AppShell>
  )

  if (!overview.ok) {
    if (overview.status === 404) notFound()
    const name = venues?.find((v) => v.id === venueId)?.name
    return shell(
      <>
        <PageHeader
          venueScope
          scope={[name ?? "Venue", "All months"]}
          title={name ? `${name} menus` : "Menus"}
        />
        <ErrorState
          title={ERROR_COPY.couldNotLoad(
            name ? `${possessive(name)} menus` : "this venue's menus"
          )}
          action={<RetryButton />}
        />
      </>
    )
  }
  const { venue, active, drafts, history, suggestions } = overview

  // Items of the active menu to link open suggestions to.
  let options: Option[] = []
  if (active && suggestions.some((s) => s.status === "open")) {
    const items = await getActiveMenuItems(auth.actor, venue.id)
    if (items.ok && items.document)
      options = itemOptions(items.document, items.archivedItemIds)
  }
  const openCount = suggestions.filter((s) => s.status === "open").length
  const versions = [...drafts, ...(active ? [active] : []), ...history]

  return shell(
    <VenueMenusView
      venueId={venue.id}
      venueName={venue.name}
      venueActive={venue.active}
      venues={venues}
      active={active ? { title: active.title } : null}
    >
      {versions.length === 0 ? (
        <EmptyState
          title={`${venue.name} has no menu yet.`}
          description={`Import a JSON or CSV file, or start an empty draft. Until a menu is active, labels can't name a menu item at ${venue.name}.`}
        />
      ) : (
        <>
          <section aria-labelledby="versions-title">
            <MenuSectionHead
              id="versions-title"
              title="Versions"
              count="Nothing with labels is ever deleted"
            />
            <VersionsTable versions={versions} venueId={venue.id} />
          </section>
          <section aria-labelledby="requests-title" className="grid gap-3">
            <MenuSectionHead
              id="requests-title"
              title="Change requests"
              count={
                requests.ok
                  ? `${requests.requests.length} open · from the venue's manager`
                  : "Could not be loaded"
              }
            />
            {requests.ok ? (
              <ChangeRequestsPanel requests={requests.requests} />
            ) : null}
          </section>
          {/* FA-51 (spec §4.2): drinks, and anything already packaged. */}
          {packaging.ok && active ? (
            <section aria-labelledby="packaged-title" className="grid gap-3">
              <MenuSectionHead
                id="packaged-title"
                title="Packaged items"
                count="A packaged item only counts in coverage when a photo is wanted"
              />
              {packagingRows(packaging.items).length === 0 ? (
                <EmptyState
                  variant="done"
                  title="No drinks on the active menu."
                  className="py-0"
                />
              ) : (
                <ul
                  aria-label="Packaged items"
                  data-slot="packaged-items"
                  className={menuListClassName}
                >
                  {packagingRows(packaging.items).map((i) => (
                    <PackagingControl
                      key={i.itemId}
                      variant="row"
                      itemId={i.itemId}
                      name={i.name}
                      venueId={venue.id}
                      detail={
                        i.source === "special" ? "Special" : i.sectionName
                      }
                      value={{
                        packaged: i.packaged,
                        photoWanted: i.photoWanted,
                      }}
                      setAction={setPackagingAction}
                    />
                  ))}
                </ul>
              )}
            </section>
          ) : null}
          <div className="grid items-start gap-6 lg:grid-cols-2">
            <section aria-labelledby="suggestions-title" className="min-w-0">
              <MenuSectionHead
                id="suggestions-title"
                title="Missing-item suggestions"
                count={`${openCount} · typed by staff while labelling`}
              />
              <SuggestionsPanel
                suggestions={suggestions}
                itemOptions={options}
              />
            </section>
            <section aria-labelledby="imports-title" className="min-w-0">
              <MenuSectionHead
                id="imports-title"
                title="Imports"
                count="Source details are kept for reference only"
              />
              <ImportHistory versions={versions} />
            </section>
          </div>
        </>
      )}
    </VenueMenusView>
  )
}
