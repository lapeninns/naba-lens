import { notFound } from "next/navigation"

import {
  AlbumPostFeedback,
  AlbumPostStatus,
} from "@/components/nabalens/album/posted-photos"
import { AppShell } from "@/components/nabalens/app-shell"
import { BackLink } from "@/components/nabalens/back-link"
import { Row } from "@/components/nabalens/common-room/row"
import { ImagesIcon } from "@phosphor-icons/react/dist/ssr"

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
  shortDay,
  slotPageHref,
} from "@/lib/staff/my-uploads"

import { staffShellStatus } from "../../../_shell/shell-status"

export const metadata = { title: "Album photo" }

const RECENT_PHOTO_COPY = {
  by: (name: string, day: string) =>
    day ? `By ${name} · posted ${day}` : `By ${name}`,
  colleague:
    "This is a colleague's photo. Only they and your manager can change it.",
} as const

/**
 * A photo from Recent photos (D21; screens-2 handoff): the photo uncropped,
 * its label, who posted it and when, Open in Album, and for a colleague's
 * photo one line saying why there is nothing to press.
 */
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
        <BackLink href={RECENT_STAFF_POSTS}>Recent photos</BackLink>
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
        <header className="grid gap-2">
          <h1 className="type-page-title wrap-break-word text-ink">{title}</h1>
          {!post.removed ? (
            <AlbumPostStatus
              needsAttention={post.feedback.some(
                ({ action }) => action === "feedback" || action === "retake"
              )}
            />
          ) : null}
          <p className="text-meta text-ink-muted">
            {RECENT_PHOTO_COPY.by(post.uploaderName, shortDay(post.postedAt))}
          </p>
        </header>
        {!post.removed
          ? post.labels.map((label) => (
              <Row
                key={`${label.kind}:${label.id}`}
                href={slotPageHref({ kind: label.kind, slotId: label.id })}
                icon={<ImagesIcon />}
                title={`Open ${label.name} in Album`}
              />
            ))
          : null}
        {own ? null : (
          <p className="text-body text-ink-muted" data-slot="recent-colleague">
            {RECENT_PHOTO_COPY.colleague}
          </p>
        )}
        <div className="flex flex-wrap gap-2 empty:hidden">
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
