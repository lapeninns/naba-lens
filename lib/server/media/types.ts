import type { SupabaseClient } from "@supabase/supabase-js"

import type { CurrentProfile } from "@/lib/auth/profile"
import type { Database } from "@/lib/db/types"
import type { MediaLabelSummary } from "@/lib/menus/types"

import type { StorageEnv } from "./storage"

export type Db = SupabaseClient<Database>

/**
 * Everything a media operation needs, built per request by `context.ts` after
 * lib/auth has authorised the caller. Tests build it from real local identities.
 */
export type MediaActor = {
  /** The caller's current, active profile (re-read from the database). */
  profile: CurrentProfile
  /** Acts as the caller: RLS and storage policies apply. */
  db: Db
  /** Service role: bypasses RLS. Only after an explicit check on the asset. */
  service: Db
  storage: StorageEnv
}

/** Server-side result: an expected failure is a value, never a thrown error. */
export type Outcome<T> =
  | ({ ok: true } & T)
  | { ok: false; status: 400 | 401 | 403 | 404 | 409 | 503; message: string }

export type MediaKind = Database["public"]["Enums"]["media_type"]
export type UploadState = Database["public"]["Enums"]["upload_state"]

/**
 * One gallery entry. Structurally identical to `MediaItem` in
 * components/nabalens/types.ts (server code never imports components/); the
 * client passes it straight to the UI kit, so a drift fails `pnpm typecheck`.
 * URLs point at authorised routes that sign or stream per request.
 */
export type MediaItemView = {
  id: string
  mediaType: MediaKind
  uploadState: UploadState
  thumbnailUrl: string | null
  previewUrl: string | null
  mimeType: string | null
  originalFilename: string
  createdAt: string
  contributorId: string
  contributorName: string
  venueName: string
  width: number | null
  height: number | null
  durationSeconds: number | null
  sizeBytes: number | null
  /** v0.3 optional labels, read as the caller; null when none are visible. */
  labels: MediaLabelSummary | null
}

export type MediaPage = { items: MediaItemView[]; nextCursor: string | null }

/** Admin library filters; every field optional and combinable. */
export type LibraryFilters = {
  venueId: string | null
  staffId: string | null
  type: MediaKind | null
}
