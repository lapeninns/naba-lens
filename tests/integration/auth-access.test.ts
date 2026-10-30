// Account-state edges, as separate signed-in people through the app's real
// pages, Server Functions and Route Handlers plus direct PostgREST / GraphQL /
// Storage / Auth calls with the same session (see ./auth-support.ts).
import { createHash, randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () =>
  import("./auth-support").then((m) => m.nextHeadersMock())
)
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))

import { deleteMedia } from "@/app/_media/actions"
import AdminPage from "@/app/admin/page"
import { loadLibraryPage } from "@/app/admin/library-actions"
import StaffDirectoryPage from "@/app/admin/staff/page"
import StaffPortfolioPage from "@/app/admin/staff/[id]/page"
import { POST as adminAvatarPost } from "@/app/admin/staff/[id]/avatar/route"
import {
  inviteStaffAction,
  resendInvitationAction,
  setStaffActiveAction,
  updateStaffAccountAction,
} from "@/app/admin/staff/actions"
import { GET as avatarRoute } from "@/app/api/avatars/[id]/route"
import { GET as downloadRoute } from "@/app/api/media/[id]/download/route"
import { GET as previewRoute } from "@/app/api/media/[id]/preview/route"
import { GET as streamRoute } from "@/app/api/media/[id]/stream/route"
import { GET as thumbRoute } from "@/app/api/media/[id]/thumb/route"
import { POST as profileRoute } from "@/app/api/profile/route"
import BlockedPage from "@/app/auth/blocked/page"
import LoginPage from "@/app/login/page"
import RootPage from "@/app/page"
import { finaliseUpload, loadMyMedia, reserveUpload } from "@/app/staff/actions"
import StaffPage from "@/app/staff/page"
import { getAuthState } from "@/lib/auth"
import { proxy } from "@/proxy"

import { syntheticJpeg } from "../slice/media-actor"
import {
  anonClient,
  createIdentity,
  createVenue,
  serviceClient,
  testEmail,
  type Db,
  type TestIdentity,
} from "../support/identities"
import { getLocalSupabaseEnv } from "../support/local-supabase"
import {
  appRequest,
  authUserCount,
  Browser,
  issueSignInLink,
  readSessionCookie,
  redirectOf,
} from "./auth-support"
import { followEmailLink } from "./auth-confirm"

const service = serviceClient()
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex")

// ---------------------------------------------------------------------------
// People and helpers
// ---------------------------------------------------------------------------

type Person = TestIdentity & { browser: Browser; rest: Db }

/** Signs in through /auth/confirm; `rest` is a Supabase client on the same session. */
async function person(
  label: string,
  opts: { role: "staff" | "admin"; venueId?: string; profile?: boolean }
): Promise<Person> {
  const identity = await createIdentity(service, {
    label,
    role: opts.role,
    venueId: opts.venueId ?? null,
    profile: opts.profile,
    session: false,
  })
  const browser = new Browser(label)
  const link = await issueSignInLink(service, identity.email)
  const res = await followEmailLink(browser, link)
  expect(res.location).toBe("/")
  return { ...identity, browser, rest: await restClientFor(browser) }
}

async function restClientFor(browser: Browser): Promise<Db> {
  const { session } = readSessionCookie(browser)
  const client = anonClient()
  const { error } = await client.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  })
  if (error) throw error
  return client
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const noSearch = { searchParams: Promise.resolve({}) }

/** Staff upload through the real Server Functions and a signed storage PUT. */
async function upload(staff: Person) {
  const bytes = await syntheticJpeg(320, 240)
  const idempotencyKey = randomUUID()
  const reserved = await staff.browser.run(() =>
    reserveUpload({
      idempotencyKey,
      filename: "dish.jpg",
      sizeBytes: bytes.byteLength,
      contentType: "image/jpeg",
      mediaType: "image",
      preferResumable: false,
    })
  )
  if (!reserved.ok) throw new Error(reserved.message)
  const { assetId, objectKey, token } = reserved.reservation
  const stored = await anonClient()
    .storage.from("media")
    .uploadToSignedUrl(objectKey, token!, bytes, { contentType: "image/jpeg" })
  if (stored.error) throw stored.error
  const done = await staff.browser.run(() =>
    finaliseUpload({ assetId, idempotencyKey })
  )
  if (!done.ok || done.result.state !== "ready")
    throw new Error("finalise failed")
  return { assetId, objectKey, bytes }
}

