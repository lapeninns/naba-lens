// DEV FIXTURE: fake data for the UI preview route only. Not real staff, venues
// or media. Images are generated flat-colour SVGs.

import type { MediaItem, Option, StaffMember } from "@/components/nabalens"

function sampleImage(label: string, colour: string, w: number, h: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="${colour}"/><circle cx="${w * 0.7}" cy="${h * 0.35}" r="${Math.min(w, h) * 0.16}" fill="rgba(255,255,255,0.35)"/><rect x="0" y="${h * 0.68}" width="${w}" height="${h * 0.32}" fill="rgba(0,0,0,0.18)"/><text x="${w * 0.06}" y="${h * 0.9}" font-family="sans-serif" font-size="${Math.round(Math.min(w, h) * 0.09)}" fill="#fff">${label}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export const FAKE_VENUES: Option[] = [
  { id: "venue-a", name: "Sample venue A" },
  { id: "venue-b", name: "Sample venue B" },
  { id: "venue-c", name: "Sample venue C (long name to test wrapping)" },
]

export const FAKE_STAFF_OPTIONS: Option[] = [
  { id: "staff-1", name: "Sample staff 1" },
  { id: "staff-2", name: "Sample staff 2" },
  { id: "staff-3", name: "Sample staff 3" },
]

export const FAKE_STAFF: StaffMember[] = [
  {
    id: "staff-1",
    displayName: "Sample staff 1",
    avatarUrl: null,
    jobTitle: "Sample job title (chef)",
    venueId: "venue-a",
    venueName: "Sample venue A",
    email: "sample.staff1@example.invalid",
    status: "active",
  },
  {
    id: "staff-2",
    displayName: "Sample staff 2",
    avatarUrl: sampleImage("S2", "#5b6b73", 160, 160),
    jobTitle: "Sample job title (bartender)",
    venueId: "venue-b",
    venueName: "Sample venue B",
    email: "sample.staff2@example.invalid",
    status: "invited",
  },
  {
    id: "staff-3",
    displayName: "Sample staff 3 with a much longer display name",
    avatarUrl: null,
    jobTitle: null,
    venueId: null,
    venueName: null,
    email: "sample.staff3.with.a.long.address@example.invalid",
    status: "inactive",
  },
]

const COLOURS = [
  "#7a5c45",
  "#3f6b5a",
  "#8a6d2f",
  "#4b5d7a",
  "#6e4a5a",
  "#56606a",
]

export const FAKE_MEDIA: MediaItem[] = Array.from({ length: 14 }, (_, i) => {
  const isVideo = i % 5 === 2
  const portrait = i % 3 === 1
  const w = portrait ? 800 : 1200
  const h = portrait ? 1200 : 800
  const colour = COLOURS[i % COLOURS.length]
  const state: MediaItem["uploadState"] =
    i === 0
      ? "processing"
      : i === 1
        ? "uploading"
        : i === 4
          ? "failed"
          : "ready"
  const staff = FAKE_STAFF[i % 3]
  return {
    id: `media-${i + 1}`,
    mediaType: isVideo ? "video" : "image",
    uploadState: state,
    thumbnailUrl:
      state === "ready"
        ? sampleImage(`Sample ${i + 1}`, colour, 400, 400)
        : null,
    // Videos point at a missing file so the viewer shows its fallback.
    previewUrl:
      state !== "ready"
        ? null
        : isVideo
          ? "/__dev-fixture-missing.mov"
          : sampleImage(`Sample ${i + 1} (full ${w}×${h})`, colour, w, h),
    mimeType: isVideo
      ? i % 2
        ? "video/quicktime"
        : "video/mp4"
      : "image/jpeg",
    originalFilename: isVideo
      ? `sample-clip-${i + 1}.mov`
      : `sample-photo-${i + 1}.jpg`,
    createdAt: new Date(Date.UTC(2026, 9, 28 - i, 18, 30)).toISOString(),
    contributorId: staff.id,
    contributorName: staff.displayName,
    venueName: FAKE_VENUES[i % 3].name,
    width: isVideo ? 1920 : w * 3,
    height: isVideo ? 1080 : h * 3,
    durationSeconds: isVideo ? 14 + i * 3 : null,
    sizeBytes: isVideo ? 48_000_000 + i * 1_000_000 : 3_200_000 + i * 100_000,
  }
})

/** Preview-only copy of the spec defaults; the app passes MEDIA_LIMITS from lib/config/media.ts. */
export const PREVIEW_LIMITS = {
  maxBatchFiles: 10,
  maxParallelUploads: 2,
  maxPhotoBytes: 20 * 1024 * 1024,
  maxVideoBytes: 200 * 1024 * 1024,
}
export const PREVIEW_MAX_AVATAR_BYTES = 5 * 1024 * 1024
