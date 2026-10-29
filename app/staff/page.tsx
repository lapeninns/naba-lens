import { logout } from "@/app/_media/actions"
import { AppShell } from "@/components/nabalens"
import { requireActiveStaff, uploadBlockReason } from "@/lib/auth"
import { getMediaActor } from "@/lib/server/media/context"
import { listOwnMedia } from "@/lib/server/media/library"
import { avatarUrl } from "@/lib/server/media/profile"

import { StaffPortfolio } from "./staff-portfolio"

const BLOCKED_COPY = {
  not_staff: "Only staff accounts can upload.",
  no_venue:
    "Your account is not assigned to a venue yet, so uploads are paused. Ask an admin to assign your venue.",
  venue_inactive:
    "Your venue is not taking uploads right now, so uploads are paused. Ask an admin to check your venue.",
} as const

export const metadata = { title: "Your portfolio · NabaLens" }

/** Staff home: own profile, Upload action and newest-first own gallery. */
export default async function StaffPage() {
  const profile = await requireActiveStaff()
  const auth = await getMediaActor("staff")
  if (!auth.ok) throw new Error("Not authorised.")
  const page = await listOwnMedia(auth.actor)
  if (!page.ok) throw new Error(page.message)
  const blocked = uploadBlockReason(profile)

  return (
    <AppShell
      variant="staff"
      userName={profile.displayName}
      logoutAction={logout}
    >
      <StaffPortfolio
        profile={{
          displayName: profile.displayName,
          jobTitle: profile.jobTitle,
          venueName: profile.venue?.name ?? null,
          avatarUrl: avatarUrl(profile.id, profile.avatarPath),
        }}
        uploadBlocked={blocked ? BLOCKED_COPY[blocked] : null}
        initialPage={{ items: page.items, nextCursor: page.nextCursor }}
      />
    </AppShell>
  )
}