/** Gives someone a real profile photo object so avatar denials are not vacuous. */
async function giveAvatar(id: string) {
  const key = `${id}/${randomUUID()}.webp`
  const webp = await (
    await import("sharp")
  )
    .default({
      create: { width: 8, height: 8, channels: 3, background: "#888" },
    })
    .webp()
    .toBuffer()
  const { error } = await service.storage
    .from("avatars")
    .upload(key, webp, { contentType: "image/webp" })
  if (error) throw error
  const { error: linkError } = await service
    .from("profiles")
    .update({ avatar_path: key })
    .eq("id", id)
  if (linkError) throw linkError
  return key
}

async function bodyBytes(res: Response) {
  return new Uint8Array(await res.arrayBuffer())
}

/** Finds the first element props in a rendered page tree that have `key`. */
function findProps(node: unknown, key: string): Record<string, unknown> | null {
  if (!node || typeof node !== "object") return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findProps(child, key)
      if (found) return found
    }
    return null
  }
  const props = (node as { props?: Record<string, unknown> }).props
  if (!props) return null
  if (key in props) return props
  return findProps(props.children, key)
}

function textOf(node: unknown): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join("")
  const props = (node as { props?: { children?: unknown } }).props
  return props ? textOf(props.children) : ""
}

async function profileRow(id: string) {
  const { data } = await service
    .from("profiles")
    .select("*")
    .eq("id", id)
    .single()
  return data!
}

// ---------------------------------------------------------------------------

let venue: { id: string; name: string }
let staff: Person
let otherStaff: Person
let admin: Person
let asset: Awaited<ReturnType<typeof upload>>

beforeAll(async () => {
  venue = await createVenue(service, "access")
  staff = await person("acc-staff", { role: "staff", venueId: venue.id })
  otherStaff = await person("acc-other", { role: "staff", venueId: venue.id })
  admin = await person("acc-admin", { role: "admin" })
  asset = await upload(staff)
})

