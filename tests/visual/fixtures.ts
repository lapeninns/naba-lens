import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import sharp from "sharp"

import type { Database } from "../../lib/db/types"
import { serviceClient, type Db } from "../support/identities"

/**
 * DEV FIXTURE data for the visual/accessibility suite. Everything is created
 * through the service role on a LOCAL stack with a per-run suffix, so the suite
 * never depends on, or collides with, seed data or other tests:
 *
 * - an admin;
 * - a staff member with a populated portfolio: landscape, portrait and square
 *   photos with real WebP derivatives, an MP4, and one asset each in the
 *   uploading, processing and failed states, plus an avatar;
 * - a staff member with an empty portfolio;
 * - a staff member with an 80-character name and job title at a venue with a
 *   long name (the database maxima), to catch truncation and overflow;
 * - a staff member whose venue was later deactivated (uploads paused);
 * - a deactivated staff member (blocked page).
 */

export type VisualPerson = { id: string; email: string; name: string }

export type VisualFixtures = {
  suffix: string
  venue: { id: string; name: string }
  longVenue: { id: string; name: string }
  admin: VisualPerson
  populated: VisualPerson
  empty: VisualPerson
  /** Used only by the upload-dialog test, so `empty` stays empty. */
  uploader: VisualPerson
  longName: VisualPerson
  pausedVenue: VisualPerson
  inactive: VisualPerson
}

const LONG_NAME =
  "DEV FIXTURE Bartholomew-Maximilian Featherstonehaugh-Cholmondeley Wolfeschlegel"
const LONG_TITLE =
  "DEV FIXTURE Senior Tandoori and Curry Chef de Partie, Weekend Brunch and Events"
const LONG_VENUE =
  "DEV FIXTURE The Very Long Named Riverside Coaching Inn and Restaurant at Upper Little Wittenham on Thames"

function check<T>(result: { data: T; error: unknown }): NonNullable<T> {
  if (result.error) throw result.error
  return result.data as NonNullable<T>
}

async function venue(db: Db, name: string, slug: string) {
  // Names are unique (case-insensitive); the long-name venue is shared by runs.
  const existing = check(
    await db.from("venues").select("id, name").ilike("name", name).maybeSingle()
  )
  if (existing) return existing
  return check(
    await db
      .from("venues")
      .insert({ name, slug, active: true })
      .select("id, name")
      .single()
  )
}

async function person(
  db: Db,
  opts: {
    label: string
    name: string
    role: "staff" | "admin"
    venueId?: string
    jobTitle?: string
  },
  suffix: string
): Promise<VisualPerson> {
  const email = `visual-${opts.label}-${suffix}@nabalens.test`
  // Local auth answers 504 "please retry" when many stacks share the machine.
  // Retry that fixture step only; nothing under test is retried.
  let created = await db.auth.admin.createUser({ email, email_confirm: true })
  for (let i = 0; created.error?.status === 504 && i < 3; i++) {
    created = await db.auth.admin.createUser({ email, email_confirm: true })
  }
  if (created.error) throw created.error
  const id = created.data.user.id
  check(
    await db.from("profiles").insert({
      id,
      display_name: opts.name,
      job_title: opts.jobTitle ?? null,
      role: opts.role,
      venue_id: opts.venueId ?? null,
      active: true,
    })
  )
  return { id, email, name: opts.name }
}

