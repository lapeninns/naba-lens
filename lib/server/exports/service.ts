import { logger } from "@/lib/server/log/logger"
import "server-only"

import { randomUUID } from "node:crypto"

import type { MediaActor } from "@/lib/server/media/types"

import {
  EXPORT_MODES,
  EXPORT_PROFILE_KEYS,
  parseCandidates,
  parseOverview,
  parsePackageDetail,
  parsePackages,
  parseProfiles,
  type ExportCandidates,
  type ExportMode,
  type ExportPackageDetail,
  type ExportPackageSummary,
  type ExportProfile,
  type ExportProfileKey,
  type PublicationAction,
  type PublicationOverview,
  type SubjectKind,
} from "./model"

// S1-EXPORT services over the export and publication RPCs
// (20261118105200_export_publication_api.sql). Every call runs as the caller
// (actor.db): the database decides access, so a manager naming another
// venue's id gets export_not_allowed (AC13) and nothing else. Failures are
// values, never thrown; unexpected ones are logged redacted and become 503.

export type ExportFailure = {
  ok: false
  status: 400 | 403 | 404 | 409 | 503
  code: string
  message: string
}

type Result<T> = ({ ok: true } & T) | ExportFailure

type RpcError = { message?: string; code?: string } | null

/** Database exception → failure the screens show beside what failed. */
const KNOWN: Record<string, Omit<ExportFailure, "ok" | "code">> = {
  export_not_allowed: {
    status: 403,
    message: "You can't export from this venue.",
  },
  publication_not_allowed: {
    status: 403,
    message: "Only an admin can record where a photo is published.",
  },
  export_package_not_found: {
    status: 404,
    message: "This package could not be found. Reload the page.",
  },
  export_download_not_found: {
    status: 404,
    message: "This download could not be found.",
  },
  publication_destination_not_found: {
    status: 404,
    message: "This destination could not be found. Reload the page.",
  },
  media_asset_not_found: {
    status: 404,
    message: "This photo could not be found. Reload the page.",
  },
  export_item_unavailable: {
    status: 409,
    message:
      "A photo you chose can no longer be exported. Reload the page and choose again.",
  },
  export_item_invalid: { status: 400, message: "Choose photos to export." },
  export_items_invalid: {
    status: 400,
    message: "Choose between 1 and 200 photos.",
  },
  export_item_duplicate: {
    status: 400,
    message: "A photo was chosen twice. Reload the page and choose again.",
  },
  export_mode_invalid: { status: 400, message: "Choose public or internal." },
  export_profile_unknown: { status: 400, message: "Choose an output size." },
  export_profile_invalid: {
    status: 400,
    message: "Check the format, size and quality.",
  },
  export_size_invalid: {
    status: 400,
    message: "Enter a width and height between 64 and 8192 pixels.",
  },
  export_text_too_long: {
    status: 400,
    message:
      "Alt text can be up to 250 characters, a caption up to 500 and a note up to 200.",
  },
  export_files_invalid: {
    status: 400,
    message: "The download was incomplete.",
  },
  export_nothing_left: {
    status: 409,
    message:
      "Every photo in this package has been withdrawn. Make a new package instead.",
  },
  request_key_reused: {
    status: 409,
    message: "This was already sent with different details. Reload the page.",
  },
  invalid_request_key: {
    status: 400,
    message: "Reload the page and try again.",
  },
  stale_revision: {
    status: 409,
    message: "Someone else changed this first. Reload the page.",
  },
  publication_action_invalid: { status: 400, message: "Choose what happened." },
  publication_date_invalid: {
    status: 400,
    message: "Enter the date it happened: today or earlier.",
  },
  publication_text_invalid: {
    status: 400,
    message:
      "Check the address (starting https://), the reference (up to 200 characters) and the note (up to 500).",
  },
  publication_where_required: {
    status: 400,
    message: "Add the page address or a reference, so it can be found again.",
  },
  publication_not_eligible: {
    status: 409,
    message:
      "This photo is not approved for public use now, so it can't be marked Published.",
  },
  publication_nothing_published: {
    status: 409,
    message: "Nothing is recorded as published there yet.",
  },
  publication_scope_mismatch: {
    status: 400,
    message: "This destination belongs to a different venue.",
  },
  publication_destination_inactive: {
    status: 409,
    message: "This destination is switched off. Switch it on first.",
  },
  publication_destination_invalid: {
    status: 400,
    message: "Give the destination a name (and an address starting https://).",
  },
  publication_destination_exists: {
    status: 409,
    message: "A destination with this name already exists for this venue.",
  },
  publication_package_mismatch: {
    status: 400,
    message: "That package doesn't hold this photo.",
  },
}