describe("inactive admin with a still-valid session", () => {
  let former: Person

  beforeAll(async () => {
    former = await person("acc-former-admin", { role: "admin" })

    // Control: before deactivation this admin can read and act.
    const page = await former.browser.run(() => loadLibraryPage({}, null))
    expect(page.ok && page.page.items.some((i) => i.id === asset.assetId)).toBe(
      true
    )
    const dl = await former.browser.run(() =>
      downloadRoute(appRequest(former.browser, "/x"), params(asset.assetId))
    )
    expect(dl.status).toBe(200)
    expect(sha256(await bodyBytes(dl))).toBe(sha256(asset.bytes))

    // Admins are deactivated only through the controlled procedure (service role).
    const { error } = await service
      .from("profiles")
      .update({ active: false })
      .eq("id", former.id)
    expect(error).toBeNull()
  })

  it("still holds a working session, which is reported as inactive", async () => {
    const { data } = await former.rest.auth.getUser()
    expect(data.user?.id).toBe(former.id)
    const { data: own } = await former.rest
      .from("profiles")
      .select("id, active")
    expect(own).toEqual([{ id: former.id, active: false }])
    expect((await former.browser.run(getAuthState)).status).toBe("inactive")

    // proxy only checks the session; it passes the request to the page, which blocks.
    const res = await proxy(appRequest(former.browser, "/admin"))
    expect(res.headers.get("location")).toBeNull()
  })

  it("every admin page sends them to the blocked page", async () => {
    const run = <T>(fn: () => Promise<T>) => former.browser.run(fn)
    for (const page of [
      RootPage,
      () => AdminPage(noSearch),
      StaffDirectoryPage,
      () => StaffPortfolioPage(params(staff.id)),
      StaffPage,
      () => LoginPage(noSearch),
    ]) {
      expect((await run(() => redirectOf(page))).location).toBe("/auth/blocked")
    }
    const blocked = await run(() => redirectOf(BlockedPage))
    expect(blocked.location).toBeNull()
    const text = textOf(blocked.value)
    expect(text).toContain("deactivated")
    expect(text).not.toContain(staff.email)
  })

  it("every admin Server Function refuses without side effects", async () => {
    const run = <T>(fn: () => Promise<T>) => former.browser.run(fn)
    const before = await profileRow(staff.id)

    expect((await run(() => loadLibraryPage({}, null))).ok).toBe(false)
    const email = testEmail("acc-by-former")
    const invite = await run(() =>
      inviteStaffAction({
        displayName: "TEST invitee",
        email,
        jobTitle: null,
        venueId: venue.id,
      })
    )
    expect(invite.status).toBe("error")
    expect(authUserCount(email)).toBe(0)
    expect((await run(() => resendInvitationAction(staff.id))).ok).toBe(false)
    expect(
      (
        await run(() =>
          updateStaffAccountAction(staff.id, { displayName: "TEST hijacked" })
        )
      ).ok
    ).toBe(false)
    expect((await run(() => setStaffActiveAction(staff.id, false))).ok).toBe(
      false
    )
    expect(
      (await run(() => loadLibraryPage({ staff: staff.id }, null))).ok
    ).toBe(false)
    expect((await run(() => deleteMedia(asset.assetId))).ok).toBe(false)

    expect(await profileRow(staff.id)).toEqual(before)
    const { data: row } = await service
      .from("media_assets")
      .select("deleted_at")
      .eq("id", asset.assetId)
      .single()
    expect(row!.deleted_at).toBeNull()
  })

  it("every media and avatar route refuses and sends no bytes", async () => {
    const run = <T>(fn: () => Promise<T>) => former.browser.run(fn)
    await giveAvatar(staff.id)
    for (const route of [
      downloadRoute,
      previewRoute,
      thumbRoute,
      streamRoute,
    ]) {
      const res = await run(() =>
        route(appRequest(former.browser, "/x"), params(asset.assetId))
      )
      expect([403, 404]).toContain(res.status)
      expect(res.headers.get("location")).toBeNull()
      expect(sha256(await bodyBytes(res))).not.toBe(sha256(asset.bytes))
    }
    const av = await run(() =>
      avatarRoute(appRequest(former.browser, "/x"), params(staff.id))
    )
    expect(av.status).toBe(403)
    expect(av.headers.get("location")).toBeNull()

    const form = new FormData()
    form.set("file", new File([asset.bytes], "a.jpg", { type: "image/jpeg" }))
    const post = await run(() =>
      adminAvatarPost(
        appRequest(former.browser, `/admin/staff/${staff.id}/avatar`, {
          method: "POST",
          body: form,
        }),
        params(staff.id)
      )
    )
    expect(post.status).toBe(403)
  })

  it("direct PostgREST, RPC and Storage calls with that session get nothing", async () => {
    const db = former.rest
    expect((await db.from("profiles").select("id")).data).toEqual([
      { id: former.id },
    ])
    expect((await db.from("media_assets").select("id")).data).toEqual([])
    expect((await db.from("venues").select("id")).data).toEqual([])
    const del = await db.rpc("delete_media_asset", {
      p_asset_id: asset.assetId,
    })
    expect(del.error).not.toBeNull()
    const signed = await db.storage
      .from("media")
      .createSignedUrl(asset.objectKey, 60)
    expect(signed.data).toBeNull()
    const direct = await db.storage.from("media").download(asset.objectKey)
    expect(direct.data).toBeNull()
    const update = await db
      .from("profiles")
      .update({ display_name: "TEST hijacked" })
      .eq("id", staff.id)
      .select("id")
    expect(update.data ?? []).toEqual([])
  })

  it("an active admin still sees the asset (the denial is per account)", async () => {
    const page = await admin.browser.run(() => loadLibraryPage({}, null))
    expect(page.ok && page.page.items.some((i) => i.id === asset.assetId)).toBe(
      true
    )
  })
})

