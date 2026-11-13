// B05 follow-up: answer freshness in asset search (contracts/b05-design.md
// §11.2 signal 3; migration 20261113150000_media_b05_answer_freshness.sql).
// The filter and the card field come only from B03's K1 read
// (private.knowledge_evidence_for_assets): every expectation here is checked
// against K1 itself, never against a copy of its rules.
import { randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import { psql } from "./coverage-fixtures"
import {
  json,
  photo,
  refused,
  world,
  yes,
  type World,
} from "./knowledge-fixtures"

type Row = { id: string; uploadedAt: string }
type Page = {
  hasMore: boolean
  items: Row[]
  resumeAfter?: { uploadedAt: string; id: string }
}
type Answers = {
  items: {
    assetId: string
    answers: {
      checkId: string
      questionKey: string
      question: string | null
      freshness: { use: string; state: string }[]
    }[]
  }[]
}
type Who = World["admin"]

const STATES = [
  "current",
  "due_soon",
  "expired",
  "basis_missing",
  "unrated",
] as const

async function searchAll(
  who: Who,
  filters: Record<string, unknown>
): Promise<string[]> {
  const out: string[] = []
  let at: string | null = null
  let id: string | null = null
  for (let i = 0; i < 50; i++) {
    const page: Page = await json<Page>(who, "asset_search", {
      p_filters: filters,
      p_limit: 48,
      p_after_created_at: at,
      p_after_id: id,
    })
    out.push(...page.items.map((r) => r.id))
    if (!page.hasMore) return out
    const next = page.resumeAfter ?? page.items[page.items.length - 1]!
    at = next.uploadedAt
    id = next.id
  }
  throw new Error("too many pages")
}

/** K1's current answers for a venue's assets, as (asset, use, state). */
function k1(venue: string): { asset: string; use: string; state: string }[] {
  const out = psql(`select coalesce(json_agg(json_build_object(
        'asset', k.asset_id, 'use', f ->> 'use', 'state', f ->> 'state')), '[]')
    from private.knowledge_evidence_for_assets(
      (select array_agg(a.id) from public.media_assets a
        where a.venue_id = '${venue}' and a.deleted_at is null
          and a.upload_state = 'ready'
          and a.id in (select sa.asset_id from public.amenity_submission_assets sa)),
      now()) k
    cross join lateral jsonb_array_elements(k.freshness) f
    where k.role = 'current_answer'`)
  return JSON.parse(out) as { asset: string; use: string; state: string }[]
}

describe("asset search answer freshness (B05 follow-up, §11.2)", () => {
  let w: World
  let other: World
  let answered: string
  let plain: string
  let otherAnswered: string

  beforeAll(async () => {
    w = await world("b05-answers")
    other = await world("b05-answers-o")
    const sent = await yes(w.staffA, w, "guest_toilets")
    answered = psql(`select asset_id from public.knowledge_contribution_assets
      where contribution_id = '${sent.contributionId}' limit 1`)
    plain = await photo(w.staffA.id, w.venue)
    const o = await yes(other.staffA, other, "guest_toilets")
    otherAnswered =
      psql(`select asset_id from public.knowledge_contribution_assets
      where contribution_id = '${o.contributionId}' limit 1`)
  })

  it("matches K1 exactly for every state and use at the venue", async () => {
    const truth = k1(w.venue)
    expect(truth.map((t) => t.asset)).toContain(answered)
    for (const use of ["internal", "public"] as const)
      for (const state of STATES) {
        const expected = [
          ...new Set(
            truth
              .filter((t) => t.use === use && t.state === state)
              .map((t) => t.asset)
          ),
        ].sort()
        const filters = {
          venue: w.venue,
          answerFreshness: state,
          ...(use === "public" ? { answerUse: use } : {}),
        }
        expect((await searchAll(w.admin, filters)).sort()).toEqual(expected)
      }
    // No freshness policy is seeded yet (OD-15), so every answer is unrated.
    expect(
      await searchAll(w.admin, { venue: w.venue, answerFreshness: "unrated" })
    ).toContain(answered)
    const unrated = await searchAll(w.admin, {
      venue: w.venue,
      answerFreshness: "unrated",
    })
    expect(unrated).not.toContain(plain)
  })

  it("lets a venue manager use it without a venue and keeps other venues out", async () => {
    for (const who of [w.manager, w.staffManager]) {
      const found = await searchAll(who, { answerFreshness: "unrated" })
      expect(found).toContain(answered)
      expect(found).not.toContain(otherAnswered)
      expect(found).not.toContain(plain)
    }
  })

  it("combines with the other filters", async () => {
    expect(
      await searchAll(w.admin, {
        venue: w.venue,
        answerFreshness: "unrated",
        check: w.checks.guest_toilets,
      })
    ).toEqual([answered])
    expect(
      await searchAll(w.admin, {
        venue: w.venue,
        answerFreshness: "unrated",
        mediaType: "video",
      })
    ).not.toContain(answered)
  })

  it("refuses it without a venue for an admin, and answerUse alone", async () => {
    const e = await refused(
      w.admin,
      "asset_search",
      { p_filters: { answerFreshness: "unrated" } },
      "invalid_search_filter",
      "22023"
    )
    expect(e.details).toBe("answerFreshness")
    for (const [filters, detail] of [
      [{ venue: w.venue, answerUse: "public" }, "answerUse"],
      [{ venue: w.venue, answerFreshness: "stale" }, "answerFreshness"],
      [
        { venue: w.venue, answerFreshness: "unrated", answerUse: "guests" },
        "answerUse",
      ],
    ] as const) {
      const err = await refused(
        w.admin,
        "asset_search",
        { p_filters: filters },
        "invalid_search_filter",
        "22023"
      )
      expect(err.details).toBe(detail)
    }
    await refused(
      w.staffA,
      "asset_search",
      { p_filters: { answerFreshness: "unrated" } },
      "not_venue_manager",
      "42501"
    )
  })

  it("rates at most 500 candidates a page and says where to resume", () => {
    const current =
      psql(`select current_submission_id from public.venue_amenity_checks
      where id = '${w.checks.guest_toilets}'`)
    const run = randomUUID().slice(0, 8)
    const out = psql(`begin;
      set local statement_timeout = 0;
      create temp table cap_rows as
        select gen_random_uuid() as id, n,
          now() + interval '1 day' + n * interval '1 second' as created_at
        from generate_series(1, 520) n;
      insert into public.media_assets (id, uploader_id, venue_id, original_path, original_filename,
          media_type, size_bytes, client_upload_key, uploader_role, created_at)
        select r.id, '${w.staffA.id}', '${w.venue}',
          '${w.staffA.id}/' || r.id || '/original.jpg', 'TEST cap ${run}.jpg', 'image', 4,
          gen_random_uuid(), 'staff', r.created_at
        from cap_rows r;
      update public.media_assets set upload_state = 'processing' where id in (select id from cap_rows);
      update public.media_assets set upload_state = 'ready', validated_mime_type = 'image/jpeg',
          size_bytes = 4, width = 1, height = 1
        where id in (select id from cap_rows);
      insert into public.amenity_submission_assets (submission_id, venue_id, asset_id, evidence_kind)
        select '${current}', '${w.venue}', r.id, 'photo' from cap_rows r;
      select set_config('request.jwt.claims', '{"sub":"${w.admin.id}","role":"authenticated"}', true) is null;
      set local role authenticated;
      create temp table pages as
        select 1 as n, public.asset_search(
          '{"venue":"${w.venue}","answerFreshness":"expired"}'::jsonb, null, null, 48) as p;
      insert into pages select 2, public.asset_search(
          '{"venue":"${w.venue}","answerFreshness":"expired"}'::jsonb,
          ((select p from pages where n = 1) -> 'resumeAfter' ->> 'uploadedAt')::timestamptz,
          ((select p from pages where n = 1) -> 'resumeAfter' ->> 'id')::uuid, 48);
      insert into pages select 3, public.asset_search(
          '{"venue":"${w.venue}","answerFreshness":"unrated"}'::jsonb, null, null, 48);
      reset role;
      select json_build_object(
        'first', (select p from pages where n = 1),
        'second', (select p from pages where n = 2),
        'unrated', (select json_build_object('hasMore', p -> 'hasMore',
            'count', jsonb_array_length(p -> 'items'), 'resume', p ? 'resumeAfter')
          from pages where n = 3),
        'fifth', (select json_build_object('uploadedAt', created_at, 'id', id)
          from cap_rows order by created_at desc, id desc offset 499 limit 1));
      rollback;`)
    const r = JSON.parse(out.split("\n").at(-1)!) as {
      first: Page
      second: Page
      unrated: { hasMore: boolean; count: number; resume: boolean }
      fifth: { uploadedAt: string; id: string }
    }
    expect(r.first.hasMore).toBe(true)
    expect(r.first.items).toEqual([])
    expect(r.first.resumeAfter?.id).toBe(r.fifth.id)
    expect(r.second).toEqual({ hasMore: false, items: [] })
    // A full page ends before the cap, with the ordinary cursor only.
    expect(r.unrated).toEqual({ hasMore: true, count: 48, resume: false })
  })

  it("answers each admitted asset with the answers it supports", async () => {
    const out = await json<Answers>(w.admin, "asset_search_answers", {
      p_asset_ids: [answered, plain],
    })
    expect(out.items).toHaveLength(1)
    const [row] = out.items
    expect(row!.assetId).toBe(answered)
    expect(row!.answers).toEqual([
      {
        checkId: w.checks.guest_toilets,
        questionKey: "guest_toilets",
        question: psql(
          `select question from public.amenity_catalogue where key = 'guest_toilets'`
        ),
        freshness: ["internal", "public"].map((use) => ({
          use,
          state: "unrated",
          nextCheckDue: null,
          basis: null,
          basisDate: null,
        })),
      },
    ])
  })

  it("answers only what the caller's search admits", async () => {
    const out = await json<Answers>(w.manager, "asset_search_answers", {
      p_asset_ids: [answered, otherAnswered],
    })
    expect(out.items.map((i) => i.assetId)).toEqual([answered])
    await refused(
      w.staffA,
      "asset_search_answers",
      { p_asset_ids: [answered] },
      "not_venue_manager",
      "42501"
    )
    await refused(
      w.admin,
      "asset_search_answers",
      { p_asset_ids: Array.from({ length: 49 }, () => randomUUID()) },
      "invalid_asset_list",
      "22023"
    )
    expect(
      await json<Answers>(w.admin, "asset_search_answers", { p_asset_ids: [] })
    ).toEqual({ items: [] })
  })

  it("is a STABLE definer for signed-in users only", () => {
    const fn = "public.asset_search_answers(uuid[])"
    expect(
      psql(
        `select concat_ws('|', p.provolatile, p.prosecdef) from pg_proc p where p.oid = '${fn}'::regprocedure`
      )
    ).toBe("s|t")
    expect(
      psql(
        `select concat_ws('|', has_function_privilege('authenticated', '${fn}', 'execute'),
           has_function_privilege('anon', '${fn}', 'execute'),
           has_function_privilege('service_role', '${fn}', 'execute'))`
      )
    ).toBe("t|f|f")
  })
})
