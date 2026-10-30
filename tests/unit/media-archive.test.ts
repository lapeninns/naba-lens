import { describe, expect, it, vi } from "vitest"

import { readArchiveConfig } from "@/lib/server/archive/config"
import {
  archiveOriginal,
  sha256,
  type ArchiveDeps,
  type RetainedOriginalReceipt,
  type ArchiveSource,
} from "@/lib/server/archive/core"

const project = "abcdefghijklmnopqrst"
const source: ArchiveSource = {
  assetId: "00000000-0000-4000-8000-000000000001",
  uploaderId: "00000000-0000-4000-8000-000000000002",
  venueId: "00000000-0000-4000-8000-000000000003",
  uploaderName: "Kitchen staff",
  venueName: "Old Crown",
  originalFilename: "food.jpg",
  originalPath: "uploader/asset/original.jpg",
  mediaType: "image",
  mimeType: "image/jpeg",
  sizeBytes: 4,
  uploadedAt: "2026-10-30T12:00:00Z",
}

function harness() {
  const bytes = new Uint8Array([1, 2, 3, 4])
  const objects = new Map<string, Uint8Array>()
  const receipts: RetainedOriginalReceipt[] = []
  const dispose = vi.fn(async () => {})
  const verify = async (key: string, hash: string, size: number) => {
    const body = objects.get(key)
    if (!body || body.byteLength !== size || sha256(body) !== hash)
      throw new Error("corrupt")
  }
  const deps: ArchiveDeps = {
    projectRef: project,
    prepare: vi.fn(async () => ({
      sha256: sha256(bytes),
      sizeBytes: 4,
      handle: bytes,
      dispose,
    })),
    store: {
      putOriginalIfAbsent: vi.fn(async (key, original) => {
        if (!objects.has(key)) objects.set(key, original.handle as Uint8Array)
      }),
      verifyOriginal: vi.fn(verify),
      putManifestIfAbsent: vi.fn(async (key, body) => {
        if (!objects.has(key)) objects.set(key, body)
      }),
      verifyManifest: vi.fn(verify),
    },
    record: vi.fn(async (receipt) => {
      receipts.push(receipt)
    }),
  }
  return { deps, objects, receipts, dispose }
}

describe("durable original retention", () => {
  it("deduplicates identical bytes but preserves each asset's immutable attribution", async () => {
    const h = harness()
    const one = await archiveOriginal(source, h.deps)
    const two = await archiveOriginal(
      {
        ...source,
        assetId: "00000000-0000-4000-8000-000000000004",
        originalFilename: "second.jpg",
      },
      h.deps
    )
    expect(one.blob_key).toBe(two.blob_key)
    expect(one.manifest_key).not.toBe(two.manifest_key)
    expect(
      [...h.objects.keys()].filter((key) => key.includes("/blobs/"))
    ).toHaveLength(1)
    expect(h.receipts).toHaveLength(2)
    const recovered = JSON.parse(
      new TextDecoder().decode(h.objects.get(one.manifest_key))
    )
    expect(recovered).toMatchObject({
      ...source,
      sourceProjectRef: project,
      sha256: one.sha256,
    })
    expect(h.dispose).toHaveBeenCalledTimes(2)
  })

  it("never records a verified copy when the destination is corrupt", async () => {
    const h = harness()
    h.deps.store.verifyOriginal = vi.fn(async () => {
      throw new Error("checksum")
    })
    await expect(archiveOriginal(source, h.deps)).rejects.toThrow("checksum")
    expect(h.deps.store.putManifestIfAbsent).not.toHaveBeenCalled()
    expect(h.receipts).toHaveLength(0)
    expect(h.dispose).toHaveBeenCalledOnce()
  })

  it("requires the attribution manifest read-back before the DB receipt", async () => {
    const h = harness()
    h.deps.store.verifyManifest = vi.fn(async () => {
      throw new Error("manifest corrupt")
    })
    await expect(archiveOriginal(source, h.deps)).rejects.toThrow(
      "manifest corrupt"
    )
    expect(h.receipts).toHaveLength(0)
    expect(h.dispose).toHaveBeenCalledOnce()
  })

  it("retains independently recoverable R2 attribution if DB receipt recording fails", async () => {
    const h = harness()
    h.deps.record = vi.fn(async () => {
      throw new Error("db unavailable")
    })
    await expect(archiveOriginal(source, h.deps)).rejects.toThrow(
      "db unavailable"
    )
    expect(
      [...h.objects.keys()].some((key) => key.includes("/manifests/"))
    ).toBe(true)
    expect(h.dispose).toHaveBeenCalledOnce()
  })

  it("fails before writes for changed source bytes and disposes temporary bytes", async () => {
    const h = harness()
    await expect(
      archiveOriginal({ ...source, sizeBytes: 5 }, h.deps)
    ).rejects.toThrow("source_mismatch")
    expect(h.deps.store.putOriginalIfAbsent).not.toHaveBeenCalled()
    expect(h.dispose).toHaveBeenCalledOnce()
  })

  it("refuses oversized media before fetching it", async () => {
    const h = harness()
    await expect(
      archiveOriginal({ ...source, sizeBytes: 201 * 1024 * 1024 }, h.deps)
    ).rejects.toThrow("invalid_size")
    expect(h.deps.prepare).not.toHaveBeenCalled()
  })
})