export const UNAVAILABLE: ExportFailure = {
  ok: false,
  status: 503,
  code: "unavailable",
  message: "Couldn't reach the server. Try again in a moment.",
}

export function exportFailure(error: RpcError, op: string): ExportFailure {
  const message = error?.message ?? ""
  const known = KNOWN[message]
  if (known) return { ok: false, code: message, ...known }
  logger.error(`[exports] ${op} failed`, error?.code)
  return UNAVAILABLE
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: unknown): v is string =>
  typeof v === "string" && UUID.test(v)

const invalid = (code: string): ExportFailure => ({
  ok: false,
  code,
  ...(KNOWN[code] ?? { status: 400, message: "Check what you entered." }),
})

type Rpc = (
  fn: string,
  args?: Record<string, unknown>
) => PromiseLike<{ data: unknown; error: RpcError }>

// The generated types are regenerated by the coordinator; the RPC names are
// checked by the security tests instead.
const rpc = (actor: MediaActor): Rpc =>
  (actor.db as unknown as { rpc: Rpc }).rpc.bind(actor.db)

/** A fresh request key: one per user intent, replayed on retry. */
export const newRequestKey = () => `exp-${randomUUID()}`

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listExportProfiles(
  actor: MediaActor
): Promise<Result<{ profiles: ExportProfile[] }>> {
  const { data, error } = await rpc(actor)("export_profiles")
  if (error) return exportFailure(error, "export_profiles")
  return { ok: true, profiles: parseProfiles(data) }
}

export async function listExportCandidates(
  actor: MediaActor,
  venueId: unknown,
  mode: ExportMode = "public"
): Promise<Result<{ candidates: ExportCandidates }>> {
  if (!isUuid(venueId)) return KNOWN_NOT_ALLOWED
  const { data, error } = await rpc(actor)("export_candidates", {
    p_venue_id: venueId,
    p_mode: mode,
  })
  if (error) return exportFailure(error, "export_candidates")
  const candidates = parseCandidates(data)
  return candidates ? { ok: true, candidates } : UNAVAILABLE
}

const KNOWN_NOT_ALLOWED: ExportFailure = {
  ok: false,
  code: "export_not_allowed",
  ...KNOWN.export_not_allowed!,
}

export async function listExportPackages(
  actor: MediaActor,
  venueId: string | null = null
): Promise<Result<{ packages: ExportPackageSummary[] }>> {
  if (venueId !== null && !isUuid(venueId)) return KNOWN_NOT_ALLOWED
  const { data, error } = await rpc(actor)("export_packages_list", {
    p_venue_id: venueId,
    p_limit: 30,
  })
  if (error) return exportFailure(error, "export_packages_list")
  return { ok: true, packages: parsePackages(data) }
}

export async function getExportPackage(
  actor: MediaActor,
  packageId: unknown
): Promise<Result<{ pkg: ExportPackageDetail }>> {
  if (!isUuid(packageId)) return invalidNotFound
  const { data, error } = await rpc(actor)("export_package_detail", {
    p_package_id: packageId,
  })
  if (error) return exportFailure(error, "export_package_detail")
  const pkg = parsePackageDetail(data)
  return pkg ? { ok: true, pkg } : UNAVAILABLE
}

const invalidNotFound: ExportFailure = {
  ok: false,
  code: "export_package_not_found",
  ...KNOWN.export_package_not_found!,
}

export async function getPublicationOverview(
  actor: MediaActor,
  venueId: string | null = null
): Promise<Result<{ overview: PublicationOverview }>> {
  if (venueId !== null && !isUuid(venueId))
    return invalid("publication_not_allowed")
  const { data, error } = await rpc(actor)("publication_overview", {
    p_venue_id: venueId,
  })
  if (error) return exportFailure(error, "publication_overview")
  const overview = parseOverview(data)
  return overview ? { ok: true, overview } : UNAVAILABLE
}

// ---------------------------------------------------------------------------
// Commands (input is untrusted: it comes from a Server Function)
// ---------------------------------------------------------------------------

export type PackageItemInput = {
  assetId: string
  subjectKind: SubjectKind
  subjectId: string
  altText?: string | null
  caption?: string | null
}

