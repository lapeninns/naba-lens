// B03-f reconciliation (docs/knowledge/b03-design.md §8, A12, A13, A23).
// Legacy facts and external sources only ever propose: a proposal is a
// finding awaiting confirmation, sent by the admin who ran the apply, adopted
// only onto an empty slot; an agreeing import is recorded as seen and a
// disagreeing one leaves the slot disputed. Runs are dry run then apply,
// idempotent, and blocked when a source changed. Every run here is scoped to
// its test venue. Real signed-in identities through PostgREST; psql builds
// legacy facts and reads state back.
import { randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import { psql } from "./coverage-fixtures"
import {
  call,
  decide,
  json,
  photo,
  resolve,
  service,
  world,
  yes,
  type World,
} from "./knowledge-fixtures"

let w: World
let toilets: string

const reconcile = (
  who: World["admin"],
  kind: string,
  mode: string,
  venue: string
) =>
  call(who, "knowledge_reconcile", {
    p_kind: kind,
    p_mode: mode,
    p_venue_id: venue,
  })

beforeAll(async () => {
  w = await world("kn-b03-reconcile")
  const asset = await photo(w.staffA.id, w.venue)
  toilets = randomUUID()
  psql(`insert into public.venue_amenity_facts (id, venue_id, amenity_key, presence, facts) values
    ('${toilets}', '${w.venue}', 'toilets', 'present', 'TEST two toilets downstairs'),
    (gen_random_uuid(), '${w.venue}', 'parking', 'present', 'TEST car park'),
    (gen_random_uuid(), '${w.venue}', 'accessible_toilet', 'unknown', null)`)
  psql(`insert into public.venue_amenity_fact_media (fact_id, venue_id, asset_id)
    values ('${toilets}', '${w.venue}', '${asset}')`)
  const parking = psql(
    `select id from public.venue_amenity_facts where venue_id = '${w.venue}' and amenity_key = 'parking'`
  )
  for (const [fact, key, kind] of [
    [toilets, "guest_toilets", "exact"],
    [parking, "onsite_parking", "none"],
  ] as const)
    await json(w.admin, "knowledge_mapping_review", {
      p_legacy_fact_id: fact,
      p_legacy_revision: 1,
      p_question_key: key,
      p_kind: kind,
      p_reason: "TEST reviewed",
      p_idempotency_key: randomUUID(),
    })
})

describe("legacy facts (§8.2)", () => {
  it("propose only through an exact mapping, once, as an admin's finding awaiting confirmation", async () => {
    expect(
      (await reconcile(w.admin, "legacy", "apply", w.venue)).error?.message
    ).toBe("reconcile_dry_run_required")
    const dry = await json<{ counts: Record<string, number> }>(
      w.admin,
      "knowledge_reconcile",
      {
        p_kind: "legacy",
        p_mode: "dry_run",
        p_venue_id: w.venue,
      }
    )
    expect(dry.counts).toMatchObject({ candidates: 1, proposals: 1 })
    expect(
      (await reconcile(w.admin, "legacy", "apply", w.venue)).data
    ).toMatchObject({ created: 1 })
    expect(
      (await reconcile(w.admin, "legacy", "apply", w.venue)).data
    ).toMatchObject({
      created: 0,
      counts: { alreadyApplied: 1 },
    })
    expect(
      psql(`select x.question_key || ':' || x.contributor_basis || ':' || x.contributed_by || ':' || x.initial_outcome
          || ':' || (select count(*) from public.knowledge_contribution_assets a where a.contribution_id = x.id)
        from public.knowledge_contributions x
        join public.knowledge_contribution_sources ks on ks.contribution_id = x.id
        where x.venue_id = '${w.venue}'`)
    ).toBe(`guest_toilets:admin:${w.admin.id}:awaiting_confirmation:1`)
    expect(
      psql(`select count(*) from public.knowledge_contributions where venue_id = '${w.venue}'
        and question_key in ('onsite_parking', 'accessible_toilet')`)
    ).toBe("0")
  })

  it("show managers the source and that it can be confirmed, as a suggestion", async () => {
    const check = await json<{ pending: Record<string, unknown>[] }>(
      w.manager,
      "knowledge_check",
      {
        p_check_id: w.checks.guest_toilets,
      }
    )
    expect(check.pending[0]).toMatchObject({
      source: "legacy_fact",
      sourceLabel: "Coverage (legacy record)",
      adoptable: true,
    })
    const triage = await json<{ queue: string; waiting: number }[]>(
      w.manager,
      "manager_triage_summary",
      {
        p_venue_id: null,
      }
    )
    expect(triage.find((q) => q.queue === "suggestions")?.waiting).toBe(1)
    expect(triage.find((q) => q.queue === "findings")?.waiting).toBe(0)
  })

  it("is confirmed onto the empty slot by a manager, the admin staying the sender", async () => {
    const id = psql(
      `select x.id from public.knowledge_contributions x where x.check_id = '${w.checks.guest_toilets}'`
    )
    expect(
      (
        await decide(
          w.manager,
          w,
          "guest_toilets",
          { type: "contribution", id },
          "confirm"
        )
      ).error
    ).toBeNull()
    expect(
      psql(`select c.progress || ':' || (s.submitted_by = '${w.admin.id}') from public.venue_amenity_checks c
        join public.amenity_submissions s on s.id = c.current_submission_id where c.id = '${w.checks.guest_toilets}'`)
    ).toBe("complete:true")
  })

  it("name the source of an adopted import on the answer in use (review low 2)", async () => {
    const check = await json<{
      answerInUse: { source: string; sourceLabel: string | null }
    }>(w.staffA, "knowledge_check", {
      p_check_id: w.checks.guest_toilets,
    })
    expect(check.answerInUse).toMatchObject({
      source: "legacy_fact",
      sourceLabel: "Coverage (legacy record)",
    })
  })

  it("block apply when a mapping review changed after the dry run (review M2)", async () => {
    const v = await world("kn-b03-reconcile-review")
    const fact = randomUUID()
    psql(`insert into public.venue_amenity_facts (id, venue_id, amenity_key, presence) values
      ('${fact}', '${v.venue}', 'toilets', 'present')`)
    const review = (kind: string) =>
      json(v.admin, "knowledge_mapping_review", {
        p_legacy_fact_id: fact,
        p_legacy_revision: 1,
        p_question_key: "guest_toilets",
        p_kind: kind,
        p_reason: "TEST",
        p_idempotency_key: randomUUID(),
      })
    await review("exact")
    await reconcile(v.admin, "legacy", "dry_run", v.venue)
    await review("none")
    const { error } = await reconcile(v.admin, "legacy", "apply", v.venue)
    expect(error?.message).toBe("reconcile_source_changed")
    expect(
      psql(
        `select count(*) from public.knowledge_contribution_sources where legacy_fact_id = '${fact}'`
      )
    ).toBe("0")
  })

  it("block apply when a fact changed after the dry run", async () => {
    await reconcile(w.admin, "legacy", "dry_run", w.venue)
    psql(
      `update public.venue_amenity_facts set revision = revision + 1 where id = '${toilets}'`
    )
    const { error } = await reconcile(w.admin, "legacy", "apply", w.venue)
    expect(error?.message).toBe("reconcile_source_changed")
    expect(error?.code).toBe("NLK12")
  })

  it("keep every legacy fact readable as narrative for managers", async () => {
    const narrative = await json<{
      items: { legacyKey: string; savedAsConfirmedAt: string | null }[]
    }>(w.manager, "knowledge_legacy_narrative", { p_venue_id: null })
    expect(narrative.items.map((i) => i.legacyKey).sort()).toEqual([
      "accessible_toilet",
      "parking",
      "toilets",
    ])
    expect(
      (await call(w.staffA, "knowledge_legacy_narrative", { p_venue_id: null }))
        .error
    ).not.toBeNull()
  })
})

describe("external sources (§8.2)", () => {
  it("corroborate an agreeing answer, dispute a disagreeing one, and never replace the answer in use", async () => {
    const v = await world("kn-b03-reconcile-ext")
    expect((await yes(v.staffA, v, "onsite_parking")).outcome).toBe("current")
    const declare = (kind: string, label: string) =>
      json<{ sourceId: string }>(v.admin, "knowledge_source_declare", {
        p_kind: kind,
        p_label: label,
        p_venue_id: v.venue,
        p_idempotency_key: randomUUID(),
      })
    const site = await declare("venue_website", "TEST website")
    const booking = await declare("booking_site", "TEST booking site")
    const importAs = (source: string, revision: string, headline: string) =>
      call(v.admin, "knowledge_source_import", {
        p_source_id: source,
        p_source_revision: revision,
        p_retrieved_at: new Date(Date.now() - 3_600_000).toISOString(),
        p_assertions: [
          { venueId: v.venue, questionKey: "onsite_parking", headline },
        ],
        p_idempotency_key: randomUUID(),
      })
    expect((await importAs(site.sourceId, "r1", "yes")).data).toMatchObject({
      imported: 1,
    })
    expect((await importAs(site.sourceId, "r1", "yes")).data).toMatchObject({
      imported: 0,
    })
    expect((await importAs(booking.sourceId, "b1", "no")).data).toMatchObject({
      imported: 1,
    })
    const bad = await importAs(booking.sourceId, "b2", "maybe")
    expect(bad.error?.message).toBe("invalid_value")
    expect(JSON.parse(bad.error!.details!)).toEqual({
      fields: [{ path: "assertions[0].headline", problem: "not_allowed" }],
    })

    await reconcile(v.admin, "external", "dry_run", v.venue)
    expect(
      (await reconcile(v.admin, "external", "apply", v.venue)).data
    ).toMatchObject({ created: 2 })
    expect(
      psql(`select string_agg(x.answer || ':' || coalesce((select string_agg(d.decision, ',') from public.knowledge_decisions d
          where d.contribution_id = x.id), '-'), ' ' order by x.answer)
        from public.knowledge_contributions x join public.knowledge_contribution_sources ks on ks.contribution_id = x.id
        where x.venue_id = '${v.venue}'`)
    ).toBe("no:- yes:seen")
    const [row] = await json<{ status: string; reason: string }[]>(
      { client: service },
      "knowledge_reader_answers_v1",
      { p_venue_id: v.venue, p_keys: ["onsite_parking"] }
    )
    expect(row).toMatchObject({ status: "unavailable", reason: "disputed" })

    // Review low 3: the source's words stay internal, never the limitations.
    expect(
      psql(`select count(*) from public.knowledge_contributions x
        join public.knowledge_contribution_sources ks on ks.contribution_id = x.id
        where x.venue_id = '${v.venue}' and ks.source_kind = 'external_source' and x.limitations is not null`)
    ).toBe("0")
    const no =
      psql(`select x.id from public.knowledge_contributions x join public.knowledge_contribution_sources ks
      on ks.contribution_id = x.id where x.venue_id = '${v.venue}' and x.answer = 'no'`)
    const pending = (
      await json<{
        pending: { findingRef: { id: string }; adoptable?: boolean }[]
      }>(v.manager, "knowledge_check", { p_check_id: v.checks.onsite_parking })
    ).pending
    expect(pending.find((p) => p.findingRef.id === no)?.adoptable).toBe(false)
    expect(
      (
        await decide(
          v.manager,
          v,
          "onsite_parking",
          { type: "contribution", id: no },
          "confirm"
        )
      ).error?.message
    ).toBe("import_slot_has_answer")
    expect(
      (await resolve(v.manager, v, "onsite_parking", no)).error?.message
    ).toBe("import_slot_has_answer")
    expect(
      (await resolve(v.manager, v, "onsite_parking", null)).error
    ).toBeNull()
  })
})

describe("guards", () => {
  it("keep sources, imports, mappings and runs to admins", async () => {
    for (const who of [w.staffA, w.manager]) {
      expect(
        (await reconcile(who, "legacy", "dry_run", w.venue)).error?.message
      ).toBe("not_active_admin")
      expect(
        (
          await call(who, "knowledge_source_declare", {
            p_kind: "other",
            p_label: "TEST",
            p_venue_id: w.venue,
            p_idempotency_key: randomUUID(),
          })
        ).error?.message
      ).toBe("not_active_admin")
      expect(
        (await call(who, "knowledge_sources", { p_include_retired: false }))
          .error?.message
      ).toBe("not_active_admin")
    }
  })

  it("keep the tables closed to clients and append-only", async () => {
    for (const table of [
      "knowledge_external_sources",
      "knowledge_source_assertions",
      "knowledge_legacy_mappings",
      "knowledge_reconciliation_runs",
      "knowledge_contribution_sources",
    ]) {
      const { data, error } = await (
        w.admin.client as unknown as {
          from(t: string): {
            select(
              c: string
            ): PromiseLike<{ data: unknown[] | null; error: unknown }>
          }
        }
      )
        .from(table)
        .select("*")
      expect(error !== null || (data ?? []).length === 0, table).toBe(true)
    }
    for (const sql of [
      `delete from public.knowledge_legacy_mappings where legacy_fact_id = '${toilets}'`,
      `delete from public.knowledge_contribution_sources where venue_id = '${w.venue}'`,
      `update public.knowledge_reconciliation_runs set counts = '{}' where venue_id = '${w.venue}'`,
    ])
      expect(() => psql(sql), sql).toThrow()
  })

  it("leave the credit function, both evidence triggers and the B01 resolver byte-identical", () => {
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
