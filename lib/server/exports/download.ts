import "server-only"

import { createHash } from "node:crypto"

import { PRIVATE_HEADERS } from "@/lib/server/media/access"
import { fetchMediaObject } from "@/lib/server/media/storage"
import type { MediaActor } from "@/lib/server/media/types"

import {
  exportFilename,
  manifestCsv,
  parseProfile,
  RESTRICTION_WORDS,
  type ExportProfile,
  type ManifestRow,
} from "./model"
import { renderExportFile } from "./render"
import {
  exportFailure,
  isUuid,
  UNAVAILABLE,
  type ExportFailure,
} from "./service"
import { ZIP_MAX_BYTES, ZipWriter } from "./zip"

// S1-EXPORT download (§14.1, AC31, AC32). The order matters:
//   1. export_package_download_start, as the caller: rechecks access and
//      every item's eligibility. An item withdrawn since the package was made
//      invalidates the package; the caller gets 409 and no bytes.
//   2. Only then does the service role read the storage keys of exactly the
//      items the database returned (the media access pattern).
//   3. The ZIP streams one file at a time: the file, then manifest.json,
//      manifest.csv and READ-ME.txt. When it ends,
//      export_package_download_finish records what it held (Exported).
//      A failure records the download as failed and ends the stream with an
//      error, so a half-written ZIP is never recorded as Exported.

type StartItem = {
  position: number
  assetId: string
  venueId: string
  venueName: string
  sourceVenueId: string
  subjectKind: string
  subjectId: string
  subjectLabel: string
  category: string
  approvalKind: string
  approvalId: string
  approvalVersion: string
  approvalLevel: string
  filenameStem: string
  altText: string | null
  caption: string | null
  useRestrictions: string[]
  uploadedAt: string
  capturedAt: string | null
  captureTimeSource: string
}

type Started =
  | { state: "invalidated"; removed: string[] }
  | {
      state: "ready"
      downloadId: string
      packageId: string
      mode: "public" | "internal"
      profile: ExportProfile
      createdAt: string
      items: StartItem[]
    }

type Rpc = (
  fn: string,
  args?: Record<string, unknown>
) => PromiseLike<{
  data: unknown
  error: { message?: string; code?: string } | null
}>
const rpc = (actor: MediaActor): Rpc =>
  (actor.db as unknown as { rpc: Rpc }).rpc.bind(actor.db)

function parseStarted(data: unknown): Started | null {
  const o = data as Record<string, unknown> | null
  if (!o) return null
  if (o.state === "invalidated") {
    return {
      state: "invalidated",
      removed: Array.isArray(o.removed)
        ? o.removed.filter((x): x is string => typeof x === "string")
        : [],
    }
  }
  const profile = parseProfile(o.profile)
  if (
    o.state !== "ready" ||
    !isUuid(o.downloadId) ||
    !isUuid(o.packageId) ||
    (o.mode !== "public" && o.mode !== "internal") ||
    !profile ||
    typeof o.createdAt !== "string" ||
    !Array.isArray(o.items)
  )
    return null
  return {
    state: "ready",
    downloadId: o.downloadId,
    packageId: o.packageId,
    mode: o.mode,
    profile,
    createdAt: o.createdAt,
    items: o.items as StartItem[],
  }
}

type Source = {
  id: string
  original_path: string
  preview_path: string | null
  validated_mime_type: string | null
  size_bytes: number | null
  width: number | null
  height: number | null
}

async function readObject(actor: MediaActor, key: string): Promise<Uint8Array> {
  const res = await fetchMediaObject(actor.storage, key)
  if (!res.ok) {
    await res.arrayBuffer().catch(() => undefined)
    throw new Error(`storage_${res.status}`)
  }
  return new Uint8Array(await res.arrayBuffer())
}

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex")

export type DownloadOutcome =
  | { ok: true; response: Response }
  | ExportFailure
  | {
      ok: false
      status: 409
      code: "export_package_invalidated"
      message: string
      removed: string[]
    }

export const INVALIDATED_MESSAGE =
  "A photo in this package was withdrawn or changed after it was made, so it can't be downloaded. Rebuild it without that photo."

export async function startPackageDownload(
  actor: MediaActor,
  packageId: string
): Promise<DownloadOutcome> {
  if (!isUuid(packageId))
    return exportFailure({ message: "export_package_not_found" }, "download")
  const { data, error } = await rpc(actor)("export_package_download_start", {
    p_package_id: packageId,
  })
  if (error) return exportFailure(error, "export_package_download_start")
  const started = parseStarted(data)
  if (!started) return UNAVAILABLE
  if (started.state === "invalidated") {
    return {
      ok: false,
      status: 409,
      code: "export_package_invalidated",
      message: INVALIDATED_MESSAGE,
      removed: started.removed,
    }
  }

  // Step 2: storage keys for exactly the returned items (service role, after
  // the caller-scoped gate above).
  const ids = [...new Set(started.items.map((i) => i.assetId))]
  const { data: rows, error: readError } = await actor.service
    .from("media_assets")
    .select(
      "id, original_path, preview_path, validated_mime_type, size_bytes, width, height"
    )
    .in("id", ids)
    .eq("upload_state", "ready")
    .is("deleted_at", null)
  const sources = new Map(
    ((rows ?? []) as Source[]).map((r) => [r.id, r] as const)
  )
  if (readError || sources.size !== ids.length) {
    await finish(actor, started.downloadId, false)
    return UNAVAILABLE
  }
  if (started.profile.format === "original") {
    const total = started.items.reduce(
      (n, i) => n + Number(sources.get(i.assetId)?.size_bytes ?? 0),
      0
    )
    if (total > ZIP_MAX_BYTES) {
      await finish(actor, started.downloadId, false)
      return {
        ok: false,
        status: 409,
        code: "export_too_large",
        message:
          "These originals are too large for one ZIP. Make two smaller packages, or choose Website image.",
      }
    }
  }

  const stream = zipStream(actor, started, sources)
  const name = `naba-lens-export-${started.createdAt.slice(0, 10)}-${started.packageId.slice(0, 8)}.zip`
  return {
    ok: true,
    response: new Response(stream, {
      status: 200,
      headers: {
        ...PRIVATE_HEADERS,
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${name}"`,
      },
    }),
  }
}

