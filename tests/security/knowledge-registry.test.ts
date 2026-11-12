// B03-a question registry (docs/knowledge/b03-design.md §3, §12 B03-a).
// Version 1 of every key restates today's catalogue and rules exactly, the
// tables are closed to clients and append-only, the reads follow their
// audiences, and the database validator agrees with the TypeScript one on
// the shared fixtures. Real signed-in identities through PostgREST; psql
// reads state back.
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { beforeAll, describe, expect, it } from "vitest"

import { anonClient } from "../support/identities"
import { MONTHLY_COMPLETION_COUNTS_HASH, psql } from "./coverage-fixtures"
import { call, json, refused, world, type World } from "./knowledge-fixtures"

type Question = Record<string, unknown> & {
  key: string
  version: number
  lifecycle: string
}

let w: World

beforeAll(async () => {
  w = await world("kn-b03-registry")
})

const q = (sql: string) => JSON.parse(psql(sql)) as unknown

describe("version 1 restates today (no behaviour change)", () => {
  it("has one question and one version 1 for every catalogue key, matching the catalogue", () => {
    expect(
      q(`select json_build_object(
        'catalogue', (select count(*) from public.amenity_catalogue),
        'questions', (select count(*) from public.knowledge_questions),
        'versions', (select count(*) from public.knowledge_question_versions),
        'mismatched', (select count(*) from public.amenity_catalogue c
          left join public.knowledge_question_versions v on v.key = c.key and v.version = 1
          where v.key is null or v.catalogue_version <> c.catalogue_version
            or v.evidence_rule <> c.evidence_rule
            or v.guidance ->> 'question' <> c.question
            or v.guidance ->> 'captureBrief' <> c.capture_brief))`)
    ).toEqual({ catalogue: 39, questions: 39, versions: 39, mismatched: 0 })
  })

  // Compared key by key against the latest rule that existed when version 1
  // was written, so a rule another fixture adds (before or after B03-a)
  // never changes the expected count.
  it("restates every knowledge rule, and confirmation none where no rule exists (drift guard)", () => {
    expect(
      q(`with v1 as (
          select v.*, r.rule_version as base_rule_version, r.confirmation as base_confirmation,
            r.self_confirmation_allowed as base_self
          from public.knowledge_question_versions v
          left join lateral (select x.* from public.knowledge_question_rules x
            where x.question_key = v.key and x.created_at <= v.created_at
            order by x.rule_version desc limit 1) r on true
          where v.version = 1)
        select json_build_object(
          'versions', (select count(*) from v1),
          'ruled_mismatched', (select count(*) from v1 where base_rule_version is not null
            and (rule_version is distinct from base_rule_version
              or confirmation is distinct from base_confirmation
              or self_confirmation_allowed is distinct from base_self)),
          'unruled_mismatched', (select count(*) from v1 where base_rule_version is null
            and (rule_version is not null or confirmation <> 'none' or self_confirmation_allowed)))`)
    ).toMatchObject({
      versions: 39,
      ruled_mismatched: 0,
      unruled_mismatched: 0,
    })
    // Both branches are exercised: B01's seven pilot rules are restated, and
    // at least one key has no rule.
    expect(
      q(`select json_build_object('pilot', (select count(*) from public.knowledge_question_versions v
          where v.version = 1 and v.rule_version is not null and v.key in
            ('onsite_parking', 'step_free_entrance', 'guest_toilets', 'guest_wifi',
             'dogs_inside', 'dogs_outside', 'sports_screen')),
        'anyUnruled', exists (select 1 from public.knowledge_question_versions v
          where v.version = 1 and v.rule_version is null))`)
    ).toEqual({ pilot: 7, anyUnruled: true })
  })

  it("applies none of the §3.4 proposals yet", () => {
    // Version 1 only: later versions (B03-c onwards, and fixtures) never
    // stand in for the initial baseline.
    expect(
      q(`with v1 as (select * from public.knowledge_question_versions where version = 1)
        select json_build_object(
        'lifecycles', (select json_agg(distinct lifecycle) from v1),
        'changeKinds', (select json_agg(distinct change_kind) from v1),
        'schemas', (select json_object_agg(value_schema, n) from (
          select value_schema, count(*) as n from v1 group by 1) s),
        'families', (select json_object_agg(family, n) from (
          select family, count(*) as n from v1 group by 1) f),
        'freshness', (select count(*) from v1
          where freshness <> '{"internal": null, "public": null}'::jsonb),
        'publishable', (select count(*) from v1
          where cardinality(publishable_fields) > 0),
        'restricted', (select json_agg(key) from v1
          where sensitivity <> 'ordinary'))`)
    ).toEqual({
      lifecycles: ["supported"],
      changeKinds: ["initial"],
      schemas: { presence: 38, "connectivity.wifi": 1 },
      families: { presence: 38, connectivity: 1 },
      freshness: 0,
      publishable: 0,
      restricted: ["guest_wifi"],
    })
  })

  it("leaves the credit function byte-identical", () => {
    expect(
      psql(`select md5(pg_get_functiondef(
        'private.monthly_venue_completion_counts(uuid,uuid,date)'::regprocedure))`)
    ).toBe(MONTHLY_COMPLETION_COUNTS_HASH)
  })
})

