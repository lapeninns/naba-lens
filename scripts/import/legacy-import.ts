/**
 * Legacy import (FA-54; spec §20 steps 3-5 and 7; docs/legacy-import.md).
 *
 * For each manifest row: hash the file (SHA-256, as finalise stores it,
 * FA-35); skip and record an exact duplicate of a live photo or video at the
 * same venue; otherwise store the original under the upload pipeline's key,
 * validate it and write its preview and thumbnail with the pipeline's own
 * code (lib/media, recordRenditions, the archive receipt), and finish it
 * through public.legacy_import_complete, which runs finalise's core. Every
 * import is awaiting review; a legacy label naming exactly one current dish,
 * place or amenity is staged as a label for review, else kept as a note.
 *
 * Dry run by default: reads only, and reports what --apply would do.
 * Idempotent: a manifest is one batch (by its SHA-256), and a line already
 * recorded in the batch is reported as unchanged. A line that failed after
 * its reservation and whose reservation the 24-hour cleanup has since
 * tombstoned is tried again at its next attempt id (S5-R3, review Y6).
 */
import { createHash } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import { basename, join, resolve, sep } from "node:path"

import type { SupabaseClient } from "@supabase/supabase-js"

import { maxBytesFor, MEDIA_LIMITS } from "../../lib/config/media"
import { mediaObjectKeys, STORAGE_BUCKETS } from "../../lib/config/storage"
import type { Database } from "../../lib/db/types"
import { sniffMedia, validateMedia } from "../../lib/media"
import {
  imageCaptureTime,
  quickTimeCaptureTime,
} from "../../lib/media/capture-time"
import { ensureMediaOriginalArchived } from "../../lib/server/archive"
import { recordRenditions, tooLong } from "../../lib/server/media/finalise"
import {
  amenityWords,
  matchLegacyLabel,
  type LabelCandidate,
  type LabelMatch,
  type SubjectKind,
} from "./labels"
import {
  parseManifest,
  type ManifestProblem,
  type ManifestRow,
} from "./manifest"

type Service = SupabaseClient<Database>

export type ImportOptions = {
  service: Service
  /** The folder the manifest's paths are relative to. */
  folder: string
  /** The manifest's text (its SHA-256 identifies the batch). */
  manifest: string
  /** Shown in the Library's Imported filter; defaults to the manifest name. */
  label: string
  /** The importing admin's email (an active admin account). */
  adminEmail: string
  apply: boolean
  now?: Date
}

export type Outcome =
  | "imported"
  | "duplicate"
  | "unchanged"
  | "failed"
  | "would_import"
  | "would_skip_duplicate"

export type ResultRow = {
  line: number
  file: string
  venue: string
  outcome: Outcome
  /** Why it failed, or what an unchanged line was recorded as. */
  detail: string
  assetId: string
  duplicateOf: string
  label: string
  labelMatch: string
  capturedAt: string
  capturedSource: "supplied" | "metadata" | "unknown" | ""
  contributor: string
}

export type ImportReport = {
  apply: boolean
  batchId: string | null
  manifestSha256: string
  rows: ResultRow[]
  counts: Record<Outcome, number>
}

const sha256 = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex")

/**
 * A stable asset id for a manifest line (a rerun finds the same row).
 * Attempt 0 is the line's first reservation; a later attempt is used only
 * once every earlier one was tombstoned by cleanup (S5-R3, review Y6), so the
 * ids stay derived from batch and line and a rerun still finds its row.
 */
