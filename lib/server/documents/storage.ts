import "server-only"

import type { StorageEnv } from "@/lib/server/media/storage"

import { DOCUMENTS_BUCKET, DOCUMENT_LIMITS } from "./config"

// Service-role Storage API access for the documents bucket. Callers must
// authorise the user through a document RPC first: this bypasses storage RLS.

function objectUrl(env: StorageEnv, key: string) {
  const path = key.split("/").map(encodeURIComponent).join("/")
  return `${env.url.replace(/\/+$/, "")}/storage/v1/object/authenticated/${DOCUMENTS_BUCKET}/${path}`
}

const authHeaders = (env: StorageEnv) => ({
  apikey: env.serviceKey,
  authorization: `Bearer ${env.serviceKey}`,
})

/**
 * The stored bytes, or null when nothing is stored yet. Reads at most one
 * byte past the cap, so an oversized object is refused without loading it.
 */
export async function readDocumentObject(
  env: StorageEnv,
  key: string
): Promise<Uint8Array | null> {
  const res = await fetch(objectUrl(env, key), {
    headers: {
      ...authHeaders(env),
      range: `bytes=0-${DOCUMENT_LIMITS.maxBytes}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  })
  if (res.status === 400 || res.status === 404) {
    await res.arrayBuffer().catch(() => undefined)
    return null
  }
  if (res.status !== 200 && res.status !== 206) {
    await res.arrayBuffer().catch(() => undefined)
    throw new Error(`storage_get_${res.status}`)
  }
  return new Uint8Array(await res.arrayBuffer())
}

/** Streams a stored document; the caller sets every response header. */
export function fetchDocumentObject(env: StorageEnv, key: string) {
  return fetch(objectUrl(env, key), {
    headers: authHeaders(env),
    cache: "no-store",
  })
}
