import type { Metadata } from "next"

import { unexpected } from "@/app/staff/manage/_shared/context"
import type { ManageSearch } from "@/app/staff/manage/_shared/screens"
import { AppShell } from "@/components/nabalens/app-shell"
import { ErrorState } from "@/components/nabalens/error-state"
import { PageHeader } from "@/components/nabalens/page-header"
import { requireActiveAdmin } from "@/lib/auth"
import { listAssignableVenues } from "@/lib/server/accounts"
import { accountsContext } from "@/lib/server/accounts/request"
import {
  getCoverageActor,
  listGrantCandidates,
  listManagerGrants,
} from "@/lib/server/coverage"
import { isUuid } from "@/lib/server/coverage/validate"

import { ADMIN_SECTION_TITLES, AdminTabs } from "../../_components/admin-tabs"
import { MANAGERS_COPY } from "./managers-copy"
import { ManagersView } from "./managers-view"

export const metadata: Metadata = { title: "Venue managers" }

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
    <AppShell variant="admin" active="staff" userName={profile.displayName}>
      <div className="flex flex-col gap-6">
        {venues.ok ? (
          <ManagersView
            grants={grants.grants}
            venues={venues.venues}
            selectedVenueId={selectedVenueId}
            candidates={candidates?.people ?? []}
            includeRevoked={includeRevoked}
            basePath={BASE}
            grantOpen={search.grant === "1"}
            header={{
              scope: MANAGERS_COPY.scope,
              title: ADMIN_SECTION_TITLES.people,
              summary: MANAGERS_COPY.summary,
              // People › Venue managers (redesign R5, ia.md decision 8).
              tabs: <AdminTabs set="people" active="managers" />,
            }}
          />
        ) : (
          <>
            <PageHeader
              venueScope
              scope={MANAGERS_COPY.scope}
              title={ADMIN_SECTION_TITLES.people}
              summary={MANAGERS_COPY.summary}
              className="pb-0 md:pb-0"
            >
              <AdminTabs set="people" active="managers" />
            </PageHeader>
            <ErrorState title={MANAGERS_COPY.couldNotLoad}>
              {MANAGERS_COPY.venuesCouldNotLoad}
            </ErrorState>
          </>
        )}
      </div>
    </AppShell>
  )
}
