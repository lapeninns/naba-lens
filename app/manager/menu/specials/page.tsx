import Link from "next/link"

import { VenueAccessUnavailable } from "@/components/nabalens/manager/venue-access-unavailable"
import {
  OfflineNotice,
  OFFLINE_BANNER_CLASS,
} from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { getManagerWorkspace } from "@/lib/auth/manager"
import { getManagerPhotoCtx } from "@/lib/server/menu-photos"
import { listSpecials } from "@/lib/server/menus/local"

import { isRefusal } from "../../load-overview"
import { CreateSpecialForm, SpecialsList } from "../_components/specials-panel"
import {
  createSpecialAction,
  decideSpecialAction,
  reviewSpecialAction,
} from "../local-actions"

export const metadata = { title: "Specials" }

/**
 * Local specials (spec §4.3, §7 M5): add a dated special, approve or decline
 * staff suggestions, and end or extend one at its end date. `?archived=1`
 * also lists ended and declined specials (spec §4.1 archive filter).
 */
export default async function ManagerSpecialsPage({
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
  const read = await listSpecials(scope.ctx.actor, {
    venueId: scope.ctx.venueId,
    includeArchived: archived,
  })
  if (!read.ok) throw new Error(read.message)
  const due = read.specials.filter((s) => s.state === "review_due").length
  return (
    <div className="grid gap-gutter">
      <OfflineNotice
        className={OFFLINE_BANNER_CLASS}
        loadedAt={new Date().toISOString()}
      />
      <PageHeader
        scope={workspace.venue.name}
        venueScope
        title="Specials"
        summary={
          due > 0
            ? `${due === 1 ? "1 special has" : `${due} specials have`} reached the end date. End or extend ${due === 1 ? "it" : "them"}.`
            : "Dated dishes and drinks on at this venue for a while."
        }
        className="pb-0 md:pb-0"
      />
      <CreateSpecialForm today={read.today} create={createSpecialAction} />
      <SpecialsList
        specials={read.specials}
        today={read.today}
        decide={decideSpecialAction}
        review={reviewSpecialAction}
      />
      <p className="px-1 text-body">
        <Link
          href={
            archived
              ? "/manager/menu/specials"
              : "/manager/menu/specials?archived=1"
          }
          className="rounded-square font-bold text-ink underline decoration-1 underline-offset-4 focus-ring outline-none hover:decoration-2"
        >
          {archived
            ? "Hide ended specials"
            : "Show ended and declined specials"}
        </Link>
      </p>
    </div>
  )
}
