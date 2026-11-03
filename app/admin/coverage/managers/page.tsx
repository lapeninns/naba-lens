import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"

import { logout } from "@/app/_media/actions"
import { unexpected } from "@/app/staff/manage/_shared/context"
import type { ManageSearch } from "@/app/staff/manage/_shared/screens"
import { AppShell } from "@/components/nabalens/app-shell"
import { ErrorState } from "@/components/nabalens/error-state"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
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

import { MANAGERS_COPY } from "./managers-copy"
import { ManagersView } from "./managers-view"

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
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-4">
          <PageHeader
            scope={MANAGERS_COPY.scope}
            title={MANAGERS_COPY.title}
            summary={MANAGERS_COPY.summary}
            actions={
              <Link
                href="/admin/coverage"
                className={buttonVariants({ variant: "secondary" })}
              >
                <ArrowLeftIcon aria-hidden />
                Coverage
              </Link>
            }
            className="pb-0 md:pb-0"
          />
          <OfflineNotice />
        </div>
        {venues.ok ? (
          <ManagersView
            grants={grants.grants}
            venues={venues.venues}
            selectedVenueId={selectedVenueId}
            candidates={candidates?.people ?? []}
            includeRevoked={includeRevoked}
            basePath={BASE}
          />
        ) : (
          <ErrorState title={MANAGERS_COPY.couldNotLoad}>
            {MANAGERS_COPY.venuesCouldNotLoad}
          </ErrorState>
        )}
      </div>
    </AppShell>
  )
}
