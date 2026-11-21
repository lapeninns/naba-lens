import type { Metadata } from "next"
import { notFound } from "next/navigation"

import {
  londonToday,
  packageTitle,
} from "@/app/admin/publishing/_components/copy"
import { PackageDetail } from "@/app/admin/publishing/_components/package-detail"
import { workspaceManagerContext } from "@/app/staff/manage/_shared/context"
import { Notice } from "@/components/nabalens/notice"
import { BackLink } from "@/components/nabalens/back-link"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { PageHeader } from "@/components/nabalens/page-header"
import { getExportPackage } from "@/lib/server/exports/service"

export const metadata: Metadata = { title: "Export package" }

/** One of the venue's export packages, for its manager (spec §14.1). */
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
  return (
    <div className="grid gap-gutter">
      <div className="grid gap-1">
        <BackLink href={managerHrefs.exports} compact>
          Exports
        </BackLink>
        <PageHeader
          scope={ctx.venue.name}
          venueScope
          title={read.ok ? packageTitle(read.pkg) : "Export package"}
          className="pb-0 md:pb-0"
        />
      </div>
      {read.ok ? (
        <PackageDetail
          area="manager"
          pkg={read.pkg}
          notice={download ?? null}
          destinations={null}
          today={londonToday()}
        />
      ) : (
        <Notice tone="negative" role="alert">
          {read.message}
        </Notice>
      )}
    </div>
  )
}
