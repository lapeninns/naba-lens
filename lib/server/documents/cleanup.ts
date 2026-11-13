import "server-only"

import { randomUUID } from "node:crypto"

import type { Db } from "@/lib/server/media/types"

import { DOCUMENTS_BUCKET, DOCUMENT_LIMITS } from "./config"
import { documentRpc } from "./rpc"

export const DOCUMENT_CLEANUP_LEASE = "document_cleanup"

export type DocumentCleanupReport =
  | { status: "skipped"; reason: "locked" }
  | { status: "completed"; documents: number; failed: number; more: boolean }

/**
 * One pass of document cleanup (b05-design §2A.4): prepare_document_cleanup
 * tombstones uploads untouched for the window (never a referenced document)
 * and lists tombstoned documents whose object remains; the objects are then
 * removed. Storage is the record of what is left, so a failed removal shows up
 * again next run. Reports counts only.
 */
export async function runDocumentCleanup(
  service: Db,
  options: { batchSize?: number; maxBatches?: number; now?: Date } = {}
): Promise<DocumentCleanupReport> {
  const holder = randomUUID()
  const lease = await service.rpc("acquire_maintenance_lease", {
    p_name: DOCUMENT_CLEANUP_LEASE,
    p_holder: holder,
    p_ttl: "600 seconds",
  })
  if (lease.error)
    throw new Error(`document_cleanup_lease_failed: ${lease.error.message}`)
  if (!lease.data) return { status: "skipped", reason: "locked" }

  const failed = new Set<string>()
  let documents = 0
  let more = false
  try {
    for (let batch = 0; ; batch++) {
      const { data, error } = await documentRpc(
        service,
        "prepare_document_cleanup",
        {
          p_abandoned_after: `${DOCUMENT_LIMITS.abandonedUploadWindowHours} hours`,
          p_limit: options.batchSize ?? 100,
          p_exclude_ids: [...failed],
          ...(options.now ? { p_now: options.now.toISOString() } : {}),
        }
      )
      if (error)
        throw new Error(`prepare_document_cleanup_failed: ${error.message}`)
      if (data.length === 0) break
      if (batch >= (options.maxBatches ?? 10)) {
        more = true
        break
      }
      for (const row of data) {
        const removed = await service.storage
          .from(DOCUMENTS_BUCKET)
          .remove(row.object_names)
        if (removed.error) failed.add(row.document_id)
        else documents++
      }
    }
  } finally {
    await service.rpc("release_maintenance_lease", {
      p_name: DOCUMENT_CLEANUP_LEASE,
      p_holder: holder,
    })
  }
  return { status: "completed", documents, failed: failed.size, more }
}
