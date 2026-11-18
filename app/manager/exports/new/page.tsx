import type { Metadata } from "next"

import { EXPORTS_COPY } from "@/app/admin/publishing/_components/copy"
import { ExportBuilder } from "@/app/admin/publishing/_components/export-builder"
import { workspaceManagerContext } from "@/app/staff/manage/_shared/context"
import { Notice } from "@/components/nabalens/notice"
import { PageHeader } from "@/components/nabalens/page-header"
import {
  listExportCandidates,
  listExportProfiles,
} from "@/lib/server/exports/service"

export const metadata: Metadata = { title: EXPORTS_COPY.makePackage }

/**
 * Make an export package of the manager's own venue (spec §14.1): photos
 * approved for public use only. The database refuses any other venue (AC13).
 */
export default async function ManagerNewPackagePage() {
  const ctx = await workspaceManagerContext()
  const [candidates, profiles] = await Promise.all([
    listExportCandidates(ctx.actor, ctx.venueId, "public"),
    listExportProfiles(ctx.actor),
  ])
  return (
    <div className="grid gap-gutter">
      <PageHeader
        scope={ctx.venue.name}
        venueScope
        title={EXPORTS_COPY.makePackage}
        summary="Only photos approved for public use now can be chosen."
        className="pb-0 md:pb-0"
      />
      {candidates.ok ? (
        <ExportBuilder
          area="manager"
          mode="public"
          candidates={candidates.candidates.items}
          profiles={profiles.ok ? profiles.profiles : []}
        />
      ) : (
        <Notice tone="negative" role="alert">
          {candidates.message}
        </Notice>
      )}
    </div>
  )
}
