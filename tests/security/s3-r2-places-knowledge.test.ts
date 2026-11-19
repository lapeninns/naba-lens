// S3-R2: regression tests for the Sprint 3 repair pass on places, facts and
// knowledge (docs/plans/full-app-v1/reviews/S3-release-review.md V4, V12;
// docs/plans/full-app-v1/reports/S3-E2E-2.md D4), fixed in
// supabase/migrations/20261118121000..121200. Each test reproduces the
// scenario and shows it is now refused or correct. Real signed-in identities
// through PostgREST; psql (as the owner) only builds fixtures and reads state.
import { describe, expect, it } from "vitest"

import { type TestIdentity } from "../support/identities"
import { fails, insertAsset, ok, psql } from "./coverage-fixtures"
import {
  call,
  json,
  londonToday,
  refused,
  service,
  world as knowledgeWorld,
} from "./knowledge-fixtures"
import { reserveReady } from "./menus-fixtures"

const shiftDays = (day: string, days: number) => {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const place = (venue: string, adminId: string, label: string) =>
  psql(
    `insert into public.knowledge_subjects (venue_id, kind, label, created_by)
     values ('${venue}', 'area', '${label}', '${adminId}') returning id`
  )

const freshness = (label: string) =>
  (
    JSON.parse(psql(`select private.area_photo_freshness('${label}')`)) as {
      state: string
    }
  ).state

// ---------------------------------------------------------------------------
// V4: the R19 check reads the start of the accepted run, as freshness does
// ---------------------------------------------------------------------------

describe("V4: a backdated 'Still right' after a report and a level change", () => {
  it("is refused, because the report is inside the current accepted run", async () => {
    const w = await knowledgeWorld("s3r2-v4")
    const patio = place(w.venue, w.admin.id, "Patio")
    const asset = (
      await insertAsset(service, { uploader: w.staffA.id, venue: w.venue })
    ).id
    const label = psql(
      `insert into public.media_area_labels (asset_id, venue_id, subject_id, subject_kind, subject_label, added_by)
       values ('${asset}', '${w.venue}', '${patio}', 'area', 'Patio', '${w.staffA.id}') returning id`
    )
    // Day 1: accepted as public.
    psql(
      `insert into public.area_photo_decisions (label_id, venue_id, asset_id, action, decided_by, decided_at)
       values ('${label}', '${w.venue}', '${asset}', 'accepted', '${w.admin.id}', now() - interval '20 days')`
    )
    // Day 10: staff report a change.
    await json(w.staffA, "area_photo_report_change", {
      p_subject_id: patio,
      p_reason: "TEST closed for works",
    })
    expect(freshness(label)).toBe("check_due")

    // Day 11: the manager changes the level, which adds a new 'accepted' row.
    await ok(
      call(w.manager, "decide_area_photo_level", {
        p_label_id: label,
        p_action: "accepted",
        p_level: "reference",
      }) as PromiseLike<{ data: unknown; error: null }>
    )
    expect(freshness(label)).toBe("check_due")

    // Day 12: 'Still right' dated before the report is refused.
    const error = await refused(
      w.manager,
      "area_photo_reconfirm",
      { p_subject_id: patio, p_checked_on: shiftDays(londonToday(), -5) },
      "invalid_value"
    )
    expect(error.details).toContain("before_reported_change")
    expect(freshness(label)).toBe("check_due")

    // A check made today, after the report, still clears it.
    await json(w.manager, "area_photo_reconfirm", {
      p_subject_id: patio,
      p_checked_on: londonToday(),
    })
    expect(freshness(label)).toBe("current")
  })

  it("reads one anchor in both functions", () => {
    const def = (fn: string) =>
      psql(`select pg_get_functiondef('${fn}'::regprocedure)`)
    expect(def("private.area_photo_freshness(uuid, timestamptz)")).toContain(
      "private.area_photo_run_start("
    )
    expect(def("public.area_photo_reconfirm(uuid, date, text)")).toContain(
      "private.area_photo_run_start("
    )
  })
})

// ---------------------------------------------------------------------------
// V12: the uploader cannot clear or move a reviewed area label
// ---------------------------------------------------------------------------

describe("V12: set_media_area_label on a reviewed area photo", () => {
  const setArea = (who: TestIdentity, asset: string, subject: string | null) =>
    who.client.rpc("set_media_area_label", {
      p_asset_id: asset,
      // Null clears; the generator types every SQL argument non-null.
      p_subject_id: subject as string,
    })
  const decide = (
    who: TestIdentity,
    label: string,
    action: "accepted" | "needs_another_photo" | "not_used" | "withdrawn",
    reason: string | null = null
  ) =>
    call(who, "decide_area_photo_level", {
      p_label_id: label,
      p_action: action,
      ...(reason === null ? {} : { p_reason: reason }),
    }) as PromiseLike<{ data: unknown; error: null }>
  const liveLabel = (asset: string) =>
    psql(
      `select coalesce((select subject_id::text from public.media_area_labels
        where asset_id = '${asset}' and removed_at is null), 'none')`
    )
  async function areaPhoto(who: TestIdentity, subject: string) {
    const asset = (await reserveReady(service, who)).id
    const [row] = (await ok(setArea(who, asset, subject)))!
    return { asset, label: (row as { label_id: string }).label_id }
  }

  it("refuses clearing or moving an accepted area, and keeps the acceptance", async () => {
    const w = await knowledgeWorld("s3r2-v12-acc")
    const garden = place(w.venue, w.admin.id, "Garden")
    const bar = place(w.venue, w.admin.id, "Bar")
    const { asset, label } = await areaPhoto(w.staffA, garden)
    await ok(decide(w.manager, label, "accepted"))

    await fails(setArea(w.staffA, asset, null), "area_photo_decided", "P0001")
    await fails(setArea(w.staffA, asset, bar), "area_photo_decided", "P0001")
    expect(liveLabel(asset)).toBe(garden)
    expect(
      psql(
        `select action from public.area_photo_decisions where label_id = '${label}' order by id desc limit 1`
      )
    ).toBe("accepted")
    // Choosing the place it already has changes nothing and is not an error.
    const [same] = (await ok(setArea(w.staffA, asset, garden)))!
    expect((same as { changed: boolean }).changed).toBe(false)
  })

  it("refuses a change after 'needs another photo' or 'not used'", async () => {
    const w = await knowledgeWorld("s3r2-v12-other")
    const garden = place(w.venue, w.admin.id, "Garden")
    const bar = place(w.venue, w.admin.id, "Bar")
    const one = await areaPhoto(w.staffA, garden)
    await ok(decide(w.manager, one.label, "needs_another_photo", "Too dark"))
    await fails(
      setArea(w.staffA, one.asset, bar),
      "area_photo_decided",
      "P0001"
    )
    await fails(
      setArea(w.staffA, one.asset, null),
      "area_photo_decided",
      "P0001"
    )
    const two = await areaPhoto(w.staffA, garden)
    await ok(decide(w.manager, two.label, "not_used", "Duplicate"))
    await fails(
      setArea(w.staffA, two.asset, bar),
      "area_photo_decided",
      "P0001"
    )
    expect(liveLabel(one.asset)).toBe(garden)
    expect(liveLabel(two.asset)).toBe(garden)
  })

  it("still lets the uploader change or clear an unreviewed area", async () => {
    const w = await knowledgeWorld("s3r2-v12-pending")
    const garden = place(w.venue, w.admin.id, "Garden")
    const bar = place(w.venue, w.admin.id, "Bar")
    const { asset } = await areaPhoto(w.staffA, garden)
    await ok(setArea(w.staffA, asset, bar))
    expect(liveLabel(asset)).toBe(bar)
    await ok(setArea(w.staffA, asset, null))
    expect(liveLabel(asset)).toBe("none")
  })

  it("keeps the withdrawn rule: clearing allowed, a new place refused", async () => {
    const w = await knowledgeWorld("s3r2-v12-wd")
    const garden = place(w.venue, w.admin.id, "Garden")
    const bar = place(w.venue, w.admin.id, "Bar")
    const { asset, label } = await areaPhoto(w.staffA, garden)
    await ok(decide(w.manager, label, "accepted"))
    await ok(decide(w.manager, label, "withdrawn", "Shows a guest"))
    await fails(setArea(w.staffA, asset, bar), "area_photo_withdrawn", "P0001")
    await ok(setArea(w.staffA, asset, null))
    expect(liveLabel(asset)).toBe("none")
  })
})

// ---------------------------------------------------------------------------
// D4: every catalogue question has a knowledge rule and can join coverage
// ---------------------------------------------------------------------------

describe("D4: catalogue questions without a knowledge rule", () => {
  it("leaves no catalogue question without a rule or a registry version naming one", () => {
    expect(
      psql(
        `select coalesce(string_agg(c.key, ',' order by c.key), '') from public.amenity_catalogue c
         where not exists (select 1 from public.knowledge_question_rules r where r.question_key = c.key)`
      )
    ).toBe("")
    // Fixtures may add newer rule versions; the latest registry version of
    // every catalogue question still names a rule.
    expect(
      psql(
        `select coalesce(string_agg(c.key, ',' order by c.key), '') from public.amenity_catalogue c
         join public.knowledge_question_versions v on v.key = c.key
         where v.version = (select max(x.version) from public.knowledge_question_versions x where x.key = c.key)
           and v.rule_version is null`
      )
    ).toBe("")
  })

  it("asks a venue manager to confirm accessibility claims and auto-completes observations", () => {
    const rule = (key: string) =>
      psql(
        `select confirmation || ':' || self_confirmation_allowed || ':' || unassigned_auto_complete
         from public.knowledge_question_rules where question_key = '${key}'
         order by rule_version desc limit 1`
      )
    expect(rule("accessible_toilet")).toBe("venue_manager:true:false")
    expect(rule("hearing_loop")).toBe("venue_manager:true:false")
    expect(rule("pool_table")).toBe("none:false:true")
    expect(rule("darts")).toBe("none:false:true")
  })

  it("lets pool_table join the working list and gives it a Facilities slot (FA-32)", async () => {
    const w = await knowledgeWorld("s3r2-d4", {
      extra: ["pool_table", "darts"],
      inScope: ["pool_table", "darts"],
    })
    const slot = (key: string) =>
      psql(
        `select coalesce((select r.slot_kind || ':' || r.category || ':' || r.required || ':' || r.state
          from private.coverage_slot_rows('${w.venue}') r
          where r.slot_id = '${w.checks[key]}'), 'none')`
      )
    // A counted Facilities slot whose photo the catalogue requires (`photo`).
    expect(slot("pool_table")).toBe("amenity:facilities:true:missing")
    expect(slot("darts")).toBe("amenity:facilities:true:missing")
    // knowledge_set_working_list accepted them (no knowledge_rule_missing).
    expect(
      psql(
        `select count(*) from public.knowledge_working_list
         where venue_id = '${w.venue}' and question_key in ('pool_table', 'darts') and disabled_at is null`
      )
    ).toBe("2")
  })
})
