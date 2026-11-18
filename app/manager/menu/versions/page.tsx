import Link from "next/link"

import { VenueAccessUnavailable } from "@/components/nabalens/manager/venue-access-unavailable"
import { Notice } from "@/components/nabalens/notice"
import {
  OfflineNotice,
  OFFLINE_BANNER_CLASS,
} from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { getManagerWorkspace } from "@/lib/auth/manager"
import { getManagerPhotoCtx } from "@/lib/server/menu-photos"
import {
  listChangeRequests,
  listVenueMenuVersions,
  type ChangeRequestStatus,
  type VenueMenuVersion,
} from "@/lib/server/menus/local"

import { isRefusal } from "../../load-overview"

export const metadata = { title: "Menus" }

const LINK =
  "rounded-square font-bold text-ink underline decoration-1 underline-offset-4 focus-ring outline-none hover:decoration-2"

const STATUS_WORD: Record<ChangeRequestStatus, string> = {
  open: "Waiting for an admin",
  approved: "Approved",
  declined: "Declined",
  clarification_requested: "Admin asks for more detail",
  withdrawn: "Withdrawn",
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
 * `?archived=1`, and this venue's requests for permanent changes.
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
      <PageHeader
        scope={workspace.venue.name}
        venueScope
        title="Menus"
        summary="The current menu and any that start later. An admin imports and schedules them."
        className="pb-0 md:pb-0"
      />
      <section aria-labelledby="menus-list" className="grid gap-3">
        <h2 id="menus-list" className="px-1 type-section-title text-ink">
          {archived
            ? "Current, scheduled and retired"
            : "Current and scheduled"}
        </h2>
        {versions.versions.length === 0 ? (
          <Notice>No menu yet. An admin adds it.</Notice>
        ) : (
          <ul className="divide-y divide-line rounded-card bg-surface px-3 shadow-card sm:px-4">
            {versions.versions.map((v) => (
              <li key={v.versionId} className="grid gap-1 py-3">
                <p className="text-body font-bold break-words text-ink">
                  {v.title}
                </p>
                <p className="text-body text-ink-muted">{versionLine(v)}</p>
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
      <section aria-labelledby="menu-requests" className="grid gap-3">
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
          <ul className="divide-y divide-line rounded-card bg-surface px-3 shadow-card sm:px-4">
            {requests.requests.map((r) => (
              <li key={r.requestId} className="grid gap-1 py-3">
                <p className="text-body text-ink">
                  <span className="font-bold">{r.itemName ?? "New dish"}</span>{" "}
                  · {STATUS_WORD[r.status]}
                </p>
                <p className="text-body break-words text-ink-muted">
                  {r.detail}
                </p>
                {r.decisionReason ? (
                  <p className="text-body break-words text-ink">
                    {r.decisionReason}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
