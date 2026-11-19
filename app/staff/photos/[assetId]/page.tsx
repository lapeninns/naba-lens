import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"

import {
  changeUploadSlotAction,
  loadMyUploadsAction,
  reportSlotChangeAction,
  requestUploadRemovalAction,
  setCapturedAtAction,
  withdrawUploadAction,
} from "@/app/staff/_me/actions"
import { loadMatchBoardAction } from "@/app/staff/_shell/match-actions"
import { AppShell } from "@/components/nabalens/app-shell"
import { MyUploads } from "@/components/nabalens/me/my-uploads"
import { requireActiveStaff } from "@/lib/auth"
import { getMediaActor } from "@/lib/server/media/context"
import { getMyUpload, listMySlotReports } from "@/lib/server/staff"
import { MY_PHOTOS_COPY } from "@/lib/staff/my-photos"

import { ownMonth, staffShellStatus } from "../../_shell/shell-status"

export const metadata = { title: "Photo · My photos" }

/**
 * One of the person's photos (DESIGN.md §5e "One photo", D19): the photo
 * large, what happened to it, and every action it allows. Someone else's
 * photo, or one that no longer exists, is not found.
 */
export default async function StaffPhotoPage({
  params,
}: {
  params: Promise<{ assetId: string }>
}) {
  const { assetId } = await params
  const profile = await requireActiveStaff()
  const auth = await getMediaActor("staff")
  if (!auth.ok) throw new Error("Not authorised.")
  const actor = auth.actor
  const [shell, monthly, read, reports] = await Promise.all([
    staffShellStatus(actor, profile),
    ownMonth(actor),
    getMyUpload(actor, assetId).catch(() => null),
    listMySlotReports(actor).catch(() => null),
  ])
  if (!read?.ok) notFound()

  return (
    <AppShell
      variant="staff"
      active="photos"
      {...shell}
      userName={profile.displayName}
      venueName={profile.venue?.name}
      monthly={monthly}
    >
      <div className="mx-auto grid w-full max-w-feed gap-3 pb-4">
        <Link
          href="/staff/photos"
          className="inline-flex min-h-12 items-center gap-1.5 justify-self-start text-label text-ink focus-ring"
        >
          <ArrowLeftIcon aria-hidden className="size-5" />
          {MY_PHOTOS_COPY.back}
        </Link>
        <h1 className="sr-only">Photo</h1>
        <MyUploads
          layout="detail"
          showTitle={false}
          headingLevel={2}
          initial={{ items: [read.upload], next: null }}
          currentVenueId={profile.venueId ?? null}
          correctionsAsked={
            reports?.ok
              ? reports.reports
                  .filter(
                    (r) => r.subjectKind === "photo" && r.state === "open"
                  )
                  .map((r) => r.subjectId)
              : []
          }
          actions={{
            loadMore: loadMyUploadsAction,
            withdraw: withdrawUploadAction,
            changeSlot: changeUploadSlotAction,
            loadBoard: loadMatchBoardAction,
            setCapturedAt: setCapturedAtAction,
            requestRemoval: requestUploadRemovalAction,
            report: reportSlotChangeAction,
          }}
        />
      </div>
    </AppShell>
  )
}