/** A photo with a recognisable layout so cropping in the viewer is visible. */
async function photo(width: number, height: number, hue: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="hsl(${hue} 55% 42%)"/>
    <rect x="12" y="12" width="${width - 24}" height="${height - 24}" fill="none" stroke="#fff" stroke-width="12"/>
    <circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 4}" fill="hsl(${(hue + 40) % 360} 70% 80%)"/>
  </svg>`
  const base = sharp(Buffer.from(svg))
  const original = await base.clone().jpeg({ quality: 85 }).toBuffer()
  const preview = await base
    .clone()
    .resize(1600, 1600, { fit: "inside" })
    .webp()
    .toBuffer()
  const thumb = await base
    .clone()
    .resize(480, 480, { fit: "cover" })
    .webp()
    .toBuffer()
  return { original, preview, thumb }
}

async function upload(db: Db, key: string, bytes: Buffer, contentType: string) {
  check(
    await db.storage
      .from("media")
      .upload(key, bytes, { contentType, upsert: false })
  )
}

type AssetSpec =
  | { kind: "photo"; name: string; width: number; height: number; hue: number }
  | {
      kind: "video"
      name: string
      /** Fixture file (default: the H.264 MP4 from tests/fixtures/media). */
      file?: URL
      ext?: "mp4" | "mov"
      mime?: "video/mp4" | "video/quicktime"
      durationSeconds?: number
    }
  | {
      kind: "pending"
      name: string
      state: "uploading" | "processing" | "failed"
    }

async function asset(
  db: Db,
  owner: VisualPerson,
  venueId: string,
  spec: AssetSpec
) {
  const id = randomUUID()
  const ext = spec.kind === "video" ? (spec.ext ?? "mp4") : "jpg"
  const prefix = `${owner.id}/${id}`
  check(
    await db.from("media_assets").insert({
      id,
      uploader_id: owner.id,
      venue_id: venueId,
      original_path: `${prefix}/original.${ext}`,
      original_filename: spec.name,
      media_type: spec.kind === "video" ? "video" : "image",
    })
  )
  const update = (
    values: Database["public"]["Tables"]["media_assets"]["Update"]
  ) => db.from("media_assets").update(values).eq("id", id)

  if (spec.kind === "pending") {
    if (spec.state === "uploading") return
    check(await update({ upload_state: "processing" }))
    if (spec.state === "failed") check(await update({ upload_state: "failed" }))
    return
  }

  // Like the real pipeline: the original is written while the reservation is
  // still `uploading` (storage refuses it afterwards), then processed.
  if (spec.kind === "video") {
    const mime = spec.mime ?? "video/mp4"
    const bytes = await readFile(
      fileURLToPath(
        spec.file ?? new URL("../fixtures/media/synthetic.mp4", import.meta.url)
      )
    )
    await upload(db, `${prefix}/original.${ext}`, bytes, mime)
    check(await update({ upload_state: "processing" }))
    check(
      await update({
        upload_state: "ready",
        validated_mime_type: mime,
        size_bytes: bytes.byteLength,
        width: 320,
        height: 240,
        duration_seconds: spec.durationSeconds ?? 12,
      })
    )
    return
  }

  const files = await photo(spec.width, spec.height, spec.hue)
  await upload(db, `${prefix}/original.jpg`, files.original, "image/jpeg")
  check(await update({ upload_state: "processing" }))
  await upload(db, `${prefix}/preview.webp`, files.preview, "image/webp")
  await upload(db, `${prefix}/thumb.webp`, files.thumb, "image/webp")
  check(
    await update({
      upload_state: "ready",
      validated_mime_type: "image/jpeg",
      size_bytes: files.original.byteLength,
      width: spec.width,
      height: spec.height,
      preview_path: `${prefix}/preview.webp`,
      thumbnail_path: `${prefix}/thumb.webp`,
    })
  )
}

async function avatar(db: Db, owner: VisualPerson) {
  const key = `${owner.id}/${randomUUID()}.webp`
  const bytes = await sharp({
    create: {
      width: 256,
      height: 256,
      channels: 3,
      background: { r: 60, g: 110, b: 160 },
    },
  })
    .webp()
    .toBuffer()
  check(
    await db.storage
      .from("avatars")
      .upload(key, bytes, { contentType: "image/webp", upsert: false })
  )
  check(
    await db.from("profiles").update({ avatar_path: key }).eq("id", owner.id)
  )
}

export async function seedVisualFixtures(): Promise<VisualFixtures> {
  const db = serviceClient()
  const suffix = randomUUID().slice(0, 8)
  const mainVenue = await venue(
    db,
    `DEV FIXTURE Visual Venue ${suffix}`,
    `dev-fixture-visual-${suffix}`
  )
  const longVenue = await venue(db, LONG_VENUE, "dev-fixture-visual-long-venue")
  const pausedVenue = await venue(
    db,
    `DEV FIXTURE Paused Venue ${suffix}`,
    `dev-fixture-visual-paused-${suffix}`
  )

  const admin = await person(
    db,
    { label: "admin", name: "DEV FIXTURE Visual Admin", role: "admin" },
    suffix
  )
  const populated = await person(
    db,
    {
      label: "populated",
      name: "DEV FIXTURE Priya Sharma",
      role: "staff",
      venueId: mainVenue.id,
      jobTitle: "DEV FIXTURE Curry Chef",
    },
    suffix
  )
  const empty = await person(
    db,
    {
      label: "empty",
      name: "DEV FIXTURE Empty Portfolio",
      role: "staff",
      venueId: mainVenue.id,
      jobTitle: "DEV FIXTURE Bartender",
    },
    suffix
  )
  const uploader = await person(
    db,
    {
      label: "uploader",
      name: "DEV FIXTURE Upload Tester",
      role: "staff",
      venueId: mainVenue.id,
    },
    suffix
  )
  const longName = await person(
    db,
    {
      label: "long",
      name: LONG_NAME,
      role: "staff",
      venueId: longVenue.id,
      jobTitle: LONG_TITLE,
    },
    suffix
  )
  const paused = await person(
    db,
    {
      label: "paused",
      name: "DEV FIXTURE Paused Venue Staff",
      role: "staff",
      venueId: pausedVenue.id,
    },
    suffix
  )
  const inactive = await person(
    db,
    {
      label: "inactive",
      name: "DEV FIXTURE Deactivated",
      role: "staff",
      venueId: mainVenue.id,
    },
    suffix
  )
  check(
    await db.from("profiles").update({ active: false }).eq("id", inactive.id)
  )
  check(
    await db.from("venues").update({ active: false }).eq("id", pausedVenue.id)
  )

  // Oldest first, so the gallery (newest first) starts with the pending states.
  const specs: AssetSpec[] = [
    {
      kind: "photo",
      name: "landscape-dish.jpg",
      width: 2400,
      height: 1350,
      hue: 20,
    },
    {
      kind: "photo",
      name: "portrait-plating.jpg",
      width: 1200,
      height: 2133,
      hue: 140,
    },
    {
      kind: "photo",
      name: "square-bar.jpg",
      width: 1600,
      height: 1600,
      hue: 220,
    },
    {
      kind: "photo",
      name: "panorama-dining-room.jpg",
      width: 3200,
      height: 800,
      hue: 300,
    },
    { kind: "video", name: "kitchen-pass.mp4" },
    // Codec matrix: H.264 in a MOV (Chromium: canPlayType "" yet it plays) and
    // HEVC in an MP4 (Chromium: "maybe" yet it cannot decode -> fallback).
    {
      kind: "video",
      name: "iphone-h264.mov",
      file: new URL("../fixtures/media/synthetic.mov", import.meta.url),
      ext: "mov",
      mime: "video/quicktime",
      durationSeconds: 0.2,
    },
    {
      kind: "video",
      name: "iphone-hevc.mp4",
      // `ffmpeg -i tests/fixtures/media/review-hevc.mov -c copy -tag:v hvc1 -movflags +faststart`
      file: new URL("./media/hevc.mp4", import.meta.url),
    },
    {
      kind: "photo",
      name: "IMG_20261030_dessert-with-a-very-long-original-filename-from-the-phone-camera.jpg",
      width: 1500,
      height: 2000,
      hue: 45,
    },
    { kind: "pending", name: "failed-upload.mov", state: "failed" },
    { kind: "pending", name: "still-processing.jpg", state: "processing" },
    { kind: "pending", name: "still-uploading.jpg", state: "uploading" },
  ]
  for (const spec of specs) await asset(db, populated, mainVenue.id, spec)
  await avatar(db, populated)

  for (const spec of [
    {
      kind: "photo",
      name: "long-name-photo.jpg",
      width: 1600,
      height: 1200,
      hue: 90,
    },
  ] satisfies AssetSpec[]) {
    await asset(db, longName, longVenue.id, spec)
  }

  return {
    suffix,
    venue: mainVenue,
    longVenue,
    admin,
    populated,
    empty,
    uploader,
    longName,
    pausedVenue: paused,
    inactive,
  }
}