describe("signed-in account without a profile", () => {
  let orphan: Person

  beforeAll(async () => {
    orphan = await person("acc-orphan", { role: "staff", profile: false })
  })

  it("is sent to the blocked page from every protected page", async () => {
    const run = <T>(fn: () => Promise<T>) => orphan.browser.run(fn)
    expect((await run(getAuthState)).status).toBe("no_profile")
    for (const page of [
      RootPage,
      StaffPage,
      () => AdminPage(noSearch),
      StaffDirectoryPage,
      () => StaffPortfolioPage(params(staff.id)),
      () => LoginPage(noSearch),
    ]) {
      expect((await run(() => redirectOf(page))).location).toBe("/auth/blocked")
    }
    const blocked = await run(() => redirectOf(BlockedPage))
    expect(blocked.location).toBeNull()
    expect(textOf(blocked.value)).toContain("not linked to an active")
  })

  it("gets no data from Server Functions, routes or the Data API", async () => {
    const run = <T>(fn: () => Promise<T>) => orphan.browser.run(fn)
    const reserve = await run(() =>
      reserveUpload({
        idempotencyKey: randomUUID(),
        filename: "x.jpg",
        sizeBytes: 10,
        contentType: "image/jpeg",
        mediaType: "image",
        preferResumable: false,
      })
    )
    expect(reserve.ok).toBe(false)
    expect((await run(() => loadMyMedia(null))).ok).toBe(false)
    expect((await run(() => loadLibraryPage({}, null))).ok).toBe(false)
    for (const route of [thumbRoute, downloadRoute]) {
      const res = await run(() =>
        route(appRequest(orphan.browser, "/x"), params(asset.assetId))
      )
      expect([403, 404]).toContain(res.status)
    }
    const av = await run(() =>
      avatarRoute(appRequest(orphan.browser, "/x"), params(staff.id))
    )
    expect(av.status).toBe(403)

    const db = orphan.rest
    for (const table of ["profiles", "media_assets", "venues"] as const) {
      expect((await db.from(table).select("id")).data).toEqual([])
    }
    const rpc = await db.rpc("reserve_media_asset", {
      p_media_type: "image",
      p_extension: "jpg",
      p_original_filename: "x.jpg",
    })
    expect(rpc.error?.message).toBe("not_active_staff")
    // It cannot create its own profile either.
    const insert = await db
      .from("profiles")
      .insert({ id: orphan.id, display_name: "TEST self", role: "admin" })
    expect(insert.error).not.toBeNull()
    expect(
      (await service.from("profiles").select("id").eq("id", orphan.id)).data
    ).toEqual([])
  })
})

