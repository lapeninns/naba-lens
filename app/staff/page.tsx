import { logout } from "@/app/_media/actions"
import { AppShell } from "@/components/nabalens"
import { requireActiveStaff, uploadBlockReason } from "@/lib/auth"
import { getManagerReviewCount } from "@/lib/server/coverage"
import { getMediaActor } from "@/lib/server/media/context"
import { avatarUrl, listOwnMedia } from "@/lib/server/media/library"

import { canManageVenue } from "./can-manage"
import { StaffPortfolio } from "./staff-portfolio"

const BLOCKED_COPY = {
  not_staff: "Only staff accounts can upload.",
  no_venue:
    "Your account is not assigned to a venue yet, so uploads are paused. Ask an admin to assign your venue.",
  venue_inactive:
    "Your venue is not taking uploads right now, so uploads are paused. Ask an admin to check your venue.",
} as const

export const metadata = { title: "Your portfolio · Naba-Lens" }

// finaliseUpload (Server Action on this page) decodes HEIC/images; keep the
// bound explicit and below MEDIA_LIMITS.staleProcessingMinutes.
export const maxDuration = 120

/** Staff home: own profile, Upload action and newest-first own gallery. */
export default async function StaffPage() {
  const profile = await requireActiveStaff()
  const auth = await getMediaActor("staff")
  if (!auth.ok) throw new Error("Not authorised.")
  const [page, canManage] = await Promise.all([
    listOwnMedia(auth.actor),
    canManageVenue(auth.actor),
  ])
  if (!page.ok) throw new Error(page.message)
  const blocked = uploadBlockReason(profile)
  // A failed count read keeps the row (Manage re-reads it) without a number.
  const review = canManage ? await getManagerReviewCount(auth.actor) : null
  const reviewCount = review?.ok ? review.count : undefined

  return (
    <AppShell
      variant="staff"
      active="portfolio"
      canManage={canManage}
      reviewCount={reviewCount}
      userName={profile.displayName}
      logoutAction={logout}
    >
      <StaffPortfolio
        profile={{
          displayName: profile.displayName,
          jobTitle: profile.jobTitle,
          department: profile.department,
          venueName: profile.venue?.name ?? null,
          avatarUrl: avatarUrl(profile.id, profile.avatarPath),
        }}
        uploadBlocked={blocked ? BLOCKED_COPY[blocked] : null}
        initialPage={{ items: page.items, nextCursor: page.nextCursor }}
        manage={
          canManage
            ? {
                venueName: profile.venue?.name ?? null,
                reviewCount: reviewCount ?? 0,
              }
            : null
        }
      />
    </AppShell>
  )
}
