// B03-g corrections, withdrawals, upgrades and history (docs/knowledge/b03-design.md
// §9, A1, A15, A16) with the C-B03 credit tests (§9.6). A material
// correction is adopted through B01's path by a manager account or an admin
// and needs confirmation again; a withdrawal is a decision only, so no credit
// input moves; staff holding a legacy grant may do neither. Real signed-in
// identities through PostgREST; psql reads state and credit counts back.
import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { psql } from "./coverage-fixtures"
import {
  call,
  decide,
  json,
  service,
  slotRevision,
  world,
  yes,
  type World,
} from "./knowledge-fixtures"

const MONTH = `date_trunc('month', now() at time zone 'Europe/London')::date`
const units = (w: World, staff: string) =>
  Number(
    psql(`select amenity_checks_completed from private.monthly_venue_completion_counts(
    '${w.venue}', '${staff}', ${MONTH})`)
  )
const participant = (w: World, id: string) =>
  psql(`select count(*) from private.completion_staff_venue_memberships
    where venue_id = '${w.venue}' and staff_id = '${id}'`) !== "0"

const correct = (
  who: World["manager"],
  w: World,
  key: string,
  headline: string,
  o: { revision?: number; idempotencyKey?: string; detail?: object | null } = {}
) =>
  call(who, "knowledge_correct", {
    p_check_id: w.checks[key],
    p_slot_revision: o.revision ?? slotRevision(w.venue, key),
    p_idempotency_key: o.idempotencyKey ?? randomUUID(),
    p_headline: headline,
    p_detail: o.detail ?? null,
    p_reason: "TEST corrected",
  })
const withdraw = (who: World["manager"], w: World, key: string) =>
  call(who, "knowledge_withdraw", {
    p_check_id: w.checks[key],
    p_slot_revision: slotRevision(w.venue, key),
    p_idempotency_key: randomUUID(),
    p_reason: "TEST withdrawn",
  })

describe("who may correct and withdraw (C-B03-2, A1)", () => {
  it("is a manager account or an admin; staff, and staff holding a legacy grant, are refused", async () => {
    const w = await world("kn-b03-g-who")
    await yes(w.staffA, w, "guest_toilets")
    for (const who of [w.staffA, w.staffManager]) {
      expect(
        (await correct(who, w, "guest_toilets", "no")).error?.message,
        who.id
      ).toBe("not_venue_manager")
      expect(
        (await withdraw(who, w, "guest_toilets")).error?.message,
        who.id
      ).toBe("not_venue_manager")
    }
    const caps = async (who: World["manager"], venue: string | null = null) =>
      json<{
        canCorrect: boolean
        canWithdraw: boolean
        canReadHistory: boolean
      }>(who, "my_venue_capabilities", {
        p_venue_id: venue,
      })
    expect(await caps(w.manager)).toMatchObject({
      canCorrect: true,
      canWithdraw: true,
      canReadHistory: true,
    })
    expect(await caps(w.admin, w.venue)).toMatchObject({
      canCorrect: true,
      canWithdraw: true,
    })
    expect(await caps(w.staffManager)).toMatchObject({
      canCorrect: false,
      canWithdraw: false,
      canReadHistory: true,
    })
    expect(await caps(w.staffA)).toMatchObject({
      canCorrect: false,
      canWithdraw: false,
      canReadHistory: false,
    })
  })
})

