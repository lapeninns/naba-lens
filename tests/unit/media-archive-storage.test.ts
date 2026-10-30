import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"

import { afterEach, describe, expect, it, vi } from "vitest"

const sdk = vi.hoisted(() => ({
  send: vi.fn(),
  close: vi.fn(),
  options: vi.fn(),
}))
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    constructor(options: unknown) {
      sdk.options(options)
    }
    send = sdk.send
    destroy = sdk.close
  },
  PutObjectCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
  GetObjectCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
}))

import type { ArchiveConfig } from "@/lib/server/archive/config"
import { sha256, type ArchiveSource } from "@/lib/server/archive/core"
import {
  createArchiveStore,
  prepareOriginal,
} from "@/lib/server/archive/object-store"

const config: ArchiveConfig = {
  sourceUrl: "https://abcdefghijklmnopqrst.supabase.co",
  sourceProjectRef: "abcdefghijklmnopqrst",
  sourceServiceKey: "fixture-service",
  accountId: "a".repeat(32),
  bucket: "private-fixture",
  accessKeyId: "fixture-id",
  secretAccessKey: "fixture-secret",
}
const bytes = new Uint8Array([1, 2, 3, 4])
const source: ArchiveSource = {
  assetId: "asset",
  uploaderId: "owner",
  venueId: "venue",
  uploaderName: "Owner",
  venueName: "Venue",
  originalFilename: "food.jpg",
  originalPath: "owner/asset/original.jpg",
  mediaType: "image",
  mimeType: "image/jpeg",
  sizeBytes: 4,
  uploadedAt: "2026-10-30T00:00:00Z",
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("bounded original spool", () => {
  it("streams original bytes to a private temporary file, hashes them, then disposes it", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(bytes))
    vi.stubGlobal("fetch", fetcher)
    const prepared = await prepareOriginal(config, source)
    expect(prepared.sha256).toBe(sha256(bytes))
    expect(prepared.sizeBytes).toBe(4)
    expect(new Uint8Array(await readFile(prepared.handle as string))).toEqual(
      bytes
    )
    expect((await stat(prepared.handle as string)).mode & 0o777).toBe(0o600)
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      redirect: "error",
      cache: "no-store",
    })
    await prepared.dispose()
    await expect(stat(prepared.handle as string)).rejects.toMatchObject({
      code: "ENOENT",
    })
  })
  it("refuses shortened, oversized or unavailable originals", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(bytes))
    )
    await expect(
      prepareOriginal(config, { ...source, sizeBytes: 3 })
    ).rejects.toThrow("source_read_failed")
    await expect(
      prepareOriginal(config, { ...source, sizeBytes: 5 })
    ).rejects.toThrow("source_read_failed")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("secret body", { status: 404 }))
    )
    await expect(prepareOriginal(config, source)).rejects.toThrow(
      "source_read_failed"
    )
  })
})

describe("R2 immutable copy and verification", () => {
  it("uses the pinned R2 endpoint and conditional writes without unsupported SHA256 headers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "archive-sdk-test-"))
    const file = join(dir, "original")
    await writeFile(file, bytes)
    sdk.send.mockImplementation(async (command) => {
      const consumed: number[] = []
      for await (const chunk of command.input.Body as AsyncIterable<Uint8Array>)
        consumed.push(...chunk)
      expect(consumed).toEqual([...bytes])
      return {}
    })
    const store = createArchiveStore(config)
    try {
      await store.putOriginalIfAbsent(
        "content-key",
        {
          sha256: sha256(bytes),
          sizeBytes: 4,
          handle: file,
          dispose: async () => {},
        },
        "image/jpeg"
      )
      expect(sdk.options).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
          region: "auto",
          requestChecksumCalculation: "WHEN_REQUIRED",
        })
      )
      expect(sdk.send.mock.calls[0][0].input).toMatchObject({
        IfNoneMatch: "*",
        ContentLength: 4,
      })
      expect(sdk.send.mock.calls[0][0].input).not.toHaveProperty(
        "ChecksumSHA256"
      )
    } finally {
      store.close?.()
      await rm(dir, { recursive: true, force: true })
    }
  })
  it("permits only existing-object conditions to reach mandatory read-back", async () => {
    const store = createArchiveStore(config)
    sdk.send.mockRejectedValueOnce({ $metadata: { httpStatusCode: 412 } })
    await store.putManifestIfAbsent("key", bytes)
    sdk.send.mockRejectedValueOnce({
      name: "ObjectLockedByBucketPolicy",
      $metadata: { httpStatusCode: 409 },
    })
    await store.putManifestIfAbsent("key", bytes)
    sdk.send.mockRejectedValueOnce({
      name: "OtherConflict",
      $metadata: { httpStatusCode: 409 },
    })
    await expect(store.putManifestIfAbsent("key", bytes)).rejects.toThrow(
      "manifest_write_failed"
    )
    store.close?.()
  })
  it("reads and hashes stored content instead of trusting metadata/ETag", async () => {
    const store = createArchiveStore(config)
    sdk.send.mockResolvedValueOnce({
      Body: Readable.from([bytes]),
      ContentLength: 4,
      ETag: "wrong",
    })
    await store.verifyOriginal("key", sha256(bytes), 4)
    sdk.send.mockResolvedValueOnce({
      Body: Readable.from([new Uint8Array([9, 9, 9, 9])]),
      ContentLength: 4,
    })
    await expect(store.verifyOriginal("key", sha256(bytes), 4)).rejects.toThrow(
      "verification_failed"
    )
    sdk.send.mockResolvedValueOnce({
      Body: Readable.from([bytes]),
      ContentLength: 99,
    })
    await expect(store.verifyManifest("key", sha256(bytes), 4)).rejects.toThrow(
      "verification_failed"
    )
    store.close?.()
  })
})
