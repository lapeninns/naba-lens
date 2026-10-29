/**
 * Private storage buckets and object-key builders. Keys are relative to their
 * bucket and always derived from server-generated IDs; the database enforces the
 * same shapes with check constraints (see supabase/migrations).
 */

export const STORAGE_BUCKETS = {
  media: "media",
  avatars: "avatars",
} as const

export type StorageBucket =
  (typeof STORAGE_BUCKETS)[keyof typeof STORAGE_BUCKETS]

const EXTENSION_PATTERN = /^[a-z0-9]{2,5}$/

function assertExtension(ext: string): string {
  const normalised = ext.replace(/^\./, "").toLowerCase()
  if (!EXTENSION_PATTERN.test(normalised)) {
    throw new Error(`Invalid file extension: ${ext}`)
  }
  return normalised
}

/** Keys inside the `media` bucket for one asset. */
export function mediaObjectKeys(
  uploaderId: string,
  assetId: string,
  ext: string
) {
  const prefix = `${uploaderId}/${assetId}`
  return {
    original: `${prefix}/original.${assertExtension(ext)}`,
    preview: `${prefix}/preview.webp`,
    thumbnail: `${prefix}/thumb.webp`,
  }
}

/** Key inside the `avatars` bucket for a new avatar derivative. */
export function avatarObjectKey(userId: string, avatarId: string): string {
  return `${userId}/${avatarId}.webp`
}
