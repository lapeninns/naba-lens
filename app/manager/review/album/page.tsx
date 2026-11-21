import { notFound } from "next/navigation"

import { PostedPhotos } from "@/components/nabalens/album/posted-photos"
import { ALBUM_REVIEW_COPY } from "@/components/nabalens/album/review/copy"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { ManagerTabs } from "@/components/nabalens/manager/manager-tabs"
import { ReviewCountTitle } from "@/components/nabalens/manager/review-count"
import { REVIEW_COPY } from "@/components/nabalens/manager/review/review-copy"
import { PageHeader } from "@/components/nabalens/page-header"
import { LinkButton } from "@/components/ui/link-button"
import { requireManagerVenue } from "@/lib/auth/manager"
import {
  MANAGER_STAFF_ALBUM,
  STAFF_ALBUM_POSTS,
} from "@/lib/config/staff-album-posts"
import { getManagerPhotoCtx } from "@/lib/server/menu-photos"
import { albumPostCursor, listAlbumPosts } from "@/lib/server/staff-album-posts"

import { failedRead } from "../../load-overview"

export const metadata = { title: "Posted by staff" }

/** Review › Posted by staff (D20; redesign R4, ia.md: was "Staff Album"). */

export default async function ManagerStaffAlbumPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string; beforeId?: string }>
}) {
  if (!STAFF_ALBUM_POSTS) notFound()
  const { venue } = await requireManagerVenue()
  const scope = await getManagerPhotoCtx()
  if (!scope.ok) failedRead(scope.code, "Posted by staff", MANAGER_STAFF_ALBUM)
  const cursor = albumPostCursor(await searchParams)
  const page = await listAlbumPosts(scope.ctx.actor.db, { cursor })
  return (
    <div className="grid gap-4">
      <PageHeader
        title={
          <ReviewCountTitle
            title={ALBUM_REVIEW_COPY.title}
            fallback={REVIEW_COPY.title}
          />
        }
        scope={venue.name}
        venueScope
        className="pb-0 md:pb-0"
      />
      <ManagerTabs section="review" active="posted" />
      <PostedPhotos
        posts={page?.posts ?? null}
        label="Recent photos"
        photoHref={managerHrefs.photo}
      />
      {page?.next ? (
        <LinkButton
          href={`${MANAGER_STAFF_ALBUM}?${new URLSearchParams(page.next)}`}
          className="justify-self-start"
        >
          Older photos
        </LinkButton>
      ) : null}
    </div>
  )
}