describe("material corrections (§9.1, C-B03-1)", () => {
  it("move the author's open-month unit to a corrector who never takes part, and record before and after", async () => {
    for (const corrector of ["manager", "admin"] as const) {
      const w = await world(`kn-b03-g-c1-${corrector}`)
      const sent = await yes(w.staffA, w, "guest_toilets")
      expect(sent.outcome).toBe("current")
      const before = units(w, w.staffA.id)
      expect(before).toBeGreaterThanOrEqual(1)
      const { data, error } = await correct(
        w[corrector],
        w,
        "guest_toilets",
        "no"
      )
      expect(error).toBeNull()
      expect(data).toMatchObject({ material: true })
      expect(units(w, w.staffA.id)).toBe(before - 1)
      expect(participant(w, w[corrector].id)).toBe(false)
      expect(
        JSON.parse(
          psql(`select d.detail from public.knowledge_decisions d
          where d.check_id = '${w.checks.guest_toilets}' and d.decision = 'corrected'`)
        )
      ).toMatchObject({
        before: { headline: "yes" },
        after: { headline: "no" },
        material: true,
        selectionRule: "correction",
      })
      const [view] = (
        await json<{
          items: {
            findingRef: { id: string }
            stateReason: string
            managerNote: string
          }[]
        }>(w.staffA, "knowledge_my_contributions", {
          p_cursor: null,
          p_limit: 20,
        })
      ).items.filter((i) => i.findingRef.id === sent.contributionId)
      expect(view).toMatchObject({
        stateReason: "corrected",
        managerNote: "TEST corrected",
      })
    }
  })

  it("drop the confirmation: the corrected answer needs confirming again", async () => {
    const w = await world("kn-b03-g-confirm")
    const sent = await yes(w.staffA, w, "step_free_entrance")
    expect(
      (
        await decide(
          w.manager,
          w,
          "step_free_entrance",
          { type: "contribution", id: sent.contributionId },
          "confirm"
        )
      ).error
    ).toBeNull()
    expect(
      (await correct(w.admin, w, "step_free_entrance", "no")).error
    ).toBeNull()
    const [row] = await json<
      { status: string; reason: string; confirmation_state: string }[]
    >({ client: service }, "knowledge_reader_answers_v1", {
      p_venue_id: w.venue,
      p_keys: ["step_free_entrance"],
    })
    expect(row).toMatchObject({
      status: "unavailable",
      reason: "not_confirmed",
    })
  })

  it("refuse no change, detail on a version 1 key, and a stale revision with nothing written", async () => {
    const w = await world("kn-b03-g-refuse")
    await yes(w.staffA, w, "guest_toilets")
    expect(
      (await correct(w.manager, w, "guest_toilets", "yes")).error?.message
    ).toBe("nothing_to_correct")
    const detail = await correct(w.manager, w, "guest_toilets", "no", {
      detail: { limitations: "x" },
    })
    expect(detail.error?.message).toBe("invalid_value")
    const revision = slotRevision(w.venue, "guest_toilets")
    expect(
      (await correct(w.manager, w, "guest_toilets", "no", { revision })).error
    ).toBeNull()
    expect(
      (
        await correct(w.admin, w, "guest_toilets", "not_applicable", {
          revision,
        })
      ).error?.message
    ).toBe("amenity_conflict")
    expect(
      psql(
        `select count(*) from public.knowledge_decisions where check_id = '${w.checks.guest_toilets}' and decision = 'corrected'`
      )
    ).toBe("1")
  })
})

describe("withdrawals (§9.2, C-B03-3)", () => {
  it("read withdrawn for every audience, move no credit input, and let a later answer replace it", async () => {
    const w = await world("kn-b03-g-withdraw")
    const sent = await yes(w.staffA, w, "onsite_parking")
    const before = units(w, w.staffA.id)
    const stored = () =>
      psql(`select progress || ':' || answer || ':' || current_submission_id from public.venue_amenity_checks
        where id = '${w.checks.onsite_parking}'`)
    const events = () =>
      psql(
        `select count(*) from public.amenity_check_events where check_id = '${w.checks.onsite_parking}'`
      )
    const was = [stored(), events()]
    expect((await withdraw(w.manager, w, "onsite_parking")).error).toBeNull()
    expect(
      (await withdraw(w.manager, w, "onsite_parking")).error?.message
    ).toBe("already_decided")
    expect([stored(), events()]).toEqual(was)
    // Review M3: the legacy check reads show it as needing a recheck.
    const [legacyRow] = await json<
      { progress: string; recheck_reason: string; qualification: string }[]
    >(w.manager, "amenity_check", { p_check_id: w.checks.onsite_parking })
    expect(legacyRow).toMatchObject({
      progress: "needs_recheck",
      recheck_reason:
        "The answer in use was withdrawn. Open the check to see why.",
      qualification: "withdrawn",
    })
    expect(units(w, w.staffA.id)).toBe(before)
    const [row] = await json<
      { status: string; reason: string; detail: string; value: string | null }[]
    >({ client: service }, "knowledge_reader_answers_v1", {
      p_venue_id: w.venue,
      p_keys: ["onsite_parking"],
    })
    expect(row).toMatchObject({
      status: "unavailable",
      reason: "withdrawn",
      detail: "answer_withdrawn",
      value: null,
    })
    const withdrawnAt =
      psql(`select to_json(created_at) #>> '{}' from public.knowledge_decisions
      where check_id = '${w.checks.onsite_parking}' and decision = 'withdrawn'`)
    for (const who of [w.staffA, w.staffB, w.manager]) {
      const check = await json<{
        answerInUse: { withdrawal: { at: string; basis: string } | null }
      }>(who, "knowledge_check", { p_check_id: w.checks.onsite_parking })
      expect(check).toMatchObject({
        status: "unavailable",
        reason: "withdrawn",
      })
      // Staff withdrawal line: when and on which basis, never who or why.
      expect(check.answerInUse.withdrawal).toEqual({
        at: expect.any(String),
        basis: "venue_manager",
      })
      expect(new Date(check.answerInUse.withdrawal!.at).getTime()).toBe(
        new Date(withdrawnAt).getTime()
      )
      expect(JSON.stringify(check.answerInUse), who.id).not.toContain(
        "TEST withdrawn"
      )
    }
    // The non-author's working-list row carries the same line, no reason.
    const rows = await json<{
      items: {
        checkId: string
        answerInUse: { withdrawal: unknown } | null
        myLatest: unknown
      }[]
    }>(w.staffB, "knowledge_working_list")
    const staffRow = rows.items.find(
      (r) => r.checkId === w.checks.onsite_parking
    )!
    expect(staffRow.answerInUse?.withdrawal).toEqual({
      at: expect.any(String),
      basis: "venue_manager",
    })
    expect(JSON.stringify(staffRow)).not.toContain("TEST withdrawn")
    const [view] = (
      await json<{
        items: {
          findingRef: { id: string }
          stateReason: string
          managerNote: string | null
          stateReasonBasis: string | null
          stateReasonAt: string | null
        }[]
      }>(w.staffA, "knowledge_my_contributions", {
        p_cursor: null,
        p_limit: 20,
      })
    ).items.filter((i) => i.findingRef.id === sent.contributionId)
    // The author alone reads why, with the basis and time of the withdrawal.
    expect(view).toMatchObject({
      stateReason: "withdrawn",
      managerNote: "TEST withdrawn",
      stateReasonBasis: "venue_manager",
    })
    expect(new Date(view!.stateReasonAt!).getTime()).toBe(
      new Date(withdrawnAt).getTime()
    )

    const again = await yes(w.staffB, w, "onsite_parking")
    if (again.outcome === "awaiting_confirmation")
      expect(
        (
          await decide(
            w.manager,
            w,
            "onsite_parking",
            { type: "contribution", id: again.contributionId },
            "confirm"
          )
        ).error
      ).toBeNull()
    expect(
      await json(w.manager, "knowledge_check", {
        p_check_id: w.checks.onsite_parking,
      })
    ).toMatchObject({ status: "available", answerInUse: { withdrawal: null } })
  })

  it("name an admin's withdrawal as an admin's to staff", async () => {
    const w = await world("kn-b03-g-withdraw-admin")
    await yes(w.staffA, w, "onsite_parking")
    expect((await withdraw(w.admin, w, "onsite_parking")).error).toBeNull()
    const check = await json<{
      answerInUse: { withdrawal: { basis: string } | null }
    }>(w.staffB, "knowledge_check", { p_check_id: w.checks.onsite_parking })
    expect(check.answerInUse.withdrawal?.basis).toBe("admin")
  })
})

