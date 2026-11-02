import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"

import { logout } from "@/app/_media/actions"
import { unexpected } from "@/app/staff/manage/_shared/context"
import { ManagerGrantsControl } from "@/app/staff/manage/_shared/controls"
import type { ManageSearch } from "@/app/staff/manage/_shared/screens"
import { AppShell } from "@/components/nabalens/app-shell"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import { requireActiveAdmin } from "@/lib/auth"
import { listAssignableVenues } from "@/lib/server/accounts"
import { accountsContext } from "@/lib/server/accounts/request"
import {
  getCoverageActor,
  listGrantCandidates,
  listManagerGrants,
} from "@/lib/server/coverage"
import { isUuid } from "@/lib/server/coverage/validate"

export const metadata: Metadata = { title: "Venue managers · Naba-Lens" }

const BASE = "/admin/coverage/managers"

/** Grant and revoke venue-manager status (admins only). */
export default async function VenueManagersPage({
  searchParams,
}: {
  searchParams: Promise<ManageSearch>
}) {
  const profile = await requireActiveAdmin()
  const search = await searchParams
  const includeRevoked = search.revoked === "1"
  const venueParam = typeof search.venue === "string" ? search.venue : null
  const auth = await getCoverageActor()
  if (!auth.ok) unexpected(auth)
  const accounts = await accountsContext()
  const venues = await listAssignableVenues(accounts)
  const selectedVenueId =
    venueParam && isUuid(venueParam) && venues.ok
      ? (venues.venues.find((v) => v.id === venueParam)?.id ?? null)
      : null
  const [grants, candidates] = await Promise.all([
    listManagerGrants(auth.actor, {
      venueId: selectedVenueId,
      includeRevoked,
    }),
    selectedVenueId
      ? listGrantCandidates(auth.actor, { venueId: selectedVenueId })
      : Promise.resolve(null),
  ])
  if (!grants.ok) unexpected(grants)
  if (candidates && !candidates.ok) unexpected(candidates)

  return (
    <AppShell
      variant="admin"
      active="coverage"
      userName={profile.displayName}
      logoutAction={logout}
    >
      <div className="grid gap-6">
        <div className="grid gap-3">
          <Link
            href="/admin/coverage"
            className={buttonVariants({
              variant: "ghost",
              className: "h-11 w-fit sm:h-9",
            })}
          >
            <ArrowLeftIcon data-icon="inline-start" aria-hidden />
            Coverage
          </Link>
          <h1 className="font-display text-page-title-compact md:text-page-title">
            Venue managers
          </h1>
        </div>
        {venues.ok ? (
          <ManagerGrantsControl
            grants={grants.grants}
            venues={venues.venues}
            selectedVenueId={selectedVenueId}
            candidates={candidates?.people ?? []}
            includeRevoked={includeRevoked}
            basePath={BASE}
          />
        ) : (
          <Alert variant="destructive">
            <AlertDescription>
              Venues could not be loaded. Reload the page to try again.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </AppShell>
  )
}
