import { createServerClient } from "@supabase/ssr"

import type { MediaActor } from "../../lib/server/media/types"
import { finaliseAsset } from "../../lib/server/media/finalise"
import { reserveAsset } from "../../lib/server/media/reserve"
import { newKey } from "../slice/media-actor"
import {
  createIdentity,
  type Db,
  type TestIdentity,
} from "../support/identities"
import { getLocalSupabaseEnv } from "../support/local-supabase"

/**
 * Support for the gaps-* integration tests, which call the app's real Route
 * Handlers and Server Functions. Those read the session from `next/headers`
 * cookies; the test file mocks that module with `cookieJar`, and this helper
 * fills the jar with the exact cookies @supabase/ssr writes for a signed-in
 * identity, so the route sees a genuine session (RLS and getClaims included).
 */

export type CookieJar = { current: Map<string, string> }

/** Points the app's env readers at the local stack the tests use. */
export function useLocalEnv() {
  const env = getLocalSupabaseEnv()
  process.env.NEXT_PUBLIC_SUPABASE_URL = env.url
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = env.publishableKey
  process.env.SUPABASE_SERVICE_ROLE_KEY = env.serviceRoleKey
  return env
}

/** The cookies a browser signed in as `identity` would send. */
export async function sessionCookies(
  identity: TestIdentity
): Promise<Map<string, string>> {
  const env = getLocalSupabaseEnv()
  const store = new Map<string, string>()
  const client = createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll: () => [...store].map(([name, value]) => ({ name, value })),
      setAll: (list) =>
        list.forEach(({ name, value }) =>
          value ? store.set(name, value) : store.delete(name)
        ),
    },
  })
  const { data } = await identity.client.auth.getSession()
  if (!data.session) throw new Error(`No session for ${identity.email}`)
  const { error } = await client.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  })
  if (error) throw error
  if (store.size === 0) throw new Error("No auth cookies were written")
  return store
}

/** `next/headers` replacement backed by the jar. */
export function cookiesModule(jar: CookieJar) {
  return {
    cookies: async () => ({
      getAll: () => [...jar.current].map(([name, value]) => ({ name, value })),
      get: (name: string) =>
        jar.current.has(name)
          ? { name, value: jar.current.get(name)! }
          : undefined,
      has: (name: string) => jar.current.has(name),
      set: () => {},
      delete: () => {},
    }),
    headers: async () => new Headers(),
  }
}

/** Route Handler context for a dynamic `[id]` segment. */
export const params = (id: string) => ({ params: Promise.resolve({ id }) })

/** Reserve, store and finalise one file as `actor` (the real upload path). */
export async function uploadAs(
  actor: MediaActor,
  identity: TestIdentity,
  bytes: Uint8Array,
  file: { filename: string; contentType: string; mediaType: "image" | "video" }
) {
  const idempotencyKey = newKey()
  const reserved = await reserveAsset(actor, {
    idempotencyKey,
    filename: file.filename,
    sizeBytes: bytes.byteLength,
    contentType: file.contentType,
    mediaType: file.mediaType,
    preferResumable: false,
  })
  if (!reserved.ok) throw new Error(reserved.message)
  const bucket = identity.client.storage.from("media")
  const stored = reserved.token
    ? await bucket.uploadToSignedUrl(
        reserved.objectKey,
        reserved.token,
        bytes,
        {
          contentType: file.contentType,
        }
      )
    : await bucket.upload(reserved.objectKey, bytes, {
        contentType: file.contentType,
      })
  if (stored.error) throw stored.error
  const finalised = await finaliseAsset(actor, {
    assetId: reserved.assetId,
    idempotencyKey,
  })
  if (!finalised.ok || finalised.state !== "ready") {
    throw new Error(`Upload did not become ready: ${JSON.stringify(finalised)}`)
  }
  return reserved.assetId
}

/** Cache-Control must keep private media out of every shared cache. */
export function assertPrivateCaching(
  response: Response,
  label: string
): string[] {
  const problems: string[] = []
  const cc = (response.headers.get("cache-control") ?? "").toLowerCase()
  if (!cc.includes("no-store")) problems.push(`${label}: no no-store (${cc})`)
  if (!cc.includes("private")) problems.push(`${label}: not private (${cc})`)
  if (/\bpublic\b|s-maxage/.test(cc)) {
    problems.push(`${label}: shared-cacheable (${cc})`)
  }
  return problems
}

const isAuthTimeout = (e: unknown) =>
  typeof e === "object" &&
  e !== null &&
  ((e as { status?: number }).status === 504 ||
    (e as { name?: string }).name === "AuthRetryableFetchError")

/**
 * Fixture setup only: `createIdentity`, retried when the local auth server
 * answers 504 (its 10 s request deadline) because several stacks share this
 * machine. Each attempt uses a fresh email, so a half-finished attempt cannot
 * collide. Logged, never applied to an assertion.
 */
export async function setupIdentity(
  admin: Db,
  opts: Parameters<typeof createIdentity>[1],
  attempts = 4
): Promise<TestIdentity> {
  for (let i = 1; ; i++) {
    try {
      return await createIdentity(admin, opts)
    } catch (e) {
      if (!isAuthTimeout(e) || i >= attempts) throw e
      console.warn(`[gaps] auth timeout creating ${opts.label}; retry ${i}`)
    }
  }
}

/** Fixture setup only: a session for an existing user, retried on auth 504s. */
export async function setupSession<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 4
): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn()
    } catch (e) {
      if (!isAuthTimeout(e) || i >= attempts) throw e
      console.warn(`[gaps] auth timeout signing in ${label}; retry ${i}`)
    }
  }
}
