import { verifiedReceiptIds } from "./driver"
import type { World } from "./world"

/**
 * Observes every cursor checkpoint at the moment it is written and records a
 * violation when any receipt at or below the new cursor has not been fully
 * (blob and manifest) verified. This is the "no skipped receipt" invariant.
 */
export function watchCheckpoints(world: World) {
  const cursors: number[] = []
  const violations: { cursor: number; unverified: number[] }[] = []
  world.db.inject({
    match: (op) =>
      op.kind === "update" &&
      op.table === "media_archive_audit_state" &&
      typeof op.patch?.cursor_id === "number" &&
      op.patch.cursor_id > 0 &&
      op.patch.last_complete_at === undefined,
    before: (op) => {
      if (op.kind !== "update") return
      const cursor = op.patch?.cursor_id as number
      cursors.push(cursor)
      const verified = new Set(verifiedReceiptIds(world))
      // Resumed runs legitimately start above 0: ids at or below the durable
      // cursor held before this run are covered by earlier verification.
      const floor = (world.state().cursor_id as number) ?? 0
      const unverified = world.db
        .rows("media_archive_receipts")
        .map((row) => row.id as number)
        .filter((id) => id > floor && id <= cursor && !verified.has(id))
      if (unverified.length > 0) violations.push({ cursor, unverified })
    },
  })
  return { cursors, violations }
}
