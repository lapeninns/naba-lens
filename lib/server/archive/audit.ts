import "server-only"

import { randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/db/types"

import { readArchiveConfig } from "./config"
import { ensureMediaOriginalArchived } from "./index"
import { createArchiveStore } from "./object-store"

type Service = SupabaseClient<Database>
export const ARCHIVE_MAX_AGE_MS = 26 * 60 * 60 * 1000

/** Durable cursor: a slow/failed audit never produces a fresh complete receipt. */
export async function runArchiveAudit(service: Service) {
  const config = readArchiveConfig()
  if (!config) throw new Error("archive_disabled")
  const holder = randomUUID()
  const lease = await service.rpc("acquire_maintenance_lease", {
    p_name: "media_archive_audit",
    p_holder: holder,
    p_ttl: "180 seconds",
  })
  if (lease.error) throw new Error("archive_lease_failed")
  if (!lease.data) return { status: "locked" as const }
  const signal = AbortSignal.timeout(80_000)
  const store = createArchiveStore(config, signal)
  let checked = 0
  let copied = 0
  try {
    const state = await service
      .from("media_archive_audit_state")
      .select("cursor_id")
      .eq("name", "originals")
      .single()
    if (state.error || !state.data) throw new Error("archive_state_unavailable")
    const candidates = await service.rpc("media_archive_backfill_candidates", {
      p_limit: 10,
    })
    if (candidates.error) throw new Error("archive_backfill_unavailable")
    for (const row of candidates.data) {
      await ensureMediaOriginalArchived(
        service,
        row.asset_id,
        undefined,
        signal
      )
      copied++
    }
    const receipts = await service
      .from("media_archive_receipts")
      .select("*")
      .gt("id", state.data.cursor_id)
      .order("id", { ascending: true })
      .limit(51)
    if (receipts.error) throw new Error("archive_receipts_unavailable")
    const batch = receipts.data.slice(0, 50)
    for (const receipt of batch) {
      await store.verifyOriginal(
        receipt.blob_key,
        receipt.sha256,
        receipt.size_bytes
      )
      await store.verifyManifest(
        receipt.manifest_key,
        receipt.manifest_sha256,
        new TextEncoder().encode(JSON.stringify(receipt.manifest)).byteLength
      )
      const saved = await service
        .from("media_archive_audit_state")
        .update({ cursor_id: receipt.id })
        .eq("name", "originals")
      if (saved.error) throw new Error("archive_checkpoint_failed")
      checked++
    }
    const missing = await service.rpc("media_archive_missing_count")
    if (missing.error) throw new Error("archive_coverage_unavailable")
    const complete = receipts.data.length <= 50 && missing.data === 0
    const now = new Date().toISOString()
    const saved = await service
      .from("media_archive_audit_state")
      .update({
        last_run_at: now,
        last_error: null,
        ...(complete ? { cursor_id: 0, last_complete_at: now } : {}),
      })
      .eq("name", "originals")
    if (saved.error) throw new Error("archive_checkpoint_failed")
    return {
      status: "completed" as const,
      complete,
      checked,
      copied,
      missing: missing.data,
    }
  } catch {
    await service
      .from("media_archive_audit_state")
      .update({
        last_run_at: new Date().toISOString(),
        last_error: "archive_audit_failed",
      })
      .eq("name", "originals")
    throw new Error("archive_audit_failed")
  } finally {
    store.close?.()
    await service.rpc("release_maintenance_lease", {
      p_name: "media_archive_audit",
      p_holder: holder,
    })
  }
}

/** Read-only health boundary for an independently configured failure monitor. */
export async function archiveStatus(service: Service, now = Date.now()) {
  if (!readArchiveConfig()) return { ok: false, status: "disabled" as const }
  const [state, missing] = await Promise.all([
    service
      .from("media_archive_audit_state")
      .select("last_complete_at,last_run_at,last_error,cursor_id")
      .eq("name", "originals")
      .single(),
    service.rpc("media_archive_missing_count"),
  ])
  if (state.error || missing.error || !state.data)
    throw new Error("archive_status_unavailable")
  const completed = Date.parse(state.data.last_complete_at ?? "")
  const fresh =
    Number.isFinite(completed) &&
    completed <= now &&
    now - completed <= ARCHIVE_MAX_AGE_MS
  return {
    ok: fresh && !state.data.last_error && missing.data === 0,
    status: fresh ? ("current" as const) : ("stale" as const),
    missing: missing.data,
    lastCompleteAt: state.data.last_complete_at,
    lastRunAt: state.data.last_run_at,
    failed: Boolean(state.data.last_error),
    inProgress: state.data.cursor_id !== 0,
  }
}
