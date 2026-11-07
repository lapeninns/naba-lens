// Shared fixtures for the coverage database suites (coverage-*.test.ts).
// Assertions run as real signed-in identities through PostgREST; the service
// role only builds fixtures that need a chosen past instant (assets uploaded
// or items submitted in an earlier London month) and reads state back.
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"

import { expect } from "vitest"

import { markReady, type Db, type TestIdentity } from "../support/identities"

export const requestKey = () => `test-${randomUUID()}`

type RpcResult<T> = {
  data: T | null
  error: { code: string; message: string; details?: string } | null
}

export async function ok<T>(call: PromiseLike<RpcResult<T>>): Promise<T> {
  const { data, error } = await call
  if (error) {
    throw new Error(`${error.message} (${error.code}) ${error.details ?? ""}`)
  }
  return data as T
}

export async function fails(
  call: PromiseLike<RpcResult<unknown>>,
  message: string,
  code?: string
) {
  const { error } = await call
  expect(error, `expected ${message}`).not.toBeNull()
  expect(error!.message).toBe(message)
  if (code) expect(error!.code).toBe(code)
  return error!
}

/** "YYYY-MM-01" of the Europe/London month containing the instant. */
export function londonMonth(at: Date | string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(at))
  const year = parts.find((p) => p.type === "year")!.value
  const month = parts.find((p) => p.type === "month")!.value
  return `${year}-${month}-01`
}

export const currentMonth = () => londonMonth(new Date())

