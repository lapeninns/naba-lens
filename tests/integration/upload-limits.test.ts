import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"

import * as tus from "tus-js-client"
import { beforeAll, describe, expect, it } from "vitest"

import { MEDIA_LIMITS } from "../../lib/config/media"
import { finaliseAsset } from "../../lib/server/media/finalise"
import { reserveAsset } from "../../lib/server/media/reserve"
import type { MediaActor } from "../../lib/server/media/types"
import { SUPABASE_TUS_CHUNK_SIZE, tusTransfer } from "../../lib/upload/tus"
import { actorFor, newKey } from "../slice/media-actor"
import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import { getLocalSupabaseEnv } from "../support/local-supabase"
import {
  blobFileReader,
  MemoryUrlStorage,
} from "../upload/helpers/node-adapters"

/**
 * Provider and bucket limits on the LOCAL stack (spec §4/§5 "verify provider and
 * bucket limits"), and the resumable path against the real storage server:
 *  - `media` bucket: private, 200 MiB `file_size_limit`, no MIME allow-list;
 *    `avatars`: private, 5 MiB, WebP only.
 *  - A real 200 MiB (209,715,200 B) video goes through TUS and finalises ready.
 *  - One byte more is refused by storage itself, not just by the app.
 *  - An interrupted TUS transfer resumes from the server's offset.
 * Hosted Supabase plans have their own global limit; see docs/media-pipeline.md.
 */

type Fixtures = { dir: string; files: Record<string, string> }
const MiB = 1024 * 1024

type Logged = { method: string; offset: string | null; bytes: number }

/** Records every TUS request the client sends (method, offset, body size). */
function loggingStack(log: Logged[]): tus.HttpStack {
  const inner = new tus.DefaultHttpStack({})
  return {
    getName: () => "logging",
    createRequest(method, url) {
      const request = inner.createRequest(method, url)
      const send = request.send.bind(request)
      request.send = (body) => {
        log.push({
          method,
          offset: request.getHeader("Upload-Offset") ?? null,
          bytes:
            body && typeof (body as { length?: number }).length === "number"
              ? (body as { length: number }).length
              : 0,
        })
        return send(body)
      }
      return request
    },
  }
}

