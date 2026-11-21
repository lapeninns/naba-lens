import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/ssr"

import {
  DOWNLOAD_NOTICES,
  EXPORTS_COPY,
  londonDate,
  londonToday,
  PACKAGE_CHIP,
  packageTitle,
} from "@/app/admin/publishing/_components/copy"
import { PackageDetail } from "@/app/admin/publishing/_components/package-detail"
import { RebuildButton } from "@/app/admin/publishing/_components/publication-forms"
import { workspaceManagerContext } from "@/app/staff/manage/_shared/context"
import { Notice } from "@/components/nabalens/notice"
import { BackLink } from "@/components/nabalens/back-link"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { PageHeader } from "@/components/nabalens/page-header"
import { StatusChip } from "@/components/nabalens/status-chip"
import { buttonVariants } from "@/components/ui/button"
import { downloadHref } from "@/lib/server/exports/hrefs"
import type { ExportPackageDetail } from "@/lib/server/exports/model"
import { getExportPackage } from "@/lib/server/exports/service"
import { cn } from "@/lib/utils"

export const metadata: Metadata = { title: "Export package" }

const photos = (n: number) => (n === 1 ? "photo" : "photos")

/** "4 photos · fits 1600 × 1600 · Made by Sita Gurung, 20 Nov 2026". */
function factsLine(pkg: ExportPackageDetail): string {
  return [
    EXPORTS_COPY.items(pkg.itemCount),
    pkg.profile.maxWidth && pkg.profile.maxHeight
      ? `fits ${pkg.profile.maxWidth} × ${pkg.profile.maxHeight}`
      : null,
    EXPORTS_COPY.madeBy(pkg.createdBy, londonDate(pkg.createdAt)),
    pkg.rebuiltFrom ? EXPORTS_COPY.rebuilt : null,
  ]
    .filter(Boolean)
    .join(" · ")
}

/**
 * One of the venue's export packages, for its manager (spec §14.1). Second
 * handoff: the title row carries the state chip and the one action
 * (Download ZIP, or Rebuild when a photo was withdrawn or changed since);
 * what is wrong is a Notice under it; then the photos, each stale one
 * marked on its own row, and the downloads.
 */
export default async function ManagerPackagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ download?: string }>
}) {
  const ctx = await workspaceManagerContext()
  const [{ id }, { download }] = await Promise.all([params, searchParams])
  const read = await getExportPackage(ctx.actor, id)
  if (!read.ok && read.status === 404) notFound()
  const back = (
    <BackLink href={managerHrefs.exports} compact>
      Exports
    </BackLink>
  )
  if (!read.ok)
    return (
      <div className="grid gap-gutter">
        <div className="grid gap-1">
          {back}
          <PageHeader
            scope={ctx.venue.name}
            venueScope
            title="Export package"
            className="pb-0 md:pb-0"
          />
        </div>
        <Notice tone="negative" role="alert">
          {read.message}
        </Notice>
      </div>
    )

  const pkg = read.pkg
  const blocked = pkg.state === "invalidated" || pkg.state === "needs_rebuild"
  const stale = pkg.staleAssets.length
  const left = pkg.itemCount - stale
  const action = blocked ? (
    left > 0 ? (
      <RebuildButton area="manager" packageId={pkg.id} primary />
    ) : null
  ) : (
    <a
      href={downloadHref("manager", pkg.id)}
      className={cn(buttonVariants({ variant: "primary", size: "lg" }))}
      download
    >
      <DownloadSimpleIcon aria-hidden weight="bold" />
      {EXPORTS_COPY.download}
    </a>
  )
  return (
    <div className="grid gap-gutter">
      <div className="grid gap-1">
        {back}
        <PageHeader
          scope={ctx.venue.name}
          venueScope
          title={packageTitle(pkg, "manager")}
          summary={
            <div className="grid gap-1.5">
              <p className="flex flex-wrap items-center gap-2">
                <StatusChip state={PACKAGE_CHIP[pkg.state]} />
                {pkg.mode === "internal" ? (
                  <StatusChip state="internal_only" />
                ) : null}
              </p>
              <p>{factsLine(pkg)}</p>
            </div>
          }
          actions={action}
          className="pb-0 md:pb-0"
        />
      </div>
      {download && DOWNLOAD_NOTICES[download] ? (
        <Notice tone="attention" role="alert">
          {DOWNLOAD_NOTICES[download]}
        </Notice>
      ) : null}
      {blocked ? (
        <Notice
          tone="attention"
          role="note"
          title={
            stale === 1
              ? "1 photo in this package was withdrawn or changed after it was made, so the package can't be downloaded."
              : `${stale} photos in this package were withdrawn or changed after it was made, so the package can't be downloaded.`
          }
        >
          {left > 0
            ? `Rebuild it without ${stale === 1 ? "that photo" : "those photos"} to download the other ${left} ${photos(left)}.`
            : "No photo in it can be downloaded now. Make a new package instead."}
        </Notice>
      ) : null}
      <p className="px-1 text-meta text-ink-muted">
        {EXPORTS_COPY.readMe("manager")}
      </p>
      <PackageDetail
        area="manager"
        pkg={pkg}
        notice={null}
        destinations={null}
        today={londonToday()}
        summary={false}
      />
    </div>
  )
}
