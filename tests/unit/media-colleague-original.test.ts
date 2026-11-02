import { beforeEach, describe, expect, it, vi } from "vitest"

import { listCommunityMedia } from "@/lib/server/community"
import { getReadableAsset, streamOriginal } from "@/lib/server/media/access"
import { fetchMediaObject } from "@/lib/server/media/storage"
import type { MediaActor } from "@/lib/server/media/types"

vi.mock("@/lib/server/media/storage", () => ({ fetchMediaObject: vi.fn() }))

const viewer = "20000000-0000-4000-8000-000000000001"
const uploader = "20000000-0000-4000-8000-000000000002"
const asset = "20000000-0000-4000-8000-000000000003"
const filename = "Anna birthday at the Bell.mp4"

const readyVideo = {
  id: asset,
  uploader_id: uploader,
  media_type: "video",
  original_path: `${uploader}/${asset}/original.mp4`,
  thumbnail_path: null,
  preview_path: null,
  validated_mime_type: "video/mp4",
  size_bytes: 100,
  original_filename: filename,
  upload_state: "ready",
  deleted_at: null,
}

const checkedVideo = {
  id: asset,
  uploader_id: uploader,
  venue_id: "20000000-0000-4000-8000-000000000004",
  media_type: "video",
  validated_mime_type: "video/mp4",
  size_bytes: 100,
  width: null,
  height: null,
  duration_seconds: 3,
  has_preview: false,
  has_thumbnail: false,
  created_at: "2026-11-01T12:00:00.000Z",
}

function actor(profile: { id: string; role: "staff" | "admin" }) {
  const ownOrAdmin = profile.role === "admin" || profile.id === uploader
  const rpc = vi.fn().mockResolvedValue({ data: [checkedVideo], error: null })
  // Colleagues have no media_assets row access; only the definer RPC sees it.
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi
      .fn()
      .mockResolvedValue({ data: ownOrAdmin ? readyVideo : null, error: null }),
  }
  const serviceQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        original_path: readyVideo.original_path,
        preview_path: null,
        thumbnail_path: null,
      },
      error: null,
    }),
  }
  return {
    value: {
      profile: { ...profile, active: true },
      db: { rpc, from: vi.fn(() => query) },
      service: { from: vi.fn(() => serviceQuery) },
      storage: {},
    } as unknown as MediaActor,
    rpc,
  }
}

async function readable(a: MediaActor) {
  const found = await getReadableAsset(a, asset)
  if (!found.ok)
    throw new Error(`expected a readable asset, got ${found.status}`)
  return found.asset
}

beforeEach(() => {
  vi.mocked(fetchMediaObject).mockImplementation(
    async (_env, _key, range) =>
      new Response("0123456789", {
        status: range ? 206 : 200,
        headers: range
          ? { "content-length": "10", "content-range": "bytes 0-9/100" }
          : { "content-length": "100" },
      })
  )
})

describe("colleague video playback headers", () => {
  it("plays a colleague's video inline with no filename, Range unchanged", async () => {
    const colleague = await readable(actor({ id: viewer, role: "staff" }).value)
    expect(colleague.originalFilename).toBeNull()

    const whole = await streamOriginal(
      actor({ id: viewer, role: "staff" }).value,
      colleague,
      null
    )
    expect(whole.status).toBe(200)
    expect(whole.headers.get("content-disposition")).toBe("inline")

    const part = await streamOriginal(
      actor({ id: viewer, role: "staff" }).value,
      colleague,
      "bytes=0-9"
    )
    expect(part.status).toBe(206)
    expect(part.headers.get("content-disposition")).toBe("inline")
    expect(part.headers.get("content-range")).toBe("bytes 0-9/100")
    expect(part.headers.get("accept-ranges")).toBe("bytes")
    expect(part.headers.get("content-type")).toBe("video/mp4")
    expect(part.headers.get("cache-control")).toBe("private, no-store")
    expect(part.headers.get("x-content-type-options")).toBe("nosniff")
    for (const response of [whole, part])
      expect([...response.headers].join(" ")).not.toContain("Anna")
  })

  it("keeps the attachment filename for the owner and for admins", async () => {
    for (const profile of [
      { id: uploader, role: "staff" as const },
      { id: viewer, role: "admin" as const },
    ]) {
      const a = actor(profile)
      const own = await readable(a.value)
      expect(own.originalFilename).toBe(filename)
      expect(a.rpc).not.toHaveBeenCalled()
      const response = await streamOriginal(a.value, own, "bytes=0-9")
      expect(response.status).toBe(206)
      expect(response.headers.get("content-disposition")).toBe(
        `attachment; filename="Anna birthday at the Bell.mp4"; filename*=UTF-8''Anna%20birthday%20at%20the%20Bell.mp4`
      )
    }
  })
})

describe("community gallery items", () => {
  it("never carry the uploader's original filename", async () => {
    const a = actor({ id: viewer, role: "staff" })
    a.rpc.mockResolvedValue({
      data: [
        {
          id: asset,
          media_type: "image",
          has_thumbnail: true,
          has_preview: true,
          validated_mime_type: "image/jpeg",
          original_filename: "Private family party.jpg",
          created_at: "2026-11-01T12:00:00.000Z",
          uploader_id: uploader,
          contributor_name: "Sam Lee",
          venue_name: "Test venue",
          width: 10,
          height: 10,
          duration_seconds: null,
          size_bytes: 4,
        },
      ],
      error: null,
    })
    const result = await listCommunityMedia(a.value)
    expect(result).toMatchObject({
      ok: true,
      items: [
        { id: asset, originalFilename: null, contributorName: "Sam Lee" },
      ],
    })
    expect(JSON.stringify(result)).not.toContain("Private family party")
  })
})
