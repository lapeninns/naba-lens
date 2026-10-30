import { beforeAll, describe, expect, it } from "vitest"
import { getReadableAsset, streamOriginal } from "@/lib/server/media/access"
import { actorFor } from "../slice/media-actor"

import { sendSignInLink } from "@/lib/auth/magic-link"
import { loadProfile, toAuthState } from "@/lib/auth/profile"

import {
  anonClient,
  createIdentity,
  createVenue,
  markReady,
  serviceClient,
  testEmail,
  TINY_BYTES,
  type TestIdentity,
} from "../support/identities"

async function authUserExists(email: string) {
  const admin = serviceClient()
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  return data.users.some((u) => u.email === email)
}

describe("invite-only sign-in", () => {
  it("an uninvited email gets no account and a neutral result", async () => {
    const email = testEmail("uninvited")
    const anon = anonClient()

    const raw = await anon.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    })
    expect(raw.error).not.toBeNull()

    // Even asking to create a user is refused: sign-ups are disabled.
    const forced = await anon.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    })
    expect(forced.error).not.toBeNull()
    const signUp = await anon.auth.signUp({
      email,
      password: "TEST-not-used-123",
    })
    expect(signUp.error).not.toBeNull()

    await expect(
      sendSignInLink(anon, email, "http://127.0.0.1:3000/auth/callback")
    ).resolves.toEqual({ status: "sent" })
    expect(await authUserExists(email)).toBe(false)
  })

  it("an auth user without a profile is not granted access", async () => {
    const admin = serviceClient()
    const user = await createIdentity(admin, {
      label: "noprofile",
      role: "staff",
      profile: false,
    })
    expect(await loadProfile(user.client, user.id, user.email)).toBeNull()
    expect(toAuthState({ id: user.id, email: user.email }, null).status).toBe(
      "no_profile"
    )

    const venues = await user.client.from("venues").select("id")
    expect(venues.data ?? []).toEqual([])
    const reserve = await user.client.rpc("reserve_media_asset", {
      // Required by reserve_media_asset (wave 3 finding 5 / upload-path F5).
      p_client_upload_key: crypto.randomUUID(),
      p_size_bytes: 4,
      p_media_type: "image",
      p_extension: "jpg",
      p_original_filename: "x.jpg",
    })
    expect(reserve.error?.message).toBe("not_active_staff")
  })
})

describe("deactivation blocks an existing session", () => {
  const admin = serviceClient()
  let staff: TestIdentity
  let assetId: string
  let originalPath: string

  beforeAll(async () => {
    const venue = await createVenue(admin, "deact")
    // Sign in while active, upload, then deactivate: the old session must stop working.
    staff = await createIdentity(admin, {
      label: "deact",
      role: "staff",
      venueId: venue.id,
    })
    const { data, error } = await staff.client.rpc("reserve_media_asset", {
      // Required by reserve_media_asset (wave 3 finding 5 / upload-path F5).
      p_client_upload_key: crypto.randomUUID(),
      p_size_bytes: 4,
      p_media_type: "image",
      p_extension: "jpg",
      p_original_filename: "dish.jpg",
    })
    if (error) throw error
    assetId = data[0].id
    originalPath = data[0].original_path
    const up = await staff.client.storage
      .from("media")
      .upload(originalPath, TINY_BYTES)
    if (up.error) throw up.error
    await markReady(admin, assetId)

    expect(
      (await staff.client.from("media_assets").select("id")).data
    ).toHaveLength(1)
    const { error: deactivateError } = await admin
      .from("profiles")
      .update({ active: false })
      .eq("id", staff.id)
    if (deactivateError) throw deactivateError
  })

  it("is reported as inactive by the app's profile loader", async () => {
    const profile = await loadProfile(staff.client, staff.id, staff.email)
    expect(profile?.active).toBe(false)
    expect(
      toAuthState({ id: staff.id, email: staff.email }, profile).status
    ).toBe("inactive")
  })

  it("cannot read media, venues or storage objects", async () => {
    expect((await staff.client.from("media_assets").select("id")).data).toEqual(
      []
    )
    expect((await staff.client.from("venues").select("id")).data).toEqual([])
    const download = await staff.client.storage
      .from("media")
      .download(originalPath)
    expect(download.error).not.toBeNull()
    const signed = await staff.client.storage
      .from("media")
      .createSignedUrl(originalPath, 60)
    expect(signed.error).not.toBeNull()
  })

  it("cannot upload, edit their profile or delete media", async () => {
    const reserve = await staff.client.rpc("reserve_media_asset", {
      // Required by reserve_media_asset (wave 3 finding 5 / upload-path F5).
      p_client_upload_key: crypto.randomUUID(),
      p_size_bytes: 4,
      p_media_type: "image",
      p_extension: "jpg",
      p_original_filename: "x.jpg",
    })
    expect(reserve.error?.message).toBe("not_active_staff")

    const { data } = await staff.client
      .from("profiles")
      .update({ display_name: "TEST still here" })
      .eq("id", staff.id)
      .select()
    expect(data ?? []).toEqual([])

    const del = await staff.client.rpc("delete_media_asset", {
      p_asset_id: assetId,
    })
    expect(del.error?.message).toBe("media_asset_not_found")
  })

  it("leaves the retained asset available to an active admin", async () => {
    const adminUser = await createIdentity(admin, {
      label: "deact-admin",
      role: "admin",
    })
    const rows = await adminUser.client
      .from("media_assets")
      .select("id")
      .eq("id", assetId)
    expect(rows.data).toHaveLength(1)
    // Through the app's read path; direct storage reads are denied to end
    // users (wave 3 finding 1).
    const download = await adminUser.client.storage
      .from("media")
      .download(originalPath)
    expect(download.error).not.toBeNull()
    const actor = await actorFor(adminUser)
    const found = await getReadableAsset(actor, assetId)
    expect(found.ok).toBe(true)
    if (!found.ok) return
    const response = await streamOriginal(actor, found.asset, null)
    expect(response.status).toBe(200)
    await response.body?.cancel()
  })

  it("an inactive admin loses admin access too", async () => {
    const adminUser = await createIdentity(admin, {
      label: "deact-admin2",
      role: "admin",
      active: false,
    })
    expect(
      (await adminUser.client.from("media_assets").select("id")).data
    ).toEqual([])
    expect(
      (await adminUser.client.from("profiles").select("id")).data
    ).toHaveLength(1)
  })
})
