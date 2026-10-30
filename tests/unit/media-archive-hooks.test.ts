import { beforeEach, describe, expect, it, vi } from "vitest"

const archive = vi.hoisted(() => ({
  beforeReady: vi.fn(),
  beforeRemove: vi.fn(),
}))
vi.mock("@/lib/server/archive", () => ({
  ensureMediaOriginalArchived: archive.beforeReady,
  ensureArchiveBeforeRemoval: archive.beforeRemove,
}))
vi.mock("@/lib/server/lifecycle/cleanup", () => ({
  touchMediaReservation: async () => {},
}))
vi.mock("@/lib/server/media/storage", () => ({
  statMediaObject: async () => 4,
  mediaRangeSource: () => ({ read: async () => new Uint8Array([1, 2, 3, 4]) }),
}))
vi.mock("@/lib/media", () => ({
  sniffMedia: () => ({ kind: "image", mime: "image/jpeg" }),
  validateMedia: async () => ({
    ok: true,
    kind: "image",
    mime: "image/jpeg",
    width: 1,
    height: 1,
    preview: new Uint8Array([1]),
    thumb: new Uint8Array([2]),
  }),
}))

import { finaliseAsset } from "@/lib/server/media/finalise"
import type { MediaActor } from "@/lib/server/media/types"
import {
  storageRemover,
  type ServiceClient,
} from "@/lib/server/lifecycle/storage"

const id = "00000000-0000-4000-8000-000000000001"
function actorFixture() {
  const events: string[] = []
  const updates: Record<string, unknown>[] = []
  let deleted = false
  const asset = {
    id,
    uploader_id: "00000000-0000-4000-8000-000000000002",
    original_path: "owner/asset/original.jpg",
    original_filename: "food.jpg",
    media_type: "image",
    upload_state: "uploading",
    client_upload_key: "fixture-key",
    size_bytes: 4,
    updated_at: new Date().toISOString(),
  }
  const bucket = {
    upload: vi.fn(async () => ({ error: null })),
    remove: vi.fn(async () => {
      events.push("physical-remove")
      return { error: null }
    }),
  }
  const service = {
    storage: { from: () => bucket },
    from() {
      let patch: Record<string, unknown> | null = null
      const query = {
        select() {
          return query
        },
        eq() {
          return query
        },
        in() {
          return query
        },
        is() {
          return query
        },
        update(value: Record<string, unknown>) {
          patch = value
          return query
        },
        async maybeSingle() {
          return {
            error: null,
            data: {
              upload_state: asset.upload_state,
              deleted_at: deleted ? new Date().toISOString() : null,
            },
          }
        },
        then(resolve: (result: unknown) => unknown) {
          if (patch) {
            updates.push(patch)
            events.push(String(patch.upload_state))
            if (!deleted) asset.upload_state = String(patch.upload_state)
          }
          return Promise.resolve({
            error: null,
            data: deleted ? [] : [{ id }],
          }).then(resolve)
        },
      }
      return query
    },
  }
  const db = {
    from: () => ({
      select() {
        return this
      },
      eq() {
        return this
      },
      is() {
        return this
      },
      maybeSingle: async () => ({ data: { ...asset }, error: null }),
    }),
  }
  return {
    actor: {
      profile: { id: asset.uploader_id, role: "staff" },
      db,
      service,
      storage: { url: "http://fixture", serviceKey: "fixture" },
    } as unknown as MediaActor,
    service: service as unknown as ServiceClient,
    bucket,
    events,
    updates,
    deleteNow: () => {
      deleted = true
    },
  }
}
beforeEach(() => {
  vi.resetAllMocks()
})

describe("archive enforced at successful upload and physical deletion boundaries", () => {
  it("keeps failed archival retryable and never marks the file ready", async () => {
    const f = actorFixture()
    archive.beforeReady.mockRejectedValueOnce(
      new Error("destination unavailable")
    )
    expect(
      await finaliseAsset(f.actor, {
        assetId: id,
        idempotencyKey: "fixture-key",
      })
    ).toMatchObject({ ok: false, status: 503 })
    expect(f.updates.some((value) => value.upload_state === "ready")).toBe(
      false
    )
    expect(f.bucket.upload).not.toHaveBeenCalled()
    expect(f.bucket.remove).not.toHaveBeenCalled()
    expect(f.updates.at(-1)).toMatchObject({ upload_state: "failed" })
  })
  it("records the archive before returning ready", async () => {
    const f = actorFixture()
    archive.beforeReady.mockImplementationOnce(async () => {
      f.events.push("verified-archive")
    })
    expect(
      await finaliseAsset(f.actor, {
        assetId: id,
        idempotencyKey: "fixture-key",
      })
    ).toEqual({ ok: true, state: "ready" })
    expect(f.events.indexOf("verified-archive")).toBeLessThan(
      f.events.indexOf("ready")
    )
  })
  it("a concurrent deletion after archival never exposes a newly ready asset", async () => {
    const f = actorFixture()
    archive.beforeReady.mockImplementationOnce(async () => {
      f.events.push("verified-archive")
      f.deleteNow()
    })
    expect(
      await finaliseAsset(f.actor, {
        assetId: id,
        idempotencyKey: "fixture-key",
      })
    ).toMatchObject({ ok: false, status: 404 })
    expect(f.events.indexOf("verified-archive")).toBeLessThan(
      f.events.indexOf("physical-remove")
    )
  })
  it("refuses physical removal while archival is unavailable", async () => {
    const f = actorFixture()
    archive.beforeRemove.mockRejectedValueOnce(new Error("archive unavailable"))
    await expect(
      storageRemover(f.service)(["owner/asset/original.jpg"])
    ).rejects.toThrow("archive unavailable")
    expect(f.bucket.remove).not.toHaveBeenCalled()
  })
  it("performs the archive guard before deleting stored bytes", async () => {
    const f = actorFixture()
    archive.beforeRemove.mockImplementationOnce(async () => {
      f.events.push("verified-archive")
    })
    await storageRemover(f.service)(["owner/asset/original.jpg"])
    expect(f.events).toEqual(["verified-archive", "physical-remove"])
  })
})