describe("archive deployment boundary", () => {
  const env = {
    MEDIA_ARCHIVE_MODE: "required",
    MEDIA_ARCHIVE_SOURCE_PROJECT_REF: project,
    NEXT_PUBLIC_SUPABASE_URL: `https://${project}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service-only",
    MEDIA_ARCHIVE_R2_ACCOUNT_ID: "a".repeat(32),
    MEDIA_ARCHIVE_R2_BUCKET: "fixture-private-archive",
    MEDIA_ARCHIVE_R2_ACCESS_KEY_ID: "fixture-key",
    MEDIA_ARCHIVE_R2_SECRET_ACCESS_KEY: "fixture-secret",
  }
  it("requires validated identity and an explicit mode on hosted deployments", () => {
    expect(() => readArchiveConfig({ VERCEL_ENV: "production" })).toThrow(
      "environment_not_configured"
    )
    expect(readArchiveConfig({})).toBeNull()
    expect(readArchiveConfig({ MEDIA_ARCHIVE_MODE: "disabled" })).toBeNull()
    expect(() => readArchiveConfig({ ...env, VERCEL_ENV: "preview" })).toThrow(
      "environment_not_configured"
    )
  })
  it("prohibits production disabled and rejects ambiguous source identity", () => {
    const hosted = {
      ...env,
      VERCEL_ENV: "production",
      NABALENS_ENVIRONMENT: "production",
      MEDIA_ARCHIVE_PRODUCTION_PROJECT_REF: project,
    }
    expect(readArchiveConfig(hosted)?.sourceProjectRef).toBe(project)
    expect(() =>
      readArchiveConfig({ ...hosted, MEDIA_ARCHIVE_MODE: "disabled" })
    ).toThrow("production_requires_retention")
    expect(() =>
      readArchiveConfig({
        ...hosted,
        NABALENS_ENVIRONMENT: "staging",
        MEDIA_ARCHIVE_MODE: "disabled",
      })
    ).toThrow("environment_project_mismatch")
    expect(() =>
      readArchiveConfig({
        ...hosted,
        MEDIA_ARCHIVE_PRODUCTION_PROJECT_REF: "u".repeat(20),
      })
    ).toThrow("environment_project_mismatch")
    expect(() =>
      readArchiveConfig({ ...hosted, NABALENS_ENVIRONMENT: "unknown" })
    ).toThrow("environment_not_configured")
  })
  it("allows explicitly disabled staging even on its Vercel production target", () => {
    expect(
      readArchiveConfig({
        VERCEL_ENV: "production",
        NABALENS_ENVIRONMENT: "staging",
        MEDIA_ARCHIVE_PRODUCTION_PROJECT_REF: "u".repeat(20),
        NEXT_PUBLIC_SUPABASE_URL: `https://${project}.supabase.co`,
        MEDIA_ARCHIVE_MODE: "disabled",
      })
    ).toBeNull()
  })
  it("pins the source project and R2 endpoint configuration", () => {
    expect(readArchiveConfig(env)?.sourceProjectRef).toBe(project)
    expect(() =>
      readArchiveConfig({ ...env, MEDIA_ARCHIVE_SOURCE_PROJECT_REF: "other" })
    ).toThrow("mismatch")
    expect(() =>
      readArchiveConfig({
        ...env,
        NEXT_PUBLIC_SUPABASE_URL: "https://attacker.example",
      })
    ).toThrow("mismatch")
    expect(() =>
      readArchiveConfig({ ...env, MEDIA_ARCHIVE_R2_SECRET_ACCESS_KEY: "" })
    ).toThrow("credentials")
  })
})
