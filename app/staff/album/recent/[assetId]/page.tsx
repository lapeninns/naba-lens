import { notFound } from "next/navigation"

import {
  AlbumPostFeedback,
  AlbumPostStatus,
} from "@/components/nabalens/album/posted-photos"
import { AppShell } from "@/components/nabalens/app-shell"
import { LinkButton } from "@/components/ui/link-button"
import { Photo } from "@/components/ui/photo"
import { requireActiveStaff } from "@/lib/auth"
import {
  RECENT_STAFF_POSTS,
  STAFF_ALBUM_POSTS,
  staffPostImage,
} from "@/lib/config/staff-album-posts"
import { getMediaActor } from "@/lib/server/media/context"
import { isUuid } from "@/lib/server/menus/validate"
import { getAlbumPost } from "@/lib/server/staff-album-posts"
import {
  LABEL_PHOTO,
  labelPhotoHref,
  photoHref,
  slotPageHref,
} from "@/lib/staff/my-uploads"

import { staffShellStatus } from "../../../_shell/shell-status"

export const metadata = { title: "Album photo" }

export default async function AlbumPhotoPage({
  params,
}: {
  params: Promise<{ assetId: string }>
}) {
  const { assetId } = await params
  if (!STAFF_ALBUM_POSTS || !isUuid(assetId)) notFound()
  const profile = await requireActiveStaff()
  const auth = await getMediaActor("staff")
  if (!auth.ok) notFound()
  const [shell, post] = await Promise.all([
    staffShellStatus(auth.actor, profile),
    getAlbumPost(auth.actor.db, assetId),
  ])
  if (!post) notFound()
  const own = post.uploaderId === auth.actor.profile.id
  const title =
    post.labels.map(({ name }) => name).join(", ") || "Unlabelled photo"
  return (
    <AppShell
      variant="staff"
      active="tasks"
      {...shell}
      userName={profile.displayName}
      venueName={profile.venue?.name}
    >
      <div className="grid gap-4">
        <LinkButton
          variant="quiet"
          href={RECENT_STAFF_POSTS}
          className="justify-self-start"
        >
          Recent photos
        </LinkButton>
        <header className="grid gap-1">
          <h1 className="type-display wrap-break-word text-ink">{title}</h1>
          <p className="text-body text-ink-muted">{post.uploaderName}</p>
          {!post.removed ? (
            <AlbumPostStatus
              needsAttention={post.feedback.some(
                ({ action }) => action === "feedback" || action === "retake"
              )}
            />
          ) : null}
        </header>
        {!post.removed ? (
          <Photo
            src={
              own
                ? `/api/media/${assetId}/preview`
                : staffPostImage(assetId, "preview")
            }
            alt={title}
            imgClassName="object-contain"
          />
        ) : null}
        <div className="flex flex-wrap gap-2">
          {!post.removed
            ? post.labels.map((label) => (
                <LinkButton
                  key={`${label.kind}:${label.id}`}
                  href={slotPageHref({ kind: label.kind, slotId: label.id })}
                >
                  Open {label.name} in Album
                </LinkButton>
              ))
            : null}
          {own && !post.removed && post.labels.length === 0 ? (
            <LinkButton href={labelPhotoHref(assetId)}>
              {LABEL_PHOTO}
            </LinkButton>
          ) : null}
          {own ? (
            <LinkButton variant="quiet" href={photoHref(assetId)}>
              View in My photos
            </LinkButton>
          ) : null}
        </div>
        <AlbumPostFeedback notes={post.feedback} removed={post.removed} />
      </div>
    </AppShell>
  )
}
