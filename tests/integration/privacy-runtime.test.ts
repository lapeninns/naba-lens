// Privacy audit against a RUNNING production server (`next start`) on an isolated
// local Supabase stack. It drives the real journey over HTTP (magic-link landing,
// Server Functions, upload, profile photo, invitation, deactivation, deletion) and
// requests every page and media route as anonymous, staff A, staff B and admin.
//
// Asserts on every response: no public/shared caching, private no-store on
// anything user-specific, nosniff on media/API routes, attachment disposition on
// originals, no public storage URLs, signed URLs only in uncached responses and
// only to their owner or an admin, no other users' emails or IDs to staff. Then
// checks the server's console output for tokens, signed URLs, keys and emails.
//
// Needs PRIVACY_BASE_URL (the server), PRIVACY_SERVER_LOG (its captured
// stdout+stderr), the stack's NEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY /
// SUPABASE_SERVICE_ROLE_KEY, and the server's CLEANUP_SECRET. The `.next` build in
// this checkout must be the one being served (Server Function IDs are read from
// it). See docs/privacy-audit.md. Without PRIVACY_BASE_URL the suite is skipped.
import { createHash, randomUUID } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { syntheticJpeg } from "../slice/media-actor"
import {
  anonClient,
  createIdentity,
  createVenue,
  serviceClient,
  testEmail,
  type Db,
} from "../support/identities"
import { getLocalSupabaseEnv } from "../support/local-supabase"

const BASE = process.env.PRIVACY_BASE_URL?.replace(/\/+$/, "")
const LOG = process.env.PRIVACY_SERVER_LOG

type Role = "anon" | "staffA" | "staffB" | "admin"
type Jar = Map<string, string>
type Observed = {
  role: Role
  method: string
  path: string
  status: number
  headers: Headers
  body: string
  rsc: boolean
}

const jars: Record<Role, Jar> = {
  anon: new Map(),
  staffA: new Map(),
  staffB: new Map(),
  admin: new Map(),
}
const observed: Observed[] = []
/** Values that must never appear in the server log. */
const secrets = new Set<string>()

function cookieHeader(jar: Jar) {
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ")
}

function absorb(jar: Jar, headers: Headers) {
  for (const raw of headers.getSetCookie()) {
    const [pair, ...attrs] = raw.split(";")
    const eq = pair.indexOf("=")
    const name = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a))
    if (expired || value === "") jar.delete(name)
    else jar.set(name, value)
    if (name.startsWith("sb-") && value) {
      secrets.add(value)
      // @supabase/ssr stores the session as base64-<base64url JSON>.
      const json = value.startsWith("base64-")
        ? Buffer.from(value.slice(7), "base64url").toString("utf8")
        : decodeURIComponent(value)
      for (const m of json.matchAll(
        /"(access_token|refresh_token)":"([^"]+)"/g
      ))
        secrets.add(m[2])
    }
  }
}

async function request(
  role: Role,
  path: string,
  init: RequestInit & { record?: boolean } = {}
): Promise<Observed> {
  const headers = new Headers(init.headers)
  const cookie = cookieHeader(jars[role])
  if (cookie) headers.set("cookie", cookie)
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
    redirect: "manual",
  })
  absorb(jars[role], res.headers)
  const isBinary = /^(image|video)\//.test(
    res.headers.get("content-type") ?? ""
  )
  const body = isBinary ? "" : await res.text()
  if (isBinary) await res.body?.cancel()
  const entry = {
    role,
    method: init.method ?? "GET",
    // Kept out of assertion messages, although each link is single-use.
    path: path.replace(/token_hash=[^&]+/, "token_hash=…"),
    status: res.status,
    headers: res.headers,
    body,
    rsc: headers.has("rsc"),
  }
  if (init.record !== false) observed.push(entry)
  return entry
}

/** Server Function IDs from the build being served. */
function actionIds(): Record<string, string> {
  const manifest = JSON.parse(
    readFileSync(".next/server/server-reference-manifest.json", "utf8")
  ) as { node: Record<string, { exportedName?: string; filename: string }> }
  const ids: Record<string, string> = {}
  for (const [id, entry] of Object.entries(manifest.node)) {
    if (entry.exportedName) ids[entry.exportedName] = id
  }
  return ids
}

let ACTIONS: Record<string, string> = {}

