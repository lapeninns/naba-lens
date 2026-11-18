// S1-FACTS (Full App v1): facts and freshness. Spec §9.2, §9.3, §10, §14.3,
// §18.1, AC24, AC25, AC30. 90-day check dates counted from the day an answer
// was last verified; "Still right" without a new contribution or photo; the
// five verification states; confirmed fact coverage; structured guest
// answers; space photo checks. Real signed-in identities through PostgREST;
// psql only builds fixtures (ageing a row with replica mode) and reads back.
import { beforeAll, describe, expect, it } from "vitest"

import {
  anonClient,
  createIdentity,
  type TestIdentity,
} from "../support/identities"
import { grantManager, insertAsset, ok, psql } from "./coverage-fixtures"
import {
  call,
  decide,
  json,
  londonToday,
  refused,
  service,
  slotRevision,
  submit,
  world,
  yes,
  type World,
} from "./knowledge-fixtures"

type FactItem = {
  key: string
  applicable: boolean
  verification: string | null
  publicVerification: string | null
  answer: string | null
  valueInUse: string | null
  sourceType: string | null
  verifiedOn: string | null
  nextCheckDue: string | null
  nextCheckSetBy: string | null
  revision: number
}
type Coverage = {
  numerator: number
  denominator: number
  checkDue: number
  unconfirmed: number
  withdrawn: number
  publicNumerator: number
  byCategory: { category: string; numerator: number; denominator: number }[]
}
type GuestAnswer = {
  key: string
  verification: string
  value: string | null
  conditions: Record<string, unknown>
  verifiedOn: string | null
  nextCheckDue: string | null
  source: { type: string; id: string; idKind: string } | null
}

const anon = { client: anonClient() }
const facts = async (who: TestIdentity | { client: unknown }, venue: string) =>
  (
    await json<{ items: FactItem[] }>(who, "knowledge_fact_states", {
      p_venue_id: venue,
    })
  ).items
const fact = async (who: TestIdentity, venue: string, key: string) =>
  (await facts(who, venue)).find((i) => i.key === key)!
const coverage = (who: TestIdentity, venue: string) =>
  json<Coverage>(who, "knowledge_fact_coverage", { p_venue_id: venue })
const guest = async (venue: string, keys: string[], use = "public") =>
  (
    await json<{ answers: GuestAnswer[] }>(
      { client: service },
      "knowledge_guest_answers",
      { p_venue_id: venue, p_keys: keys, p_use: use }
    )
  ).answers
const reconfirmArgs = (
  w: World,
  key: string,
  o: { checkedOn?: string; next?: string; reconfirm?: boolean } = {}
) => ({
  p_check_id: w.checks[key],
  p_slot_revision: slotRevision(w.venue, key),
  ...(o.checkedOn ? { p_checked_on: o.checkedOn } : {}),
  ...(o.next ? { p_next_check_on: o.next } : {}),
  ...(o.reconfirm === false ? { p_reconfirm: false } : {}),
})
const shiftDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
/** Local midnight (Europe/London) of a calendar date, as an instant. */
const londonMidnight = (iso: string) =>
  psql(
    `select to_char(('${iso}'::date::timestamp at time zone 'Europe/London') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`
  )

/** Ages the answer in use (its submission and decisions) by `days`. */
function ageAnswer(venue: string, key: string, days: number) {
  psql(`begin;
    set local session_replication_role = replica;
    update public.amenity_submissions s set created_at = s.created_at - interval '${days} days'
    from public.venue_amenity_checks c
    where c.venue_id = '${venue}' and c.template_key = '${key}' and s.id = c.current_submission_id;
    update public.knowledge_decisions d set created_at = d.created_at - interval '${days} days'
    from public.venue_amenity_checks c
    where c.venue_id = '${venue}' and c.template_key = '${key}'
      and (d.submission_id = c.current_submission_id or d.resulting_submission_id = c.current_submission_id);
    commit;`)
}

async function inactiveManager(w: World, label: string) {
  const m = await createIdentity(service, {
    label,
    role: "manager",
    venueId: w.venue,
  })
  await grantManager(w.admin, m.id, w.venue)
  await ok(service.from("profiles").update({ active: false }).eq("id", m.id))
  return m
}