describe("staff venue states", () => {
  it("a staff account can never be without a venue", async () => {
    const lone = await createIdentity(service, {
      label: "acc-novenue",
      role: "admin",
      profile: false,
      session: false,
    })
    const insert = await service
      .from("profiles")
      .insert({ id: lone.id, display_name: "TEST no venue", role: "staff" })
    expect(insert.error?.message).toContain("profiles_staff_requires_venue")

    const viaAction = await admin.browser.run(() =>
      updateStaffAccountAction(otherStaff.id, { venueId: null })
    )
    expect(viaAction.ok).toBe(false)
    const direct = await admin.rest
      .from("profiles")
      .update({ venue_id: null })
      .eq("id", otherStaff.id)
    expect(direct.error?.message).toContain("profiles_staff_requires_venue")
    expect((await profileRow(otherStaff.id)).venue_id).toBe(venue.id)
  })

  describe("inactive venue", () => {
    let closing: { id: string; name: string }
    let worker: Person
    let retained: Awaited<ReturnType<typeof upload>>

    beforeAll(async () => {
      closing = await createVenue(service, "acc-closing")
      worker = await person("acc-worker", {
        role: "staff",
        venueId: closing.id,
      })
      retained = await upload(worker)
      const { error } = await service
        .from("venues")
        .update({ active: false })
        .eq("id", closing.id)
      expect(error).toBeNull()
    })

    it("its staff see the setup message instead of Upload", async () => {
      const page = await worker.browser.run(() => redirectOf(StaffPage))
      expect(page.location).toBeNull()
      const portfolio = findProps(page.value, "uploadBlocked")
      expect(portfolio?.uploadBlocked).toMatch(/uploads are paused/)
      // Their own retained media is still listed for them.
      const items = (portfolio?.initialPage as { items: { id: string }[] })
        .items
      expect(items.map((i) => i.id)).toContain(retained.assetId)

      const active = await staff.browser.run(() => redirectOf(StaffPage))
      expect(findProps(active.value, "uploadBlocked")?.uploadBlocked).toBeNull()
    })

    it("its staff cannot reserve or store a new upload", async () => {
      const reserve = await worker.browser.run(() =>
        reserveUpload({
          idempotencyKey: randomUUID(),
          filename: "dish.jpg",
          sizeBytes: 100,
          contentType: "image/jpeg",
          mediaType: "image",
          preferResumable: false,
        })
      )
      expect(reserve).toEqual({
        ok: false,
        message: expect.stringMatching(/venue/i),
      })
      const rpc = await worker.rest.rpc("reserve_media_asset", {
        p_media_type: "image",
        p_extension: "jpg",
        p_original_filename: "dish.jpg",
      })
      expect(rpc.error?.message).toBe("venue_unavailable")
      const put = await worker.rest.storage
        .from("media")
        .upload(`${worker.id}/${randomUUID()}/original.jpg`, retained.bytes)
      expect(put.error).not.toBeNull()
    })

    it("cannot be assigned through invitations, edits or direct updates", async () => {
      const email = testEmail("acc-closed-invite")
      const invite = await admin.browser.run(() =>
        inviteStaffAction({
          displayName: "TEST closed",
          email,
          jobTitle: null,
          venueId: closing.id,
        })
      )
      expect(invite).toMatchObject({
        status: "error",
        fieldErrors: { venueId: expect.any(String) },
      })
      expect(authUserCount(email)).toBe(0)

      const edit = await admin.browser.run(() =>
        updateStaffAccountAction(otherStaff.id, { venueId: closing.id })
      )
      expect(edit.ok).toBe(false)
      const direct = await admin.rest
        .from("profiles")
        .update({ venue_id: closing.id })
        .eq("id", otherStaff.id)
      expect(direct.error?.message).toBe("venue_inactive")
      expect((await profileRow(otherStaff.id)).venue_id).toBe(venue.id)
    })

    it("its retained media stays visible and downloadable for admin", async () => {
      const page = await admin.browser.run(() =>
        loadLibraryPage({ venue: closing.id }, null)
      )
      expect(page.ok).toBe(true)
      if (!page.ok) return
      expect(page.page.items.map((i) => i.id)).toEqual([retained.assetId])
      expect(page.page.items[0].venueName).toBe(closing.name)

      const dl = await admin.browser.run(() =>
        downloadRoute(appRequest(admin.browser, "/x"), params(retained.assetId))
      )
      expect(dl.status).toBe(200)
      expect(sha256(await bodyBytes(dl))).toBe(sha256(retained.bytes))

      const portfolio = await admin.browser.run(() =>
        loadLibraryPage({ staff: worker.id }, null)
      )
      expect(portfolio.ok && portfolio.page.items.map((i) => i.id)).toEqual([
        retained.assetId,
      ])
    })
  })
})

