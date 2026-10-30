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

/** Smallest Range request: video probes read many tiny box headers. */
const READ_BLOCK_BYTES = 256 * 1024
/** Blocks kept per source (at most ~2 MiB plus one large read). */
const CACHED_BLOCKS = 8

async function fetchRange(
  env: StorageEnv,
  key: string,
  offset: number,
  end: number
): Promise<Uint8Array> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(objectUrl(env, key), {
      headers: { ...authHeaders(env), range: `bytes=${offset}-${end}` },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    })
    if (res.status === 206 || res.status === 200) {
      const bytes = new Uint8Array(await res.arrayBuffer())
      // A server that ignores Range answers 200 with the whole object.
      return res.status === 200 ? bytes.subarray(offset, end + 1) : bytes
    }
    // Drain rather than cancel: awaiting cancel() on Next's fetch body can hang.
    await res.arrayBuffer().catch(() => undefined)
    if (res.status < 500 || attempt >= 1) {
      throw new Error(`storage_range_${res.status}`)
    }
  }
}

/**
 * A `VideoRangeSource` over one stored object. Reads are served from a small
 * cache of blocks fetched with HTTP Range requests of at least 256 KiB, so a
 * probe of box headers costs a few round trips instead of dozens.
 */
export function mediaRangeSource(
  env: StorageEnv,
  key: string,
  size: number
): VideoRangeSource {
  const blocks: { start: number; bytes: Uint8Array }[] = []
  return {
    size,
    async read(offset, length) {
      if (length <= 0 || offset >= size) return new Uint8Array(0)
      const end = Math.min(size, offset + length)
      const hit = blocks.find(
        (b) => b.start <= offset && b.start + b.bytes.byteLength >= end
      )
      if (hit) return hit.bytes.subarray(offset - hit.start, end - hit.start)
      const fetchEnd = Math.min(size, Math.max(end, offset + READ_BLOCK_BYTES))
      const bytes = await fetchRange(env, key, offset, fetchEnd - 1)
      if (bytes.byteLength <= READ_BLOCK_BYTES) {
        blocks.push({ start: offset, bytes })
        if (blocks.length > CACHED_BLOCKS) blocks.shift()
      }
      return bytes.subarray(0, end - offset)
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
