import { beforeAll, describe, expect, it } from "vitest"

import {
  createIdentity,
  createVenue,
  markReady,
  serviceClient,
  TINY_BYTES,
  type TestIdentity,
} from "../support/identities"
import { getReadableAsset, streamOriginal } from "@/lib/server/media/access"
import { signAvatar } from "@/lib/server/media/profile"
import { actorFor } from "../slice/media-actor"

/**
 * Wave 3 finding 1: end users have no storage read policy. Authorised reads go
 * through the app's read path (getReadableAsset + streamOriginal, as the
 * /api/media/[id]/download route does), which checks the caller first.
 */
async function readThroughApp(identity: TestIdentity, assetId: string) {
  const actor = await actorFor(identity)
  const found = await getReadableAsset(actor, assetId)
  if (!found.ok) return null
  const response = await streamOriginal(actor, found.asset, null)
  return response.status === 200
    ? new Uint8Array(await response.arrayBuffer())
    : null
}

/**
 * Staff A and staff B work at the SAME venue: isolation must come from identity,
 * not venue. Admin is a separate identity.
 */
describe("staff isolation (RLS + storage, separate identities)", () => {
  const admin = serviceClient()
  let staffA: TestIdentity
  let staffB: TestIdentity
  let adminUser: TestIdentity
  let assetA: { id: string; original_path: string }

  beforeAll(async () => {
    const venue = await createVenue(admin, "iso")
    staffA = await createIdentity(admin, {
      label: "iso-a",
      role: "staff",
      venueId: venue.id,
    })
    staffB = await createIdentity(admin, {
      label: "iso-b",
      role: "staff",
      venueId: venue.id,
    })
    adminUser = await createIdentity(admin, {
      label: "iso-admin",
      role: "admin",
    })

    const { data, error } = await staffA.client.rpc("reserve_media_asset", {
      p_media_type: "image",
      p_extension: "jpg",
      p_original_filename: "dish.jpg",
      p_size_bytes: TINY_BYTES.byteLength,
    })
    if (error) throw error
    assetA = data[0]

    const upload = await staffA.client.storage
      .from("media")
      .upload(assetA.original_path, TINY_BYTES, { contentType: "image/jpeg" })
    if (upload.error) throw upload.error
    await markReady(admin, assetA.id)
  })

  it("staff A reads their own profile, asset row and object", async () => {
    const profile = await staffA.client
      .from("profiles")
      .select("id")
      .eq("id", staffA.id)
    expect(profile.data).toHaveLength(1)

    const rows = await staffA.client
      .from("media_assets")
      .select("id")
      .eq("id", assetA.id)
    expect(rows.data).toHaveLength(1)

    const download = await staffA.client.storage
      .from("media")
      .download(assetA.original_path)
    expect(download.error).not.toBeNull()
    expect(await readThroughApp(staffA, assetA.id)).toEqual(TINY_BYTES)
  })

  it("staff B cannot read staff A's profile", async () => {
    const { data, error } = await staffB.client.from("profiles").select("id")
    expect(error).toBeNull()
    expect(data!.map((p) => p.id)).toEqual([staffB.id])
  })

  it("staff B cannot list or read staff A's media rows", async () => {
    const byId = await staffB.client
      .from("media_assets")
      .select("id")
      .eq("id", assetA.id)
    expect(byId.data).toEqual([])
    const all = await staffB.client.from("media_assets").select("uploader_id")
    expect(all.data!.every((r) => r.uploader_id === staffB.id)).toBe(true)
  })

  it("staff B cannot download, sign or list staff A's storage objects", async () => {
    const download = await staffB.client.storage
      .from("media")
      .download(assetA.original_path)
    expect(download.data).toBeNull()
    expect(download.error).not.toBeNull()

    const signed = await staffB.client.storage
      .from("media")
      .createSignedUrl(assetA.original_path, 60)
    expect(signed.data).toBeNull()
    expect(signed.error).not.toBeNull()

    const listed = await staffB.client.storage.from("media").list(staffA.id)
    expect(listed.data ?? []).toEqual([])
  })

  it("staff B cannot delete or overwrite staff A's asset", async () => {
    const del = await staffB.client.rpc("delete_media_asset", {
      p_asset_id: assetA.id,
    })
    expect(del.error?.message).toBe("media_asset_not_found")

    const removed = await staffB.client.storage
      .from("media")
      .remove([assetA.original_path])
    expect(removed.data ?? []).toEqual([])

    const overwrite = await staffB.client.storage
      .from("media")
      .upload(assetA.original_path, new Uint8Array([1, 2, 3]), { upsert: true })
    expect(overwrite.error).not.toBeNull()

    const stillThere = await admin.storage
      .from("media")
      .download(assetA.original_path)
    expect(new Uint8Array(await stillThere.data!.arrayBuffer())).toEqual(
      TINY_BYTES
    )
    const row = await admin
      .from("media_assets")
      .select("deleted_at")
      .eq("id", assetA.id)
      .single()
    expect(row.data!.deleted_at).toBeNull()
  })

  it("an admin sees the same ready asset and every staff profile", async () => {
    const rows = await adminUser.client
      .from("media_assets")
      .select("id")
      .eq("id", assetA.id)
    expect(rows.data).toHaveLength(1)

    const profiles = await adminUser.client
      .from("profiles")
      .select("id")
      .in("id", [staffA.id, staffB.id])
    expect(profiles.data).toHaveLength(2)

    const signed = await adminUser.client.storage
      .from("media")
      .createSignedUrl(assetA.original_path, 60)
    expect(signed.error).not.toBeNull()
    expect(await readThroughApp(adminUser, assetA.id)).toEqual(TINY_BYTES)
  })

  it("staff cannot read another user's avatar folder", async () => {
    const key = `${staffA.id}/${crypto.randomUUID()}.webp`
    const put = await admin.storage
      .from("avatars")
      .upload(key, new Uint8Array([1]), { contentType: "image/webp" })
    expect(put.error).toBeNull()
    const linked = await admin
      .from("profiles")
      .update({ avatar_path: key })
      .eq("id", staffA.id)
    expect(linked.error).toBeNull()

    // No direct storage reads for anyone (wave 3 finding 1)...
    for (const user of [staffA, staffB, adminUser])
      expect(
        (await user.client.storage.from("avatars").download(key)).error
      ).not.toBeNull()
    // ...the app's /api/avatars/[id] path serves own-or-admin only.
    expect((await signAvatar(await actorFor(staffA), staffA.id)).ok).toBe(true)
    expect((await signAvatar(await actorFor(staffB), staffA.id)).ok).toBe(false)
    expect((await signAvatar(await actorFor(adminUser), staffA.id)).ok).toBe(
      true
    )
  })
})
