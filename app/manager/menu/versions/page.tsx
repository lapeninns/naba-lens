import Link from "next/link"

import { VenueAccessUnavailable } from "@/components/nabalens/manager/venue-access-unavailable"
import { Notice } from "@/components/nabalens/notice"
import {
  OfflineNotice,
  OFFLINE_BANNER_CLASS,
} from "@/components/nabalens/offline-notice"
import { BackLink } from "@/components/nabalens/back-link"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { PageHeader } from "@/components/nabalens/page-header"
import { StatusChip } from "@/components/nabalens/status-chip"
import { getManagerWorkspace } from "@/lib/auth/manager"
import { getManagerPhotoCtx } from "@/lib/server/menu-photos"
import {
  listChangeRequests,
  listVenueMenuVersions,
  type ChangeRequestStatus,
  type VenueMenuVersion,
} from "@/lib/server/menus/local"

import { isRefusal } from "../../load-overview"

export const metadata = { title: "Menus and change requests" }

const LINK =
  "rounded-square font-semibold text-ink underline decoration-1 underline-offset-4 focus-ring outline-none hover:decoration-2"

/** A request's chip (status-chip.tsx holds the words; second handoff). */
const requestChip = (status: ChangeRequestStatus) => `change_request_${status}`

const VERSION_CHIP: Record<VenueMenuVersion["state"], string> = {
  active: "active_menu",
  scheduled: "draft",
  retired: "retired_menu",
}

const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(iso))
    : "—"

function versionLine(v: VenueMenuVersion): string {
  switch (v.state) {
    case "active":
      return `Current menu since ${when(v.activatedAt)} · ${v.itemCount} items`
    case "scheduled":
      return `Starts ${when(v.scheduledFor)} · ${v.itemCount} items${
        v.upcomingCount ? ` · ${v.upcomingCount} new` : ""
      }${v.retiringCount ? ` · ${v.retiringCount} leaving` : ""}`
    case "retired":
      return `Retired ${when(v.retiredAt)}`
  }
}

/**
 * The venue's menus (spec §7 M5): the current one, any scheduled for later
 * (a future menu changes nothing until it starts, AC27), retired ones with
 * `?archived=1`, and this venue's requests for permanent changes. Second
 * handoff: the two lists sit side by side from 768px and each row carries
 * its state as a chip.
 */
export default async function ManagerMenuVersionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const workspace = await getManagerWorkspace()
  if (workspace.status !== "available")
    return <VenueAccessUnavailable reason={workspace.reason} refreshShell />
  const scope = await getManagerPhotoCtx()
  if (!scope.ok) {
    if (isRefusal(scope.code))
      return <VenueAccessUnavailable reason="no_grant" refreshShell />
    throw new Error(scope.message)
  }
  const archived = (await searchParams).archived === "1"
  const [versions, requests] = await Promise.all([
    listVenueMenuVersions(scope.ctx.actor, {
      venueId: scope.ctx.venueId,
      includeArchived: archived,
    }),
    listChangeRequests(scope.ctx.actor, { venueId: scope.ctx.venueId }),
  ])
  if (!versions.ok) throw new Error(versions.message)
  return (
    <div className="grid gap-gutter">
      <OfflineNotice
        className={OFFLINE_BANNER_CLASS}
        loadedAt={new Date().toISOString()}
      />
      <div className="grid gap-1">
        <BackLink href={managerHrefs.venue} compact>
          Venue
        </BackLink>
        <PageHeader
          scope={workspace.venue.name}
          venueScope
          title="Menus and change requests"
          summary="The current menu and any that start later. An admin imports and schedules them."
          className="pb-0 md:pb-0"
        />
      </div>
      <div className="grid items-start gap-8 md:grid-cols-2 md:gap-gutter">
        <section aria-labelledby="menus-list" className="grid min-w-0 gap-3">
          <h2 id="menus-list" className="px-1 type-section-title text-ink">
            {archived
              ? "Current, scheduled and retired"
              : "Current and scheduled"}
          </h2>
          {versions.versions.length === 0 ? (
            <Notice>No menu yet. An admin adds it.</Notice>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-card bg-surface edge">
              {versions.versions.map((v) => (
                <li
                  key={v.versionId}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-4 py-3"
                >
                  <div className="grid min-w-0 gap-1">
                    <p className="text-label break-words text-ink">{v.title}</p>
                    <p className="text-meta text-ink-muted">{versionLine(v)}</p>
                  </div>
                  <StatusChip state={VERSION_CHIP[v.state]} />
                </li>
              ))}
            </ul>
          )}
          <p className="px-1 text-body">
            <Link
              href={
                archived
                  ? "/manager/menu/versions"
                  : "/manager/menu/versions?archived=1"
              }
              className={LINK}
            >
              {archived ? "Hide retired menus" : "Show retired menus"}
            </Link>
          </p>
        </section>
        <section aria-labelledby="menu-requests" className="grid min-w-0 gap-3">
          <h2 id="menu-requests" className="px-1 type-section-title text-ink">
            Your requests
          </h2>
          {!requests.ok ? (
            <Notice tone="negative">{requests.message}</Notice>
          ) : requests.requests.length === 0 ? (
            <Notice>
              None. Ask for a permanent change from a dish&apos;s page.
            </Notice>
          ) : (
            <>
              <ul className="divide-y divide-line overflow-hidden rounded-card bg-surface edge">
                {requests.requests.map((r) => (
                  <li
                    key={r.requestId}
                    data-request={r.requestId}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-4 py-3"
                  >
                    <div className="grid min-w-0 gap-1">
                      <p className="text-label break-words text-ink">
                        {r.itemName ?? "New dish"}
                      </p>
                      <p className="text-meta break-words text-ink-muted">
                        {r.detail}
                      </p>
                      {r.decisionReason ? (
                        <p className="text-body break-words text-ink">
                          “{r.decisionReason}”
                        </p>
                      ) : null}
                    </div>
                    <StatusChip state={requestChip(r.status)} />
                  </li>
                ))}
              </ul>
              <p className="px-1 text-meta text-ink-muted">
                Ask for a permanent change from a dish&apos;s page.
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
