import { beforeAll, describe, expect, it } from "vitest"

import { getReadableAsset } from "@/lib/server/media/access"
import { actorFor } from "../slice/media-actor"

import { bootstrapAdmin } from "../../scripts/bootstrap-admin"
import {
  createIdentity,
  createVenue,
  markReady,
  serviceClient,
  testEmail,
  TINY_BYTES,
  type TestIdentity,
} from "../support/identities"

describe("media lifecycle", () => {
  const admin = serviceClient()
  let staff: TestIdentity
  let venueA: { id: string }
  let venueB: { id: string }

  beforeAll(async () => {
    venueA = await createVenue(admin, "life-a")
    venueB = await createVenue(admin, "life-b")
    staff = await createIdentity(admin, {
      label: "life",
      role: "staff",
      venueId: venueA.id,
    })
  })

  async function reserve(client = staff.client) {
    const { data, error } = await client.rpc("reserve_media_asset", {
      // Required by reserve_media_asset (wave 3 finding 5 / upload-path F5).
      p_client_upload_key: crypto.randomUUID(),
      p_size_bytes: 4,
      p_media_type: "image",
      p_extension: "JPG",
      p_original_filename: "dish.jpg",
    })
    if (error) throw error
    return data[0]
  }

  it("snapshots the venue at upload; a transfer does not relabel old assets", async () => {
    const before = await reserve()
    expect(before.venue_id).toBe(venueA.id)
    expect(before.original_path).toMatch(
      new RegExp(`^${staff.id}/${before.id}/original\\.jpg$`)
    )

    await admin
      .from("profiles")
      .update({ venue_id: venueB.id })
      .eq("id", staff.id)
    const after = await reserve()
    expect(after.venue_id).toBe(venueB.id)

    const old = await admin
      .from("media_assets")
      .select("venue_id")
      .eq("id", before.id)
      .single()
    expect(old.data!.venue_id).toBe(venueA.id)

    await admin
      .from("profiles")
      .update({ venue_id: venueA.id })
      .eq("id", staff.id)
  })

  it("keeps owner, venue and keys immutable even for the service role", async () => {
    const asset = await reserve()
    for (const patch of [
      { uploader_id: crypto.randomUUID() },
      { venue_id: venueB.id },
      { original_path: `${staff.id}/${asset.id}/original.png` },
    ]) {
      const { error } = await admin
        .from("media_assets")
        .update(patch)
        .eq("id", asset.id)
      expect(error).not.toBeNull()
    }
  })

  it("refuses an uploading asset becoming ready without validation", async () => {
    const asset = await reserve()
    const skip = await admin
      .from("media_assets")
      .update({
        upload_state: "ready",
        validated_mime_type: "image/jpeg",
        size_bytes: 4,
      })
      .eq("id", asset.id)
    expect(skip.error?.message).toBe("media_asset_invalid_state_transition")

    await admin
      .from("media_assets")
      .update({ upload_state: "processing" })
      .eq("id", asset.id)
    const unvalidated = await admin
      .from("media_assets")
      .update({ upload_state: "ready" })
      .eq("id", asset.id)
    expect(unvalidated.error).not.toBeNull()
  })

  it("staff cannot read their own object until it is ready", async () => {
    const asset = await reserve()
    await staff.client.storage
      .from("media")
      .upload(asset.original_path, TINY_BYTES)
    expect(
      (await staff.client.storage.from("media").download(asset.original_path))
        .error
    ).not.toBeNull()
    await markReady(admin, asset.id)
    // Once ready it is readable only through the app's read path; direct
    // storage reads stay denied (wave 3 finding 1).
    expect(
      (await staff.client.storage.from("media").download(asset.original_path))
        .error
    ).not.toBeNull()
    const actor = await actorFor(staff)
    const found = await getReadableAsset(actor, asset.id)
    expect(found.ok).toBe(true)
  })

  it("an inactive venue cannot receive uploads or assignments", async () => {
    const closed = await createVenue(admin, "life-closed", false)
    const assign = await admin
      .from("profiles")
      .update({ venue_id: closed.id })
      .eq("id", staff.id)
    expect(assign.error?.message).toBe("venue_inactive")

    await admin.from("venues").update({ active: false }).eq("id", venueA.id)
    const blocked = await staff.client.rpc("reserve_media_asset", {
      // Required by reserve_media_asset (wave 3 finding 5 / upload-path F5).
      p_client_upload_key: crypto.randomUUID(),
      p_size_bytes: 4,
      p_media_type: "image",
      p_extension: "jpg",
      p_original_filename: "x.jpg",
    })
    expect(blocked.error?.message).toBe("venue_unavailable")
    await admin.from("venues").update({ active: true }).eq("id", venueA.id)
  })

  it("deletion hides the asset at once, is idempotent, and drives retryable cleanup", async () => {
    const asset = await reserve()
    await staff.client.storage
      .from("media")
      .upload(asset.original_path, TINY_BYTES)
    await markReady(admin, asset.id)
    const derivative = `${staff.id}/${asset.id}/thumb.webp`
    await admin.storage
      .from("media")
      .upload(derivative, new Uint8Array([1]), { contentType: "image/webp" })

    expect(
      (await staff.client.rpc("delete_media_asset", { p_asset_id: asset.id }))
        .error
    ).toBeNull()
    expect(
      (await staff.client.rpc("delete_media_asset", { p_asset_id: asset.id }))
        .error
    ).toBeNull()

    expect(
      (await staff.client.from("media_assets").select("id").eq("id", asset.id))
        .data
    ).toEqual([])
    expect(
      (
        await staff.client.storage
          .from("media")
          .createSignedUrl(asset.original_path, 60)
      ).error
    ).not.toBeNull()

    const undelete = await admin
      .from("media_assets")
      .update({ deleted_at: null })
      .eq("id", asset.id)
    expect(undelete.error?.message).toBe("media_asset_tombstone_permanent")

    const pending = await admin.rpc("prepare_media_cleanup", {
      p_abandoned_after: "24 hours",
      p_limit: 1000,
    })
    expect(pending.error).toBeNull()
    const entry = pending.data!.find((p) => p.asset_id === asset.id)
    expect(entry?.object_names.sort()).toEqual(
      [asset.original_path, derivative].sort()
    )

    const removed = await admin.storage
      .from("media")
      .remove(entry!.object_names)
    expect(removed.error).toBeNull()
    const again = await admin.rpc("prepare_media_cleanup", {
      p_abandoned_after: "24 hours",
      p_limit: 1000,
    })
    expect(again.data!.some((p) => p.asset_id === asset.id)).toBe(false)
  })
})

