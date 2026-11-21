import type { Metadata } from "next"

import {
  EXPORTS_COPY,
  londonToday,
} from "@/app/admin/publishing/_components/copy"
import { PackageList } from "@/app/admin/publishing/_components/package-list"
import { PublicationPanels } from "@/app/admin/publishing/_components/panels"
import { workspaceManagerContext } from "@/app/staff/manage/_shared/context"
import { Notice } from "@/components/nabalens/notice"
import {
  OfflineNotice,
  OFFLINE_BANNER_CLASS,
} from "@/components/nabalens/offline-notice"
import { ManagerTabs } from "@/components/nabalens/manager/manager-tabs"
import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { PageHeader } from "@/components/nabalens/page-header"
import { LinkButton } from "@/components/ui/link-button"
import { exportHrefs } from "@/lib/server/exports/hrefs"
import {
  getPublicationOverview,
  listExportPackages,
} from "@/lib/server/exports/service"

export const metadata: Metadata = { title: EXPORTS_COPY.managerTitle }

/**
 * A manager's exports (spec §7 M3 download, §14.1; S1-EXPORT): approved
 * photos of their own venue as a ZIP, and where the venue's photos are
 * published (read only: only admins record publication, §3.3). Venue ›
 * Exports (redesign R4, ia.md).
 */
export default async function ManagerExportsPage() {
  const ctx = await workspaceManagerContext()
  const [packages, overview] = await Promise.all([
    listExportPackages(ctx.actor, ctx.venueId),
    getPublicationOverview(ctx.actor, ctx.venueId),
  ])
  const make = (
    <LinkButton href={exportHrefs.managerNew} variant="primary">
      {EXPORTS_COPY.makePackage}
    </LinkButton>
  )
  return (
    <div className="grid gap-gutter">
      <OfflineNotice
        className={OFFLINE_BANNER_CLASS}
        loadedAt={new Date().toISOString()}
      />
      <PageHeader
        scope={ctx.venue.name}
        venueScope
        title={MANAGER_COPY.venue.title}
        summary={EXPORTS_COPY.managerSummary}
        actions={make}
        className="pb-0 md:pb-0"
      />
      <ManagerTabs section="venue" active="exports" />
      <div className="grid gap-8">
        <PublicationPanels
          part="outstanding"
          overview={overview.ok ? overview.overview : null}
          today={londonToday()}
        />
        <section aria-labelledby="packages" className="grid gap-3">
          <h2 id="packages" className="text-heading text-ink">
            {EXPORTS_COPY.packagesTitle}
          </h2>
          {packages.ok ? (
            <PackageList area="manager" packages={packages.packages} />
          ) : (
            <Notice tone="negative" role="alert">
              {packages.message}
            </Notice>
          )}
        </section>
        <PublicationPanels
          part="rest"
          overview={overview.ok ? overview.overview : null}
          today={londonToday()}
        />
      </div>
    </div>
  )
}