export type CreatePackageInput = {
  requestKey: unknown
  mode: unknown
  profileKey: unknown
  items: unknown
  customWidth?: unknown
  customHeight?: unknown
  note?: unknown
}

const KEY = /^[A-Za-z0-9_-]{8,128}$/
const optionalText = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : null
const optionalInt = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null
  const n = typeof v === "string" ? Number(v) : v
  return typeof n === "number" && Number.isInteger(n) ? n : NaN
}

export function parseItemsInput(v: unknown): PackageItemInput[] | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > 200) return null
  const out: PackageItemInput[] = []
  for (const raw of v) {
    const o = raw as Record<string, unknown> | null
    if (!o || typeof o !== "object") return null
    const kind = o.subjectKind
    if (
      !isUuid(o.assetId) ||
      !isUuid(o.subjectId) ||
      (kind !== "menu_item" && kind !== "place" && kind !== "amenity")
    )
      return null
    out.push({
      assetId: o.assetId,
      subjectKind: kind,
      subjectId: o.subjectId,
      altText: optionalText(o.altText),
      caption: optionalText(o.caption),
    })
  }
  return out
}

export async function createExportPackage(
  actor: MediaActor,
  input: CreatePackageInput
): Promise<Result<{ packageId: string; itemCount: number }>> {
  if (typeof input.requestKey !== "string" || !KEY.test(input.requestKey))
    return invalid("invalid_request_key")
  if (!(EXPORT_MODES as readonly unknown[]).includes(input.mode))
    return invalid("export_mode_invalid")
  if (!(EXPORT_PROFILE_KEYS as readonly unknown[]).includes(input.profileKey))
    return invalid("export_profile_unknown")
  const items = parseItemsInput(input.items)
  if (!items) return invalid("export_items_invalid")
  const width = optionalInt(input.customWidth)
  const height = optionalInt(input.customHeight)
  if (Number.isNaN(width) || Number.isNaN(height))
    return invalid("export_size_invalid")
  const { data, error } = await rpc(actor)("export_package_create", {
    p_request_key: input.requestKey,
    p_mode: input.mode,
    p_profile_key: input.profileKey as ExportProfileKey,
    p_items: items,
    p_custom_width: width,
    p_custom_height: height,
    p_note: optionalText(input.note),
  })
  if (error) return exportFailure(error, "export_package_create")
  const row = data as { packageId?: unknown; itemCount?: unknown } | null
  if (!isUuid(row?.packageId) || typeof row?.itemCount !== "number")
    return UNAVAILABLE
  return { ok: true, packageId: row.packageId, itemCount: row.itemCount }
}

export async function rebuildExportPackage(
  actor: MediaActor,
  input: { requestKey: unknown; packageId: unknown }
): Promise<Result<{ packageId: string; removed: string[] }>> {
  if (typeof input.requestKey !== "string" || !KEY.test(input.requestKey))
    return invalid("invalid_request_key")
  if (!isUuid(input.packageId)) return invalidNotFound
  const { data, error } = await rpc(actor)("export_package_rebuild", {
    p_request_key: input.requestKey,
    p_package_id: input.packageId,
  })
  if (error) return exportFailure(error, "export_package_rebuild")
  const row = data as { packageId?: unknown; removed?: unknown } | null
  if (!isUuid(row?.packageId)) return UNAVAILABLE
  return {
    ok: true,
    packageId: row.packageId,
    removed: Array.isArray(row?.removed)
      ? row.removed.filter((x): x is string => typeof x === "string")
      : [],
  }
}

export async function setExportProfile(
  actor: MediaActor,
  input: {
    key: unknown
    label: unknown
    format: unknown
    maxWidth: unknown
    maxHeight: unknown
    quality: unknown
    revision: unknown
  }
): Promise<Result<{ changed: boolean }>> {
  if (!(EXPORT_PROFILE_KEYS as readonly unknown[]).includes(input.key))
    return invalid("export_profile_unknown")
  const label = typeof input.label === "string" ? input.label.trim() : ""
  const maxWidth = optionalInt(input.maxWidth)
  const maxHeight = optionalInt(input.maxHeight)
  const quality = optionalInt(input.quality)
  const revision = optionalInt(input.revision)
  if (
    !label ||
    !["original", "webp", "jpeg"].includes(input.format as string) ||
    Number.isNaN(maxWidth) ||
    Number.isNaN(maxHeight) ||
    Number.isNaN(quality) ||
    revision === null ||
    Number.isNaN(revision)
  )
    return invalid("export_profile_invalid")
  const { data, error } = await rpc(actor)("export_profile_set", {
    p_key: input.key,
    p_label: label,
    p_format: input.format,
    p_max_width: maxWidth,
    p_max_height: maxHeight,
    p_quality: quality,
    p_expected_revision: revision,
  })
  if (error) return exportFailure(error, "export_profile_set")
  return {
    ok: true,
    changed: (data as { changed?: unknown })?.changed === true,
  }
}

