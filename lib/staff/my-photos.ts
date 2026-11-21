// My photos (DESIGN.md §5e, D19): what needs the person, each photo's mark,
// the filter, the day groups and the summary line. Pure, so the screen, the
// photo page and the tests share it.

import { londonDay } from "@/lib/staff/home"
import { STAFF_POSTED } from "@/lib/config/staff-album-posts"
import {
  openRetake,
  unmatched,
  type MyUpload,
  type UploadSlot,
} from "@/lib/staff/my-uploads"

/** Why a photo is in Needs you (§5e step 3). */
export type NeedYou =
  | { kind: "retake"; slot: UploadSlot }
  | { kind: "no-slot" }
  | { kind: "failed" }
  | { kind: "feedback" }

/** The one thing a photo needs from the person, or null. */
export function needsYou(item: MyUpload): NeedYou | null {
  if (item.uploadState === "failed") return { kind: "failed" }
  const retake = openRetake(item)
  if (retake) return { kind: "retake", slot: retake }
  if (item.albumPost)
    return item.albumPost.needs_attention ? { kind: "feedback" } : null
  // "I'm not sure" goes to the manager, who chooses the slot: not the person's job.
  if (item.uploadState === "ready" && unmatched(item) && !item.labelHelp)
    return { kind: "no-slot" }
  return null
}

/** A photo's corner mark in the grid (§5e step 6). */
export type PhotoMark =
  "needs-you" | "waiting" | "in-album" | "posted" | "removed" | "none"

const IN_ALBUM = new Set(["public", "reference", "label_corrected"])

export function photoMark(item: MyUpload): PhotoMark {
  if (item.albumPost?.removed) return "removed"
  if (needsYou(item)) return "needs-you"
  if (item.albumPost) return "posted"
  if (item.slots.some((s) => IN_ALBUM.has(s.outcome))) return "in-album"
  if (
    item.uploadState !== "ready" ||
    item.labelHelp ||
    item.sharedKinds.length > 0 ||
    item.slots.some((s) => s.outcome === "awaiting_review")
  )
    return "waiting"
  return "none"
}

export type PhotoShow = "all" | "waiting" | "in-album" | "posted" | "unlabelled"

export const PHOTO_SHOWS: ReadonlyArray<{ key: PhotoShow; label: string }> = [
  { key: "all", label: "All" },
  { key: "waiting", label: "Waiting" },
  { key: "in-album", label: "In the album" },
]

export const POSTED_PHOTO_SHOWS: typeof PHOTO_SHOWS = [
  { key: "all", label: "All" },
  { key: "unlabelled", label: "Unlabelled" },
  { key: "posted", label: STAFF_POSTED },
]

export const isPhotoShow = (v: unknown, posting = false): v is PhotoShow =>
  (posting ? POSTED_PHOTO_SHOWS : PHOTO_SHOWS).some((s) => s.key === v)

export function matchesShow(item: MyUpload, show: PhotoShow): boolean {
  if (show === "all") return true
  if (show === "posted") return !!item.albumPost && !item.albumPost.removed
  if (show === "unlabelled")
    // A photo with the manager (I'm not sure) is theirs to label now.
    return (
      !!item.albumPost &&
      !item.albumPost.removed &&
      !item.albumPost.labelled &&
      !item.labelHelp
    )
  return photoMark(item) === show
}

export type DayGroup = { day: string; label: string; items: MyUpload[] }

/** "Today", "Yesterday", else "Tue 17 Nov", in the venue's calendar. */
export function dayLabel(day: string, now: Date = new Date()): string {
  const today = londonDay(now)
  if (day === today) return "Today"
  const y = new Date(`${today}T12:00:00Z`)
  y.setUTCDate(y.getUTCDate() - 1)
  if (day === y.toISOString().slice(0, 10)) return "Yesterday"
  const d = new Date(`${day}T12:00:00Z`)
  const sameYear = day.slice(0, 4) === today.slice(0, 4)
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  })
    .format(d)
    .replace(",", "")
}

/** Photos grouped by the day they were sent, newest day first (§5e step 6). */
export function groupByDay(
  items: readonly MyUpload[],
  now: Date = new Date()
): DayGroup[] {
  const groups: DayGroup[] = []
  for (const item of [...items].sort((a, b) =>
    b.uploadedAt.localeCompare(a.uploadedAt)
  )) {
    const day = londonDay(new Date(item.uploadedAt))
    const last = groups.at(-1)
    if (last && last.day === day) last.items.push(item)
    else groups.push({ day, label: dayLabel(day, now), items: [item] })
  }
  return groups
}

export type PhotoSummary = {
  sent: number
  inAlbum: number
  waiting: number
  needsYou: number
}

export function photoSummary(items: readonly MyUpload[]): PhotoSummary {
  const marks = items.map(photoMark)
  return {
    sent: items.length,
    inAlbum: marks.filter((m) => m === "in-album").length,
    waiting: marks.filter((m) => m === "waiting").length,
    needsYou: marks.filter((m) => m === "needs-you").length,
  }
}

export const MY_PHOTOS_COPY = {
  summary: (s: PhotoSummary, more: boolean) =>
    [
      `${s.sent}${more ? "+" : ""} sent`,
      s.inAlbum ? `${s.inAlbum} in the album` : null,
      s.waiting ? `${s.waiting} waiting` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  needsYou: "Needs you",
  feedback: "Your manager left feedback.",
  retake: "Retake",
  noSlot: "Which dish or space is this?",
  viewPhoto: "View photo",
  labelMultiple: "Label photos",
  failed: "Didn't finish. Add it again from your gallery.",
  addAgain: "Add again",
  sending: (n: number) => `Sending ${n} ${n === 1 ? "photo" : "photos"}…`,
  showMore: "Show more",
  empty: "Photos you add appear here, newest first.",
  noneShown: "None here yet. Choose All to see every photo.",
  readFailed: "Your photos couldn't be loaded. Reload to try again.",
  mark: {
    "needs-you": "Needs you",
    waiting: "Waiting",
    "in-album": "In the album",
    posted: STAFF_POSTED,
    removed: "Removed from Album",
    none: "Not in the album",
  } satisfies Record<PhotoMark, string>,
  back: "My photos",
}