describe("bootstrap-admin", () => {
  const admin = serviceClient()

  it("refuses an email without an existing auth user and never creates one", async () => {
    const email = testEmail("boot-missing")
    await expect(
      bootstrapAdmin(admin, { email, displayName: "TEST" })
    ).rejects.toThrow(/No auth user/)
  })

  it("promotes an existing staff account and is idempotent", async () => {
    const venue = await createVenue(admin, "boot")
    const user = await createIdentity(admin, {
      label: "boot",
      role: "staff",
      venueId: venue.id,
    })
    expect((await bootstrapAdmin(admin, { email: user.email })).action).toBe(
      "promoted"
    )
    expect(
      (await bootstrapAdmin(admin, { email: user.email.toUpperCase() })).action
    ).toBe("already_admin")
    const row = await admin
      .from("profiles")
      .select("role, active")
      .eq("id", user.id)
      .single()
    expect(row.data).toEqual({ role: "admin", active: true })
  })

  it("creates an admin profile for an invited user without one", async () => {
    const user = await createIdentity(admin, {
      label: "boot2",
      role: "admin",
      profile: false,
    })
    await expect(bootstrapAdmin(admin, { email: user.email })).rejects.toThrow(
      /--name/
    )
    expect(
      (
        await bootstrapAdmin(admin, {
          email: user.email,
          displayName: "TEST Owner",
        })
      ).action
    ).toBe("created_profile")
  })

  // Final review F10: an active admin still banned in Auth (left by an older
  // script promoting a deactivated account) could never sign in.
  it("lifts a stale Auth ban from an already-active admin", async () => {
    const user = await createIdentity(admin, {
      label: "boot-banned",
      role: "admin",
      session: false,
    })
    const ban = await admin.auth.admin.updateUserById(user.id, {
      ban_duration: "876000h",
    })
    expect(ban.error).toBeNull()
    expect((await bootstrapAdmin(admin, { email: user.email })).action).toBe(
      "already_admin"
    )
    const { data } = await admin.auth.admin.getUserById(user.id)
    const bannedUntil = data.user?.banned_until
    expect(!bannedUntil || Date.parse(bannedUntil) <= Date.now()).toBe(true)
  })
})
