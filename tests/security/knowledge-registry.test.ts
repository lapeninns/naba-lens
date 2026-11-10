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
import { psql } from "./coverage-fixtures"
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

  it("restates every knowledge rule, and confirmation none where no rule exists (drift guard)", () => {
    expect(
      q(`select json_build_object(
        'ruled', (select count(*) from public.knowledge_question_versions v
          join lateral (select r.* from public.knowledge_question_rules r
            where r.question_key = v.key order by r.rule_version desc limit 1) r on true
          where v.rule_version = r.rule_version and v.confirmation = r.confirmation
            and v.self_confirmation_allowed = r.self_confirmation_allowed),
        'rules', (select count(distinct question_key) from public.knowledge_question_rules),
        'unruled_not_none', (select count(*) from public.knowledge_question_versions v
          where v.rule_version is null
            and (v.confirmation <> 'none' or v.self_confirmation_allowed)))`)
    ).toEqual({ ruled: 7, rules: 7, unruled_not_none: 0 })
  })

  it("applies none of the §3.4 proposals yet", () => {
    expect(
      q(`select json_build_object(
        'lifecycles', (select json_agg(distinct lifecycle) from public.knowledge_question_versions),
        'schemas', (select json_object_agg(value_schema, n) from (
          select value_schema, count(*) as n from public.knowledge_question_versions group by 1) s),
        'families', (select json_object_agg(family, n) from (
          select family, count(*) as n from public.knowledge_question_versions group by 1) f),
        'freshness', (select count(*) from public.knowledge_question_versions
          where freshness <> '{"internal": null, "public": null}'::jsonb),
        'publishable', (select count(*) from public.knowledge_question_versions
          where cardinality(publishable_fields) > 0),
        'restricted', (select json_agg(key) from public.knowledge_question_versions
          where sensitivity <> 'ordinary')))`)
    ).toEqual({
      lifecycles: ["supported"],
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
    ).toBe("b78b9daeb8ede1fec0b7224d99348659")
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