export function importAssetId(
  batchId: string,
  line: number,
  attempt = 0
): string {
  const seed =
    attempt === 0
      ? `nabalens-legacy-import:${batchId}:${line}`
      : `nabalens-legacy-import:${batchId}:${line}:${attempt}`
  const h = sha256(seed).slice(0, 32)
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

type Context = {
  adminId: string | null
  contributors: Record<string, { id: string; role: string; active: boolean }>
  venues: Record<string, { id: string; name: string; active: boolean }>
}

async function readContext(
  service: Service,
  adminEmail: string,
  rows: ManifestRow[]
): Promise<Context> {
  const emails = [
    ...new Set(
      rows.flatMap((r) => (r.contributorEmail ? [r.contributorEmail] : []))
    ),
  ]
  const venues = [...new Set(rows.map((r) => r.venue))]
  const { data, error } = await service.rpc("legacy_import_context", {
    p_admin_email: adminEmail,
    p_emails: emails,
    p_venues: venues,
  })
  if (error)
    throw new Error(`Could not read venues and accounts: ${error.message}`)
  return data as unknown as Context
}

async function readCandidates(
  service: Service,
  venueId: string
): Promise<LabelCandidate[]> {
  const candidates: LabelCandidate[] = []
  const versions = await service
    .from("menu_versions")
    .select("id")
    .eq("venue_id", venueId)
    .eq("status", "active")
  if (versions.error) throw new Error("Could not read the active menu.")
  const versionIds = (versions.data ?? []).map((v) => v.id)
  if (versionIds.length > 0) {
    const [entries, items] = await Promise.all([
      service
        .from("menu_entries")
        .select("item_id, name, aliases")
        .in("version_id", versionIds),
      service
        .from("menu_items")
        .select("id")
        .eq("venue_id", venueId)
        .is("archived_at", null),
    ])
    if (entries.error || items.error)
      throw new Error("Could not read the menu.")
    const live = new Set((items.data ?? []).map((i) => i.id))
    const byItem = new Map<string, string[]>()
    for (const e of entries.data ?? []) {
      if (!live.has(e.item_id)) continue
      const names = byItem.get(e.item_id) ?? []
      names.push(e.name, ...((e.aliases as string[] | null) ?? []))
      byItem.set(e.item_id, names)
    }
    for (const [id, names] of byItem)
      candidates.push({ kind: "dish", id, names })
  }
  const [places, checks] = await Promise.all([
    service
      .from("knowledge_subjects")
      .select("id, label")
      .eq("venue_id", venueId)
      .is("retired_at", null),
    service
      .from("venue_amenity_checks")
      .select("id, template_key")
      .eq("venue_id", venueId)
      .eq("status", "active"),
  ])
  if (places.error || checks.error) throw new Error("Could not read places.")
  // Only questions on the venue's working list have an amenity queue
  // (private.knowledge_in_scope); an off-list check is neither offered nor
  // counted towards an ambiguous match (S5-R3, review Y5).
  const working = await service
    .from("knowledge_working_list")
    .select("question_key")
    .eq("venue_id", venueId)
    .is("disabled_at", null)
  if (working.error) throw new Error("Could not read the working list.")
  const inScope = new Set((working.data ?? []).map((w) => w.question_key))
  for (const p of places.data ?? [])
    candidates.push({ kind: "place", id: p.id, names: [p.label] })
  for (const c of checks.data ?? []) {
    if (!inScope.has(c.template_key)) continue
    candidates.push({
      kind: "amenity",
      id: c.id,
      names: [amenityWords(c.template_key)],
    })
  }
  return candidates
}

const describeMatch = (match: LabelMatch) =>
  match.state === "matched"
    ? `${match.kind}:${match.id}`
    : match.state === "ambiguous"
      ? `ambiguous (${match.count} subjects); kept as note`
      : match.state === "none"
        ? "no current subject; kept as note"
        : ""

type Prepared = {
  bytes: Uint8Array
  size: number
  hash: string
  kind: "image" | "video"
  ext: string
}

/** Reads one file inside the folder: size limits first, then the bytes. */
async function readSource(folder: string, file: string): Promise<Prepared> {
  const root = resolve(folder)
  const path = resolve(root, file)
  if (path !== root && !path.startsWith(root + sep))
    throw new Error("outside the import folder")
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) throw new Error("file not found")
  if (info.size === 0) throw new Error("file is empty")
  if (info.size > MEDIA_LIMITS.maxVideoBytes)
    throw new Error("file is too large")
  const bytes = new Uint8Array(await readFile(path))
  const type = sniffMedia(bytes.subarray(0, MEDIA_LIMITS.sniffHeadBytes))
  if (!type) throw new Error("not a supported photo or video")
  if (bytes.byteLength > maxBytesFor(type.kind))
    throw new Error(
      `${type.kind === "image" ? "photos" : "videos"} can be up to ${Math.round(maxBytesFor(type.kind) / (1024 * 1024))} MB`
    )
  return {
    bytes,
    size: bytes.byteLength,
    hash: sha256(bytes),
    kind: type.kind,
    ext: type.ext,
  }
}

