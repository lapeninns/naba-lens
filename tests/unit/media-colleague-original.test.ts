import { beforeEach, describe, expect, it, vi } from "vitest"

import { listCommunityMedia } from "@/lib/server/community"
import { getReadableAsset, streamOriginal } from "@/lib/server/media/access"
import { fetchMediaObject } from "@/lib/server/media/storage"
import type { MediaActor } from "@/lib/server/media/types"

import { box, phoneVideo } from "./fixtures/iso-bmff"

vi.mock("@/lib/server/media/storage", () => ({
  fetchMediaObject: vi.fn(),
  mediaRangeSource: vi.fn(),
}))

/** A phone video with a location box (©xyz) and Apple location keys. */
const FILE = phoneVideo()
const LOCATION = "+51.5074-000.1278/"

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
  size_bytes: FILE.byteLength,
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
  size_bytes: FILE.byteLength,
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

beforeEach(async () => {
  const storage = await import("@/lib/server/media/storage")
  vi.mocked(storage.mediaRangeSource).mockImplementation(
    (_env, _key, size) => ({
      size,
      read: async (offset, length) => FILE.subarray(offset, offset + length),
    })
  )
  vi.mocked(fetchMediaObject).mockImplementation(async (_env, _key, range) => {
    const m = range?.match(/^bytes=(\d+)-(\d+)$/)
    const [from, to] = m
      ? [Number(m[1]), Number(m[2])]
      : [0, FILE.byteLength - 1]
    return new Response(FILE.slice(from, to + 1), {
      status: range ? 206 : 200,
      headers: range
        ? {
            "content-length": String(to - from + 1),
            "content-range": `bytes ${from}-${to}/${FILE.byteLength}`,
          }
        : { "content-length": String(FILE.byteLength) },
    })
  })
})

const text = async (response: Response) =>
  Buffer.from(await response.arrayBuffer()).toString("latin1")

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
    expect(part.headers.get("content-range")).toBe(
      `bytes 0-9/${FILE.byteLength}`
    )
    expect(part.headers.get("accept-ranges")).toBe("bytes")
    expect(part.headers.get("content-type")).toBe("video/mp4")
    expect(part.headers.get("cache-control")).toBe("private, no-store")
    expect(part.headers.get("x-content-type-options")).toBe("nosniff")
    for (const response of [whole, part])
      expect([...response.headers].join(" ")).not.toContain("Anna")
  })

  it("strips location and device boxes from a colleague's stream, keeping its length (FA-24)", async () => {
    const a = actor({ id: viewer, role: "staff" }).value
    const colleague = await readable(a)
    const whole = await streamOriginal(a, colleague, null)
    const body = await text(whole)
    expect(body).toHaveLength(FILE.byteLength)
    expect(Buffer.from(FILE).toString("latin1")).toContain(LOCATION)
    // Blanked: renamed free and zeroed, so nothing of the location is left.
    expect(body).not.toContain(LOCATION)
    expect(body).not.toMatch(/udta|xmpmeta|Apple|iPhone/)
    expect(body).toContain("moov")
    expect(body).toContain("mdat")

    // Every Range lines up with the stripped whole.
    for (const [from, to] of [
      [0, 9],
      [30, 70],
      [FILE.byteLength - 12, FILE.byteLength - 1],
    ]) {
      const part = await streamOriginal(a, colleague, `bytes=${from}-${to}`)
      expect(await text(part)).toBe(body.slice(from, to + 1))
    }
  })

  it("refuses a colleague a video it cannot read as MP4", async () => {
    const a = actor({ id: viewer, role: "staff" }).value
    const colleague = await readable(a)
    const storage = await import("@/lib/server/media/storage")
    vi.mocked(storage.mediaRangeSource).mockImplementation(
      (_env, _key, size) => ({
        size,
        read: async () => box("bad!", new Uint8Array(0)).subarray(0, 4),
      })
    )
    const response = await streamOriginal(
      a,
      { ...colleague, id: "20000000-0000-4000-8000-0000000000ff" },
      null
    )
    expect(response.status).toBe(404)
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
      const response = await streamOriginal(a.value, own, null)
      expect(response.status).toBe(200)
      // The original, byte for byte.
      expect(Buffer.from(await response.arrayBuffer())).toEqual(
        Buffer.from(FILE)
      )
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
