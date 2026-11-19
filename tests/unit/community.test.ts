import { describe, expect, it, vi } from "vitest"

import {
  listCommunityMembers,
  getCommunityMember,
  listCommunityMedia,
} from "@/lib/server/community"
import { getReadableAsset } from "@/lib/server/media/access"
import { signAvatar } from "@/lib/server/media/profile"
import type { MediaActor } from "@/lib/server/media/types"

const viewer = "10000000-0000-4000-8000-000000000001"
const colleague = "10000000-0000-4000-8000-000000000002"
const asset = "10000000-0000-4000-8000-000000000003"
function actor() {
  const rpc = vi.fn().mockResolvedValue({ data: [], error: null })
  const single = vi.fn().mockResolvedValue({ data: null, error: null })
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: single,
  }
  const signed = vi
    .fn()
    .mockResolvedValue({
      data: { signedUrl: "https://fixture.invalid/signed" },
      error: null,
    })
  return {
    value: {
      profile: { id: viewer, role: "staff", active: true },
      db: { rpc, from: vi.fn(() => query) },
      service: {
        storage: { from: vi.fn(() => ({ createSignedUrl: signed })) },
      },
    } as unknown as MediaActor,
    rpc,
    single,
    signed,
  }
}
const row = {
  id: colleague,
  display_name: "Colleague",
  job_title: "Chef",
  department: "boh",
  venue_id: null,
  venue_name: null,
  avatar_path: `${colleague}/photo.webp`,
  media_count: 3,
}
const readyAsset = {
  id: asset,
  uploader_id: colleague,
  media_type: "image",
  original_path: "original.jpg",
  thumbnail_path: "thumb.webp",
  preview_path: "preview.webp",
  validated_mime_type: "image/jpeg",
  size_bytes: 4,
  original_filename: "dish.jpg",
  upload_state: "ready",
  deleted_at: null,
}

describe("organization community boundaries", () => {
  it("rejects inactive callers before any directory or gallery read", async () => {
    const a = actor()
    a.value.profile.active = false
    expect(await listCommunityMembers(a.value)).toMatchObject({
      ok: false,
      status: 403,
    })
    expect(await listCommunityMedia(a.value)).toMatchObject({
      ok: false,
      status: 403,
    })
    expect(await getCommunityMember(a.value, colleague)).toMatchObject({
      ok: false,
      status: 403,
    })
    expect(a.rpc).not.toHaveBeenCalled()
  })
  it("projects safe member fields and never serializes account or storage data", async () => {
    const a = actor()
    a.rpc.mockResolvedValue({
      data: [
        {
          ...row,
          email: "private@example.invalid",
          role: "admin",
          active: true,
        },
      ],
      error: null,
    })
    const result = await getCommunityMember(a.value, colleague)
    expect(result).toMatchObject({
      ok: true,
      member: { id: colleague, department: "boh", mediaCount: 3 },
    })
    expect(JSON.stringify(result)).not.toContain("private@example.invalid")
    expect(JSON.stringify(result)).not.toContain("avatar_path")
    if (result.ok)
      expect(Object.keys(result.member).sort()).toEqual(
        [
          "avatarUrl",
          "department",
          "displayName",
          "id",
          "jobTitle",
          "mediaCount",
          "venueId",
          "venueName",
        ].sort()
      )
  })
  it("rejects invalid cursors and filter identifiers without a database query", async () => {
    const a = actor()
    expect(await listCommunityMedia(a.value, {}, "not-a-cursor")).toMatchObject(
      { ok: false, status: 400 }
    )
    expect(
      await listCommunityMedia(a.value, { uploaderId: "invalid" })
    ).toMatchObject({ ok: false, status: 400 })
    expect(await listCommunityMembers(a.value, { offset: -1 })).toMatchObject({
      ok: false,
      status: 400,
    })
    expect(a.rpc).not.toHaveBeenCalled()
  })
  it("only signs peer assets after a current community-membership check", async () => {
    const a = actor()
    a.single.mockResolvedValue({ data: readyAsset, error: null })
    expect(await getReadableAsset(a.value, asset)).toMatchObject({
      ok: false,
      status: 404,
    })
    a.rpc.mockResolvedValue({ data: [row], error: null })
    expect(await getReadableAsset(a.value, asset)).toMatchObject({
      ok: true,
      asset: { id: asset },
    })
    expect(a.rpc).toHaveBeenLastCalledWith("community_members", {
      p_member: colleague,
      p_limit: 1,
    })
  })
  it("rejects deleted and unfinished peer assets before querying directory data", async () => {
    const a = actor()
    for (const data of [
      { ...readyAsset, deleted_at: "2026-11-01T00:00:00Z" },
      { ...readyAsset, upload_state: "processing" },
    ]) {
      a.single.mockResolvedValue({ data, error: null })
      expect(await getReadableAsset(a.value, asset)).toMatchObject({
        ok: false,
        status: 404,
      })
    }
    expect(a.rpc).not.toHaveBeenCalled()
  })
  it("signs only the currently visible colleague avatar with the bounded TTL", async () => {
    const a = actor()
    expect(await signAvatar(a.value, colleague)).toMatchObject({
      ok: false,
      status: 404,
    })
    expect(a.signed).not.toHaveBeenCalled()
    a.rpc.mockResolvedValue({ data: [row], error: null })
    expect(await signAvatar(a.value, colleague)).toMatchObject({ ok: true })
    expect(a.signed).toHaveBeenCalledWith(row.avatar_path, 60)
  })
})
