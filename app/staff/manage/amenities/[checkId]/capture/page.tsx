import type { Metadata } from "next"

import { managerAccess } from "@/app/staff/manage/_shared/context"
import { NotManagerPage } from "@/app/staff/manage/_shared/frame"
import { CaptureScreen } from "@/app/staff/tasks/amenities/_capture/screen"
import { AppShell } from "@/components/nabalens/app-shell"
import { amenityHrefs } from "@/lib/amenities/contract"

export const metadata: Metadata = {
  title: "Capture amenity · Manage · Naba-Lens",
}

// finaliseUpload (Server Action used by the upload flow on this page) decodes
// HEIC/images; same bound as the staff task pages.
export const maxDuration = 120

/** "Capture myself": the venue manager captures a check with the staff form. */
export default async function ManageAmenityCapturePage({
  params,
  searchParams,
}: {
  params: Promise<{ checkId: string }>
  searchParams?: Promise<{
    complete?: string | string[]
    correct?: string | string[]
  }>
}) {
  const { checkId } = await params
  // "Complete the policy" (B03-c §4.4): one finding, or none.
  const search = await searchParams
  const complete = search?.complete
  const access = await managerAccess()
  if (!access.ok) return <NotManagerPage viewerName={access.viewerName} />
  const { ctx } = access
  const checkHref = amenityHrefs(ctx.basePath).check(checkId)
  return (
    <AppShell
      variant="staff"
      active="manage"
      canManage
      userName={ctx.viewerName}
    >
      <CaptureScreen
        actor={ctx.actor}
        checkId={checkId}
        mode="manager"
        venueId={ctx.venueId}
        venueName={ctx.venue.name}
        backHref={checkHref}
        backLabel="Back to the check"
        doneHref={checkHref}
        complete={typeof complete === "string" ? complete : null}
        correct={search?.correct === "1"}
      />
    </AppShell>
  )
}