export async function saveDestination(
  actor: MediaActor,
  input: {
    destinationId: unknown
    venueId: unknown
    label: unknown
    url: unknown
    active: unknown
    revision: unknown
  }
): Promise<Result<{ id: string; changed: boolean }>> {
  const destinationId =
    input.destinationId === null || input.destinationId === ""
      ? null
      : input.destinationId
  const venueId =
    input.venueId === null || input.venueId === "" ? null : input.venueId
  if (
    (destinationId !== null && !isUuid(destinationId)) ||
    (venueId !== null && !isUuid(venueId)) ||
    typeof input.active !== "boolean"
  )
    return invalid("publication_destination_invalid")
  const revision = optionalInt(input.revision)
  if (Number.isNaN(revision)) return invalid("publication_destination_invalid")
  const { data, error } = await rpc(actor)("publication_destination_save", {
    p_destination_id: destinationId,
    p_venue_id: venueId,
    p_label: typeof input.label === "string" ? input.label : "",
    p_url: optionalText(input.url),
    p_active: input.active,
    p_expected_revision: revision,
  })
  if (error) return exportFailure(error, "publication_destination_save")
  const row = data as { id?: unknown; changed?: unknown } | null
  if (!isUuid(row?.id)) return UNAVAILABLE
  return { ok: true, id: row.id, changed: row.changed === true }
}

const ACTIONS: readonly PublicationAction[] = [
  "published",
  "withdrawal_requested",
  "withdrawn",
  "failed",
]
const DATE = /^\d{4}-\d{2}-\d{2}$/

export async function recordPublication(
  actor: MediaActor,
  input: {
    requestKey: unknown
    destinationId: unknown
    assetId: unknown
    action: unknown
    occurredOn: unknown
    externalUrl?: unknown
    externalRef?: unknown
    note?: unknown
    packageId?: unknown
  }
): Promise<Result<{ state: string | null; generation: number }>> {
  if (typeof input.requestKey !== "string" || !KEY.test(input.requestKey))
    return invalid("invalid_request_key")
  if (!isUuid(input.destinationId))
    return invalid("publication_destination_not_found")
  if (!isUuid(input.assetId)) return invalid("media_asset_not_found")
  if (!ACTIONS.includes(input.action as PublicationAction))
    return invalid("publication_action_invalid")
  if (typeof input.occurredOn !== "string" || !DATE.test(input.occurredOn))
    return invalid("publication_date_invalid")
  const packageId =
    input.packageId === undefined ||
    input.packageId === null ||
    input.packageId === ""
      ? null
      : input.packageId
  if (packageId !== null && !isUuid(packageId))
    return invalid("publication_package_mismatch")
  const { data, error } = await rpc(actor)("publication_record", {
    p_request_key: input.requestKey,
    p_destination_id: input.destinationId,
    p_asset_id: input.assetId,
    p_action: input.action,
    p_occurred_on: input.occurredOn,
    p_external_url: optionalText(input.externalUrl),
    p_external_ref: optionalText(input.externalRef),
    p_note: optionalText(input.note),
    p_package_id: packageId,
  })
  if (error) return exportFailure(error, "publication_record")
  const row = data as { state?: unknown; generation?: unknown } | null
  return {
    ok: true,
    state: typeof row?.state === "string" ? row.state : null,
    generation: typeof row?.generation === "number" ? row.generation : 0,
  }
}

/** Venues by name, for the admin's venue choice (RLS: admins read every venue). */
export async function listVenues(
  actor: MediaActor
): Promise<Result<{ venues: { id: string; name: string }[] }>> {
  const { data, error } = await actor.db
    .from("venues")
    .select("id, name")
    .order("name")
  if (error) return exportFailure(error, "venues")
  return {
    ok: true,
    venues: ((data ?? []) as Array<{ id: unknown; name: unknown }>)
      .filter(
        (v): v is { id: string; name: string } =>
          isUuid(v.id) && typeof v.name === "string"
      )
      .map((v) => ({ id: v.id, name: v.name })),
  }
}
