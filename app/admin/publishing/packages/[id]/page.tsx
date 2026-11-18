import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { unexpected } from "@/app/staff/manage/_shared/context"
import { AppShell } from "@/components/nabalens/app-shell"
import { Notice } from "@/components/nabalens/notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { requireActiveAdmin } from "@/lib/auth"
import { getCoverageActor } from "@/lib/server/coverage"
import {
  getExportPackage,
  getPublicationOverview,
} from "@/lib/server/exports/service"

import { EXPORTS_COPY, londonToday, packageTitle } from "../../_components/copy"
import { PackageDetail } from "../../_components/package-detail"

export const metadata: Metadata = { title: "Export package" }

/** One export package, for an admin (spec §14.1, §8 A5). */
export default async function AdminPackagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ download?: string }>
}) {
  const profile = await requireActiveAdmin()
  const auth = await getCoverageActor()
  if (!auth.ok) unexpected(auth)
  const [{ id }, { download }] = await Promise.all([params, searchParams])
  const [read, overview] = await Promise.all([
    getExportPackage(auth.actor, id),
    getPublicationOverview(auth.actor),
  ])
  if (!read.ok && read.status === 404) notFound()
  return (
    <AppShell
      variant="admin"
      active="publishing"
      userName={profile.displayName}
    >
      <div className="flex flex-col gap-6">
        <PageHeader
          scope={
            read.ok ? (read.pkg.venueName ?? EXPORTS_COPY.allVenues) : null
          }
          venueScope={read.ok && Boolean(read.pkg.venueName)}
          title={read.ok ? packageTitle(read.pkg) : "Export package"}
          className="pb-0 md:pb-0"
        />
        {read.ok ? (
          <PackageDetail
            area="admin"
            pkg={read.pkg}
            notice={download ?? null}
            destinations={overview.ok ? overview.overview.destinations : []}
            today={londonToday()}
          />
        ) : (
          <Notice tone="negative" role="alert">
            {read.message}
          </Notice>
        )}
      </div>
    </AppShell>
  )
}