/** POST a Server Function the way the browser's router does; returns its value. */
async function callAction<T>(
  role: Role,
  page: string,
  name: string,
  args: unknown[]
): Promise<{ value: T; res: Observed }> {
  const id = ACTIONS[name]
  if (!id) throw new Error(`No Server Function ${name} in this build`)
  const res = await request(role, page, {
    method: "POST",
    headers: {
      "next-action": id,
      accept: "text/x-component",
      "content-type": "text/plain;charset=UTF-8",
      origin: BASE!,
    },
    body: JSON.stringify(args),
  })
  const row = res.body.split("\n").find((line) => line.startsWith("1:"))
  if (res.status !== 200 || !row) {
    throw new Error(`${name} -> ${res.status}: ${res.body.slice(0, 300)}`)
  }
  return { value: JSON.parse(row.slice(2)) as T, res }
}

/** The real landing route verifies the magic-link token hash and sets the session. */
async function signInOverHttp(admin: Db, role: Role, email: string) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  })
  if (error) throw error
  secrets.add(data.properties.hashed_token)
  secrets.add(data.properties.action_link)
  const res = await request(
    role,
    `/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink`
  )
  expect(res.status).toBe(303)
  expect(res.headers.get("location")).toBe("/")
  expect(cookieHeader(jars[role])).toMatch(/sb-[^=]+-auth-token/)
}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex")
const EMAIL =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
const SIGNED_URL = /\/storage\/v1\/object\/sign\/[^"'\s\\]+/g

describe.skipIf(!BASE)("privacy: runtime headers, bodies and logs", () => {
  const admin = serviceClient()
  const ids = {} as Record<"staffA" | "staffB" | "admin", string>
  const emails = {} as Record<"staffA" | "staffB" | "admin" | "invited", string>
  let assetId = ""
  let originalBytes = new Uint8Array()
  let logStart = 0

  beforeAll(async () => {
    const env = getLocalSupabaseEnv()
    expect(new URL(env.url).port, "isolated stack, not 554xx").not.toMatch(
      /^554/
    )
    expect(LOG, "PRIVACY_SERVER_LOG").toBeTruthy()
    expect(process.env.CLEANUP_SECRET, "CLEANUP_SECRET").toBeTruthy()
    secrets.add(env.serviceRoleKey)
    secrets.add(process.env.CLEANUP_SECRET!)
    logStart = readFileSync(LOG!, "utf8").length
    ACTIONS = actionIds()

    const venue = await createVenue(admin, "privacy")
    for (const role of ["staffA", "staffB", "admin"] as const) {
      const identity = await createIdentity(admin, {
        label: `privacy-${role.toLowerCase()}`,
        role: role === "admin" ? "admin" : "staff",
        venueId: role === "admin" ? null : venue.id,
        session: false,
      })
      ids[role] = identity.id
      emails[role] = identity.email
      await signInOverHttp(admin, role, identity.email)
    }
    emails.invited = testEmail("privacy-invited")

    // Staff A uploads one real photo through the app's Server Functions and a
    // signed upload, exactly as the browser does.
    originalBytes = await syntheticJpeg(800, 600)
    const uploadKey = randomUUID()
    const reserved = await callAction<{
      ok: boolean
      message?: string
      reservation: { assetId: string; objectKey: string; token: string }
    }>("staffA", "/staff", "reserveUpload", [
      {
        idempotencyKey: uploadKey,
        filename: "privacy-dish.jpg",
        sizeBytes: originalBytes.byteLength,
        contentType: "image/jpeg",
        mediaType: "image",
        preferResumable: false,
      },
    ])
    expect(reserved.value.ok, reserved.value.message).toBe(true)
    const { reservation } = reserved.value
    assetId = reservation.assetId
    secrets.add(reservation.token)
    const put = await anonClient()
      .storage.from("media")
      .uploadToSignedUrl(
        reservation.objectKey,
        reservation.token,
        originalBytes,
        {
          contentType: "image/jpeg",
        }
      )
    expect(put.error).toBeNull()
    const finalised = await callAction<{
      ok: boolean
      result?: { state: string }
    }>("staffA", "/staff", "finaliseUpload", [
      { assetId, idempotencyKey: uploadKey },
    ])
    expect(finalised.value).toMatchObject({
      ok: true,
      result: { state: "ready" },
    })

    // Staff A sets a profile photo through the multipart route.
    const form = new FormData()
    form.set("displayName", "TEST privacy staff A")
    form.set(
      "avatar",
      new Blob([await syntheticJpeg(256, 256)], { type: "image/jpeg" }),
      "me.jpg"
    )
    const profile = await request("staffA", "/api/profile", {
      method: "POST",
      body: form,
      headers: { origin: BASE! },
    })
    expect(profile.status, profile.body).toBe(200)

    // Admin invites a new staff member (sends a real invitation email).
    const invited = await callAction<{ status: string }>(
      "admin",
      "/admin/staff",
      "inviteStaffAction",
      [
        {
          displayName: "TEST privacy invited",
          email: emails.invited,
          jobTitle: "Chef",
          venueId: venue.id,
        },
      ]
    )
    expect(invited.value.status).toBe("sent")

    // Anonymous sign-in link requests: a known and an unknown address.
    for (const email of [emails.staffB, testEmail("privacy-unknown")]) {
      const sent = await callAction<{ error?: string }>(
        "anon",
        "/login",
        "requestSignInLink",
        [email]
      )
      expect(sent.value).toEqual({})
    }
  }, 120_000)

  const pages = () => [
    "/",
    "/login",
    "/auth/blocked",
    "/staff",
    "/admin",
    "/admin/staff",
    `/admin/staff/${ids.staffA}`,
    `/admin/staff/${ids.staffB}`,
    "/ui-preview",
  ]
  const mediaRoutes = () => [
    `/api/media/${assetId}/thumb`,
    `/api/media/${assetId}/preview`,
    `/api/media/${assetId}/stream`,
    `/api/media/${assetId}/download`,
    `/api/media/${randomUUID()}/thumb`,
    `/api/media/not-a-uuid/download`,
    `/api/avatars/${ids.staffA}`,
    `/api/avatars/${ids.admin}`,
  ]
  const roles: Role[] = ["anon", "staffA", "staffB", "admin"]

  it("requests every page (HTML and RSC) and media route in every role", async () => {
    for (const role of roles) {
      for (const path of pages()) {
        await request(role, path)
        await request(role, path, { headers: { rsc: "1" } })
      }
      for (const path of mediaRoutes()) await request(role, path)
    }
    // Server Function responses carry user data too.
    await callAction("staffA", "/staff", "loadMyMedia", [null])
    await callAction("staffB", "/staff", "loadMyMedia", [null])
    await callAction("admin", "/admin", "loadLibraryPage", [{}, null])
    await callAction("admin", "/admin/staff", "loadMorePortfolioAction", [
      ids.staffA,
      null,
    ])
    // Mutating routes without the right credential.
    await request("staffB", `/admin/staff/${ids.staffA}/avatar`, {
      method: "POST",
      headers: { origin: BASE! },
      body: new FormData(),
    })
    await request("anon", "/api/profile", {
      method: "POST",
      body: new FormData(),
    })
    await request("anon", "/api/internal/cleanup", {
      method: "POST",
      headers: {
        authorization: "Bearer wrong-secret-wrong-secret-wrong-secret",
      },
    })
    const cleanup = await request("anon", "/api/internal/cleanup", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.CLEANUP_SECRET}` },
    })
    expect(cleanup.status).toBe(200)
    expect(observed.length).toBeGreaterThan(100)
  }, 180_000)

  it("never allows public or shared caching of anything user-specific", () => {
    const sharedCacheable =
      /\bpublic\b|s-maxage|stale-while-revalidate|immutable/
    for (const r of observed) {
      const cc = (r.headers.get("cache-control") ?? "").toLowerCase()
      const where = `${r.role} ${r.method} ${r.path} -> ${r.status} [${cc}]`
      if (sharedCacheable.test(cc)) {
        // Only a build-time prerender (the production 404 for /ui-preview) may
        // be shared, and only if every role received the same bytes.
        expect(r.headers.get("x-nextjs-prerender"), where).toMatch(/^1(, 1)*$/)
        const variants = observed.filter(
          (o) => o.path === r.path && o.method === r.method && o.rsc === r.rsc
        )
        expect(new Set(variants.map((o) => o.role)).size, where).toBe(4)
        expect(new Set(variants.map((o) => o.body)).size, where).toBe(1)
        continue
      }
      // Any 2xx/4xx with content to a signed-in user, and every API response,
      // must be private and no-store. Redirects without a body may omit it
      // (307/303 are not cacheable without explicit freshness).
      const isRedirect = r.status >= 300 && r.status < 400
      // A response that sets cookies (a session) must never be stored.
      if (r.headers.getSetCookie().length > 0) {
        expect(cc, `${where} sets cookies`).toMatch(/no-store/)
      }
      // no-store forbids every cache from storing it, so `private` is optional.
      if (r.path.startsWith("/api/") || (r.role !== "anon" && !isRedirect)) {
        expect(cc, where).toMatch(/no-store/)
      }
    }
  })

  it("keeps HTML and RSC payloads apart in any cache (Vary)", () => {
    for (const r of observed) {
      if (!/text\/(html|x-component)/.test(r.headers.get("content-type") ?? ""))
        continue
      if (r.method !== "GET") continue
      expect(r.headers.get("vary") ?? "", `${r.role} ${r.path}`).toMatch(
        /\brsc\b/i
      )
    }
  })

  it("sends nosniff on every response", () => {
    for (const r of observed) {
      expect(
        r.headers.get("x-content-type-options"),
        `${r.role} ${r.method} ${r.path} -> ${r.status}`
      ).toBe("nosniff")
    }
  })

  it("serves originals as attachments with the validated type, only to the right roles", async () => {
    const find = (role: Role, suffix: string) =>
      observed.find(
        (r) => r.role === role && r.path === `/api/media/${assetId}/${suffix}`
      )!
    const download = await fetch(`${BASE}/api/media/${assetId}/download`, {
      headers: { cookie: cookieHeader(jars.admin) },
    })
    expect(download.status).toBe(200)
    expect(download.headers.get("content-type")).toBe("image/jpeg")
    expect(download.headers.get("content-disposition")).toMatch(/^attachment;/)
    expect(sha256(new Uint8Array(await download.arrayBuffer()))).toBe(
      sha256(originalBytes)
    )
    expect(find("staffA", "download").status).toBe(404)
    expect(find("staffB", "download").status).toBe(404)
    expect(find("anon", "download").status).toBe(401)
    for (const role of ["anon", "staffB"] as const) {
      for (const which of ["thumb", "preview"]) {
        expect([401, 404]).toContain(find(role, which).status)
        expect(find(role, which).headers.get("location")).toBeNull()
      }
    }
    // Avatars: own or admin only; other staff get 404 and no URL.
    const avatar = (role: Role, id: string) =>
      observed.find((r) => r.role === role && r.path === `/api/avatars/${id}`)!
    expect(avatar("staffA", ids.staffA).status).toBe(302)
    expect(avatar("admin", ids.staffA).status).toBe(302)
    expect(avatar("staffB", ids.staffA).status).toBe(404)
    expect(avatar("anon", ids.staffA).status).toBe(401)
  })

  it("cannot pull private media through the image optimiser", async () => {
    // /_next/image fetches local URLs without the caller's cookies, so the
    // media routes answer 401 and nothing private is optimised or cached.
    for (const role of ["admin", "staffA", "anon"] as const) {
      for (const path of [
        `/api/media/${assetId}/thumb`,
        `/api/media/${assetId}/preview`,
        `/api/avatars/${ids.staffA}`,
      ]) {
        const r = await request(
          role,
          `/_next/image?url=${encodeURIComponent(path)}&w=64&q=75`,
          { record: false }
        )
        expect(r.status, `${role} ${path}`).not.toBe(200)
        expect(r.headers.get("content-type") ?? "", path).not.toMatch(
          /^image\//
        )
      }
    }
  })

  it("signs derivative and avatar redirects for 60 seconds at most", () => {
    const redirects = observed.filter((r) => r.status === 302)
    expect(redirects.length).toBeGreaterThanOrEqual(4)
    for (const r of redirects) {
      const location = new URL(r.headers.get("location")!)
      expect(location.pathname).toMatch(/^\/storage\/v1\/object\/sign\//)
      const token = location.searchParams.get("token")!
      const payload = JSON.parse(
        Buffer.from(token.split(".")[1], "base64url").toString("utf8")
      ) as { iat: number; exp: number }
      expect(payload.exp - payload.iat, r.path).toBeLessThanOrEqual(60)
      secrets.add(token)
    }
  })

  it("never puts public storage URLs in a response, and signed URLs only in uncached admin responses", () => {
    for (const r of observed) {
      const where = `${r.role} ${r.method} ${r.path}`
      expect(r.body, where).not.toMatch(/\/storage\/v1\/object\/public\//)
      const signed = r.body.match(SIGNED_URL) ?? []
      if (signed.length === 0) continue
      expect(r.role, `${where} embeds signed URLs`).toBe("admin")
      expect(r.headers.get("cache-control") ?? "", where).toMatch(/no-store/)
      for (const s of signed) secrets.add(s)
    }
  })

  it("shows staff no other user's email or ID", () => {
    for (const r of observed) {
      if (r.role !== "staffA" && r.role !== "staffB" && r.role !== "anon")
        continue
      const own = r.role === "anon" ? [] : [emails[r.role]]
      const where = `${r.role} ${r.method} ${r.path}`
      for (const email of r.body.match(EMAIL) ?? []) {
        expect(own, `${where} leaks ${email}`).toContain(email)
      }
      // An ID the caller put in the URL may be echoed back (router state).
      const others = (["staffA", "staffB", "admin"] as const).filter(
        (k) => k !== r.role && !r.path.includes(ids[k])
      )
      for (const k of others) {
        expect(r.body.includes(ids[k]), `${where} contains ${k}'s id`).toBe(
          false
        )
      }
      if (r.role !== "staffA") {
        expect(r.body.includes(assetId), `${where} contains A's asset`).toBe(
          false
        )
      }
    }
  })

  it(
    "keeps working after deactivation and deletion without leaking",
    { timeout: 120_000 },
    async () => {
      const deactivated = await callAction<{ ok: boolean }>(
        "admin",
        `/admin/staff/${ids.staffB}`,
        "setStaffActiveAction",
        [ids.staffB, false]
      )
      expect(deactivated.value.ok).toBe(true)
      const blocked = await request("staffB", "/api/avatars/" + ids.staffB)
      expect(blocked.status).toBe(403)
      expect(blocked.headers.get("cache-control")).toMatch(/no-store/)

      const deleted = await callAction<{ ok: boolean }>(
        "staffA",
        "/staff",
        "deleteMedia",
        [assetId]
      )
      expect(deleted.value.ok).toBe(true)
      for (const suffix of ["thumb", "preview", "download"]) {
        const gone = await request("admin", `/api/media/${assetId}/${suffix}`)
        expect(gone.status).toBe(404)
        expect(gone.headers.get("location")).toBeNull()
      }
    }
  )

  afterAll(() => {
    // Optional evidence for docs/privacy-audit.md: the headers of every
    // response, with IDs replaced by role names. No bodies, no Locations.
    const out = process.env.PRIVACY_REPORT
    if (!out || observed.length === 0) return
    const label = (path: string) => {
      let p = path.replace(/token_hash=[^&]+/, "token_hash=…")
      for (const [k, v] of Object.entries(ids)) p = p.replaceAll(v, `<${k}>`)
      if (assetId) p = p.replaceAll(assetId, "<assetA>")
      return p.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "<random>")
    }
    const rows = observed.map((r) => ({
      role: r.role,
      method: r.method,
      path: label(r.path),
      rsc: r.rsc,
      status: r.status,
      cacheControl: r.headers.get("cache-control"),
      vary: r.headers.get("vary"),
      nosniff: r.headers.get("x-content-type-options"),
      contentDisposition: r.headers.get("content-disposition"),
      contentType: r.headers.get("content-type"),
    }))
    writeFileSync(out, JSON.stringify(rows, null, 2))
  })

  it("prints no tokens, signed URLs, keys or emails to the server log", () => {
    const log = readFileSync(LOG!, "utf8").slice(logStart)
    const where = (what: string) => `server log contains ${what}`
    for (const value of secrets) {
      if (value.length < 12) continue
      expect(
        log.includes(value),
        where(`a secret (${value.slice(0, 6)}…)`)
      ).toBe(false)
    }
    for (const email of Object.values(emails)) {
      expect(log.includes(email), where(email)).toBe(false)
    }
    expect(log, where("an email address")).not.toMatch(EMAIL)
    expect(log, where("a signed URL")).not.toMatch(
      /\/object\/sign\/|[?&]token=/
    )
    expect(log, where("a JWT")).not.toMatch(/eyJ[A-Za-z0-9_-]{8,}\.eyJ/)
    expect(log, where("a Supabase secret key")).not.toMatch(/sb_secret_/)
    expect(log, where("a magic-link token hash")).not.toMatch(/token_hash=/)
  })
})