type Validated = {
  mime: string
  width?: number
  height?: number
  durationSeconds?: number
  preview?: Uint8Array
  thumb?: Uint8Array
  capturedAt: Date | null
}

/** The pipeline's validation (lib/media), as finalise runs it. */
async function validate(
  folder: string,
  row: ManifestRow,
  file: Prepared
): Promise<Validated> {
  if (file.kind === "image") {
    const result = await validateMedia({
      bytes: file.bytes,
      size: file.size,
      declaredMime: "",
      filename: basename(row.file),
    })
    if (!result.ok) throw new Error(result.error)
    if (result.kind !== "image" || !("preview" in result))
      throw new Error("type_mismatch")
    return {
      mime: result.mime,
      width: result.width,
      height: result.height,
      preview: result.preview,
      thumb: result.thumb,
      capturedAt: imageCaptureTime(file.bytes),
    }
  }
  const result = await validateMedia({
    source: join(resolve(folder), row.file),
    size: file.size,
    declaredMime: "",
    filename: basename(row.file),
  })
  if (!result.ok) throw new Error(result.error)
  if (result.kind !== "video") throw new Error("type_mismatch")
  const durationSeconds =
    "durationSeconds" in result ? result.durationSeconds : undefined
  if (tooLong(durationSeconds)) throw new Error("video_too_long")
  return {
    mime: result.mime,
    width: "width" in result ? result.width : undefined,
    height: "height" in result ? result.height : undefined,
    durationSeconds,
    capturedAt: quickTimeCaptureTime(
      "creationTime" in result ? result.creationTime : undefined
    ),
  }
}

const empty = (): Record<Outcome, number> => ({
  imported: 0,
  duplicate: 0,
  unchanged: 0,
  failed: 0,
  would_import: 0,
  would_skip_duplicate: 0,
})

