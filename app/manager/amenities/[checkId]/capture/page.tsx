import type { Metadata } from "next"

import { workspaceManagerContext } from "@/app/staff/manage/_shared/context"
import { CaptureScreen } from "@/app/staff/tasks/amenities/_capture/screen"
import { amenityHrefs } from "@/lib/amenities/contract"

export const metadata: Metadata = { title: "Capture amenity · Naba-Lens" }

// finaliseUpload (Server Action used by the upload flow on this page) decodes
// HEIC/images; same bound as the staff task pages.
export const maxDuration = 120

/**
 * "Capture myself": the manager captures a check of the workspace venue with
 * the staff form, inside the workspace shell. Another venue's check is not
 * found.
 */
export default async function ManagerAmenityCapturePage({
  params,
}: {
  params: Promise<{ checkId: string }>
}) {
  const { checkId } = await params
  const ctx = await workspaceManagerContext()
  const checkHref = amenityHrefs(ctx.basePath).check(checkId)
  return (
    <CaptureScreen
      actor={ctx.actor}
      checkId={checkId}
      mode="manager"
      venueId={ctx.venueId}
      venueName={ctx.venue.name}
      backHref={checkHref}
      backLabel="Back to the check"
      doneHref={checkHref}
    />
  )
}