describe("profile reads", () => {
  beforeAll(async () => {
    await giveAvatar(admin.id)
    await giveAvatar(otherStaff.id)
    await giveAvatar(staff.id)
  })

  it("PostgREST gives staff their own profile only", async () => {
    const db = staff.rest
    const all = await db.from("profiles").select("*")
    expect(all.data?.map((p) => p.id)).toEqual([staff.id])
    for (const id of [admin.id, otherStaff.id]) {
      expect((await db.from("profiles").select("*").eq("id", id)).data).toEqual(
        []
      )
    }
    const counted = await db
      .from("profiles")
      .select("id", { count: "exact", head: true })
    expect(counted.count).toBe(1)
    const embedded = await db
      .from("media_assets")
      .select("id, uploader:profiles(id, display_name, role)")
    expect(new Set((embedded.data ?? []).map((r) => r.uploader?.id))).toEqual(
      new Set([staff.id])
    )
    // Role filters do not reveal admins either.
    expect(
      (await db.from("profiles").select("id").eq("role", "admin")).data
    ).toEqual([])
  })

  it("GraphQL and the Auth admin API give staff nothing about others", async () => {
    const env = getLocalSupabaseEnv()
    const { data } = await staff.rest.auth.getSession()
    const token = data.session!.access_token
    const headers = {
      apikey: env.publishableKey,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    }
    const gql = await fetch(`${env.url}/graphql/v1`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: "{ profilesCollection { edges { node { id } } } }",
      }),
    })
    const body = JSON.stringify(await gql.json())
    expect(body).not.toContain(admin.id)
    expect(body).not.toContain(otherStaff.id)

    for (const path of [
      "/auth/v1/admin/users",
      `/auth/v1/admin/users/${admin.id}`,
    ]) {
      const res = await fetch(`${env.url}${path}`, { headers })
      expect([401, 403]).toContain(res.status)
      const text = await res.text()
      expect(text).not.toContain(admin.email)
      expect(text).not.toContain(otherStaff.email)
    }
    const me = await fetch(`${env.url}/auth/v1/user`, { headers })
    expect((await me.json()).id).toBe(staff.id)
  })

  it("no route gives staff another person's profile or photo", async () => {
    const run = <T>(fn: () => Promise<T>) => staff.browser.run(fn)
    const own = await run(() =>
      avatarRoute(appRequest(staff.browser, "/x"), params(staff.id))
    )
    expect(own.status).toBe(302)
    for (const id of [admin.id, otherStaff.id]) {
      const res = await run(() =>
        avatarRoute(appRequest(staff.browser, "/x"), params(id))
      )
      expect(res.status).toBe(404)
      expect(res.headers.get("location")).toBeNull()
    }
    for (const page of [
      () => AdminPage(noSearch),
      StaffDirectoryPage,
      () => StaffPortfolioPage(params(admin.id)),
      () => StaffPortfolioPage(params(otherStaff.id)),
    ]) {
      expect((await run(() => redirectOf(page))).location).toBe("/staff")
    }
    expect(
      (await run(() => loadLibraryPage({ staff: otherStaff.id }, null))).ok
    ).toBe(false)
    expect((await run(() => loadLibraryPage({}, null))).ok).toBe(false)
    expect(
      (await run(() => updateStaffAccountAction(otherStaff.id, {}))).ok
    ).toBe(false)

    // The staff page itself carries only the caller's own profile.
    const page = await run(() => redirectOf(StaffPage))
    const shown = JSON.stringify(findProps(page.value, "profile")?.profile)
    expect(shown).toContain("TEST acc-staff")
    expect(shown).not.toContain("acc-admin")
    expect(shown).not.toContain("acc-other")

    // A profile edit only ever touches the caller's own row.
    const form = new FormData()
    form.set("displayName", "TEST acc-staff renamed")
    const res = await run(() =>
      profileRoute(
        appRequest(staff.browser, "/api/profile", {
          method: "POST",
          body: form,
        })
      )
    )
    expect(res.status).toBe(200)
    expect((await profileRow(otherStaff.id)).display_name).toBe(
      "TEST acc-other"
    )
    expect((await profileRow(admin.id)).display_name).toBe("TEST acc-admin")
  })

  it("Storage gives staff no other person's photo", async () => {
    const adminKey = (await profileRow(admin.id)).avatar_path!
    const otherKey = (await profileRow(otherStaff.id)).avatar_path!
    const bucket = staff.rest.storage.from("avatars")
    for (const key of [adminKey, otherKey]) {
      expect((await bucket.createSignedUrl(key, 60)).data).toBeNull()
      expect((await bucket.download(key)).data).toBeNull()
      const folder = key.split("/")[0]
      expect((await bucket.list(folder)).data ?? []).toEqual([])
    }
    // Control: their own photo is readable.
    const ownKey = (await profileRow(staff.id)).avatar_path!
    expect((await bucket.download(ownKey)).data).not.toBeNull()
  })
})
