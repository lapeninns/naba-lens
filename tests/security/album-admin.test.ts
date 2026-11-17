// Album A4 admin albums (20261117140000_album_admin.sql): album_admin_counts
// is admins only, and each amenity question carries its latest open finding's
// state, so a finding a manager sent back for more detail reads as
// needs_attention (Retake on staff Album), not as Waiting (revc should-fix 3).
import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  call,
  json,
  slotRevision,
  world,
  yes,
  type World,
} from "./knowledge-fixtures"

const KEY = "step_free_entrance"

type Counts = {
  amenities: { checkId: string; openState: string | null }[]
}

async function openStateOf(w: World) {
  const counts = await json<Counts>(w.admin, "album_admin_counts", {
    p_venue_id: w.venue,
  })
  return counts.amenities.find((a) => a.checkId === w.checks[KEY])?.openState
}

describe("album_admin_counts", () => {
  it("refuses anyone but an admin", async () => {
    const w = await world("alb-admin-access")
    for (const who of [w.manager, w.staffA]) {
      const { error } = await call(who, "album_admin_counts", {
        p_venue_id: w.venue,
      })
      expect(error?.message).toBe("not_admin")
    }
  })

  it("gives the latest open finding's state: none, waiting, then sent back", async () => {
    const w = await world("alb-admin-open")
    expect(await openStateOf(w)).toBeNull()
    const r = await yes(w.staffA, w, KEY)
    expect(await openStateOf(w)).toBe("awaiting_confirmation")
    await json(w.manager, "knowledge_decide", {
      p_target_type: "contribution",
      p_target_id: r.contributionId,
      p_decision: "request_detail",
      p_slot_revision: slotRevision(w.venue, KEY),
      p_idempotency_key: randomUUID(),
      p_note: "TEST show the door",
    })
    expect(await openStateOf(w)).toBe("needs_attention")
  })
})
