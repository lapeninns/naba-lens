import { AlbumLanding } from "@/components/nabalens/album/album-landing"
import { MatchLaterRow } from "@/components/nabalens/album/match/match-later"
import { AppShell } from "@/components/nabalens/app-shell"
import { Notice } from "@/components/nabalens/notice"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { requireActiveStaff, uploadBlockReason } from "@/lib/auth"
import { getCoverageActor } from "@/lib/server/coverage"

import { listMatchLater } from "../_shell/match-later"
import { ownMonth, staffShellStatus } from "../_shell/shell-status"
import { ADD_BLOCKED } from "../add-blocked"
import { unwrap } from "../tasks/result"
import { loadShelves } from "./_shelves"

export const metadata = { title: "Album" }

/**
 * Album's landing (DESIGN.md §5d, D16): the venue's album by type, each with
 * its shelves, under the place lens (`?place=`).
 */
export default async function StaffAlbumPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const profile = await requireActiveStaff()
  const { actor } = unwrap(await getCoverageActor())
  const [params, shell, monthly, later] = await Promise.all([
    searchParams,
    staffShellStatus(actor, profile),
    ownMonth(actor),
    listMatchLater(actor).catch(() => null),
  ])
  const shelves = await loadShelves(actor, params)
  const blocked = uploadBlockReason(profile)

  return (
    <AppShell
      variant="staff"
      active="tasks"
      {...shell}
      userName={profile.displayName}
      venueName={profile.venue?.name}
      monthly={monthly}
    >
      <OfflineNotice className="mb-3" />
      {shelves.ok ? (
        <AlbumLanding
          venueName={profile.venue?.name ?? ""}
          view={shelves.view}
          lens={shelves.lens}
          places={shelves.places}
          searchPlaces={shelves.searchPlaces}
          canAdd={blocked === null}
          blocked={blocked ? ADD_BLOCKED[blocked] : null}
          matchLater={<MatchLaterRow count={later?.length ?? 0} />}
        />
      ) : blocked === "no_venue" ? (
        <Notice role="status">{ADD_BLOCKED.no_venue}</Notice>
      ) : (
        <Notice tone="negative" role="alert">
          {shelves.message}
        </Notice>
      )}
    </AppShell>
  )
}
