import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { beforeAll, describe, expect, it, vi } from "vitest"

import { actorFor, syntheticJpeg } from "../slice/media-actor"
import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import {
  assertPrivateCaching,
  cookiesModule,
  params,
  sessionCookies,
  uploadAs,
  useLocalEnv,
  type CookieJar,
} from "./gaps-support"

/**
 * GAP-11 and GAP-12 at the Route Handler / Server Function level: the app's real
 * handlers run with a genuine session cookie for each identity (see
 * gaps-support.ts), so authorisation, RLS and the response headers are the ones
 * a browser gets. tests/e2e/gaps.spec.ts repeats the key checks over real HTTP.
 */

const jar = vi.hoisted<CookieJar>(() => ({ current: new Map() }))
vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => cookiesModule(jar))

useLocalEnv()

const routes = {
  avatar: () => import("../../app/api/avatars/[id]/route"),
  adminAvatar: () => import("../../app/admin/staff/[id]/avatar/route"),
  profile: () => import("../../app/api/profile/route"),
  thumb: () => import("../../app/api/media/[id]/thumb/route"),
  preview: () => import("../../app/api/media/[id]/preview/route"),
  stream: () => import("../../app/api/media/[id]/stream/route"),
  download: () => import("../../app/api/media/[id]/download/route"),
}
type MediaRoute = "thumb" | "preview" | "stream" | "download"
const MEDIA_ROUTES: MediaRoute[] = ["thumb", "preview", "stream", "download"]

