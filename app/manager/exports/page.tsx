import type { Metadata } from "next"

import {
  EXPORTS_COPY,
  londonDate,
  londonToday,
} from "@/app/admin/publishing/_components/copy"
import { PackageList } from "@/app/admin/publishing/_components/package-list"
import { PublicationPanels } from "@/app/admin/publishing/_components/panels"
import { workspaceManagerContext } from "@/app/staff/manage/_shared/context"
import { Disclosure, DisclosureList } from "@/components/nabalens/disclosure"
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
 * Exports (redesign R4, ia.md). Second handoff: follow-ups are one Notice,
 * only when there are some; the packages are the page; destinations and the
 * publication log, which a manager can only read, fold shut.
 */
export default async function ManagerExportsPage() {
  const ctx = await workspaceManagerContext()
  const [packages, overview] = await Promise.all([
    listExportPackages(ctx.actor, ctx.venueId),
    getPublicationOverview(ctx.actor, ctx.venueId),
  ])
  const publication = overview.ok ? overview.overview : null
  const outstanding = publication?.outstanding ?? []
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
        {outstanding.length > 0 ? (
          <Notice
            tone="attention"
            role="note"
            title={EXPORTS_COPY.takeDownTitle(outstanding.length)}
          >
            <ul className="grid gap-0.5">
              {outstanding.map((o) => (
                <li key={`${o.destinationId}/${o.assetId}`}>
                  {o.subjectLabel} · {o.destinationLabel}
                </li>
              ))}
            </ul>
            <p className="mt-1">
              {outstanding.length === 1
                ? EXPORTS_COPY.takeDownText
                : EXPORTS_COPY.takeDownTextMany}
            </p>
          </Notice>
        ) : null}
        <section aria-labelledby="packages" className="grid gap-3">
          <h2
            id="packages"
            className="flex flex-wrap items-baseline gap-x-3 px-1 type-section-title text-ink"
          >
            {EXPORTS_COPY.packagesTitle}
            {packages.ok ? (
              <span className="text-meta font-normal text-ink-muted tabular-nums">
                {packages.packages.length}
              </span>
            ) : null}
          </h2>
          {packages.ok ? (
            <PackageList
              area="manager"
              packages={packages.packages}
              emptyAction={make}
            />
          ) : (
            <Notice tone="negative" role="alert">
              {packages.message}
            </Notice>
          )}
        </section>
        {publication ? (
          <div className="grid gap-3">
            <DisclosureList label={EXPORTS_COPY.publicationLabel}>
              <Disclosure
                title={EXPORTS_COPY.destinationsTitle}
                summary={
                  publication.destinations.length > 0
                    ? publication.destinations.map((d) => d.label).join(" · ")
                    : EXPORTS_COPY.noDestinations
                }
              >
                <PublicationPanels
                  part="rest"
                  only="destinations"
                  bare
                  overview={publication}
                  today={londonToday()}
                />
              </Disclosure>
              <Disclosure
                title={EXPORTS_COPY.publishedTitle}
                summary={EXPORTS_COPY.items(publication.published.length)}
              >
                <PublicationPanels
                  part="rest"
                  only="published"
                  bare
                  overview={publication}
                  today={londonToday()}
                />
              </Disclosure>
              {publication.recent.length > 0 ? (
                <Disclosure
                  title={EXPORTS_COPY.recentTitle}
                  summary={EXPORTS_COPY.lastOn(
                    londonDate(publication.recent[0]!.occurredOn)
                  )}
                >
                  <PublicationPanels
                    part="rest"
                    only="recent"
                    bare
                    overview={publication}
                    today={londonToday()}
                  />
                </Disclosure>
              ) : null}
            </DisclosureList>
            <p className="px-1 text-meta text-ink-muted">
              {EXPORTS_COPY.readMe("manager")}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
