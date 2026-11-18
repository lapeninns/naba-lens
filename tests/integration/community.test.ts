import { beforeAll, describe, expect, it } from "vitest"

import {
  getCommunityMember,
  listCommunityMedia,
  listCommunityMembers,
} from "@/lib/server/community"
import { getReadableAsset } from "@/lib/server/media/access"
import { signAvatar } from "@/lib/server/media/profile"
import type { MediaActor } from "@/lib/server/media/types"
import { seedAsset } from "../library/seed"
import { acceptForColleagues } from "./accepted"
import { actorFor } from "../slice/media-actor"
import {
  anonClient,
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"

/** Only run against an owned local fixture stack, using integration/setup-env.ts. */
describe("organization portfolio community", () => {
  const service = serviceClient()
  let viewer: TestIdentity
  let owner: TestIdentity
  let viewerActor: MediaActor
  let teammateActor: MediaActor
  let readyId: string
  let unreviewedId: string
  let deletedId: string
  let pendingId: string
  let ownerVenueId: string

  beforeAll(async () => {
    const [a, b] = await Promise.all([
      createVenue(service, "community-a"),
      createVenue(service, "community-b"),
    ])
    ownerVenueId = b.id
    viewer = await createIdentity(service, {
      label: "community-viewer",
      role: "staff",
      venueId: a.id,
    })
    owner = await createIdentity(service, {
      label: "community-owner",
      role: "staff",
      venueId: b.id,
    })
    const updated = await service
      .from("profiles")
      .update({ department: "boh" })
      .eq("id", owner.id)
    if (updated.error) throw updated.error
    const avatarPath = `${owner.id}/${crypto.randomUUID()}.webp`
    const avatar = await service.storage
      .from("avatars")
      .upload(avatarPath, new Uint8Array([1]), { contentType: "image/webp" })
    if (avatar.error) throw avatar.error
    const linkedAvatar = await service
      .from("profiles")
      .update({ avatar_path: avatarPath })
      .eq("id", owner.id)
    if (linkedAvatar.error) throw linkedAvatar.error
    viewerActor = await actorFor(viewer)
    // A colleague at the owner's own venue (S1-PRIVACY: accepted media is
    // shown only at the venue it was taken for).
    const teammate = await createIdentity(service, {
      label: "community-teammate",
      role: "staff",
      venueId: b.id,
    })
    teammateActor = await actorFor(teammate)
    readyId = (
      await seedAsset(service, { uploaderId: owner.id, venueId: b.id })
    ).id
    // FA-20: colleagues see a photo only once it is accepted.
    await acceptForColleagues(readyId)
    unreviewedId = (
      await seedAsset(service, { uploaderId: owner.id, venueId: b.id })
    ).id
    deletedId = (
      await seedAsset(service, { uploaderId: owner.id, venueId: b.id })
    ).id
    const deleted = await service
      .from("media_assets")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", deletedId)
    if (deleted.error) throw deleted.error
    const pending = await owner.client.rpc("reserve_media_asset", {
      p_client_upload_key: crypto.randomUUID(),
      p_media_type: "image",
      p_extension: "jpg",
      p_original_filename: "unfinished.jpg",
      p_size_bytes: 4,
    })
    if (pending.error) throw pending.error
    pendingId = pending.data[0].id
  }, 180000)

  it("browses a colleague at another venue using only safe profile fields", async () => {
    const member = await getCommunityMember(viewerActor, owner.id)
    expect(member).toMatchObject({
      ok: true,
      member: {
        id: owner.id,
        department: "boh",
        venueId: ownerVenueId,
        // FA-20 / S1-PRIVACY: none of their media is visible from another
        // venue, accepted or not.
        mediaCount: 0,
      },
    })
    expect(await getCommunityMember(teammateActor, owner.id)).toMatchObject({
      ok: true,
      member: { id: owner.id, mediaCount: 1 },
    })
    if (member.ok) expect(Object.keys(member.member)).not.toContain("email")
    const raw = await viewer.client
      .from("profiles")
      .select("id, role, active")
      .eq("id", owner.id)
    expect(raw.error).toBeNull()
    expect(raw.data).toEqual([])
    expect((await signAvatar(viewerActor, owner.id)).ok).toBe(true)
    const direct = await viewer.client.rpc("community_members", {
      p_member: owner.id,
    })
    expect(direct.error).toBeNull()
    expect(direct.data?.[0]).not.toHaveProperty("active")
    expect(direct.data?.[0]).not.toHaveProperty("role")
  })

  it("shows accepted ready assets only, filters by venue/department and retains write isolation", async () => {
    const media = await listCommunityMedia(teammateActor, {
      venueId: ownerVenueId,
      department: "boh",
    })
    expect(media.ok && media.items.map((item) => item.id)).toEqual([readyId])
    expect((await getReadableAsset(teammateActor, readyId)).ok).toBe(true)
    // From another venue: nothing, not even the accepted photo (S1-PRIVACY).
    const elsewhere = await listCommunityMedia(viewerActor, {
      venueId: ownerVenueId,
      department: "boh",
    })
    expect(elsewhere.ok && elsewhere.items).toEqual([])
    expect(await getReadableAsset(viewerActor, readyId)).toMatchObject({
      ok: false,
      status: 404,
    })
    // Ready but not reviewed: hidden from colleagues (FA-20, spec §3.3).
    for (const id of [unreviewedId, pendingId, deletedId]) {
      for (const actor of [teammateActor, viewerActor]) {
        expect(await getReadableAsset(actor, id)).toMatchObject({
          ok: false,
          status: 404,
        })
      }
      expect(
        (await viewer.client.from("media_assets").select("id").eq("id", id))
          .data
      ).toEqual([])
    }
    const deletion = await viewer.client.rpc("delete_media_asset", {
      p_asset_id: readyId,
    })
    expect(deletion.error?.message).toContain("media_asset_not_found")
    const department = await listCommunityMembers(viewerActor, {
      venueId: ownerVenueId,
      department: "foh",
    })
    expect(department.ok && department.members).toEqual([])
  })

  it("exposes no community RPCs to anonymous users", async () => {
    const anon = anonClient()
    expect(
      (await anon.rpc("community_members", { p_member: owner.id })).error
    ).not.toBeNull()
    expect(
      (await anon.rpc("community_media_page", { p_uploader: owner.id })).error
    ).not.toBeNull()
  })

  it("hides a deactivated colleague immediately and keeps admin archival reads", async () => {
    const adminUser = await createIdentity(service, {
      label: "community-admin",
      role: "admin",
    })
    const adminActor = await actorFor(adminUser)
    const changed = await service
      .from("profiles")
      .update({ active: false })
      .eq("id", owner.id)
    if (changed.error) throw changed.error
    try {
      expect(await getCommunityMember(viewerActor, owner.id)).toMatchObject({
        ok: false,
        status: 404,
      })
      expect(
        (
          await viewer.client
            .from("media_assets")
            .select("id")
            .eq("id", readyId)
        ).data
      ).toEqual([])
      expect(await signAvatar(viewerActor, owner.id)).toMatchObject({
        ok: false,
        status: 404,
      })
      expect(await getReadableAsset(viewerActor, readyId)).toMatchObject({
        ok: false,
        status: 404,
      })
      expect(
        (await listCommunityMedia(viewerActor, { uploaderId: owner.id })).ok
      ).toBe(true)
      const feed = await listCommunityMedia(viewerActor, {
        uploaderId: owner.id,
      })
      expect(feed.ok && feed.items).toEqual([])
      expect((await getReadableAsset(adminActor, readyId)).ok).toBe(true)
    } finally {
      const restored = await service
        .from("profiles")
        .update({ active: true })
        .eq("id", owner.id)
      if (restored.error) throw restored.error
    }
  })

  it("revokes discovery for a deactivated viewer with an existing session", async () => {
    const changed = await service
      .from("profiles")
      .update({ active: false })
      .eq("id", viewer.id)
    if (changed.error) throw changed.error
    try {
      const members = await viewer.client.rpc("community_members", {
        p_member: owner.id,
      })
      const media = await viewer.client.rpc("community_media_page", {
        p_uploader: owner.id,
      })
      expect(members.error).toBeNull()
      expect(members.data).toEqual([])
      expect(media.error).toBeNull()
      expect(media.data).toEqual([])
      expect(
        (
          await viewer.client
            .from("media_assets")
            .select("id")
            .eq("id", readyId)
        ).data
      ).toEqual([])
    } finally {
      const restored = await service
        .from("profiles")
        .update({ active: true })
        .eq("id", viewer.id)
      if (restored.error) throw restored.error
    }
  })
})
