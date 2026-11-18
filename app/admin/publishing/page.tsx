import type { Metadata } from "next"

import { unexpected } from "@/app/staff/manage/_shared/context"
import { AppShell } from "@/components/nabalens/app-shell"
import { Notice } from "@/components/nabalens/notice"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { LinkButton } from "@/components/ui/link-button"
import { requireActiveAdmin } from "@/lib/auth"
import { getCoverageActor } from "@/lib/server/coverage"
import { exportHrefs } from "@/lib/server/exports/hrefs"
import {
  getPublicationOverview,
  listExportPackages,
  listExportProfiles,
  listVenues,
} from "@/lib/server/exports/service"

import { EXPORTS_COPY, londonToday } from "./_components/copy"
import { PackageList } from "./_components/package-list"
import { PublicationPanels } from "./_components/publication-panels"

export const metadata: Metadata = { title: EXPORTS_COPY.adminTitle }

/**
 * Admin Publishing (spec §8 A5, S1-EXPORT). Useful before any integration
 * exists: export packages, manual Published records and what still needs
 * following up. What needs following up comes first (DESIGN.md §11 rule 3).
 * Admins only: the layout's gate, requireActiveAdmin here, and the database.
 */
export default async function AdminPublishingPage() {
  const profile = await requireActiveAdmin()
  const auth = await getCoverageActor()
  if (!auth.ok) unexpected(auth)
  const [overview, packages, profiles, venues] = await Promise.all([
    getPublicationOverview(auth.actor),
    listExportPackages(auth.actor),
    listExportProfiles(auth.actor),
    listVenues(auth.actor),
  ])
  const make = (
    <LinkButton href={exportHrefs.adminNew()} variant="primary">
      {EXPORTS_COPY.makePackage}
    </LinkButton>
  )
  return (
    <AppShell
      variant="admin"
      active="publishing"
      userName={profile.displayName}
    >
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-4">
          <PageHeader
            scope={EXPORTS_COPY.adminScope}
            title={EXPORTS_COPY.adminTitle}
            summary={<p>{EXPORTS_COPY.adminSummary}</p>}
            actions={make}
            className="pb-0 md:pb-0"
          />
          <OfflineNotice />
        </div>
        {overview.ok ? null : (
          <Notice tone="negative" role="alert">
            {overview.message}
          </Notice>
        )}
        <PublicationPanels
          part="outstanding"
          overview={overview.ok ? overview.overview : null}
          today={londonToday()}
        />
        <section aria-labelledby="packages" className="grid gap-3">
          <h2 id="packages" className="type-section-title text-ink">
            {EXPORTS_COPY.packagesTitle}
          </h2>
          {packages.ok ? (
            <PackageList area="admin" packages={packages.packages} />
          ) : (
            <Notice tone="negative" role="alert">
              {packages.message}
            </Notice>
          )}
        </section>
        <PublicationPanels
          part="rest"
          overview={overview.ok ? overview.overview : null}
          venues={venues.ok ? venues.venues : []}
          profiles={profiles.ok ? profiles.profiles : []}
          today={londonToday()}
        />
      </div>
    </AppShell>
  )
}
