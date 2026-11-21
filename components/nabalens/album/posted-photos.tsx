import Link from "next/link"

import { Notice } from "@/components/nabalens/notice"
import { StatusChip } from "@/components/nabalens/status-chip"
import { Photo } from "@/components/ui/photo"
import {
  STAFF_POSTED,
  staffPostHref,
  staffPostImage,
} from "@/lib/config/staff-album-posts"
import type { AlbumFeedback, AlbumPost } from "@/lib/server/staff-album-posts"

export function PostedPhotos({
  posts,
  label,
  photoHref = staffPostHref,
}: {
  posts: AlbumPost[] | null
  label: string
  photoHref?: (id: string) => string
}) {
  if (!posts)
    return (
      <Notice tone="negative" role="alert">
        Photos could not be loaded. Reload to try again.
      </Notice>
    )
  if (posts.length === 0)
    return <p className="text-body text-ink-muted">No photos here yet.</p>
  return (
    <ul aria-label={label} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {posts.map((post) => {
        const subject =
          post.labels.map(({ name }) => name).join(", ") || "Unlabelled"
        return (
          <li key={post.id} className="min-w-0">
            <Link
              href={photoHref(post.id)}
              className="grid gap-1 rounded-card focus-ring"
            >
              <Photo
                src={staffPostImage(post.id, "thumb")}
                alt=""
                ratio="4/3"
              />
              <span className="text-label wrap-break-word text-ink">
                {subject}
              </span>
              <span className="text-meta wrap-break-word text-ink-muted">
                {post.uploaderName}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

const FEEDBACK_TITLE = {
  feedback: "Feedback from your manager",
  retake: "Another photo requested",
  remove: "Removed from Album",
  label: "Label corrected",
} as const

export function AlbumPostFeedback({
  notes,
  removed,
}: {
  notes: AlbumFeedback[]
  removed: boolean
}) {
  if (notes.length === 0 && !removed) return null
  return (
    <section aria-label="Manager feedback" className="grid gap-2">
      <h2 className="type-section-title text-ink">Manager feedback</h2>
      {removed && !notes.some((note) => note.action === "remove") ? (
        <Notice tone="attention">Removed from Album</Notice>
      ) : null}
      {notes.map((note) => (
        <Notice
          tone={note.action === "label" ? "plain" : "attention"}
          key={note.id}
        >
          <p className="text-label">{FEEDBACK_TITLE[note.action]}</p>
          {note.label_name ? <p>{note.label_name}</p> : null}
          {note.note ? <p className="wrap-break-word">{note.note}</p> : null}
        </Notice>
      ))}
    </section>
  )
}

/** A posted photo's chips (screens-2 handoff): Posted, and Needs attention. */
export function AlbumPostStatus({
  needsAttention = false,
}: {
  needsAttention?: boolean
}) {
  return (
    <div className="flex flex-wrap gap-1.5" data-slot="album-post-status">
      <StatusChip tone="positive">{STAFF_POSTED}</StatusChip>
      {needsAttention ? <StatusChip state="needs_attention" /> : null}
    </div>
  )
}
