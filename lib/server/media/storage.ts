import type { VideoRangeSource } from "@/lib/media"
import { STORAGE_BUCKETS } from "@/lib/config/storage"

/**
 * Direct Storage API access with the service role, for the two things supabase-js
 * cannot do: HTTP Range reads (video probing without downloading the whole file)
 * and streaming an original through an authorised route. Callers must authorise
 * the user and re-check the asset first: this bypasses storage RLS.
 */
export type StorageEnv = { url: string; serviceKey: string }

function objectUrl(env: StorageEnv, key: string) {
  const path = key.split("/").map(encodeURIComponent).join("/")
  return `${env.url.replace(/\/+$/, "")}/storage/v1/object/authenticated/${STORAGE_BUCKETS.media}/${path}`
}

function authHeaders(env: StorageEnv): Record<string, string> {
  // Same pair supabase-js sends; works for JWT service keys and sb_secret keys.
  return { apikey: env.serviceKey, authorization: `Bearer ${env.serviceKey}` }
}

/** Object size in bytes, or null when the object does not exist (yet). */
export async function statMediaObject(
  env: StorageEnv,
  key: string
): Promise<number | null> {
  const res = await fetch(objectUrl(env, key), {
    method: "HEAD",
    headers: authHeaders(env),
    cache: "no-store",
  })
  // Storage answers 400 ("not_found") or 404 for a missing object.
  if (res.status === 400 || res.status === 404) return null
  if (!res.ok) throw new Error(`storage_head_${res.status}`)
  const size = Number(res.headers.get("content-length"))
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error("storage_head_no_length")
  }
  return size
}

/** A `VideoRangeSource` over one stored object; every read is a Range request. */
export function mediaRangeSource(
  env: StorageEnv,
  key: string,
  size: number
): VideoRangeSource {
  return {
    size,
    async read(offset, length) {
      if (length <= 0 || offset >= size) return new Uint8Array(0)
      const end = Math.min(size, offset + length) - 1
      const res = await fetch(objectUrl(env, key), {
        headers: { ...authHeaders(env), range: `bytes=${offset}-${end}` },
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      })
      if (res.status !== 206 && res.status !== 200) {
        throw new Error(`storage_range_${res.status}`)
      }
      const bytes = new Uint8Array(await res.arrayBuffer())
      // A server that ignores Range answers 200 with the whole object.
      return res.status === 200 ? bytes.subarray(offset, end + 1) : bytes
    },
  }
}

/**
 * Streams an original from storage, forwarding an optional client Range header.
 * The caller sets every response header itself; nothing from storage is trusted
 * except the byte range bookkeeping.
 */
export async function fetchMediaObject(
  env: StorageEnv,
  key: string,
  range?: string | null
): Promise<Response> {
  const headers = authHeaders(env)
  if (range && /^bytes=\d*-\d*$/.test(range)) headers.range = range
  return fetch(objectUrl(env, key), { headers, cache: "no-store" })
}
