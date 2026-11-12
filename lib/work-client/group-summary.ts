// B05-m5's group summary (OD-B5-01-2) as pure TypeScript, so the client can
// reason about a set the same way contribution_group does. The server's
// summary is authoritative; this mirror must agree with it on every mix of
// member states (tests/unit/group-summary.test.ts).

import type {
  GroupMemberTechnical,
  GroupSummary,
} from "@/lib/knowledge/contract"

export type SummaryMember = {
  technical: GroupMemberTechnical
  /** A replaces_failed_member link in this group names this member. */
  replaced: boolean
}

/**
 * Each member that is not replaced is in one bucket: removed, failed,
 * inProgress (uploading or processing, stopped included) or ready.
 * live = ready + inProgress + failed; replaced members count only in
 * `replaced`, whatever their state. finished = live > 0 and ready = live.
 */
export function summariseGroup(
  members: readonly SummaryMember[]
): GroupSummary {
  const s = { ready: 0, inProgress: 0, failed: 0, removed: 0, replaced: 0 }
  for (const m of members) {
    if (m.replaced) s.replaced += 1
    else if (m.technical === "removed") s.removed += 1
    else if (m.technical === "failed") s.failed += 1
    else if (m.technical === "ready") s.ready += 1
    else s.inProgress += 1
  }
  const live = s.ready + s.inProgress + s.failed
  return { live, ...s, finished: live > 0 && s.ready === live }
}