describe("check-date rules and registry (spec §9.3)", () => {
  it("seeds 90-day fact and space photo rules counted from verification, named by every question", () => {
    expect(
      psql(`select string_agg(id || ':' || use || ':' || extract(day from max_age) || ':' || basis, ',' order by id, use)
        from public.knowledge_freshness_policies where left(id, 5) <> 'test_'`)
    ).toBe(
      "fact_internal:internal:90:verified_on,fact_public:public:90:verified_on,space_photo:public:90:verified_on"
    )
    expect(
      psql(`select count(*) from public.knowledge_questions q
        where (private.knowledge_version_as_of(q.key, now())).freshness
          is distinct from '{"internal": "fact_internal", "public": "fact_public"}'::jsonb`)
    ).toBe("0")
    // guest_wifi: a manager confirms; the rule row and the registry agree.
    expect(
      psql(`select r.confirmation || ':' || r.self_confirmation_allowed || ':' || v.confirmation || ':' || v.rule_version
        from public.knowledge_question_rules r
        join lateral (select * from public.knowledge_question_versions x where x.key = r.question_key
          order by x.version desc limit 1) v on true
        where r.question_key = 'guest_wifi' order by r.rule_version desc limit 1`)
    ).toBe("venue_manager:true:venue_manager:2")
    expect(
      psql(`select value_schema || '@' || value_schema_version || ':' || (upgrade_rules ->> 'presence@1')
        from public.knowledge_question_versions where key = 'outdoor_seating' order by version desc limit 1`)
    ).toBe("facility@1:lossless")
  })

  it("maps the resolver's states to the spec's verification states", () => {
    const v = (s: string, r: string | null, d: string | null) =>
      psql(
        `select coalesce(private.knowledge_fact_verification('${s}', ${r ? `'${r}'` : "null"}, ${d ? `'${d}'` : "null"}), 'null')`
      )
    expect(v("available", null, null)).toBe("confirmed")
    expect(v("unavailable", "stale", "qualified_answer")).toBe("confirmed")
    expect(v("unavailable", "stale", "expired")).toBe("check_due")
    expect(v("unavailable", "stale", "basis_missing")).toBe("check_due")
    expect(v("unavailable", "stale", "recheck_requested")).toBe("check_due")
    expect(v("unavailable", "disputed", "conflict")).toBe("check_due")
    expect(v("unavailable", "withdrawn", "answer_withdrawn")).toBe("withdrawn")
    expect(v("unavailable", "not_confirmed", "pending")).toBe("unconfirmed")
    expect(v("unavailable", "unknown", "not_checked")).toBe("unconfirmed")
    expect(v("unavailable", "unknown", "not_enabled")).toBe("null")
  })
})

