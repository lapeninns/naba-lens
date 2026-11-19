// Full App v1, Sprint 3 repair S3-R6 (review V20, V22):
//   20261118125000  venues switched off before operating statuses existed
//                   are archived; admin_venue_set_status's no-op needs the
//                   status and venues.active to match
//   20261118125200  admin Overview counts each check due once, in parts
// Real signed-in identities through PostgREST; psql and the service role only
// build fixtures (and age records) and read state back.
import { readFileSync } from "node:fs"

import { beforeAll, describe, expect, it } from "vitest"

import { createVenue } from "../support/identities"
import { ok, psql } from "./coverage-fixtures"
import {
  call,
  json,
  service,
  world,
  yes,
  type World,
} from "./knowledge-fixtures"
import { reserveReady } from "./menus-fixtures"

type Obj = Record<string, unknown>
type Checks = {
  dishes: number
  places: number
  facilities: number
  slots: number
  facts: number
  total: number
}
type Row = Obj & { checksDue: Checks; facts: { checkDue: number } }

const overviewRow = async (w: World) => {
  const read = await json<{ rows: Row[] }>(w.admin, "admin_group_overview", {
    p_venue_ids: [w.venue],
  })
  expect(read.rows).toHaveLength(1)
  return read.rows[0]
}

const slotState = async (w: World, slotId: string) =>
  (
    await json<{ slots: { slotId: string; state: string }[] }>(
      w.admin,
      "coverage_slots",
      { p_venue_id: w.venue }
    )
  ).slots.find((s) => s.slotId === slotId)?.state

describe("Checks due counts each subject once, in parts (V20)", () => {
  let w: World

  beforeAll(async () => {
    w = await world("r6-checks")
  })

  it("a check-due facility is one fact, not a photo and a fact; a place check is its own part", async () => {
    // A facility answered Yes with a photo accepted for public use.
    const check = w.checks.onsite_parking!
    const sent = await yes(w.staffA, w, "onsite_parking")
    const asset = psql(
      `select asset_id from public.knowledge_contribution_assets
       where contribution_id = '${sent.contributionId}' limit 1`
    )
    await ok(
      call(w.manager, "decide_amenity_photo", {
        p_check_id: check,
        p_asset_id: asset,
        p_action: "accepted",
        p_level: "public",
      }) as never
    )
    expect(await slotState(w, check)).toBe("covered")
    const before = await overviewRow(w)

    // Past its check date: the fact is check due, and so is the slot.
    psql(`begin;
      set local session_replication_role = replica;
      update public.amenity_submissions s set created_at = s.created_at - interval '120 days'
      from public.venue_amenity_checks c
      where c.id = '${check}' and s.id = c.current_submission_id;
      update public.knowledge_decisions d set created_at = d.created_at - interval '120 days'
      from public.venue_amenity_checks c
      where c.id = '${check}'
        and (d.submission_id = c.current_submission_id or d.resulting_submission_id = c.current_submission_id);
      commit;`)
    expect(await slotState(w, check)).toBe("check_due")

    // A place whose accepted photo was reported changed: a place check.
    const bar = psql(
      `insert into public.knowledge_subjects (venue_id, kind, label, created_by)
       values ('${w.venue}', 'area', 'Bar', '${w.admin.id}') returning id`
    )
    const photo = (await reserveReady(service, w.staffA)).id
    const [labelled] = (await ok(
      w.staffA.client.rpc("set_media_area_label", {
        p_asset_id: photo,
        p_subject_id: bar,
      })
    ))!
    await ok(
      call(w.manager, "decide_area_photo_level", {
        p_label_id: (labelled as { label_id: string }).label_id,
        p_action: "accepted",
        p_level: "public",
      }) as never
    )
    await json(w.staffA, "area_photo_report_change", {
      p_subject_id: bar,
      p_reason: "TEST new bar top",
    })
    expect(await slotState(w, bar)).toBe("check_due")

    const row = await overviewRow(w)
    const facts = row.facts.checkDue
    expect(facts).toBe(before.facts.checkDue + 1)
    // Before the repair: slots 2 (place + facility) + facts, one too many.
    expect(row.checksDue).toEqual({
      dishes: 0,
      places: 1,
      facilities: 0,
      slots: 1,
      facts,
      total: 1 + facts,
    })
  })

  it("a facility asked to be checked again is one check too", async () => {
    const check = w.checks.guest_toilets!
    const sent = await yes(w.staffA, w, "guest_toilets")
    const asset = psql(
      `select asset_id from public.knowledge_contribution_assets
       where contribution_id = '${sent.contributionId}' limit 1`
    )
    await ok(
      call(w.manager, "decide_amenity_photo", {
        p_check_id: check,
        p_asset_id: asset,
        p_action: "accepted",
        p_level: "public",
      }) as never
    )
    const before = await overviewRow(w)
    psql(`begin;
      set local session_replication_role = replica;
      update public.venue_amenity_checks set progress = 'needs_recheck', recheck_reason = 'TEST looks different' where id = '${check}';
      commit;`)
    expect(await slotState(w, check)).toBe("check_due")
    const row = await overviewRow(w)
    // The recheck makes its fact due as well: counted once, as a fact.
    expect(row.checksDue.total).toBe(before.checksDue.total + 1)
    expect(row.checksDue.facts).toBe(before.checksDue.facts + 1)
    expect(row.checksDue.facilities).toBe(before.checksDue.facilities)
  })
})