async function finish(
  actor: MediaActor,
  downloadId: string,
  completed: boolean,
  files?: unknown[]
) {
  const { error } = await rpc(actor)("export_package_download_finish", {
    p_download_id: downloadId,
    p_completed: completed,
    p_files: completed ? files : null,
  })
  if (error) throw new Error(`finish_failed:${error.message ?? ""}`)
}

function readMe(mode: "public" | "internal", profile: ExportProfile): string {
  const lines = [
    "Naba-Lens export",
    "",
    "This package was exported. Exported does not mean published. When a file is used,",
    "an admin records where on the Publishing page, with the page address and the date.",
    "If you are not an admin, tell one where you put it.",
    "",
    "manifest.csv and manifest.json list every file with its photo id, venue, subject,",
    "approval, upload date and any use restrictions. The filename is not the record id.",
    "",
    profile.format === "original"
      ? "Originals are the unchanged files and may keep camera details, including location."
      : `Files were resized to fit ${profile.maxWidth} x ${profile.maxHeight} and carry no camera details or location.`,
  ]
  if (mode === "internal") {
    lines.push(
      "",
      "INTERNAL EXPORT: these files are not approved for public use."
    )
  }
  return `${lines.join("\r\n")}\r\n`
}

function zipStream(
  actor: MediaActor,
  started: Extract<Started, { state: "ready" }>,
  sources: Map<string, Source>
): ReadableStream<Uint8Array> {
  const zip = new ZipWriter(new Date(started.createdAt))
  const manifest: ManifestRow[] = []
  const files: unknown[] = []
  let index = 0
  let done = false

  const fail = async (
    controller: ReadableStreamDefaultController<Uint8Array>,
    e: unknown
  ) => {
    done = true
    console.error("[exports] zip failed", {
      code: e instanceof Error ? e.message.slice(0, 80) : "unknown",
    })
    await finish(actor, started.downloadId, false).catch(() => undefined)
    controller.error(new Error("export_failed"))
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (done) return
      try {
        if (index < started.items.length) {
          const item = started.items[index++]!
          const src = sources.get(item.assetId)!
          const mime = src.validated_mime_type ?? ""
          // HEIC: resized profiles read the stored preview (render.ts).
          const useSource =
            started.profile.format !== "original" &&
            mime === "image/heic" &&
            src.preview_path
              ? { key: src.preview_path, mime: "image/webp" }
              : { key: src.original_path, mime }
          const bytes = await readObject(actor, useSource.key)
          const out = await renderExportFile(
            {
              bytes,
              mime: useSource.mime,
              width: src.width,
              height: src.height,
            },
            started.profile
          )
          const file = exportFilename(item.filenameStem, out.ext)
          for (const chunk of zip.add(file, out.bytes))
            controller.enqueue(chunk)
          const digest = sha256(out.bytes)
          const renditionId = `${item.assetId}:${started.profile.key}:${out.format}:${out.width ?? "?"}x${out.height ?? "?"}`
          manifest.push({
            file,
            assetId: item.assetId,
            renditionId,
            venueId: item.venueId,
            venueName: item.venueName,
            sourceVenueId: item.sourceVenueId,
            subjectKind: item.subjectKind,
            subjectId: item.subjectId,
            subject: item.subjectLabel,
            category: item.category,
            approvalKind: item.approvalKind,
            approvalId: item.approvalId,
            approvalVersion: item.approvalVersion,
            approvalLevel: item.approvalLevel,
            capturedAt: item.capturedAt,
            captureTimeSource: item.captureTimeSource,
            uploadedAt: item.uploadedAt,
            useRestrictions: item.useRestrictions
              .map((r) => RESTRICTION_WORDS[r] ?? r)
              .join("; "),
            altText: item.altText,
            caption: item.caption,
            profile: started.profile.label,
            format: out.format,
            width: out.width,
            height: out.height,
            bytes: out.bytes.length,
            sha256: digest,
          })
          files.push({
            assetId: item.assetId,
            file,
            bytes: out.bytes.length,
            sha256: digest,
            width: out.width,
            height: out.height,
            format: out.format,
          })
          return
        }
        const json = new TextEncoder().encode(
          JSON.stringify(
            {
              packageId: started.packageId,
              mode: started.mode,
              profile: started.profile,
              state: "exported",
              note: "Exported is not Published.",
              files: manifest,
            },
            null,
            2
          )
        )
        for (const chunk of zip.add("manifest.json", json))
          controller.enqueue(chunk)
        for (const chunk of zip.add(
          "manifest.csv",
          new TextEncoder().encode(manifestCsv(manifest))
        ))
          controller.enqueue(chunk)
        for (const chunk of zip.add(
          "READ-ME.txt",
          new TextEncoder().encode(readMe(started.mode, started.profile))
        ))
          controller.enqueue(chunk)
        const end = zip.finish()
        await finish(actor, started.downloadId, true, files)
        done = true
        controller.enqueue(end)
        controller.close()
      } catch (e) {
        await fail(controller, e)
      }
    },
    async cancel() {
      if (!done) {
        done = true
        await finish(actor, started.downloadId, false).catch(() => undefined)
      }
    },
  })
}