describe("tables", () => {
  it("are closed to signed-in clients", async () => {
    for (const table of [
      "knowledge_questions",
      "knowledge_question_versions",
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
  })

  it("keep versions append-only and questions undeletable with a fixed key", () => {
    for (const sql of [
      `update public.knowledge_question_versions set lifecycle = 'retired' where key = 'darts'`,
      `delete from public.knowledge_question_versions where key = 'darts'`,
      `delete from public.knowledge_questions where key = 'darts'`,
      `update public.knowledge_questions set key = 'darts2' where key = 'darts'`,
      // B03-b: a question row is only its key; nothing on it changes.
      `update public.knowledge_questions set created_at = now() where key = 'darts'`,
    ])
      expect(() => psql(sql), sql).toThrow()
    expect(
      psql(
        `select count(*) from public.knowledge_question_versions where key = 'darts' and lifecycle = 'supported'`
      )
    ).toBe("1")
  })
})

describe("reads", () => {
  it("serve one question to every active account, with material fields", async () => {
    for (const who of [w.staffA, w.manager, w.staffManager, w.admin]) {
      const question = await json<Question>(who, "knowledge_question", {
        p_key: "step_free_entrance",
        p_version: null,
      })
      expect(question).toMatchObject({
        key: "step_free_entrance",
        version: 1,
        latestVersion: 1,
        ruleVersion: 1,
        confirmation: "venue_manager",
        selfConfirmationAllowed: true,
        evidenceRule: "video",
        valueSchema: { name: "presence", version: 1 },
        materialFields: ["headline"],
        lifecycle: "supported",
      })
      expect(question).not.toHaveProperty("createdBy")
    }
    await refused(
      w.staffA,
      "knowledge_question",
      { p_key: "not_a_key", p_version: null },
      "knowledge_question_not_found",
      "P0002"
    )
    await refused(
      w.staffA,
      "knowledge_question",
      { p_key: "darts", p_version: 2 },
      "knowledge_question_not_found",
      "P0002"
    )
    const anon = await call({ client: anonClient() }, "knowledge_question", {
      p_key: "darts",
      p_version: null,
    })
    expect(anon.error).not.toBeNull()
  })

  it("serve the registry to admins only, in catalogue order", async () => {
    const all = await json<{ items: Question[] }>(
      w.admin,
      "knowledge_registry",
      {
        p_lifecycle: null,
      }
    )
    expect(all.items).toHaveLength(39)
    const order = psql(
      `select string_agg(key, ',' order by position, key) from public.amenity_catalogue`
    )
    expect(all.items.map((i) => i.key).join(",")).toBe(order)
    expect(
      (
        await json<{ items: Question[] }>(w.admin, "knowledge_registry", {
          p_lifecycle: ["retired"],
        })
      ).items
    ).toEqual([])
    for (const who of [w.staffA, w.manager, w.staffManager])
      await refused(
        who,
        "knowledge_registry",
        { p_lifecycle: null },
        "not_active_admin",
        "42501"
      )
  })
})

describe("value validator (shared fixtures)", () => {
  type Case = {
    name: string
    schema: string
    version: number
    headline: string | null
    detail: unknown
    /** The database receives jsonb 'null' rather than SQL null. */
    jsonNull?: boolean
    expect:
      | { ok: true; detail: unknown }
      | { fields: { path: string; problem: string }[] }
      | { unknownSchema: true }
  }
  const { cases } = JSON.parse(
    readFileSync(
      join(process.cwd(), "tests/fixtures/knowledge/values.json"),
      "utf8"
    )
  ) as { cases: Case[] }
  const lit = (v: unknown) =>
    v === null || v === undefined
      ? "null"
      : `'${String(v).replace(/'/g, "''")}'`

  it.each(cases.map((c) => [c.name, c] as const))("%s", (_, c) => {
    const sql = `select private.knowledge_validate_value(${lit(c.schema)}, ${c.version},
      ${lit(c.headline)}, ${c.jsonNull ? "'null'::jsonb" : c.detail === null ? "null" : `${lit(JSON.stringify(c.detail))}::jsonb`})`
    if ("ok" in c.expect) {
      expect(JSON.parse(psql(sql))).toEqual({
        headline: c.headline,
        detail: c.expect.detail,
      })
      return
    }
    let message = ""
    try {
      psql(sql)
    } catch (e) {
      message = String((e as { stderr?: string }).stderr ?? e)
    }
    if ("unknownSchema" in c.expect)
      expect(message).toContain("unknown_value_schema")
    else {
      expect(message).toContain("invalid_value")
      const detail = /DETAIL:\s+(\{.*\})/.exec(message)?.[1]
      expect(JSON.parse(detail!)).toEqual({ fields: c.expect.fields })
    }
  })
})