describe("facts: verification, reconfirmation and coverage", () => {
  let w: World
  let other: World

  beforeAll(async () => {
    w = await world("facts-fresh")
    other = await world("facts-fresh-other")
  })

  it("a new answer is confirmed and current, due 90 days after it was verified", async () => {
    await yes(w.staffA, w, "guest_toilets")
    const item = await fact(w.manager, w.venue, "guest_toilets")
    const today = londonToday()
    expect(item).toMatchObject({
      verification: "confirmed",
      publicVerification: "confirmed",
      answer: "yes",
      sourceType: "staff_observation",
      verifiedOn: today,
      nextCheckSetBy: null,
    })
    expect(new Date(item.nextCheckDue!).toISOString()).toBe(
      new Date(londonMidnight(shiftDays(today, 90))).toISOString()
    )
  })

  it("AC25: a staff Wi-Fi Yes with a photo, a video and test notes stays unconfirmed until a manager confirms", async () => {
    const sent = await yes(w.staffA, w, "guest_wifi")
    expect(sent.outcome).toBe("awaiting_confirmation")
    expect(await fact(w.manager, w.venue, "guest_wifi")).toMatchObject({
      verification: "unconfirmed",
      valueInUse: null,
    })
    const [answer] = await guest(w.venue, ["guest_wifi"])
    expect(answer).toMatchObject({
      verification: "unconfirmed",
      value: null,
      source: null,
    })
  })

  it("coverage counts confirmed answers (a confirmed No included) over applicable questions; a confirmed Not applicable leaves both", async () => {
    await submit(w.staffA, w, "onsite_parking", { answer: "not_applicable" })
    // guest_toilets confirmed; step_free_entrance not checked; guest_wifi waiting.
    expect(await coverage(w.manager, w.venue)).toMatchObject({
      numerator: 1,
      denominator: 3,
      unconfirmed: 2,
      checkDue: 0,
      publicNumerator: 1,
    })
    const v2 = await world("facts-fresh-no")
    await submit(v2.staffA, v2, "guest_toilets", { answer: "no" })
    await yes(v2.staffA, v2, "onsite_parking")
    expect(await coverage(v2.admin, v2.venue)).toMatchObject({
      numerator: 2,
      denominator: 4,
    })
  })

  it("past its check date a fact is check due: out of the coverage numerator and with no guest value, never a No", async () => {
    ageAnswer(w.venue, "guest_toilets", 91)
    expect(await fact(w.manager, w.venue, "guest_toilets")).toMatchObject({
      verification: "check_due",
      answer: "yes",
      valueInUse: null,
    })
    expect(await coverage(w.manager, w.venue)).toMatchObject({
      numerator: 0,
      denominator: 3,
      checkDue: 1,
    })
    const [answer] = await guest(w.venue, ["guest_toilets"])
    expect(answer).toMatchObject({ verification: "check_due", value: null })
    // The job opens one recheck, idempotently.
    await json({ client: service }, "knowledge_run_rechecks")
    await json({ client: service }, "knowledge_run_rechecks")
    expect(
      psql(`select count(*) from public.knowledge_recheck_tasks
        where check_id = '${w.checks.guest_toilets}' and state = 'open' and cause = 'expired'`)
    ).toBe("2")
  })

  it("refuses Still right to staff, another venue's manager, an inactive manager and anon; checks the revision", async () => {
    const args = reconfirmArgs(w, "guest_toilets")
    await refused(
      w.staffA,
      "knowledge_reconfirm",
      args,
      "amenity_check_not_found"
    )
    await refused(
      other.manager,
      "knowledge_reconfirm",
      args,
      "amenity_check_not_found"
    )
    const leaver = await inactiveManager(w, "facts-fresh-leaver")
    const { error } = await call(leaver, "knowledge_reconfirm", args)
    expect(error).not.toBeNull()
    const { error: anonError } = await call(anon, "knowledge_reconfirm", args)
    expect(anonError).not.toBeNull()
    await refused(
      w.manager,
      "knowledge_reconfirm",
      { ...args, p_slot_revision: args.p_slot_revision - 1 },
      "amenity_conflict"
    )
    await refused(
      w.manager,
      "knowledge_reconfirm",
      { ...args, p_checked_on: shiftDays(londonToday(), 1) },
      "invalid_value"
    )
    await refused(
      w.manager,
      "knowledge_reconfirm",
      { ...args, p_next_check_on: shiftDays(londonToday(), 400) },
      "invalid_value"
    )
    // An unconfirmed answer needs a decision, not a reconfirmation.
    await refused(
      w.manager,
      "knowledge_reconfirm",
      reconfirmArgs(w, "guest_wifi"),
      "knowledge_reconfirm_not_allowed"
    )
  })

  it("AC30: Still right restores Confirmed and current without a new contribution, closes the rechecks and raises the revision", async () => {
    const before = slotRevision(w.venue, "guest_toilets")
    const contributions = psql(
      `select count(*) from public.knowledge_contributions where check_id = '${w.checks.guest_toilets}'`
    )
    const out = await json<{
      verification: string
      verifiedOn: string
      slotRevision: number
      rechecksClosed: { taskId: string; use: string }[]
    }>(w.manager, "knowledge_reconfirm", reconfirmArgs(w, "guest_toilets"))
    expect(out).toMatchObject({
      verification: "confirmed",
      verifiedOn: londonToday(),
    })
    expect(out.slotRevision).toBe(before + 1)
    expect(out.rechecksClosed.map((r) => r.use).sort()).toEqual([
      "internal",
      "public",
    ])
    expect(
      psql(
        `select count(*) from public.knowledge_contributions where check_id = '${w.checks.guest_toilets}'`
      )
    ).toBe(contributions)
    expect(await coverage(w.manager, w.venue)).toMatchObject({
      numerator: 1,
      checkDue: 0,
    })
    const [answer] = await guest(w.venue, ["guest_toilets"])
    expect(answer).toMatchObject({
      verification: "confirmed",
      value: "yes",
      verifiedOn: londonToday(),
    })
    expect(answer.source).toMatchObject({ type: "staff_observation" })
  })

  it("M5: a manager can bring the next check forward, never push it back; an admin may check too", async () => {
    const today = londonToday()
    const soon = shiftDays(today, 10)
    await json(
      w.admin,
      "knowledge_reconfirm",
      reconfirmArgs(w, "guest_toilets", { next: soon, reconfirm: false })
    )
    let item = await fact(w.manager, w.venue, "guest_toilets")
    expect(item.nextCheckSetBy).toBe("manager")
    expect(new Date(item.nextCheckDue!).toISOString()).toBe(
      new Date(londonMidnight(soon)).toISOString()
    )
    // A later date than the rule's is ignored.
    await json(
      w.manager,
      "knowledge_reconfirm",
      reconfirmArgs(w, "guest_toilets", { next: shiftDays(today, 200) })
    )
    item = await fact(w.manager, w.venue, "guest_toilets")
    expect(item.nextCheckSetBy).toBeNull()
    expect(new Date(item.nextCheckDue!).toISOString()).toBe(
      new Date(londonMidnight(shiftDays(today, 90))).toISOString()
    )
  })

  it("reads are for the venue's manager or an admin; guest answers for the service role only", async () => {
    for (const fn of ["knowledge_fact_states", "knowledge_fact_coverage"]) {
      await refused(
        w.staffA,
        fn,
        { p_venue_id: w.venue },
        "knowledge_venue_not_found"
      )
      await refused(
        other.manager,
        fn,
        { p_venue_id: w.venue },
        "knowledge_venue_not_found"
      )
      const { error } = await call(anon, fn, { p_venue_id: w.venue })
      expect(error).not.toBeNull()
      expect(
        (await json<{ venueId: string }>(w.admin, fn, { p_venue_id: w.venue }))
          .venueId
      ).toBe(w.venue)
    }
    const leaver = await inactiveManager(w, "facts-fresh-leaver2")
    const { error: inactive } = await call(leaver, "knowledge_fact_states", {
      p_venue_id: w.venue,
    })
    expect(inactive).not.toBeNull()
    for (const who of [w.manager, w.admin, anon]) {
      const { error } = await call(who, "knowledge_guest_answers", {
        p_venue_id: w.venue,
        p_keys: ["guest_toilets"],
      })
      expect(error).not.toBeNull()
    }
  })

  it("the admin preview forecasts a verified_on rule", async () => {
    const preview = await json<{
      items: {
        venueId: string
        use: string
        expired: number
        answers: number
      }[]
    }>(w.admin, "knowledge_freshness_preview", {
      p_key: "guest_toilets",
      p_policy: { internal: "fact_internal", public: "fact_public" },
    })
    expect(
      preview.items.find((i) => i.venueId === w.venue && i.use === "internal")
    ).toMatchObject({ answers: 1, expired: 0 })
  })
})

