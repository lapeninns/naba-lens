import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"

import { AppShell } from "@/components/nabalens"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import { requireActiveAdmin } from "@/lib/auth"
import { MEDIA_LIMITS } from "@/lib/config/media"
import { getStaffAccount, listAssignableVenues } from "@/lib/server/accounts"
import { accountsContext } from "@/lib/server/accounts/request"
import { getMediaActor } from "@/lib/server/media/context"
import { listLibrary } from "@/lib/server/media/library"

import { signOutAction } from "../actions"
import { AuthDetailsNotice } from "../auth-details-notice"
import { AccountHeader } from "./account-header"
import { AdminPortfolio } from "./admin-portfolio"

export const metadata: Metadata = { title: "Staff portfolio · NabaLens" }

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
  const [media, venues] = await Promise.all([
    // The admin library filtered to this contributor (ready media, newest first,
    // each keeping its upload-time venue).
    listLibrary(auth.actor, { venueId: null, staffId: member.id, type: null }),
    listAssignableVenues(ctx),
  ])

  return (
    <AppShell
      variant="admin"
      active="staff"
      userName={admin.displayName}
      logoutAction={signOutAction}
    >
      <div className="grid gap-6 sm:gap-8">
        <Link
          href="/admin/staff"
          className={buttonVariants({
            variant: "ghost",
            className: "h-11 w-fit sm:h-9",
          })}
        >
          <ArrowLeftIcon data-icon="inline-start" aria-hidden />
          All staff
        </Link>
        {account.authDetails === "unavailable" ? <AuthDetailsNotice /> : null}
        <AccountHeader
          member={member}
          venueActive={member.venueActive}
          venues={venues.ok ? venues.venues : []}
          maxAvatarBytes={MEDIA_LIMITS.maxAvatarBytes}
        />
        <section aria-labelledby="portfolio-heading" className="grid gap-4">
          <h2 id="portfolio-heading" className="text-base font-semibold">
            Portfolio
          </h2>
          {media.ok ? (
            <AdminPortfolio
              staffId={member.id}
              staffName={member.displayName}
              initialPage={{ items: media.items, nextCursor: media.nextCursor }}
            />
          ) : (
            <Alert variant="destructive">
              <AlertDescription>
                This portfolio could not be loaded. Reload the page to try
                again.
              </AlertDescription>
            </Alert>
          )}
        </section>
      </div>
    </AppShell>
  )
}
