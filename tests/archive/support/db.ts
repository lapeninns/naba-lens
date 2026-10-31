import { randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"

import {
  anonClient,
  createIdentity,
  createVenue,
  markReady,
  serviceClient,
  type Db,
  type TestIdentity,
} from "../../support/identities"
import {
  archiveOriginal,
  sha256,
  type ArchiveSource,
} from "../../../lib/server/archive/core"
import { preparedOriginal, type FakeBucket } from "./fake-bucket"
import { PROJECT_REF } from "./world"

export { anonClient, serviceClient, type Db, type TestIdentity }

/**
 * The DB and e2e suites mutate the single archive audit state row and its
 * lease, so they run only on the stack Harness reserved for Verification.
 * Refuse anything else, including the shared ws2 stack.
 */
export function assertVerificationStack() {
  const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalid")
  const port = process.env.ARCHIVE_DB_API_PORT ?? "64421"
  if (url.hostname !== "127.0.0.1" || url.port !== port)
    throw new Error(
      `Archive DB suites must run on the Verification stack (127.0.0.1:${port}); got ${url.host}. Source /tmp/nabalens-ws/spare4/env.sh.`
    )
}

/** Run SQL as the database owner. Needed for private schema and TRUNCATE checks. */
export function psql(sql: string) {
  assertVerificationStack()
  const dbUrl = process.env.SUPABASE_DB_URL
  if (!dbUrl) throw new Error("SUPABASE_DB_URL is not set")
  const result = spawnSync(
    "psql",
    [dbUrl, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql],
    {
      encoding: "utf8",
    }
  )
  return {
    ok: result.status === 0,
    out: result.stdout.trim(),
    err: result.stderr.trim(),
  }
}

export const STATE_COLUMNS = [
  "name",
  "cursor_id",
  "cycle_id",
  "cycle_started_at",
  "cycle_target_id",
  "cycle_target_count",
  "cycle_checked",
  "last_run_at",
  "last_run_outcome",
  "last_complete_at",
  "last_complete_cycle_started_at",
  "last_cycle_duration_seconds",
  "last_error",
  "consecutive_failures",
] as const

export type StateRow = Record<(typeof STATE_COLUMNS)[number], unknown>

export async function readState(service: Db): Promise<StateRow> {
  const { data, error } = await service
    .from("media_archive_audit_state")
    .select("*")
    .eq("name", "originals")
    .single()
  if (error) throw error
  return data as unknown as StateRow
}

/** A healthy, idle baseline: no open cycle, last cycle long enough ago to start a new one. */
export async function resetState(
  service: Db,
  patch: Record<string, unknown> = {}
) {
  const hour = 3_600_000
  const { error } = await service
    .from("media_archive_audit_state")
    .update({
      cursor_id: 0,
      cycle_id: null,
      cycle_started_at: null,
      cycle_target_id: null,
      cycle_target_count: null,
      cycle_checked: 0,
      last_run_at: new Date(Date.now() - 60_000).toISOString(),
      last_run_outcome: "completed_cycle",
      last_complete_at: new Date(Date.now() - hour).toISOString(),
      last_complete_cycle_started_at: new Date(
        Date.now() - 14 * hour
      ).toISOString(),
      last_cycle_duration_seconds: 3600,
      last_error: null,
      consecutive_failures: 0,
      ...patch,
    } as never)
    .eq("name", "originals")
  if (error) throw error
}

export async function clearLease(service: Db, name = "media_archive_audit") {
  // Only a holder can release; find it through the owner connection.
  const holder = psql(
    `select holder from private.maintenance_leases where name = '${name}'`
  )
  if (holder.out)
    await service.rpc("release_maintenance_lease", {
      p_name: name,
      p_holder: holder.out,
    })
}

export type Fixtures = {
  service: Db
  staff: TestIdentity
  admin: TestIdentity
  venueId: string
  newReadyAsset(): Promise<string>
}

/** A venue, two identities and a factory for ready media assets. */
export async function createFixtures(): Promise<Fixtures> {
  assertVerificationStack()
  const service = serviceClient()
  const venue = await createVenue(service, "archive-verify")
  const staff = await createIdentity(service, {
    label: "archive-verify-staff",
    role: "staff",
    venueId: venue.id,
  })
  const admin = await createIdentity(service, {
    label: "archive-verify-admin",
    role: "admin",
  })
  return {
    service,
    staff,
    admin,
    venueId: venue.id,
    async newReadyAsset() {
      const reservation = await staff.client.rpc("reserve_media_asset", {
        p_client_upload_key: randomUUID(),
        p_extension: "jpg",
        p_media_type: "image",
        p_original_filename: "archive-verify.jpg",
        p_size_bytes: 4,
      })
      if (reservation.error) throw reservation.error
      const asset = reservation.data[0]
      await markReady(service, asset.id)
      return asset.id as string
    },
  }
}

/**
 * Backfill callback for the audit: archives one ready asset through the real
 * `archiveOriginal` (so the database's receipt guard really checks the
 * manifest) into the fake bucket, with no network. Assets listed in
 * `missingSources` fail like an unreadable source original.
 */
export function createArchiver(
  service: Db,
  bucket: FakeBucket,
  missingSources = new Set<string>()
) {
  return async (_service: unknown, assetId: string, signal: AbortSignal) => {
    const { data: asset, error } = await service
      .from("media_assets")
      .select(
        "id,uploader_id,venue_id,original_filename,original_path,media_type,size_bytes,validated_mime_type,created_at,upload_state"
      )
      .eq("id", assetId)
      .single()
    if (error || !asset || asset.upload_state !== "ready")
      throw new Error("archive_asset_unavailable")
    if (missingSources.has(assetId))
      throw new Error("archive_source_read_failed")
    const [uploader, venue] = await Promise.all([
      service
        .from("profiles")
        .select("display_name")
        .eq("id", asset.uploader_id)
        .single(),
      service.from("venues").select("name").eq("id", asset.venue_id).single(),
    ])
    const source: ArchiveSource = {
      assetId: asset.id,
      uploaderId: asset.uploader_id,
      venueId: asset.venue_id,
      uploaderName: uploader.data?.display_name ?? "unknown",
      venueName: venue.data?.name ?? "unknown",
      originalFilename: asset.original_filename,
      originalPath: asset.original_path,
      mediaType: asset.media_type,
      mimeType: asset.validated_mime_type ?? "image/jpeg",
      sizeBytes: asset.size_bytes as number,
      uploadedAt: asset.created_at,
    }
    await archiveOriginal(source, {
      projectRef: PROJECT_REF,
      prepare: async (input) =>
        preparedOriginal(sha256(`verify-${input.assetId}`), input.sizeBytes),
      store: bucket.store(signal),
      async record(receipt) {
        const { error: recordError } = await service
          .from("media_archive_receipts")
          .upsert(
            { ...receipt, manifest: receipt.manifest as never },
            {
              onConflict: "asset_id,sha256,manifest_sha256",
              ignoreDuplicates: true,
            }
          )
        if (recordError) throw new Error("archive_receipt_write_failed")
      },
    })
  }
}

/** Wrap a real client so a "process death" leaves later calls pending forever. */
export function killableService(service: Db) {
  let dead = false
  const never = () => new Promise<never>(() => undefined)
  // After death any chain stays pending: every method returns the same pending builder.
  const deadBuilder: unknown = new Proxy(function () {}, {
    get: (_, prop) => (prop === "then" ? () => never() : () => deadBuilder),
  })
  const wrapped = new Proxy(service, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (prop !== "from" && prop !== "rpc") return value
      return (...args: unknown[]) => {
        if (dead) return deadBuilder
        const result = (value as (...a: unknown[]) => unknown).apply(
          target,
          args
        )
        return wrapBuilder(result, () => dead)
      }
    },
  })
  const wrapBuilder = (builder: unknown, isDead: () => boolean): unknown =>
    new Proxy(builder as object, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver)
        if (typeof value !== "function") return value
        if (prop === "then")
          return (
            onFulfilled?: (v: unknown) => unknown,
            onRejected?: (e: unknown) => unknown
          ) =>
            (value as (...a: unknown[]) => Promise<unknown>).call(
              target,
              onFulfilled && ((v) => (isDead() ? never() : onFulfilled(v))),
              onRejected
            )
        return (...args: unknown[]) => {
          const out = (value as (...a: unknown[]) => unknown).apply(
            target,
            args
          )
          return out && typeof out === "object" ? wrapBuilder(out, isDead) : out
        }
      },
    })
  return {
    client: wrapped as Db,
    kill: () => {
      dead = true
    },
  }
}
