import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"

import {
  changeUploadSlotAction,
  loadMyUploadsAction,
  reportSlotChangeAction,
  requestUploadRemovalAction,
  withdrawUploadAction,
} from "@/app/staff/_me/actions"
import { loadMatchBoardAction } from "@/app/staff/_shell/match-actions"
import { AppShell } from "@/components/nabalens/app-shell"
import {
  AlbumPostFeedback,
  AlbumPostStatus,
} from "@/components/nabalens/album/posted-photos"
import { MyUploads } from "@/components/nabalens/me/my-uploads"
import { requireActiveStaff } from "@/lib/auth"
import { STAFF_ALBUM_POSTS } from "@/lib/config/staff-album-posts"
import { getMediaActor } from "@/lib/server/media/context"
import { getMyUpload, listMySlotReports } from "@/lib/server/staff"
import { getAlbumPost } from "@/lib/server/staff-album-posts"
import { isUuid } from "@/lib/server/menus/validate"
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
  if (!isUuid(assetId)) notFound()
  const profile = await requireActiveStaff()
  const auth = await getMediaActor("staff")
  if (!auth.ok) throw new Error("Not authorised.")
  const actor = auth.actor
  const [shell, monthly, read, reports, post] = await Promise.all([
    staffShellStatus(actor, profile),
    ownMonth(actor),
    getMyUpload(actor, assetId).catch(() => null),
    listMySlotReports(actor).catch(() => null),
    STAFF_ALBUM_POSTS ? getAlbumPost(actor.db, assetId) : null,
  ])
  if (!read?.ok) notFound()
  const upload = post
    ? {
        ...read.upload,
        albumPost: {
          removed: post.removed,
          labelled: post.labels.length > 0,
          labels: post.labels,
          managerLabelled: post.feedback.some(
            ({ action }) => action === "label"
          ),
          needs_attention: post.feedback.some(
            ({ action }) => action === "feedback" || action === "retake"
          ),
        },
      }
    : read.upload

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
        {post && !post.removed ? (
          <AlbumPostStatus needsAttention={upload.albumPost?.needs_attention} />
        ) : null}
        <MyUploads
          layout="detail"
          showTitle={false}
          headingLevel={2}
          initial={{ items: [upload], next: null }}
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
            requestRemoval: requestUploadRemovalAction,
            report: reportSlotChangeAction,
          }}
        />
        {post ? (
          <AlbumPostFeedback notes={post.feedback} removed={post.removed} />
        ) : null}
      </div>
    </AppShell>
  )
}
