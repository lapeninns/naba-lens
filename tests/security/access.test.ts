import { beforeAll, describe, expect, it } from "vitest"
import {
  createIdentity,
  createVenue,
  markReady,
  serviceClient,
  testEmail,
  TINY_BYTES,
  type TestIdentity,
} from "../support/identities"
import { getLocalSupabaseEnv } from "../support/local-supabase"

type Actor =
  "A" | "B" | "C" | "admin" | "inactiveStaff" | "inactiveAdmin" | "anonymous"
type Asset = { id: string; original_path: string; venue_id: string }
const actors: Actor[] = [
  "A",
  "B",
  "C",
  "admin",
  "inactiveStaff",
  "inactiveAdmin",
  "anonymous",
]
const users = {} as Record<Exclude<Actor, "anonymous">, TestIdentity>
const tokens = {} as Record<Actor, string | undefined>
const assets = {} as Record<"ready" | "uploading" | "failed" | "deleted", Asset>
let venueA: string
let venueB: string
let avatar: string
const setup = () => serviceClient()

// All assertions use anon-key HTTP requests with individual real Auth JWTs.
// The service role is used only for fixtures and independent persisted readback.
async function request(
  actor: Actor,
  path: string,
  method = "GET",
  body?: unknown,
  extra: Record<string, string> = {}
) {
  const env = getLocalSupabaseEnv()
  const response = await fetch(`${env.url}${path}`, {
    method,
    headers: {
      apikey: env.publishableKey,
      ...(tokens[actor] ? { Authorization: `Bearer ${tokens[actor]}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (response.status === 500 && path === "/rest/v1/rpc/delete_media_asset") {
    // PostgREST maps the foundation RPC's intentional P0002 denial to HTTP 500.
    // Accept only its exact application error, never an arbitrary server failure.
    expect(await response.clone().json()).toMatchObject({
      code: "P0002",
      message: "media_asset_not_found",
    })
  } else {
    expect(
      response.status,
      `${method} ${path} must reach the API`
    ).toBeLessThan(500)
  }
  return response
}
async function jsonRows(actor: Actor, table: string, query: string) {
  const response = await request(actor, `/rest/v1/${table}?select=id&${query}`)
  if (actor === "anonymous") {
    expect(response.ok).toBe(false)
    return [] as { id: string }[]
  }
  expect(response.ok).toBe(true)
  return (await response.json()) as { id: string }[]
}
async function deniedMutation(
  actor: Actor,
  table: string,
  id: string,
  method: string,
  patch?: unknown
) {
  const response = await request(
    actor,
    `/rest/v1/${table}?id=eq.${id}`,
    method,
    patch,
    { Prefer: "return=representation" }
  )
  if (response.ok) expect(await response.json()).toEqual([])
  else expect([400, 401, 403]).toContain(response.status)
}
async function objectRequest(
  actor: Actor,
  bucket: string,
  key: string,
  method = "GET",
  upsert = false
) {
  const env = getLocalSupabaseEnv()
  const response = await fetch(
    `${env.url}/storage/v1/object/${method === "GET" ? "authenticated/" : ""}${bucket}/${key}`,
    {
      method,
      headers: {
        apikey: env.publishableKey,
        ...(tokens[actor] ? { Authorization: `Bearer ${tokens[actor]}` } : {}),
        "Content-Type": bucket === "avatars" ? "image/webp" : "image/jpeg",
        "x-upsert": String(upsert),
      },
      body: method === "GET" ? undefined : TINY_BYTES,
    }
  )
  expect(response.status).toBeLessThan(500)
  return response
}
async function reserve(user: TestIdentity) {
  const result = await user.client.rpc("reserve_media_asset", {
    // Required by reserve_media_asset (wave 3 finding 5 / upload-path F5).
    p_client_upload_key: crypto.randomUUID(),
    p_size_bytes: 4,
    p_media_type: "image",
    p_extension: "jpg",
    p_original_filename: "TEST security.jpg",
  })
  if (result.error) throw result.error
  return result.data[0]
}

beforeAll(async () => {
  const service = setup()
  venueA = (await createVenue(service, "security-a")).id
  venueB = (await createVenue(service, "security-b")).id
  for (const name of actors.filter((a) => a !== "anonymous")) {
    const isAdmin = name === "admin" || name === "inactiveAdmin"
    users[name] = await createIdentity(service, {
      label: `security-${name}`,
      role: isAdmin ? "admin" : "staff",
      venueId: isAdmin ? undefined : name === "C" ? venueB : venueA,
    })
    const session = await users[name].client.auth.getSession()
    tokens[name] = session.data.session!.access_token
  }
  expect(new Set(Object.values(tokens)).size).toBe(6)
  for (const state of ["ready", "uploading", "failed", "deleted"] as const) {
    assets[state] = await reserve(users.A)
    const put = await users.A.client.storage
      .from("media")
      .upload(assets[state].original_path, TINY_BYTES)
    if (put.error) throw put.error
    if (state === "ready" || state === "deleted")
      await markReady(service, assets[state].id)
    if (state === "failed") {
      const result = await service
        .from("media_assets")
        .update({ upload_state: "failed" })
        .eq("id", assets[state].id)
      if (result.error) throw result.error
    }
    if (state === "deleted") {
      const result = await users.A.client.rpc("delete_media_asset", {
        p_asset_id: assets[state].id,
      })
      if (result.error) throw result.error
    }
  }
  avatar = `${users.A.id}/${crypto.randomUUID()}.webp`
  const avatarPut = await service.storage
    .from("avatars")
    .upload(avatar, TINY_BYTES, { contentType: "image/webp" })
  if (avatarPut.error) throw avatarPut.error
  // Deactivate AFTER JWT issuance. These exact JWTs remain in use below.
  for (const name of ["inactiveStaff", "inactiveAdmin"] as const) {
    const result = await service
      .from("profiles")
      .update({ active: false })
      .eq("id", users[name].id)
    if (result.error) throw result.error
  }
})

for (const actor of actors)
  describe(`${actor}: adversarial API matrix`, () => {
    it("§7: profiles list and targeted select obey identity, including inactive own-row explanation", async () => {
      const ids = Object.values(users).map((u) => u.id)
      const rows = await jsonRows(actor, "profiles", `id=in.(${ids.join(",")})`)
      const expected =
        actor === "anonymous" ? [] : actor === "admin" ? ids : [users[actor].id]
      expect(rows.map((r) => r.id).sort()).toEqual(expected.sort())
      const target = await jsonRows(actor, "profiles", `id=eq.${users.A.id}`)
      expect(target.map((r) => r.id)).toEqual(
        actor === "A" || actor === "admin" ? [users.A.id] : []
      )
    })
    it("§7: venues list/select requires an active profile; direct update/delete is forbidden", async () => {
      const active = ["A", "B", "C", "admin"].includes(actor)
      const rows = await jsonRows(
        actor,
        "venues",
        `id=in.(${venueA},${venueB})`
      )
      expect(rows.map((r) => r.id).sort()).toEqual(
        active ? [venueA, venueB].sort() : []
      )
      expect((await jsonRows(actor, "venues", `id=eq.${venueA}`)).length).toBe(
        active ? 1 : 0
      )
      await deniedMutation(actor, "venues", venueA, "PATCH", {
        name: "TEST attacker rename",
      })
      await deniedMutation(actor, "venues", venueA, "DELETE")
      expect(
        (await setup().from("venues").select("id").eq("id", venueA)).data
      ).toHaveLength(1)
    })
    it("§7: media list/select hides other contributors, non-ready admin rows and tombstones", async () => {
      const ids = Object.values(assets).map((a) => a.id)
      const rows = await jsonRows(
        actor,
        "media_assets",
        `id=in.(${ids.join(",")})`
      )
      const expected =
        actor === "A"
          ? [assets.ready.id, assets.uploading.id, assets.failed.id]
          : actor === "admin"
            ? [assets.ready.id]
            : []
      expect(rows.map((r) => r.id).sort()).toEqual(expected.sort())
      for (const asset of Object.values(assets)) {
        expect(
          (await jsonRows(actor, "media_assets", `id=eq.${asset.id}`)).length
        ).toBe(expected.includes(asset.id) ? 1 : 0)
      }
    })
    it("§7: role escalation and direct profile deletion are forbidden", async () => {
      const id = actor === "anonymous" ? users.A.id : users[actor].id
      await deniedMutation(actor, "profiles", id, "PATCH", {
        role:
          actor === "admin" || actor === "inactiveAdmin" ? "staff" : "admin",
      })
      await deniedMutation(actor, "profiles", id, "DELETE")
      expect(
        (await setup().from("profiles").select("id").eq("id", id)).data
      ).toHaveLength(1)
    })
    it("§7: direct media insert/update/delete cannot bypass trusted reservation and validation", async () => {
      const id = crypto.randomUUID()
      const inserted = await request(actor, "/rest/v1/media_assets", "POST", {
        id,
        uploader_id: users.A.id,
        venue_id: venueA,
        media_type: "image",
        original_path: `${users.A.id}/${id}/original.jpg`,
        original_filename: "TEST forged.jpg",
      })
      expect(inserted.ok).toBe(false)
      for (const patch of [
        { uploader_id: users.B.id },
        { venue_id: venueB },
        { original_path: `${users.A.id}/${assets.ready.id}/original.png` },
        { upload_state: "failed" },
        { deleted_at: new Date().toISOString() },
      ])
        await deniedMutation(
          actor,
          "media_assets",
          assets.ready.id,
          "PATCH",
          patch
        )
      await deniedMutation(actor, "media_assets", assets.ready.id, "DELETE")
      const readback = await setup()
        .from("media_assets")
        .select("uploader_id,venue_id,original_path,upload_state,deleted_at")
        .eq("id", assets.ready.id)
        .single()
      expect(readback.data).toEqual({
        uploader_id: users.A.id,
        venue_id: venueA,
        original_path: assets.ready.original_path,
        upload_state: "ready",
        deleted_at: null,
      })
      expect(
        (await setup().from("media_assets").select("id").eq("id", id)).data
      ).toEqual([])
    })
    for (const state of ["ready", "uploading", "failed", "deleted"] as const) {
      it(`§7/§10: ${state} objects cannot be listed, downloaded or signed directly by any end user`, async () => {
        const key = assets[state].original_path
        // Wave 3 finding 1: no end-user storage read policy. Authorised reads go
        // through the app routes, which check the caller and sign for 60 s with
        // the service role (tests/security/hardening.test.ts).
        const allowed = false
        const download = await objectRequest(actor, "media", key)
        expect(download.ok).toBe(allowed)
        if (allowed)
          expect(new Uint8Array(await download.arrayBuffer())).toEqual(
            TINY_BYTES
          )
        const signed = await request(
          actor,
          `/storage/v1/object/sign/media/${key}`,
          "POST",
          { expiresIn: 60 }
        )
        expect(signed.ok).toBe(allowed)
        if (allowed) {
          const data = await signed.json()
          expect(data.signedURL).toBeTruthy()
          const url = new URL(
            `/storage/v1${data.signedURL}`,
            getLocalSupabaseEnv().url
          )
          const bytes = await fetch(url)
          expect(bytes.ok).toBe(true)
          expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(TINY_BYTES)
        }
        const listed = await request(
          actor,
          "/storage/v1/object/list/media",
          "POST",
          { prefix: key.slice(0, key.lastIndexOf("/")), limit: 100 }
        )
        if (listed.ok) {
          const entries = (await listed.json()) as { name: string }[]
          expect(entries.some((entry) => entry.name === "original.jpg")).toBe(
            allowed
          )
        } else expect(allowed).toBe(false)
        // Existing keys are immutable even for the owner and active admin.
        expect((await objectRequest(actor, "media", key, "PUT")).ok).toBe(false)
        expect(
          (await objectRequest(actor, "media", key, "POST", true)).ok
        ).toBe(false)
      })
    }
    it("§7: uploads to unreserved, foreign reserved, derivative and non-uploading keys are denied", async () => {
      const own = actor === "anonymous" ? users.A.id : users[actor].id
      for (const key of [
        `${own}/${crypto.randomUUID()}/original.jpg`,
        `${users.A.id}/${assets.uploading.id}/preview.webp`,
        ...Object.values(assets).map((asset) =>
          asset.original_path.replace("original.jpg", "unexpected.jpg")
        ),
      ])
        expect((await objectRequest(actor, "media", key, "POST")).ok).toBe(
          false
        )
      if (actor !== "A")
        expect(
          (
            await objectRequest(
              actor,
              "media",
              assets.uploading.original_path,
              "POST"
            )
          ).ok
        ).toBe(false)
    })
    it("§7: avatars cannot be listed, downloaded or signed directly; all direct avatar writes are denied", async () => {
      // Wave 3 finding 1: own-or-admin reads go through /api/avatars/[id] only.
      const allowed = false
      expect((await objectRequest(actor, "avatars", avatar)).ok).toBe(allowed)
      expect(
        (
          await request(
            actor,
            `/storage/v1/object/sign/avatars/${avatar}`,
            "POST",
            { expiresIn: 60 }
          )
        ).ok
      ).toBe(allowed)
      const listed = await request(
        actor,
        "/storage/v1/object/list/avatars",
        "POST",
        { prefix: users.A.id, limit: 100 }
      )
      if (listed.ok)
        expect(
          ((await listed.json()) as { name: string }[]).some(
            (entry) => entry.name === avatar.split("/")[1]
          )
        ).toBe(allowed)
      else expect(allowed).toBe(false)
      const own = actor === "anonymous" ? users.A.id : users[actor].id
      expect(
        (
          await objectRequest(
            actor,
            "avatars",
            `${own}/${crypto.randomUUID()}.webp`,
            "POST"
          )
        ).ok
      ).toBe(false)
      expect(
        (
          await objectRequest(
            actor,
            "avatars",
            `${users.A.id}/${crypto.randomUUID()}.webp`,
            "POST"
          )
        ).ok
      ).toBe(false)
      expect((await objectRequest(actor, "avatars", avatar, "PUT")).ok).toBe(
        false
      )
      expect(
        (await objectRequest(actor, "avatars", avatar, "POST", true)).ok
      ).toBe(false)
    })
    it("§7: privileged cleanup RPC is never callable by end users", async () => {
      expect(
        (
          await request(actor, "/rest/v1/rpc/prepare_media_cleanup", "POST", {
            p_abandoned_after: "24 hours",
            p_limit: 1,
          })
        ).ok
      ).toBe(false)
    })
  })

for (const actor of actors.filter((a) => a !== "admin")) {
  for (const column of ["active", "venue_id", "job_title"] as const) {
    it(`§7: ${actor} cannot change own protected profile column ${column}`, async () => {
      const id = actor === "anonymous" ? users.A.id : users[actor].id
      const before = await setup()
        .from("profiles")
        .select("active,venue_id,job_title")
        .eq("id", id)
        .single()
      const patch =
        column === "active"
          ? { active: !before.data!.active }
          : column === "venue_id"
            ? { venue_id: venueB }
            : { job_title: "TEST escalated" }
      // C already belongs to venueB: pick a genuinely different value.
      if (column === "venue_id" && before.data!.venue_id === venueB)
        patch.venue_id = venueA
      await deniedMutation(actor, "profiles", id, "PATCH", patch)
      expect(
        (
          await setup()
            .from("profiles")
            .select("active,venue_id,job_title")
            .eq("id", id)
            .single()
        ).data
      ).toEqual(before.data)
    })
  }
}

it("§7: staff cannot edit a same-venue or different-venue contributor's profile", async () => {
  for (const actor of ["B", "C"] as const)
    await deniedMutation(actor, "profiles", users.A.id, "PATCH", {
      display_name: "TEST attacker",
    })
})
it("§7: active admin can edit staff job title, venue and activation without role promotion", async () => {
  const response = await request(
    "admin",
    `/rest/v1/profiles?id=eq.${users.B.id}`,
    "PATCH",
    { job_title: "TEST admin-assigned", venue_id: venueB, active: true },
    { Prefer: "return=representation" }
  )
  expect(response.ok).toBe(true)
  expect((await response.json())[0]).toMatchObject({
    job_title: "TEST admin-assigned",
    venue_id: venueB,
    active: true,
    role: "staff",
  })
})
it("§7: active staff may edit own display name but cannot point avatar to another user's folder", async () => {
  const response = await request(
    "A",
    `/rest/v1/profiles?id=eq.${users.A.id}`,
    "PATCH",
    { display_name: "TEST Security renamed" },
    { Prefer: "return=representation" }
  )
  expect(response.ok).toBe(true)
  expect((await response.json())[0].display_name).toBe("TEST Security renamed")
  await deniedMutation("B", "profiles", users.B.id, "PATCH", {
    avatar_path: avatar,
  })
})
it("§7/§10: public password signup and OTP account creation yield no account or usable session", async () => {
  for (const kind of ["password", "otp-default", "otp-explicit"] as const) {
    const email = testEmail(`security-public-${kind}`)
    const result =
      kind === "password"
        ? await request("anonymous", "/auth/v1/signup", "POST", {
            email,
            password: `TEST-${crypto.randomUUID()}`,
          })
        : await request("anonymous", "/auth/v1/otp", "POST", {
            email,
            ...(kind === "otp-explicit" ? { create_user: true } : {}),
          })
    expect(result.ok).toBe(false)
    const body = await result.json()
    expect(body.access_token).toBeUndefined()
    const usersResult = await setup().auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    })
    expect(usersResult.error).toBeNull()
    expect(usersResult.data.users.some((user) => user.email === email)).toBe(
      false
    )
  }
})

for (const actor of actors) {
  it(`§7: ${actor} reservation derives owner/venue and deletion enforces owner-or-admin`, async () => {
    const activeStaff = ["A", "B", "C"].includes(actor)
    const response = await request(
      actor,
      "/rest/v1/rpc/reserve_media_asset",
      "POST",
      {
        // Required by reserve_media_asset (wave 3 finding 5 / upload-path F5).
        p_client_upload_key: crypto.randomUUID(),
        p_size_bytes: 4,
        p_media_type: "image",
        p_extension: "jpg",
        p_original_filename: "TEST rpc.jpg",
      }
    )
    expect(response.ok).toBe(activeStaff)
    if (activeStaff) {
      const reserved = (await response.json())[0] as Asset
      const id = users[actor as "A" | "B" | "C"].id
      const profile = await setup()
        .from("profiles")
        .select("venue_id")
        .eq("id", id)
        .single()
      expect(reserved.venue_id).toBe(profile.data!.venue_id)
      expect(reserved.original_path).toBe(`${id}/${reserved.id}/original.jpg`)
      expect(
        (await objectRequest(actor, "media", reserved.original_path, "POST")).ok
      ).toBe(true)
    }
    // Always attack A's fresh live object; no prior actor can tombstone it.
    const target = await reserve(users.A)
    const deletion = await request(
      actor,
      "/rest/v1/rpc/delete_media_asset",
      "POST",
      { p_asset_id: target.id }
    )
    expect(deletion.ok).toBe(actor === "A" || actor === "admin")
    const persisted = await setup()
      .from("media_assets")
      .select("deleted_at")
      .eq("id", target.id)
      .single()
    expect(persisted.data!.deleted_at !== null).toBe(
      actor === "A" || actor === "admin"
    )
  })
}

it("§7: failed and deleted reservations reject a fresh upload, beyond duplicate-key checks", async () => {
  for (const state of ["failed", "deleted"] as const) {
    const target = await reserve(users.A)
    if (state === "failed") {
      const result = await setup()
        .from("media_assets")
        .update({ upload_state: "failed" })
        .eq("id", target.id)
      expect(result.error).toBeNull()
    } else {
      expect(
        (
          await users.A.client.rpc("delete_media_asset", {
            p_asset_id: target.id,
          })
        ).error
      ).toBeNull()
    }
    expect(
      (await objectRequest("A", "media", target.original_path, "POST")).ok
    ).toBe(false)
  }
})