/** First day of the London month `offset` months from the current one. */
export function monthOffset(offset: number): string {
  const [y, m] = currentMonth().split("-").map(Number)
  const d = new Date(Date.UTC(y!, m! - 1 + offset, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`
}

/** A mid-month instant (the 15th, noon UTC) of a "YYYY-MM-01" month. */
export const midMonth = (month: string) => `${month.slice(0, 8)}15T12:00:00Z`

export const lastDay = (month: string) => {
  const [y, m] = month.split("-").map(Number)
  const d = new Date(Date.UTC(y!, m!, 0))
  return `${month.slice(0, 8)}${String(d.getUTCDate()).padStart(2, "0")}`
}

/**
 * A ready asset with a chosen upload instant (service role: the reservation
 * RPC always stamps now()). Same row shape as a real reservation.
 */
export async function insertAsset(
  service: Db,
  opts: {
    uploader: string
    venue: string
    createdAt?: string
    mediaType?: "image" | "video"
    ready?: boolean
  }
): Promise<{ id: string; created_at: string }> {
  const id = randomUUID()
  const mediaType = opts.mediaType ?? "image"
  const ext = mediaType === "image" ? "jpg" : "mp4"
  const { data, error } = await service
    .from("media_assets")
    .insert({
      id,
      uploader_id: opts.uploader,
      venue_id: opts.venue,
      original_path: `${opts.uploader}/${id}/original.${ext}`,
      original_filename: `TEST coverage.${ext}`,
      media_type: mediaType,
      size_bytes: 4,
      client_upload_key: randomUUID(),
      ...(opts.createdAt ? { created_at: opts.createdAt } : {}),
    })
    .select("id, created_at")
    .single()
  if (error) throw error
  if (opts.ready !== false) {
    await markReady(
      service,
      id,
      mediaType === "image" ? "image/jpeg" : "video/mp4"
    )
  }
  return data
}

/**
 * A staff submission made at a chosen past instant (service role), exactly as
 * submit_coverage_photos would have stored it.
 */
export async function insertSubmittedItem(
  service: Db,
  opts: {
    asset: { id: string; created_at: string }
    venue: string
    author: string
    submittedAt: string
    requirement?: string | null
  }
): Promise<string> {
  const { data: submission, error: sError } = await service
    .from("coverage_submissions")
    .insert({
      venue_id: opts.venue,
      submitted_by: opts.author,
      kind: "staff_submit",
      requirement_id: opts.requirement ?? null,
      client_request_key: requestKey(),
      asset_ids: [opts.asset.id],
      created_at: opts.submittedAt,
    })
    .select("id")
    .single()
  if (sError) throw sError
  const { data, error } = await service
    .from("coverage_submission_items")
    .insert({
      submission_id: submission.id,
      venue_id: opts.venue,
      asset_id: opts.asset.id,
      author_id: opts.author,
      requirement_id: opts.requirement ?? null,
      origin: "submitted",
      submitted_by: opts.author,
      submitted_at: opts.submittedAt,
      submitted_month: londonMonth(opts.submittedAt),
      uploaded_at: opts.asset.created_at,
      uploaded_month: londonMonth(opts.asset.created_at),
    })
    .select("id")
    .single()
  if (error) throw error
  return data.id
}

export async function itemRevision(service: Db, itemId: string) {
  const { data, error } = await service
    .from("coverage_submission_items")
    .select("revision, state")
    .eq("id", itemId)
    .single()
  if (error) throw error
  return data
}

export async function submit(
  staff: TestIdentity,
  assetIds: string[],
  requirementId: string | null = null,
  key = requestKey()
) {
  return ok(
    staff.client.rpc("submit_coverage_photos", {
      p_asset_ids: assetIds,
      p_requirement_id: requirementId as string,
      p_client_request_key: key,
    })
  )
}

export async function review(
  reviewer: TestIdentity,
  itemId: string,
  revision: number,
  decision: "accepted" | "needs_another_photo",
  reason: string | null = null,
  key: string | null = null
) {
  return reviewer.client.rpc("review_coverage_item", {
    p_item_id: itemId,
    p_expected_revision: revision,
    p_decision: decision,
    p_reason: reason as string,
    p_client_request_key: key as string,
  })
}

export async function accept(
  service: Db,
  reviewer: TestIdentity,
  itemId: string
) {
  const { revision } = await itemRevision(service, itemId)
  return ok(review(reviewer, itemId, revision, "accepted"))
}

/** Regrants a manager account (grant_venue_manager accepts manager accounts only). */
export async function grantManager(
  admin: TestIdentity,
  managerId: string,
  venueId: string
) {
  return ok(
    admin.client.rpc("grant_venue_manager", {
      p_staff_id: managerId,
      p_venue_id: venueId,
      p_reason: "TEST grant",
    })
  )
}

/**
 * Converts a staff account into a venue manager account for `venueId`, as an
 * admin does in the app. Returns the new grant id.
 */
export async function makeManager(
  admin: TestIdentity,
  staff: { id: string },
  venueId: string,
  key = requestKey()
): Promise<string> {
  const [row] = await ok(
    admin.client.rpc("convert_account_to_manager", {
      p_profile_id: staff.id,
      p_venue_id: venueId,
      p_reason: "TEST conversion",
      p_client_request_key: key,
    })
  )
  return row!.grant_id
}

/**
 * A grant held by a staff account, as granted before manager accounts
 * existed. It stays effective under the transitional rule (legacy
 * /staff/manage); new grants can no longer be made this way, so the service
 * role writes the rows grant_venue_manager used to write.
 */
export async function legacyStaffGrant(
  service: Db,
  admin: TestIdentity,
  staffId: string,
  venueId: string
): Promise<string> {
  const { data, error } = await service
    .from("venue_manager_grants")
    .insert({
      staff_id: staffId,
      venue_id: venueId,
      granted_by: admin.id,
      grant_reason: "TEST legacy grant",
    })
    .select("id")
    .single()
  if (error) throw error
  const { error: auditError } = await service
    .from("coverage_audit_events")
    .insert({
      venue_id: venueId,
      entity: "manager_grant",
      entity_id: data.id,
      actor_id: admin.id,
      actor_role: "admin",
      action: "granted",
      reason: "TEST legacy grant",
      after: { staffId },
    })
  if (auditError) throw auditError
  return data.id
}

/** Creates an active service/venue-specific requirement (manager or admin). */
export async function createRequirement(
  actor: TestIdentity,
  venueId: string,
  opts: {
    title?: string
    photoTarget?: number
    kind?: "service" | "venue_specific"
    dueOn?: string | null
  } = {}
): Promise<string> {
  const rows = await ok(
    actor.client.rpc("save_coverage_requirement", {
      p_venue_id: venueId,
      p_requirement_id: null as unknown as string,
      p_expected_revision: null as unknown as number,
      p_kind: opts.kind ?? "venue_specific",
      p_title: opts.title ?? "TEST requirement",
      p_guidance: null as unknown as string,
      p_photo_target: opts.photoTarget ?? 1,
      p_due_on: (opts.dueOn ?? null) as string,
    })
  )
  return rows[0]!.requirement_id
}

/** Sets a requirement's open assignees (manager or admin): the desired set. */
export async function assign(
  actor: TestIdentity,
  requirementId: string,
  staffIds: string[]
) {
  return ok(
    actor.client.rpc("set_coverage_requirement_assignees", {
      p_requirement_id: requirementId,
      p_staff_ids: staffIds,
    })
  )
}

export async function staffProgress(
  actor: TestIdentity,
  venueId: string | null,
  month: string,
  staffId: string | null = null
) {
  return ok(
    actor.client.rpc("coverage_staff_progress", {
      p_venue_id: venueId as string,
      p_period_month: month,
      p_staff_id: staffId as string,
    })
  )
}

export async function requirementProgress(
  actor: TestIdentity,
  venueId: string,
  includeClosed = false
) {
  return ok(
    actor.client.rpc("coverage_requirement_progress", {
      p_venue_id: venueId,
      p_include_closed: includeClosed,
    })
  )
}

/** psql against the owned local stack (refuses anything but localhost). */
export function psql(sql: string): string {
  const url = process.env.NABALENS_TEST_DB_URL
  if (!url || !/^postgresql:\/\/[^@]+@(127\.0\.0\.1|localhost):/.test(url)) {
    throw new Error("Run through `pnpm test:security <workdir>` (local DB).")
  }
  return execFileSync(
    "psql",
    [url, "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql],
    {
      encoding: "utf8",
    }
  ).trim()
}
