import { notFound } from "next/navigation"

import { PostedPhotos } from "@/components/nabalens/album/posted-photos"
import { AppShell } from "@/components/nabalens/app-shell"
import { BackLink } from "@/components/nabalens/back-link"
import { LinkButton } from "@/components/ui/link-button"
import { requireActiveStaff } from "@/lib/auth"
import {
  RECENT_STAFF_POSTS,
  STAFF_ALBUM_POSTS,
} from "@/lib/config/staff-album-posts"
import { getMediaActor } from "@/lib/server/media/context"
import { albumPostCursor, listAlbumPosts } from "@/lib/server/staff-album-posts"

import { staffShellStatus } from "../../_shell/shell-status"

export const metadata = { title: "Recent photos" }

export default async function RecentPhotosPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string; beforeId?: string }>
}) {
  if (!STAFF_ALBUM_POSTS) notFound()
  const profile = await requireActiveStaff()
  const auth = await getMediaActor("staff")
  if (!auth.ok) notFound()
  const cursor = albumPostCursor(await searchParams)
  const [shell, page] = await Promise.all([
    staffShellStatus(auth.actor, profile),
    listAlbumPosts(auth.actor.db, { cursor }),
  ])
  return (
    <AppShell
      variant="staff"
      active="tasks"
      {...shell}
      userName={profile.displayName}
      venueName={profile.venue?.name}
    >
      <div className="grid gap-4">
        <BackLink href="/staff/album">Album</BackLink>
        <h1 className="type-display text-ink">Recent photos</h1>
        <PostedPhotos posts={page?.posts ?? null} label="Recent photos" />
        {page?.next ? (
          <LinkButton
            href={`${RECENT_STAFF_POSTS}?${new URLSearchParams(page.next)}`}
            className="justify-self-start"
          >
            Older photos
          </LinkButton>
        ) : null}
      </div>
    </AppShell>
  )
}