describe("a withdrawn answer off the working list (WS5 item 1)", () => {
  it("reads not_enabled once its key leaves the working list", async () => {
    const w = await world("kn-b03-g-withdrawn-off")
    await yes(w.staffA, w, "onsite_parking")
    expect((await withdraw(w.manager, w, "onsite_parking")).error).toBeNull()
    await json(w.admin, "knowledge_set_working_list", {
      p_venue_id: w.venue,
      p_keys: ["onsite_parking"],
      p_enabled: false,
      p_reason: "TEST off the list",
    })
    const [row] = await json<
      { status: string; reason: string; detail: string }[]
    >({ client: service }, "knowledge_reader_answers_v1", {
      p_venue_id: w.venue,
      p_keys: ["onsite_parking"],
    })
    expect(row).toMatchObject({
      status: "unavailable",
      reason: "unknown",
      detail: "not_enabled",
    })
    // Off the list the withdrawal line goes with the withdrawn reading.
    const check = await json<{
      answerInUse: { withdrawal: unknown } | null
    }>(w.manager, "knowledge_check", { p_check_id: w.checks.onsite_parking })
    expect(check.answerInUse?.withdrawal ?? null).toBeNull()
  })
})

describe("imports never displace an answer (C-B03-4)", () => {
  it("refuses a disagreeing import on a slot whose answer was withdrawn, and an adopted import creates no unit", async () => {
    const w = await world("kn-b03-g-c4")
    await yes(w.staffA, w, "guest_toilets")
    expect((await withdraw(w.manager, w, "guest_toilets")).error).toBeNull()
    const fact = randomUUID()
    psql(`insert into public.venue_amenity_facts (id, venue_id, amenity_key, presence) values
      ('${fact}', '${w.venue}', 'toilets', 'absent')`)
    await json(w.admin, "knowledge_mapping_review", {
      p_legacy_fact_id: fact,
      p_legacy_revision: 1,
      p_question_key: "guest_toilets",
      p_kind: "exact",
      p_reason: "TEST",
      p_idempotency_key: randomUUID(),
    })
    await json(w.admin, "knowledge_reconcile", {
      p_kind: "legacy",
      p_mode: "dry_run",
      p_venue_id: w.venue,
    })
    await json(w.admin, "knowledge_reconcile", {
      p_kind: "legacy",
      p_mode: "apply",
      p_venue_id: w.venue,
    })
    const imported = psql(
      `select contribution_id from public.knowledge_contribution_sources where legacy_fact_id = '${fact}'`
    )
    expect(
      (
        await decide(
          w.manager,
          w,
          "guest_toilets",
          { type: "contribution", id: imported },
          "confirm"
        )
      ).error?.message
    ).toBe("import_slot_has_answer")
    expect(units(w, w.admin.id)).toBe(0)
  })
})

