import { randomUUID } from "node:crypto"

import sharp from "sharp"

import {
  createIdentity,
  type Db,
  type TestIdentity,
} from "../support/identities"

/**
 * Library test data, written with the service role the way finalise leaves a
 * ready asset: a reservation row (`uploading`), the stored objects, then
 * `processing -> ready` with the validated facts and derivative keys. Unlike a
 * real upload, `created_at` (and `id`) can be chosen, so tests control the feed
 * order exactly, including equal timestamps that only the id tiebreak orders.
 */

export type SeedOptions = {
  uploaderId: string
  venueId: string
  type?: "image" | "video"
  createdAt?: string
  id?: string
  filename?: string
  /** Store real WebP derivatives (images) so thumbnails and previews load. */
  derivatives?: boolean
}

export type SeededAsset = {
  id: string
  uploaderId: string
  venueId: string
  type: "image" | "video"
  createdAt: string
}

let webp: Promise<Uint8Array> | null = null

/** A small valid WebP shared by every seeded derivative. */
function derivativeBytes() {
  webp ??= sharp({
    create: {
      width: 64,
      height: 48,
      channels: 3,
      background: { r: 200, g: 120, b: 60 },
    },
  })
    .webp()
    .toBuffer()
    .then((b) => new Uint8Array(b))
  return webp
}

export async function seedAsset(
  service: Db,
  opts: SeedOptions
): Promise<SeededAsset> {
  const id = opts.id ?? randomUUID()
  const type = opts.type ?? "image"
  const ext = type === "video" ? "mp4" : "jpg"
  const prefix = `${opts.uploaderId}/${id}`
  const { data, error } = await service
    .from("media_assets")
    .insert({
      id,
      uploader_id: opts.uploaderId,
      venue_id: opts.venueId,
      media_type: type,
      original_path: `${prefix}/original.${ext}`,
      original_filename: opts.filename ?? `seed-${id.slice(0, 8)}.${ext}`,
      ...(opts.createdAt ? { created_at: opts.createdAt } : {}),
    })
    .select("created_at")
    .single()
  if (error) throw error

  let thumbnail: string | null = null
  let preview: string | null = null
  if (opts.derivatives && type === "image") {
    const bytes = await derivativeBytes()
    const bucket = service.storage.from("media")
    for (const name of ["thumb", "preview"] as const) {
      const path = `${prefix}/${name}.webp`
      const { error: upErr } = await bucket.upload(path, bytes, {
        contentType: "image/webp",
        upsert: true,
      })
      if (upErr) throw upErr
      if (name === "thumb") thumbnail = path
      else preview = path
    }
  }

  const { error: processingError } = await service
    .from("media_assets")
    .update({ upload_state: "processing" })
    .eq("id", id)
  if (processingError) throw processingError
  const { error: readyError } = await service
    .from("media_assets")
    .update({
      upload_state: "ready",
      validated_mime_type: type === "video" ? "video/mp4" : "image/jpeg",
      size_bytes: 4,
      width: 64,
      height: 48,
      thumbnail_path: thumbnail,
      preview_path: preview,
    })
    .eq("id", id)
  if (readyError) throw readyError

  return {
    id,
    uploaderId: opts.uploaderId,
    venueId: opts.venueId,
    type,
    createdAt: data.created_at,
  }
}

/** Distinct, strictly decreasing ISO timestamps: `base - i` seconds. */
export function secondsBefore(base: Date, i: number): string {
  return new Date(base.getTime() - i * 1000).toISOString()
}

/**
 * Microseconds since the epoch for a timestamptz string. Postgres keeps
 * microseconds (`now()` differs between concurrent inserts below a
 * millisecond), which `Date.parse` would drop.
 */
export function micros(ts: string): bigint {
  const m = /^(.*T\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d:\d\d)$/.exec(ts)
  if (!m) throw new Error(`Unexpected timestamp ${ts}`)
  const seconds = BigInt(Date.parse(`${m[1]}${m[3]}`)) * BigInt(1000)
  return seconds + BigInt((m[2] ?? "").padEnd(6, "0"))
}

/** Negative when `a` comes first in the feed: created_at desc, then id desc. */
export function feedCompare(
  a: { id: string; createdAt: string },
  b: { id: string; createdAt: string }
): number {
  const at = micros(a.createdAt)
  const bt = micros(b.createdAt)
  if (at !== bt) return at > bt ? -1 : 1
  return a.id > b.id ? -1 : a.id < b.id ? 1 : 0
}

/** The feed order: created_at desc, then id desc. */
export function newestFirst<T extends { id: string; createdAt: string }>(
  rows: T[]
): T[] {
  return [...rows].sort(feedCompare)
}

/**
 * createIdentity for test SETUP. No retries (merge plan, fixture-retry policy):
 * a local auth timeout (HTTP 504, usually machine load from several stacks)
 * fails once with a diagnostic instead of being retried.
 */
export async function setupIdentity(
  admin: Db,
  opts: Parameters<typeof createIdentity>[1]
): Promise<TestIdentity> {
  try {
    return await createIdentity(admin, opts)
  } catch (error) {
    if (error instanceof Error && error.name === "AuthRetryableFetchError")
      error.message = `setupIdentity(${opts.label}): local auth timed out (machine load?): ${error.message}`
    throw error
  }
}