const ORIGIN = "http://127.0.0.1:3000"
const get = (path: string, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}${path}`, { headers })

const fixture = (name: string) =>
  readFile(
    fileURLToPath(new URL(`../fixtures/media/${name}`, import.meta.url))
  ).then((b) => new Uint8Array(b))

const admin = serviceClient()

async function as<T>(identity: TestIdentity | null, fn: () => Promise<T>) {
  jar.current = identity ? await sessionCookies(identity) : new Map()
  try {
    return await fn()
  } finally {
    jar.current = new Map()
  }
}

async function mediaGet(
  route: MediaRoute,
  identity: TestIdentity | null,
  id: string,
  headers: Record<string, string> = {}
) {
  const { GET } = await routes[route]()
  return as(identity, () =>
    GET(get(`/api/media/${id}/${route}`, headers), params(id))
  )
}

async function profileRow(id: string) {
  const { data, error } = await admin
    .from("profiles")
    .select("display_name, role, venue_id, active, job_title, avatar_path")
    .eq("id", id)
    .single()
  if (error) throw error
  return data
}

describe("GAP-11: cross-role access and private headers at the HTTP layer", () => {
  let venue: { id: string }
  let otherVenue: { id: string }
  let staffA: TestIdentity
  let staffB: TestIdentity
  let adminUser: TestIdentity
  let photoA: string
  let videoA: string

  beforeAll(async () => {
    venue = await createVenue(admin, "gaps-http")
    otherVenue = await createVenue(admin, "gaps-http-other")
    // Same venue: isolation must come from identity, not venue.
    staffA = await createIdentity(admin, {
      label: "gaps-a",
      role: "staff",
      venueId: venue.id,
    })
    staffB = await createIdentity(admin, {
      label: "gaps-b",
      role: "staff",
      venueId: venue.id,
    })
    adminUser = await createIdentity(admin, {
      label: "gaps-admin",
      role: "admin",
    })
    await admin
      .from("profiles")
      .update({ job_title: "Curry chef" })
      .in("id", [staffA.id, staffB.id])

    const actorA = await actorFor(staffA)
    photoA = await uploadAs(actorA, staffA, await syntheticJpeg(), {
      filename: "dish.jpg",
      contentType: "image/jpeg",
      mediaType: "image",
    })
    videoA = await uploadAs(actorA, staffA, await fixture("synthetic.mp4"), {
      filename: "clip.mp4",
      contentType: "video/mp4",
      mediaType: "video",
    })

    // Staff A sets a profile photo through the real route.
    const { POST } = await routes.profile()
    const form = new FormData()
    form.set("displayName", "TEST gaps-a")
    form.set(
      "avatar",
      new File([await syntheticJpeg(300, 300)], "me.jpg", {
        type: "image/jpeg",
      })
    )
    const res = await as(staffA, () =>
      POST(new Request(`${ORIGIN}/api/profile`, { method: "POST", body: form }))
    )
    expect(res.status).toBe(200)
    expect((await profileRow(staffA.id)).avatar_path).toMatch(
      new RegExp(`^${staffA.id}/`)
    )
  })

  describe("avatars", () => {
    it("staff B cannot read staff A's avatar; anon gets 401", async () => {
      const { GET } = await routes.avatar()
      const asB = await as(staffB, () =>
        GET(get(`/api/avatars/${staffA.id}`), params(staffA.id))
      )
      expect([403, 404]).toContain(asB.status)
      expect(asB.headers.get("location")).toBeNull()
      expect(await asB.text()).not.toContain("token=")

      const anon = await as(null, () =>
        GET(get(`/api/avatars/${staffA.id}`), params(staffA.id))
      )
      expect(anon.status).toBe(401)
      expect(anon.headers.get("location")).toBeNull()
    })

    it("the owner and an admin get a private, uncached redirect", async () => {
      const { GET } = await routes.avatar()
      for (const who of [staffA, adminUser]) {
        const res = await as(who, () =>
          GET(get(`/api/avatars/${staffA.id}`), params(staffA.id))
        )
        expect(res.status).toBe(302)
        expect(res.headers.get("location")).toContain(
          "/storage/v1/object/sign/"
        )
        expect(assertPrivateCaching(res, `avatar as ${who.email}`)).toEqual([])
      }
    })

    it("staff B cannot replace staff A's avatar through the admin route", async () => {
      const before = await profileRow(staffA.id)
      const { POST } = await routes.adminAvatar()
      const form = new FormData()
      form.set(
        "file",
        new File([await syntheticJpeg(200, 200)], "x.jpg", {
          type: "image/jpeg",
        })
      )
      const res = await as(staffB, () =>
        POST(
          new Request(`${ORIGIN}/admin/staff/${staffA.id}/avatar`, {
            method: "POST",
            body: form,
          }) as never,
          params(staffA.id)
        )
      )
      expect(res.status).toBe(403)
      expect(await profileRow(staffA.id)).toEqual(before)
    })
  })

  describe("media routes", () => {
    it("staff B is denied every media route for staff A's assets", async () => {
      for (const route of MEDIA_ROUTES) {
        for (const id of [photoA, videoA]) {
          const res = await mediaGet(route, staffB, id)
          expect([403, 404], `${route} ${id}`).toContain(res.status)
          expect(res.headers.get("location"), route).toBeNull()
          expect(assertPrivateCaching(res, `${route} denied`)).toEqual([])
        }
      }
    })

    it("anonymous requests are refused on every media route", async () => {
      for (const route of MEDIA_ROUTES) {
        const res = await mediaGet(route, null, photoA)
        expect([401, 404], route).toContain(res.status)
        expect(res.headers.get("location"), route).toBeNull()
      }
    })

    it("staff cannot download even their own original (admin only)", async () => {
      const res = await mediaGet("download", staffA, photoA)
      expect(res.status).toBe(404)
    })

    it("preview, thumb, stream and download send private, no-store and nosniff", async () => {
      const ok: [MediaRoute, TestIdentity, string, number][] = [
        ["thumb", staffA, photoA, 302],
        ["preview", staffA, photoA, 302],
        ["preview", adminUser, photoA, 302],
        ["stream", staffA, videoA, 200],
        ["stream", adminUser, videoA, 200],
        ["download", adminUser, photoA, 200],
        ["download", adminUser, videoA, 200],
      ]
      const problems: string[] = []
      for (const [route, who, id, status] of ok) {
        const res = await mediaGet(route, who, id)
        const label = `${route} ${id === photoA ? "photo" : "video"} as ${who === adminUser ? "admin" : "owner"}`
        expect(res.status, label).toBe(status)
        problems.push(...assertPrivateCaching(res, label))
        if (res.headers.get("x-content-type-options") !== "nosniff") {
          problems.push(`${label}: no nosniff`)
        }
        await res.body?.cancel()
      }
      // A ranged stream (video playback) is just as private.
      const ranged = await mediaGet("stream", staffA, videoA, {
        range: "bytes=0-99",
      })
      expect(ranged.status).toBe(206)
      problems.push(...assertPrivateCaching(ranged, "ranged stream"))
      await ranged.body?.cancel()
      expect(problems).toEqual([])
    })

    it("an image is not served through the video stream route", async () => {
      const res = await mediaGet("stream", staffA, photoA)
      expect(res.status).toBe(404)
    })
  })

  describe("/api/profile cannot change protected columns", () => {
    it("ignores role, venue_id, active and job_title in the body", async () => {
      const before = await profileRow(staffA.id)
      const { POST } = await routes.profile()
      const form = new FormData()
      form.set("displayName", "TEST gaps-a renamed")
      form.set("role", "admin")
      form.set("venue_id", otherVenue.id)
      form.set("venueId", otherVenue.id)
      form.set("active", "false")
      form.set("job_title", "Owner")
      form.set("jobTitle", "Owner")
      form.set("avatar_path", `${staffB.id}/stolen.webp`)
      const res = await as(staffA, () =>
        POST(
          new Request(`${ORIGIN}/api/profile`, { method: "POST", body: form })
        )
      )
      expect(res.status).toBe(200)
      expect(assertPrivateCaching(res, "profile")).toEqual([])
      const after = await profileRow(staffA.id)
      expect(after).toEqual({ ...before, display_name: "TEST gaps-a renamed" })
      expect(after.role).toBe("staff")
      expect(after.venue_id).toBe(venue.id)
      expect(after.active).toBe(true)
      expect(after.job_title).toBe("Curry chef")
    })

    it("a JSON body with protected fields changes nothing", async () => {
      const before = await profileRow(staffA.id)
      const { POST } = await routes.profile()
      const res = await as(staffA, () =>
        POST(
          new Request(`${ORIGIN}/api/profile`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              displayName: "TEST json",
              role: "admin",
              venue_id: otherVenue.id,
              active: false,
              job_title: "Owner",
            }),
          })
        )
      )
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(await profileRow(staffA.id)).toEqual(before)
    })

    it("an admin cannot use the staff self-service route either", async () => {
      const { POST } = await routes.profile()
      const form = new FormData()
      form.set("displayName", "TEST admin via staff route")
      form.set("role", "staff")
      const res = await as(adminUser, () =>
        POST(
          new Request(`${ORIGIN}/api/profile`, { method: "POST", body: form })
        )
      )
      expect(res.status).toBe(403)
      expect((await profileRow(adminUser.id)).role).toBe("admin")
    })

    it("anonymous POST is refused", async () => {
      const { POST } = await routes.profile()
      const form = new FormData()
      form.set("displayName", "anon")
      const res = await as(null, () =>
        POST(
          new Request(`${ORIGIN}/api/profile`, { method: "POST", body: form })
        )
      )
      expect(res.status).toBe(401)
    })

    // BUG: app/api/profile/route.ts has no same-origin check (acceptance GAP-11
    // item 2, review finding 7, LOW). app/admin/staff/[id]/avatar/route.ts
    // refuses a foreign Origin with 403; /api/profile accepts it and renames the
    // caller. SameSite=Lax cookies blunt this in browsers, but the route itself
    // does not refuse, so this test fails until the route checks Origin.
    it("refuses a cross-origin POST", async () => {
      const before = await profileRow(staffA.id)
      const { POST } = await routes.profile()
      const form = new FormData()
      form.set("displayName", "TEST cross-origin")
      const res = await as(staffA, () =>
        POST(
          new Request(`${ORIGIN}/api/profile`, {
            method: "POST",
            body: form,
            headers: { origin: "https://attacker.example" },
          })
        )
      )
      expect(res.status).toBe(403)
      expect(await profileRow(staffA.id)).toEqual(before)
    })
  })

  describe("admin Server Functions refuse staff", () => {
    it("loadLibraryPage returns nothing to staff or anonymous callers", async () => {
      const { loadLibraryPage } =
        await import("../../app/admin/library-actions")
      for (const who of [staffA, staffB, null]) {
        const result = await as(who, () => loadLibraryPage({}, null))
        expect(result.ok).toBe(false)
        expect(JSON.stringify(result)).not.toContain(photoA)
      }
      const asAdmin = await as(adminUser, () =>
        loadLibraryPage({ staff: staffA.id }, null)
      )
      expect(asAdmin.ok && asAdmin.page.items.map((i) => i.id)).toEqual(
        expect.arrayContaining([photoA, videoA])
      )
    })
  })
})

describe("GAP-12: staff whose venue is deactivated", () => {
  let venue: { id: string; name: string }
  let staff: TestIdentity
  let adminUser: TestIdentity
  let retained: string

  beforeAll(async () => {
    venue = await createVenue(admin, "gaps-paused")
    staff = await createIdentity(admin, {
      label: "gaps-paused",
      role: "staff",
      venueId: venue.id,
    })
    adminUser = await createIdentity(admin, {
      label: "gaps-paused-admin",
      role: "admin",
    })
    retained = await uploadAs(
      await actorFor(staff),
      staff,
      await syntheticJpeg(),
      { filename: "before.jpg", contentType: "image/jpeg", mediaType: "image" }
    )
    const { error } = await admin
      .from("venues")
      .update({ active: false })
      .eq("id", venue.id)
    if (error) throw error
  })

  it("reserveUpload refuses with a clear venue message and reserves nothing", async () => {
    const { count: before } = await admin
      .from("media_assets")
      .select("id", { count: "exact", head: true })
      .eq("uploader_id", staff.id)
    const { reserveUpload } = await import("../../app/staff/actions")
    const result = await as(staff, () =>
      reserveUpload({
        idempotencyKey: "gaps-paused-key-1",
        filename: "after.jpg",
        sizeBytes: 1000,
        contentType: "image/jpeg",
        mediaType: "image",
        preferResumable: false,
      })
    )
    expect(result).toEqual({
      ok: false,
      message: expect.stringMatching(/venue/i),
    })
    expect(!result.ok && result.message).toMatch(/not taking uploads/i)
    const { count: after } = await admin
      .from("media_assets")
      .select("id", { count: "exact", head: true })
      .eq("uploader_id", staff.id)
    expect(after).toBe(before)
  })

  it("the reserve RPC refuses too, even when called directly", async () => {
    const { error } = await staff.client.rpc("reserve_media_asset", {
      p_media_type: "image",
      p_extension: "jpg",
      p_original_filename: "direct.jpg",
      p_size_bytes: 1000,
    })
    expect(error).not.toBeNull()
  })

  it("admin still sees and downloads the retained media", async () => {
    const { loadLibraryPage } = await import("../../app/admin/library-actions")
    const page = await as(adminUser, () =>
      loadLibraryPage({ venue: venue.id }, null)
    )
    expect(page.ok).toBe(true)
    const item = page.ok
      ? page.page.items.find((i) => i.id === retained)
      : undefined
    expect(item).toBeDefined()
    const res = await mediaGet("download", adminUser, retained)
    expect(res.status).toBe(200)
    await res.body?.cancel()
  })
})