export async function runLegacyImport(
  options: ImportOptions
): Promise<ImportReport> {
  const { service, apply } = options
  const now = options.now ?? new Date()
  const manifestSha256 = sha256(options.manifest)
  const parsed = parseManifest(options.manifest, now)
  const context = await readContext(service, options.adminEmail, parsed.rows)
  const adminId = context.adminId
  if (!adminId)
    throw new Error("--admin must be the email of an active admin account.")

  // The batch: read in a dry run, created (or found) by --apply.
  let batchId: string | null = null
  if (apply) {
    const { data, error } = await service.rpc("legacy_import_begin", {
      p_admin: adminId,
      p_manifest_sha256: manifestSha256,
      p_label: options.label,
      p_source_folder: basename(resolve(options.folder)),
    })
    if (error) throw new Error(`Could not start the batch: ${error.message}`)
    batchId = data as string
  } else {
    const { data, error } = await service
      .from("media_import_batches")
      .select("id")
      .eq("manifest_sha256", manifestSha256)
      .maybeSingle()
    if (error) throw new Error("Could not read earlier imports.")
    batchId = data?.id ?? null
  }

  const recorded = new Map<number, { outcome: string; asset_id: string }>()
  if (batchId) {
    const { data, error } = await service
      .from("media_import_items")
      .select("line_no, outcome, asset_id")
      .eq("batch_id", batchId)
    if (error) throw new Error("Could not read earlier imports.")
    for (const item of data ?? []) recorded.set(item.line_no, item)
  }

  const rows: ResultRow[] = []
  const counts = empty()
  const push = (row: ResultRow) => {
    rows.push(row)
    counts[row.outcome]++
  }
  for (const problem of parsed.problems) push(problemRow(problem))

  const candidates = new Map<string, LabelCandidate[]>()
  /** venue|hash -> asset id or "line N" (this run's dry-run imports). */
  const seen = new Map<string, string>()

  for (const row of parsed.rows) {
    const base: ResultRow = {
      line: row.line,
      file: row.file,
      venue: row.venue,
      outcome: "failed",
      detail: "",
      assetId: "",
      duplicateOf: "",
      label: row.legacyLabel ?? "",
      labelMatch: "",
      capturedAt: "",
      capturedSource: "",
      contributor: row.contributorEmail ?? "",
    }
    const earlier = recorded.get(row.line)
    if (earlier) {
      push({
        ...base,
        outcome: "unchanged",
        detail: `recorded as ${earlier.outcome}`,
        assetId: earlier.outcome === "imported" ? earlier.asset_id : "",
        duplicateOf: earlier.outcome === "duplicate" ? earlier.asset_id : "",
      })
      continue
    }
    const venue = context.venues[row.venue]
    if (!venue) {
      push({ ...base, detail: "venue not found" })
      continue
    }
    const contributor = row.contributorEmail
      ? (context.contributors[row.contributorEmail] ?? null)
      : null

    let file: Prepared
    try {
      file = await readSource(options.folder, row.file)
    } catch (error) {
      push({ ...base, detail: (error as Error).message })
      continue
    }

    const key = `${venue.id}|${file.hash}`
    let duplicateOf = seen.get(key) ?? null
    if (!duplicateOf) {
      const { data, error } = await service
        .from("media_assets")
        .select("id")
        .eq("venue_id", venue.id)
        .eq("content_sha256", file.hash)
        .eq("upload_state", "ready")
        .is("deleted_at", null)
        .order("created_at")
        .order("id")
        .limit(1)
      if (error) {
        push({ ...base, detail: "could not check for duplicates" })
        continue
      }
      duplicateOf = data?.[0]?.id ?? null
    }
    if (duplicateOf) {
      // A dry run only reports it (this run's own planned imports are
      // "line N"); --apply records it against the earlier asset.
      if (!apply) {
        push({ ...base, outcome: "would_skip_duplicate", duplicateOf })
        continue
      }
      const { error } = await service.rpc("legacy_import_record_duplicate", {
        p_batch_id: batchId!,
        p_line_no: row.line,
        p_file_path: row.file,
        p_venue_id: venue.id,
        p_content_sha256: file.hash,
        p_duplicate_of: duplicateOf,
        p_contributor_email: row.contributorEmail ?? undefined,
        p_contributor_id: contributor?.id,
        p_captured_at: row.capturedAt?.toISOString(),
        p_legacy_label: row.legacyLabel ?? undefined,
        p_legacy_folder: row.legacyFolder ?? undefined,
      })
      push(
        error
          ? { ...base, detail: "could not record the duplicate" }
          : { ...base, outcome: "duplicate", duplicateOf }
      )
      continue
    }

    let validated: Validated
    try {
      validated = await validate(options.folder, row, file)
    } catch (error) {
      push({
        ...base,
        detail: `could not be used (${(error as Error).message})`,
      })
      continue
    }
    const captured: Pick<ResultRow, "capturedAt" | "capturedSource"> =
      row.capturedAt
        ? {
            capturedAt: row.capturedAt.toISOString(),
            capturedSource: "supplied",
          }
        : validated.capturedAt
          ? {
              capturedAt: validated.capturedAt.toISOString(),
              capturedSource: "metadata",
            }
          : { capturedAt: "", capturedSource: "unknown" }

    if (!candidates.has(venue.id)) {
      try {
        candidates.set(venue.id, await readCandidates(service, venue.id))
      } catch (error) {
        push({ ...base, ...captured, detail: (error as Error).message })
        continue
      }
    }
    // Places and amenities take photos only (as in the app).
    const usable = candidates
      .get(venue.id)!
      .filter((c) => file.kind === "image" || c.kind === "dish")
    const match = matchLegacyLabel(row.legacyLabel, usable)
    const staged: { kind: SubjectKind; id: string } | null =
      match.state === "matched" ? { kind: match.kind, id: match.id } : null

    if (!apply) {
      seen.set(key, `line ${row.line}`)
      push({
        ...base,
        ...captured,
        outcome: "would_import",
        labelMatch: describeMatch(match),
      })
      continue
    }

    const result = await importOne({
      service,
      adminId,
      batchId: batchId!,
      row,
      file,
      validated,
      venueId: venue.id,
      // The contributor holds the photo when they can still be reviewed as
      // an uploader (an active staff or manager account); otherwise the
      // importing admin does, and the contributor stays on the import item.
      uploaderId:
        contributor?.active &&
        (contributor.role === "staff" || contributor.role === "manager")
          ? contributor.id
          : adminId,
      contributorId: contributor?.id ?? null,
      captured,
      staged,
    })
    if (!result.ok) {
      push({ ...base, ...captured, detail: result.message })
      continue
    }
    if (result.outcome === "duplicate") {
      seen.set(key, result.assetId)
      push({ ...base, outcome: "duplicate", duplicateOf: result.assetId })
      continue
    }
    seen.set(key, result.assetId)
    push({
      ...base,
      ...captured,
      outcome: "imported",
      assetId: result.assetId,
      labelMatch: result.stagedKind
        ? `${result.stagedKind}:${result.stagedId}`
        : describeMatch(match.state === "matched" ? { state: "none" } : match),
    })
  }

  rows.sort((a, b) => a.line - b.line)
  return { apply, batchId, manifestSha256, rows, counts }
}