describe("space photos: check due, reconfirm, change, end date (AC30)", () => {
  let w: World
  let other: World
  let garden: string
  let label: string

  const state = (labelId: string) =>
    JSON.parse(psql(`select private.area_photo_freshness('${labelId}')`)) as {
      state: string
      cause: string | null
      verifiedOn: string | null
      dueSoon: boolean
    }

  /** An accepted photo of the place, its acceptance `days` ago. */
  async function accepted(days: number) {
    const asset = (
      await insertAsset(service, { uploader: w.staffA.id, venue: w.venue })
    ).id
    const id =
      psql(`insert into public.media_area_labels (asset_id, venue_id, subject_id, subject_kind, subject_label, added_by)
      values ('${asset}', '${w.venue}', '${garden}', 'area', 'Garden', '${w.staffA.id}') returning id`)
    psql(`insert into public.area_photo_decisions (label_id, venue_id, asset_id, action, decided_by, decided_at)
      values ('${id}', '${w.venue}', '${asset}', 'accepted', '${w.admin.id}', now() - interval '${days} days')`)
    return id
  }

  beforeAll(async () => {
    w = await world("facts-space")
    other = await world("facts-space-other")
    garden =
      psql(`insert into public.knowledge_subjects (venue_id, kind, label, created_by)
      values ('${w.venue}', 'area', 'Garden', '${w.admin.id}') returning id`)
    label = await accepted(100)
  })

  it("an unchanged garden past its review date is check due, not needing replacement", async () => {
    expect(state(label)).toMatchObject({
      state: "check_due",
      cause: "review_date_passed",
    })
    const fresh = await accepted(1)
    expect(state(fresh)).toMatchObject({ state: "current", dueSoon: false })
    const rows = await json<{ label_id: string; state: string }[]>(
      w.manager,
      "area_photo_freshness_list",
      { p_venue_id: w.venue }
    )
    expect(rows.find((r) => r.label_id === label)?.state).toBe("check_due")
  })

  it("refuses reconfirmation to staff, another venue's manager, an inactive manager and anon", async () => {
    const args = { p_subject_id: garden }
    await refused(
      w.staffA,
      "area_photo_reconfirm",
      args,
      "knowledge_subject_not_found"
    )
    await refused(
      other.manager,
      "area_photo_reconfirm",
      args,
      "knowledge_subject_not_found"
    )
    const leaver = await inactiveManager(w, "facts-space-leaver")
    const { error } = await call(leaver, "area_photo_reconfirm", args)
    expect(error).not.toBeNull()
    const { error: anonError } = await call(anon, "area_photo_reconfirm", args)
    expect(anonError).not.toBeNull()
    await refused(
      other.manager,
      "area_photo_freshness_list",
      { p_venue_id: w.venue },
      "not_venue_manager"
    ).catch(async () => {
      const { error: e } = await call(
        other.manager,
        "area_photo_freshness_list",
        {
          p_venue_id: w.venue,
        }
      )
      expect(e).not.toBeNull()
    })
    const { error: staffList } = await call(
      w.staffA,
      "area_photo_freshness_list",
      {
        p_venue_id: w.venue,
      }
    )
    expect(staffList).not.toBeNull()
  })

  it("Still right restores current without a new photo", async () => {
    const out = await json<{ photos: number }>(
      w.manager,
      "area_photo_reconfirm",
      {
        p_subject_id: garden,
      }
    )
    expect(out.photos).toBe(2)
    expect(state(label)).toMatchObject({
      state: "current",
      verifiedOn: londonToday(),
    })
    // An admin may reconfirm too.
    await json(w.admin, "area_photo_reconfirm", { p_subject_id: garden })
  })

  it("a reported change makes it check due; a known change needs replacement; only managers say so", async () => {
    await refused(
      w.staffA,
      "area_photo_report_change",
      { p_subject_id: garden, p_reason: "TEST", p_replacement: true },
      "not_venue_manager"
    )
    await refused(
      w.staffA,
      "area_photo_report_change",
      { p_subject_id: garden, p_reason: null },
      "reason_required"
    )
    await refused(
      other.staffA,
      "area_photo_report_change",
      { p_subject_id: garden, p_reason: "TEST" },
      "knowledge_subject_not_found"
    )
    const { error: anonError } = await call(anon, "area_photo_report_change", {
      p_subject_id: garden,
      p_reason: "TEST",
    })
    expect(anonError).not.toBeNull()
    await json(w.staffA, "area_photo_report_change", {
      p_subject_id: garden,
      p_reason: "TEST new fencing",
    })
    expect(state(label)).toMatchObject({
      state: "check_due",
      cause: "change_reported",
    })
    await json(w.manager, "area_photo_report_change", {
      p_subject_id: garden,
      p_reason: "TEST renovated",
      p_replacement: true,
    })
    expect(state(label)).toMatchObject({
      state: "needs_replacement",
      cause: "replacement_needed",
    })
  })

  it("an explicit end date expires the photo once passed", async () => {
    const photo = await accepted(1)
    await refused(
      w.manager,
      "area_photo_set_end_date",
      { p_label_id: photo, p_valid_until: shiftDays(londonToday(), -1) },
      "invalid_value"
    )
    await refused(
      other.manager,
      "area_photo_set_end_date",
      { p_label_id: photo, p_valid_until: londonToday() },
      "area_photo_not_found"
    )
    await refused(
      w.staffA,
      "area_photo_set_end_date",
      { p_label_id: photo, p_valid_until: londonToday() },
      "area_photo_not_found"
    )
    await json(w.manager, "area_photo_set_end_date", {
      p_label_id: photo,
      p_valid_until: londonToday(),
    })
    expect(state(photo).state).toBe("current")
    psql(`insert into public.area_photo_checks (label_id, venue_id, subject_id, kind, valid_until, decided_by, decider_basis)
      values ('${photo}', '${w.venue}', '${garden}', 'end_date_set', current_date - 2, '${w.manager.id}', 'venue_manager')`)
    expect(state(photo).state).toBe("expired")
  })

  it("no client role reads or writes the new tables directly", async () => {
    for (const table of [
      "area_photo_checks",
      "knowledge_fact_checks",
    ] as const) {
      const { data } = await w.manager.client.from(table).select("id")
      expect(data ?? []).toEqual([])
      const { error } = await w.manager.client
        .from(table)
        .insert({ venue_id: w.venue } as never)
      expect(error).not.toBeNull()
    }
  })
})

describe("confirmation keeps its verification date", () => {
  it("a manager-confirmed Wi-Fi answer is confirmed with source staff_observation_confirmed", async () => {
    const w = await world("facts-wifi-confirm")
    const sent = await yes(w.staffA, w, "guest_wifi")
    const { error } = await decide(
      w.manager,
      w,
      "guest_wifi",
      { type: "contribution", id: sent.contributionId },
      "confirm"
    )
    expect(error).toBeNull()
    expect(await fact(w.manager, w.venue, "guest_wifi")).toMatchObject({
      verification: "confirmed",
      sourceType: "staff_observation_confirmed",
      verifiedOn: londonToday(),
    })
  })
})
