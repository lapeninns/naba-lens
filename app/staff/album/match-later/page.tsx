import type { Metadata } from "next"

import { AppShell } from "@/components/nabalens/app-shell"
import { MatchLaterScreen } from "@/components/nabalens/album/match/match-later"
import { Notice } from "@/components/nabalens/notice"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { requireActiveStaff } from "@/lib/auth"
import { getMediaActor } from "@/lib/server/media/context"
import { staffShellStatus } from "@/app/staff/_shell/shell-status"
import { listMatchLater } from "@/app/staff/_shell/match-later"

export const metadata: Metadata = { title: "Match later" }

/**
 * Match later (DESIGN.md §2.8, §6.1): the person's own photos added without
 * a slot, matched one at a time. Staff only, like Match.
 */
export default async function MatchLaterPage() {
  const profile = await requireActiveStaff()
  const auth = await getMediaActor("staff")
  if (!auth.ok) throw new Error("Not authorised.")
  const [shell, photos] = await Promise.all([
    staffShellStatus(auth.actor, profile),
    listMatchLater(auth.actor),
  ])
  return (
    <AppShell
      variant="staff"
      active="tasks"
      {...shell}
      userName={profile.displayName}
    >
      <OfflineNotice className="mb-3" />
      {photos ? (
        <MatchLaterScreen photos={photos} />
      ) : (
        <Notice tone="negative" role="alert">
          Your photos could not be loaded. Try again in a moment.
        </Notice>
      )}
    </AppShell>
  )
}