describe("storage limits and TUS on the local stack", () => {
  const admin = serviceClient()
  const env = getLocalSupabaseEnv()
  const endpoint = `${env.url}/storage/v1/upload/resumable`
  let staff: TestIdentity
  let actor: MediaActor
  let fixtures: Fixtures

  async function token() {
    const { data } = await staff.client.auth.getSession()
    return data.session?.access_token ?? null
  }

  beforeAll(async () => {
    fixtures = JSON.parse(
      execFileSync(
        process.execPath,
        ["tests/fixtures/uploads/generate.mjs", "--big"],
        { encoding: "utf8", timeout: 300_000 }
      )
    ) as Fixtures
    const venue = await createVenue(admin, "upload-limits")
    staff = await createIdentity(admin, {
      label: "upload-limits",
      role: "staff",
      venueId: venue.id,
    })
    actor = await actorFor(staff)
  }, 320_000)

  it("buckets are private with the configured size and type limits", async () => {
    const media = await admin.storage.getBucket("media")
    const avatars = await admin.storage.getBucket("avatars")
    expect(media.data).toMatchObject({
      public: false,
      file_size_limit: MEDIA_LIMITS.maxVideoBytes,
      allowed_mime_types: null,
    })
    expect(avatars.data).toMatchObject({
      public: false,
      file_size_limit: 5 * 1024 * 1024, // 256px WebP derivatives; inputs are capped lower
      allowed_mime_types: ["image/webp"],
    })
  })

  it(
    "a 200 MiB video uploads over TUS in 6 MiB chunks and finalises ready",
    { timeout: 300_000 },
    async () => {
      const bytes = await readFile(fixtures.files.big_200mib_mp4)
      expect(bytes.byteLength).toBe(MEDIA_LIMITS.maxVideoBytes)
      const key = newKey()
      const reserved = await reserveAsset(actor, {
        idempotencyKey: key,
        filename: "big-200mib.mp4",
        sizeBytes: bytes.byteLength,
        contentType: "video/mp4",
        mediaType: "video",
        preferResumable: true,
      })
      if (!reserved.ok) throw new Error(reserved.message)
      expect(reserved.resumable).toBe(true)

      const log: Logged[] = []
      const started = Date.now()
      await tusTransfer({
        endpoint,
        file: new Blob([bytes]),
        assetId: reserved.assetId,
        bucket: "media",
        objectKey: reserved.objectKey,
        contentType: "video/mp4",
        getAccessToken: token,
        apiKey: env.publishableKey,
        chunkSize: SUPABASE_TUS_CHUNK_SIZE,
        retryDelays: [],
        onProgress: () => {},
        adapters: {
          urlStorage: new MemoryUrlStorage(),
          fileReader: blobFileReader,
          httpStack: loggingStack(log),
        },
      })
      const seconds = (Date.now() - started) / 1000
      const patches = log.filter((r) => r.method === "PATCH")
      expect(patches).toHaveLength(Math.ceil(bytes.byteLength / (6 * MiB)))
      expect(patches.reduce((n, r) => n + r.bytes, 0)).toBe(bytes.byteLength)

      const finalised = await finaliseAsset(actor, {
        assetId: reserved.assetId,
        idempotencyKey: key,
      })
      expect(finalised).toEqual({ ok: true, state: "ready" })
      const { data: row } = await admin
        .from("media_assets")
        .select("size_bytes, validated_mime_type, upload_state")
        .eq("id", reserved.assetId)
        .single()
      expect(row).toEqual({
        size_bytes: MEDIA_LIMITS.maxVideoBytes,
        validated_mime_type: "video/mp4",
        upload_state: "ready",
      })
      console.info(
        `200 MiB TUS upload: ${patches.length} PATCH requests in ${seconds.toFixed(1)} s`
      )
    }
  )

  it("storage itself refuses one byte over the limit, and reserve refuses it first", async () => {
    const over = MEDIA_LIMITS.maxVideoBytes + 1
    expect(
      await reserveAsset(actor, {
        idempotencyKey: newKey(),
        filename: "too-big.mp4",
        sizeBytes: over,
        contentType: "video/mp4",
        mediaType: "video",
        preferResumable: true,
      })
    ).toMatchObject({ ok: false, status: 400 })

    // Bypass the app: create a TUS upload for a key the staff member reserved
    // with a smaller declared size. The storage server checks Upload-Length.
    const reserved = await reserveAsset(actor, {
      idempotencyKey: newKey(),
      filename: "small.mp4",
      sizeBytes: 1000,
      contentType: "video/mp4",
      mediaType: "video",
      preferResumable: true,
    })
    if (!reserved.ok) throw new Error(reserved.message)
    const metadata = (o: Record<string, string>) =>
      Object.entries(o)
        .map(([k, v]) => `${k} ${Buffer.from(v).toString("base64")}`)
        .join(",")
    const create = async (length: number) =>
      fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${await token()}`,
          apikey: env.publishableKey,
          "tus-resumable": "1.0.0",
          "upload-length": String(length),
          "x-upsert": "false",
          "upload-metadata": metadata({
            bucketName: "media",
            objectName: reserved.objectKey,
            contentType: "video/mp4",
          }),
        },
      })
    const refused = await create(over)
    expect([refused.status, await refused.text()]).toEqual([
      413,
      expect.stringMatching(/maximum size exceeded/i),
    ])
    // The same request at exactly the limit is accepted (then abandoned).
    const accepted = await create(MEDIA_LIMITS.maxVideoBytes)
    expect(accepted.status).toBe(201)
  })

  it(
    "an interrupted TUS transfer resumes from the stored offset without resending finished chunks",
    { timeout: 120_000 },
    async () => {
      const bytes = await readFile(fixtures.files.tus_video_mp4)
      expect(bytes.byteLength).toBeGreaterThan(3 * 6 * MiB)
      const key = newKey()
      const reserved = await reserveAsset(actor, {
        idempotencyKey: key,
        filename: "tus-video.mp4",
        sizeBytes: bytes.byteLength,
        contentType: "video/mp4",
        mediaType: "video",
        preferResumable: true,
      })
      if (!reserved.ok) throw new Error(reserved.message)
      const urlStorage = new MemoryUrlStorage()
      const options = (
        log: Logged[],
        signal?: AbortSignal,
        onProgress: (f: number) => void = () => {}
      ) => ({
        endpoint,
        file: new Blob([bytes]),
        assetId: reserved.assetId,
        bucket: "media",
        objectKey: reserved.objectKey,
        contentType: "video/mp4",
        getAccessToken: token,
        apiKey: env.publishableKey,
        chunkSize: SUPABASE_TUS_CHUNK_SIZE,
        retryDelays: [],
        onProgress,
        signal,
        adapters: {
          urlStorage,
          fileReader: blobFileReader,
          httpStack: loggingStack(log),
        },
      })

      // First attempt: abort once two chunks are acknowledged.
      const firstLog: Logged[] = []
      const controller = new AbortController()
      const first = tusTransfer(
        options(firstLog, controller.signal, (f) => {
          if (f * bytes.byteLength >= 2 * 6 * MiB) controller.abort()
        })
      )
      await expect(first).rejects.toThrow("Upload cancelled")
      expect(urlStorage.entries.size).toBe(1)

      // Retry of the same asset (same fingerprint): HEAD, then PATCH from the offset.
      const secondLog: Logged[] = []
      await tusTransfer(options(secondLog))
      expect(secondLog[0].method).toBe("HEAD")
      expect(secondLog.some((r) => r.method === "POST")).toBe(false)
      const resumedAt = Number(
        secondLog.find((r) => r.method === "PATCH")!.offset
      )
      expect(resumedAt).toBeGreaterThanOrEqual(2 * 6 * MiB)
      const resent = secondLog
        .filter((r) => r.method === "PATCH")
        .reduce((n, r) => n + r.bytes, 0)
      expect(resent).toBe(bytes.byteLength - resumedAt)
      expect(urlStorage.entries.size).toBe(0)

      expect(
        await finaliseAsset(actor, {
          assetId: reserved.assetId,
          idempotencyKey: key,
        })
      ).toEqual({ ok: true, state: "ready" })
      const { data: stored } = await admin.storage
        .from("media")
        .download(reserved.objectKey)
      expect(Buffer.from(await stored!.arrayBuffer()).equals(bytes)).toBe(true)
    }
  )
})
