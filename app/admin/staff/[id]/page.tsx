import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { AppShell } from "@/components/nabalens"
import { ERROR_COPY, ErrorState } from "@/components/nabalens/error-state"
import { requireActiveAdmin } from "@/lib/auth"
import { MEDIA_LIMITS } from "@/lib/config/media"
import { getStaffAccount, listAssignableVenues } from "@/lib/server/accounts"
import { accountsContext } from "@/lib/server/accounts/request"
import { getVenueRoster } from "@/lib/server/coverage"
import { getMediaActor } from "@/lib/server/media/context"
import { listLibrary } from "@/lib/server/media/library"

import { signOutAction } from "../actions"
import { AuthDetailsNotice } from "../auth-details-notice"
import { effectiveGrants, loadManagerGrants } from "../manager-grants"
import { RetryButton } from "../retry-button"
import { firstName } from "../staff-order"
import { AccountHeader, type GrantRecord } from "./account-header"
import { AdminPortfolio } from "./admin-portfolio"
import { StaffMonth } from "./staff-month"

export const metadata: Metadata = { title: "Staff member · Naba-Lens" }

export default async function StaffPortfolioPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const admin = await requireActiveAdmin()
  const { id } = await params
  const ctx = await accountsContext()
  const auth = await getMediaActor("admin")
  if (!auth.ok) throw new Error("Not authorised.")

  const account = await getStaffAccount(ctx, id)
  if (!account.ok) {
    if (account.code === "not_found") notFound()
    throw new Error("Could not load the staff account.")
  }
  const member = account.staff
  const first = firstName(member.displayName)
  const [media, venues, grants, roster] = await Promise.all([
    // The admin library filtered to this contributor (ready media, newest first,
    // each keeping its upload-time venue).
    listLibrary(auth.actor, { venueId: null, staffId: member.id, type: null }),
    listAssignableVenues(ctx),
    loadManagerGrants({ includeEnded: true }),
    member.venueId
      ? getVenueRoster(auth.actor, { venueId: member.venueId })
      : null,
  ])
  // Like the grants, the month only adds context: a failed read leaves it out.
  if (roster && !roster.ok) {
    console.error("[staff] month unavailable", { code: roster.code })
  }
  const monthly = roster?.ok
    ? (roster.roster.find((row) => row.person.id === member.id) ?? null)
    : null

  // The effective grant, else the one that ended most recently.
  const own = (grants ?? [])
    .filter((g) => g.staff.id === member.id)
    .sort((a, b) =>
      a.effective !== b.effective
        ? Number(b.effective) - Number(a.effective)
        : (b.revokedAt ?? b.grantedAt).localeCompare(a.revokedAt ?? a.grantedAt)
    )[0]
  const grant: GrantRecord | null = own
    ? {
        venueId: own.venue.id,
        venueName: own.venue.name,
        grantedAt: own.grantedAt,
        grantedByName: own.grantedBy.displayName,
        revokedAt: own.revokedAt,
        revokeKind: own.revokeKind,
        effective: own.effective,
      }
    : null

  return (
    <AppShell
      variant="admin"
      active="staff"
      userName={admin.displayName}
      logoutAction={signOutAction}
    >
      <AccountHeader
        member={member}
        venueActive={member.venueActive}
        venues={venues.ok ? venues.venues : []}
        maxAvatarBytes={MEDIA_LIMITS.maxAvatarBytes}
        grant={grant}
        venueGrants={effectiveGrants(grants)}
        month={
          monthly ? (
            <StaffMonth
              monthly={monthly}
              firstName={first}
              inactive={member.status === "inactive"}
            />
          ) : null
        }
        notices={
          account.authDetails === "unavailable" ? <AuthDetailsNotice /> : null
        }
        photos={
          <section aria-labelledby="photos-heading" className="grid gap-3">
            <h2
              id="photos-heading"
              className="text-section-title-touch text-ink md:text-section-title"
            >
              Photos
            </h2>
            {media.ok ? (
              <AdminPortfolio
                staffId={member.id}
                staffName={member.displayName}
                initialPage={{
                  items: media.items,
                  nextCursor: media.nextCursor,
                }}
                emptyDescription={
                  member.status === "invited"
                    ? `${first}'s photos appear here once ${first} signs in and uploads.`
                    : undefined
                }
              />
            ) : (
              <ErrorState
                title={`We couldn't load ${first}'s photos`}
                action={<RetryButton label={ERROR_COPY.tryAgain} />}
              >
                The account details below are up to date. Try again to load the
                photos.
              </ErrorState>
            )}
          </section>
        }
      />
    </AppShell>
  )
}
