import { afterAll, afterEach, beforeAll } from "vitest"

import { realClock } from "./clock"
import {
  assertVerificationStack,
  clearLease,
  createArchiver,
  createFixtures,
  readState,
  resetState,
  type Fixtures,
  type StateRow,
} from "./db"
import type { AuditModule, AuditOptions } from "./driver"
import { FakeBucket } from "./fake-bucket"

/**
 * Shared setup for suites that run the real audit against the real (spare4)
 * database with a fake store and real time: fixtures, a fresh bucket per
 * scenario, helpers to settle the backlog and to invoke the audit, and
 * restoration of the global state row afterwards.
 */
export function createRig(loadModule: () => AuditModule) {
  const rig = {
    fx: undefined as unknown as Fixtures,
    bucket: undefined as unknown as FakeBucket,
    missingSources: new Set<string>(),
    snapshot: undefined as unknown as StateRow,
    fresh() {
      rig.bucket = new FakeBucket(realClock)
      rig.bucket.lenient = true
      rig.missingSources = new Set()
    },
    async receiptCount() {
      return (
        (
          await rig.fx.service
            .from("media_archive_receipts")
            .select("id", { count: "exact", head: true })
        ).count ?? 0
      )
    },
    async readyUnarchived() {
      const { data } = await rig.fx.service.rpc(
        "media_archive_backfill_candidates",
        { p_limit: 50 }
      )
      return (data ?? []).map((row) => row.asset_id)
    },
    /** Archive every ready original directly so the audit starts with no backlog. */
    async settleBacklog() {
      const archive = createArchiver(
        rig.fx.service,
        rig.bucket,
        rig.missingSources
      )
      for (;;) {
        const pending = await rig.readyUnarchived()
        if (pending.length === 0) return
        for (const id of pending)
          await archive(null, id, AbortSignal.timeout(30_000))
      }
    },
    async ensureReceipts(count: number) {
      const archive = createArchiver(
        rig.fx.service,
        rig.bucket,
        rig.missingSources
      )
      while ((await rig.receiptCount()) < count) {
        const id = await rig.fx.newReadyAsset()
        await archive(null, id, AbortSignal.timeout(30_000))
      }
    },
    run(
      options: AuditOptions & { service?: unknown; deadlineMs?: number } = {}
    ) {
      const { service = rig.fx.service, deadlineMs = 60_000, ...rest } = options
      const signal = rest.signal ?? AbortSignal.timeout(deadlineMs)
      return loadModule().runArchiveAudit(service, {
        store: rig.bucket.store(signal),
        archive: createArchiver(rig.fx.service, rig.bucket, rig.missingSources),
        signal,
        ...rest,
      })
    },
    register() {
      beforeAll(async () => {
        assertVerificationStack()
        rig.fx = await createFixtures()
        rig.snapshot = await readState(rig.fx.service)
      })
      afterEach(async () => {
        await clearLease(rig.fx.service)
        await resetState(rig.fx.service)
      })
      afterAll(async () => {
        await clearLease(rig.fx.service)
        const { name, ...rest } = rig.snapshot
        void name
        await rig.fx.service
          .from("media_archive_audit_state")
          .update(rest as never)
          .eq("name", "originals")
      })
    },
  }
  return rig
}
