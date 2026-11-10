import type { Metadata } from "next"

import { workspaceManagerContext } from "@/app/staff/manage/_shared/context"
import { CaptureScreen } from "@/app/staff/tasks/amenities/_capture/screen"
import { amenityHrefs } from "@/lib/amenities/contract"
import { managerCapabilities } from "@/app/manager/entry"
import { contributionEntry } from "@/lib/config/contribution-entry"

export const metadata: Metadata = { title: "Capture amenity · Naba-Lens" }

/**
 * "Capture myself": the manager captures a check of the workspace venue with
 * the staff form, inside the workspace shell. Another venue's check is not
 * found. With the shared entry on and R8 saying this account can upload
 * (B02-c), the form offers a new photo or video as evidence. Otherwise, or
 * when R8 can't be read, it only attaches media already on Naba-Lens and new
 * evidence means assigning the check to staff.
 */
export default async function ManagerAmenityCapturePage({
  params,
}: {
  params: Promise<{ checkId: string }>
}) {
  const { checkId } = await params
  const ctx = await workspaceManagerContext()
  const checkHref = amenityHrefs(ctx.basePath).check(checkId)
  const canUpload =
    contributionEntry(ctx.venueId) === "b02" &&
    (await managerCapabilities(ctx.venueId))?.canUpload === true
  return (
    <CaptureScreen
      actor={ctx.actor}
      checkId={checkId}
      mode="manager"
      canUpload={canUpload}
      venueId={ctx.venueId}
      venueName={ctx.venue.name}
      backHref={checkHref}
      backLabel="Back to the check"
      doneHref={checkHref}
    />
  )
}