describe("venues switched off before operating statuses (V22)", () => {
  let admin: World["admin"]

  beforeAll(async () => {
    admin = (await world("r6-venues")).admin
  })

  /** A venue as one switched off before 20261118100000 was left. */
  async function legacyInactive(label: string) {
    const v = (await createVenue(service, label)).id
    psql(`update public.venues set active = false, operating_status = 'open',
      archived_at = null where id = '${v}'`)
    return v
  }
  const venueRow = (id: string) =>
    JSON.parse(
      psql(`select row_to_json(v)::text from (
        select active, operating_status, archived_at, revision
        from public.venues where id = '${id}') v`)
    ) as {
      active: boolean
      operating_status: string
      archived_at: string | null
      revision: number
    }

  it("the migration's backfill archives them and keeps everything else", async () => {
    const v = await legacyInactive("r6-legacy-backfill")
    const open = (await createVenue(service, "r6-open")).id
    const sql = readFileSync(
      "supabase/migrations/20261118125000_venue_status_backfill.sql",
      "utf8"
    )
    const backfill = sql.slice(
      sql.indexOf("update public.venues v"),
      sql.indexOf(";", sql.indexOf("update public.venues v")) + 1
    )
    const revision = venueRow(v).revision
    psql(backfill)
    expect(venueRow(v)).toMatchObject({
      active: false,
      operating_status: "permanently_closed",
      revision,
    })
    expect(venueRow(v).archived_at).not.toBeNull()
    expect(venueRow(open)).toMatchObject({
      active: true,
      operating_status: "open",
    })
  })

  it("Open reopens one on purpose, recorded as restored", async () => {
    const v = await legacyInactive("r6-legacy-open")
    const r = await json<Obj>(admin, "admin_venue_set_status", {
      p_venue_id: v,
      p_status: "open",
      p_reason: "TEST reopened",
      p_revision: venueRow(v).revision,
    })
    expect(r.changed).toBe(true)
    expect(venueRow(v)).toMatchObject({
      active: true,
      operating_status: "open",
      archived_at: null,
    })
    expect(
      psql(
        `select string_agg(action, ',') from public.activity_events
         where venue_id = '${v}' and action like 'venue\\_%'`
      )
    ).toBe("venue_restored")
  })

  it("Closed for good switches the access off and archives it; a repeat is a no-op", async () => {
    const v = await legacyInactive("r6-legacy-close")
    const first = await json<Obj>(admin, "admin_venue_set_status", {
      p_venue_id: v,
      p_status: "permanently_closed",
      p_reason: "TEST sold",
      p_revision: venueRow(v).revision,
    })
    expect(first.changed).toBe(true)
    expect(venueRow(v)).toMatchObject({
      active: false,
      operating_status: "permanently_closed",
    })
    const again = await json<Obj>(admin, "admin_venue_set_status", {
      p_venue_id: v,
      p_status: "permanently_closed",
      p_reason: "TEST again",
      p_revision: venueRow(v).revision,
    })
    expect(again.changed).toBe(false)
    expect(
      psql(
        `select count(*) from public.activity_events
         where venue_id = '${v}' and action = 'venue_archived'`
      )
    ).toBe("1")
  })

  it("an open, switched-on venue choosing Open is still a no-op", async () => {
    const v = (await createVenue(service, "r6-open-noop")).id
    const r = await json<Obj>(admin, "admin_venue_set_status", {
      p_venue_id: v,
      p_status: "open",
      p_reason: "TEST nothing",
      p_revision: venueRow(v).revision,
    })
    expect(r.changed).toBe(false)
  })
})