function problemRow(problem: ManifestProblem): ResultRow {
  return {
    line: problem.line,
    file: "",
    venue: "",
    outcome: "failed",
    detail: problem.message,
    assetId: "",
    duplicateOf: "",
    label: "",
    labelMatch: "",
    capturedAt: "",
    capturedSource: "",
    contributor: "",
  }
}

/** Reservations one line may use before the operator must start a new batch. */
const MAX_IMPORT_ATTEMPTS = 20

type OneResult =
  | {
      ok: true
      outcome: "imported" | "duplicate"
      assetId: string
      stagedKind: string | null
      stagedId: string | null
    }
  | { ok: false; message: string }

async function importOne(input: {
  service: Service
  adminId: string
  batchId: string
  row: ManifestRow
  file: Prepared
  validated: Validated
  venueId: string
  uploaderId: string
  contributorId: string | null
  captured: Pick<ResultRow, "capturedAt" | "capturedSource">
  staged: { kind: SubjectKind; id: string } | null
}): Promise<OneResult> {
  const { service, row, file, validated } = input
  const bucket = service.storage.from(STORAGE_BUCKETS.media)

  // 0. The line's reservation: the first attempt whose row is not
  //    tombstoned. A row cleanup tombstoned (a failed line left for more than
  //    24 hours) is closed for good: its objects are gone or going, and the
  //    storage guard refuses a new original at its key. The line moves on to
  //    its next attempt id instead (S5-R3, review Y6).
  const attempts = Array.from({ length: MAX_IMPORT_ATTEMPTS }, (_, k) =>
    importAssetId(input.batchId, row.line, k)
  )
  const rows = await service
    .from("media_assets")
    .select("id, deleted_at")
    .in("id", attempts)
  if (rows.error) return { ok: false, message: "could not read the asset" }
  const tombstoned = new Set(
    (rows.data ?? []).filter((r) => r.deleted_at).map((r) => r.id)
  )
  const assetId = attempts.find((id) => !tombstoned.has(id))
  if (!assetId)
    return {
      ok: false,
      message: `${MAX_IMPORT_ATTEMPTS} earlier attempts expired; import it under a new manifest`,
    }
  let keys = mediaObjectKeys(input.uploaderId, assetId, file.ext)

  // 1. The original, before the reservation: the storage write guard checks
  //    only keys that a reservation owns. A rerun finds it already stored.
  if (!rows.data?.some((r) => r.id === assetId)) {
    const stored = await bucket.upload(keys.original, file.bytes, {
      contentType: validated.mime,
      upsert: false,
    })
    if (stored.error && !/exists|duplicate/i.test(stored.error.message))
      return {
        ok: false,
        message: `could not store the original (${stored.error.message})`,
      }
  }

  // 2. The asset row ('uploading', legacy_import).
  const reserved = await service.rpc("legacy_import_reserve", {
    p_batch_id: input.batchId,
    p_asset_id: assetId,
    p_uploader: input.uploaderId,
    p_venue_id: input.venueId,
    p_media_type: file.kind,
    p_extension: file.ext,
    p_original_filename: basename(row.file),
    p_size_bytes: file.size,
  })
  if (reserved.error || !reserved.data?.[0])
    return {
      ok: false,
      message: `could not reserve the asset (${reserved.error?.message ?? "no row"})`,
    }

  // A rerun keeps the holder the first run chose (the row's own key), even
  // if the contributor's account changed in between.
  const holder = reserved.data[0].original_path.split("/")[0]
  if (holder && holder !== input.uploaderId)
    keys = mediaObjectKeys(holder, assetId, file.ext)

  if (reserved.data[0].upload_state !== "ready") {
    // 3. Archive receipt, derivatives and renditions, as finalise does.
    try {
      await ensureMediaOriginalArchived(service, assetId, {
        sizeBytes: file.size,
        mimeType: validated.mime,
      })
      if (validated.preview && validated.thumb) {
        for (const [key, body] of [
          [keys.preview, validated.preview],
          [keys.thumbnail, validated.thumb],
        ] as const) {
          const { error } = await bucket.upload(key, body, {
            contentType: "image/webp",
            cacheControl: String(MEDIA_LIMITS.signedUrlExpirySeconds),
            upsert: true,
          })
          if (error) throw new Error("derivative_upload")
        }
        await recordRenditions(
          { service },
          assetId,
          keys,
          validated.preview,
          validated.thumb
        )
      }
    } catch (error) {
      return {
        ok: false,
        message: `could not process the file; run again (${(error as Error).message})`,
      }
    }
  }

  // 4. Ready, capture time, staged label and the manifest line, together.
  const derivatives = Boolean(validated.preview && validated.thumb)
  const { data, error } = await service.rpc("legacy_import_complete", {
    p_admin: input.adminId,
    p_asset_id: assetId,
    p_line_no: row.line,
    p_file_path: row.file,
    p_validated_mime_type: validated.mime,
    p_size_bytes: file.size,
    p_width: validated.width,
    p_height: validated.height,
    p_duration_seconds:
      validated.durationSeconds === undefined
        ? undefined
        : Math.round(validated.durationSeconds * 1000) / 1000,
    p_preview_path: derivatives ? keys.preview : undefined,
    p_thumbnail_path: derivatives ? keys.thumbnail : undefined,
    p_content_sha256: file.hash,
    p_captured_at: input.captured.capturedAt || undefined,
    p_captured_source: input.captured.capturedSource || "unknown",
    p_contributor_email: row.contributorEmail ?? undefined,
    p_contributor_id: input.contributorId ?? undefined,
    p_manifest_captured_at: row.capturedAt?.toISOString(),
    p_legacy_label: row.legacyLabel ?? undefined,
    p_legacy_folder: row.legacyFolder ?? undefined,
    p_staged_kind: input.staged?.kind,
    p_staged_id: input.staged?.id,
  })
  const done = data?.[0]
  if (error || !done)
    return {
      ok: false,
      message: `could not finish the import; run again (${error?.message ?? "no row"})`,
    }
  if (done.outcome === "duplicate") {
    // The reservation was removed; its stored objects are left for cleanup,
    // which removes a deleted asset's objects. Best effort here.
    await bucket
      .remove([keys.original, keys.preview, keys.thumbnail])
      .catch(() => {})
  }
  return {
    ok: true,
    outcome: done.outcome as "imported" | "duplicate",
    assetId: done.asset_id,
    stagedKind: done.staged_kind,
    stagedId: done.staged_id,
  }
}

const CSV_COLUMNS: (keyof ResultRow)[] = [
  "line",
  "file",
  "venue",
  "outcome",
  "detail",
  "assetId",
  "duplicateOf",
  "label",
  "labelMatch",
  "capturedAt",
  "capturedSource",
  "contributor",
]

const HEADER: Record<keyof ResultRow, string> = {
  line: "line",
  file: "file",
  venue: "venue",
  outcome: "outcome",
  detail: "detail",
  assetId: "asset_id",
  duplicateOf: "duplicate_of",
  label: "legacy_label",
  labelMatch: "label_match",
  capturedAt: "captured_at",
  capturedSource: "captured_source",
  contributor: "contributor_email",
}

const csvCell = (value: unknown) => {
  const text = String(value ?? "")
  // A leading formula character is neutralised for spreadsheet apps.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** The result CSV: one row per manifest line, in line order. */
export function resultCsv(rows: readonly ResultRow[]): string {
  return (
    [
      CSV_COLUMNS.map((c) => HEADER[c]).join(","),
      ...rows.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c])).join(",")),
    ].join("\n") + "\n"
  )
}
