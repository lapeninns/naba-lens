import { notFound } from "next/navigation"

import { PostedPhotos } from "@/components/nabalens/album/posted-photos"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
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

export const metadata = { title: "Staff Album" }

export default async function ManagerStaffAlbumPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string; beforeId?: string }>
}) {
  if (!STAFF_ALBUM_POSTS) notFound()
  const { venue } = await requireManagerVenue()
  const scope = await getManagerPhotoCtx()
  if (!scope.ok) failedRead(scope.code, "Staff Album", MANAGER_STAFF_ALBUM)
  const cursor = albumPostCursor(await searchParams)
  const page = await listAlbumPosts(scope.ctx.actor.db, { cursor })
  return (
    <div className="grid gap-4">
      <LinkButton
        href={managerHrefs.review()}
        variant="quiet"
        className="justify-self-start"
      >
        Back to Review
      </LinkButton>
      <PageHeader title="Staff Album" scope={venue.name} venueScope />
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