describe("history and events (§9.4, A16)", () => {
  it("rebuild the answer in use at any time and list the slot's events for managers", async () => {
    const w = await world("kn-b03-g-history")
    await yes(w.staffA, w, "guest_toilets")
    const at = psql(`select now()`)
    await new Promise((r) => setTimeout(r, 50))
    expect(
      (await correct(w.manager, w, "guest_toilets", "no")).error
    ).toBeNull()
    type History = {
      answerInUse: {
        answer: string
        submissionId: string
        selectionRule: string
      } | null
    }
    const now = await json<History>(w.manager, "knowledge_slot_history", {
      p_check_id: w.checks.guest_toilets,
      p_at: new Date().toISOString(),
    })
    expect(now.answerInUse).toMatchObject({
      answer: "no",
      selectionRule: "correction",
    })
    expect(now.answerInUse!.submissionId).toBe(
      psql(
        `select current_submission_id from public.venue_amenity_checks where id = '${w.checks.guest_toilets}'`
      )
    )
    const then = await json<History>(w.manager, "knowledge_slot_history", {
      p_check_id: w.checks.guest_toilets,
      p_at: at,
    })
    expect(then.answerInUse).toMatchObject({ answer: "yes" })
    const events = await json<{
      items: { kind: string; before: unknown }[]
      nextCursor: string | null
    }>(w.manager, "knowledge_slot_events", {
      p_check_id: w.checks.guest_toilets,
      p_cursor: null,
      p_limit: 50,
    })
    expect(events.items.map((e) => e.kind)).toContain("correction")
    expect(
      events.items.find((e) => e.kind === "correction")?.before
    ).toMatchObject({ headline: "yes" })
    const page = await json<{ items: unknown[]; nextCursor: string | null }>(
      w.manager,
      "knowledge_slot_events",
      { p_check_id: w.checks.guest_toilets, p_cursor: null, p_limit: 1 }
    )
    expect(page.items).toHaveLength(1)
    expect(page.nextCursor).not.toBeNull()
    for (const fn of ["knowledge_slot_history", "knowledge_slot_events"])
      expect(
        (await call(w.staffA, fn, { p_check_id: w.checks.guest_toilets })).error
          ?.message
      ).toBe("amenity_check_not_found")
  })
})

describe("schema upgrades (§9.3)", () => {
  it("are an admin's dry run then apply, and change nothing without a schema version", async () => {
    const w = await world("kn-b03-g-upgrade")
    await yes(w.staffA, w, "guest_toilets")
    expect(
      (
        await call(w.manager, "knowledge_upgrade_run", {
          p_key: "guest_toilets",
          p_mode: "dry_run",
        })
      ).error?.message
    ).toBe("not_active_admin")
    const dry = await json<{
      counts: { lossless: number; needsChecking: number }
    }>(w.admin, "knowledge_upgrade_run", {
      p_key: "guest_toilets",
      p_mode: "dry_run",
    })
    expect(dry.counts).toMatchObject({ lossless: 0, needsChecking: 0 })
    expect(
      await json(w.admin, "knowledge_upgrade_run", {
        p_key: "guest_toilets",
        p_mode: "apply",
      })
    ).toMatchObject({ derived: 0 })
    expect(
      psql(
        `select count(*) from public.knowledge_question_versions where upgrade_rules <> '{}'::jsonb`
      )
    ).toBe("0")
  })
})

describe("guards", () => {
  it("keep the overlay table append-only, and the hashes unchanged", async () => {
    expect(() => psql(`truncate public.knowledge_detail_corrections`)).toThrow()
    expect(
      psql(
        `select md5(pg_get_functiondef('private.monthly_venue_completion_counts(uuid,uuid,date)'::regprocedure))`
      )
    ).toBe("b78b9daeb8ede1fec0b7224d99348659")
    expect(
      psql(`select string_agg(md5(pg_get_functiondef(t.tgfoid)), ',' order by t.tgname)
        from pg_trigger t where t.tgname in
          ('media_assets_amenity_evidence_lost', 'media_assets_knowledge_evidence_withdrawn')`)
    ).toBe("6c156e9d55c5058e331d904cb6b6eca7,af720155bd3b5945954060520619f7d0")
    expect(
      psql(
        `select md5(pg_get_functiondef('private.knowledge_slot_state(uuid,text[])'::regprocedure))`
      )
    ).toBe("cdcd2a00eb77d64e9ff9306b042a05d4")
  })
})
