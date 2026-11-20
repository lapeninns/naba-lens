import Link from "next/link"
import { notFound } from "next/navigation"

import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { INBOX_COPY } from "@/components/nabalens/manager/review/inbox-copy"
import { InboxPhotoDetail } from "@/components/nabalens/manager/review/inbox-photo-detail"
import { AlbumPostModeration } from "@/components/nabalens/manager/review/album-post-moderation"
import {
  OfflineNotice,
  OFFLINE_BANNER_CLASS,
} from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { buttonVariants } from "@/components/ui/button"
import { requireManagerVenue } from "@/lib/auth/manager"
import {
  STAFF_ALBUM_POSTS,
  staffPostImage,
} from "@/lib/config/staff-album-posts"
import { isUuid } from "@/lib/server/coverage/validate"
import { getManagerPhotoCtx } from "@/lib/server/menu-photos"
import { getPhotoDetail } from "@/lib/server/review/inbox"
import { getAlbumPost } from "@/lib/server/staff-album-posts"

import { imagesOf } from "../../_shared/photo-images"
import { failedRead } from "../../../load-overview"

export const metadata = { title: "Photo review" }

/**
 * One photo's review (S2-REVIEW; spec §7 M2): provenance, group, note,
 * possible duplicates, its slots with the album's photos to compare, history,
 * and every decision. The venue's manager only; any photo not at the venue
 * is not found.
 */
export default async function ManagerReviewPhotoPage({
  params,
}: {
  params: Promise<{ assetId: string }>
}) {
  const { venue } = await requireManagerVenue()
  const { assetId } = await params
  if (!isUuid(assetId)) notFound()
  const here = managerHrefs.photo(assetId)
  const scope = await getManagerPhotoCtx()
  if (!scope.ok) failedRead(scope.code, undefined, here)
  const db = scope.ctx.actor.db
  const [read, post] = await Promise.all([
    getPhotoDetail(scope.ctx, assetId),
    STAFF_ALBUM_POSTS ? getAlbumPost(db, assetId) : null,
  ])
  if (!read.ok) {
    if (read.code === "not_found") notFound()
    if (read.code === "forbidden") failedRead("not_permitted", undefined, here)
    if (read.code === "account_inactive" || read.code === "unauthenticated")
      failedRead(read.code, undefined, here)
    throw new Error(`Could not load the photo: ${read.code}`)
  }
  const choices =
    post && !post.removed ? await db.rpc("staff_album_review_options") : null
  const images = imagesOf(read.detail)
  if (post && !post.removed) {
    images.main = {
      thumbnail: staffPostImage(assetId, "thumb"),
      preview: staffPostImage(assetId, "preview"),
    }
  }
  return (
    <div className="grid gap-6">
      <OfflineNotice
        className={OFFLINE_BANNER_CLASS}
        loadedAt={new Date().toISOString()}
      />
      <Link
        href={`${managerHrefs.review()}?view=list`}
        className={buttonVariants({
          variant: "row-link",
          className: "justify-self-start",
        })}
      >
        {INBOX_COPY.back}
      </Link>
      <PageHeader
        scope={venue.name}
        venueScope
        title={INBOX_COPY.title}
        className="pb-0 md:pb-0"
      />
      <InboxPhotoDetail
        detail={read.detail}
        images={images}
        staffAlbum={
          post && post.uploaderId !== scope.ctx.actor.profile.id ? (
            <AlbumPostModeration post={post} choices={choices?.data ?? []} />
          ) : null
        }
      />
    </div>
  )
}
