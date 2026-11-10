// Schema compatibility guards (docs/knowledge/b01-design.md §17 T11a, T9b):
// the released amenity CHECK constraints are exactly those of f8c49430, the
// resolver and every knowledge read keep one snapshot per call, and a
// confirmation always carries a manager or admin basis.
import { execFileSync } from "node:child_process"

import { describe, expect, it } from "vitest"

import { psql } from "./coverage-fixtures"

/** Runs a psql script (several statements) and returns its output. */
function psqlScript(sql: string): string {
  const url = process.env.NABALENS_TEST_DB_URL
  if (!url || !/^postgresql:\/\/[^@]+@(127\.0\.0\.1|localhost):/.test(url)) {
    throw new Error("Run through `pnpm test:security <workdir>` (local DB).")
  }
  return execFileSync("psql", [url, "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: sql,
    encoding: "utf8",
  }).trim()
}

// The CHECK constraints as written at f8c49430 (20261107120000, unchanged
// since). Postgres deparses this text in scratch temp tables with the same
// column types, so the comparison does not depend on deparse formatting.
const RELEASED = `
create temp table t11a_venue_amenity_checks (
  status text, progress text, answer text, current_submission_id uuid, answered_by uuid,
  answered_at timestamptz, notes text, recheck_reason text, revision integer,
  check (status in ('active', 'archived')),
  check (progress in ('needs_capture', 'complete', 'needs_recheck')),
  check (answer in ('to_check', 'yes', 'no', 'not_applicable')),
  check (notes is null or (length(notes) between 1 and 2000 and notes = btrim(notes))),
  check (recheck_reason is null or length(recheck_reason) between 1 and 600),
  check (revision >= 1),
  constraint venue_amenity_checks_answered check (
    (current_submission_id is null) = (answered_by is null)
    and (answered_by is null) = (answered_at is null)
    and (current_submission_id is null) = (answer = 'to_check')
  ),
  constraint venue_amenity_checks_complete_answered check (progress <> 'complete' or current_submission_id is not null),
  constraint venue_amenity_checks_recheck_reason check ((progress = 'needs_recheck') = (recheck_reason is not null))
);
create temp table t11a_amenity_submissions (
  answer text, finding text, limitations text, reason text, template_version integer,
  evidence_rule text, internal_metadata jsonb, result_revision integer,
  check (answer in ('yes', 'no', 'not_applicable')),
  check (finding is null or (length(finding) between 1 and 2000 and finding = btrim(finding))),
  check (limitations is null or (length(limitations) between 1 and 2000 and limitations = btrim(limitations))),
  check (reason is null or (length(reason) between 1 and 500 and reason = btrim(reason))),
  check (template_version >= 1),
  check (evidence_rule in ('photo', 'video', 'either', 'both')),
  check (internal_metadata is null or jsonb_typeof(internal_metadata) = 'object'),
  check (result_revision >= 2),
  constraint amenity_submissions_reason check (answer = 'yes' or reason is not null)
);
create temp table t11a_amenity_check_events (
  kind text, reason text, detail jsonb,
  check (kind in (
    'added', 'assigned', 'unassigned', 'notes_updated', 'submitted',
    'reopened', 'evidence_lost', 'archived', 'restored'
  )),
  check (reason is null or length(reason) between 1 and 600),
  check (jsonb_typeof(detail) = 'object')
);
`

const COMPARE = `
with expected as (
  select substr(r.relname, length('t11a_') + 1) as tbl, pg_get_constraintdef(c.oid) as def
  from pg_constraint c
  join pg_class r on r.oid = c.conrelid
  where c.contype = 'c' and c.conrelid in (
    'pg_temp.t11a_venue_amenity_checks'::regclass,
    'pg_temp.t11a_amenity_submissions'::regclass,
    'pg_temp.t11a_amenity_check_events'::regclass)
),
actual as (
  select r.relname::text as tbl, c.conname::text as name, pg_get_constraintdef(c.oid) as def
  from pg_constraint c
  join pg_class r on r.oid = c.conrelid
  where c.contype = 'c' and c.conrelid in (
    'public.venue_amenity_checks'::regclass,
    'public.amenity_submissions'::regclass,
    'public.amenity_check_events'::regclass)
)
select json_build_object(
  'expected', (select count(*) from expected),
  'missing', (select coalesce(json_agg(e.tbl || ': ' || e.def order by e.tbl, e.def), '[]')
    from expected e where not exists (select 1 from actual a where a.tbl = e.tbl and a.def = e.def)),
  'extra', (select coalesce(json_agg(a.name order by a.name), '[]')
    from actual a where not exists (select 1 from expected e where e.tbl = a.tbl and e.def = a.def))
);
`

describe("released amenity constraints (T11a)", () => {
  it("keeps every f8c49430 CHECK definition and adds only the B01 column check", () => {
    const result = JSON.parse(psqlScript(`${RELEASED}\n${COMPARE}`)) as {
      expected: number
      missing: string[]
      extra: string[]
    }
    expect(result.expected).toBe(21)
    expect(result.missing).toEqual([])
    expect(result.extra).toEqual(["amenity_submissions_submitter_basis_check"])
  })
})

describe("one snapshot per read (T9b)", () => {
  it("keeps the resolver a SQL function and every knowledge read STABLE", () => {
    const rows = JSON.parse(
      psql(`select json_object_agg(n.nspname || '.' || p.proname,
          json_build_object('language', l.lanname, 'volatility', p.provolatile, 'definer', p.prosecdef))
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        join pg_language l on l.oid = p.prolang
        where (n.nspname = 'private' and p.proname in (
            'knowledge_slot_state', 'knowledge_slot_json', 'knowledge_contribution_view',
            'knowledge_submission_scored'))
          or (n.nspname = 'public' and p.proname in (
            'knowledge_reader_answers_v1', 'knowledge_working_list', 'knowledge_check',
            'knowledge_to_confirm', 'knowledge_my_contributions', 'knowledge_my_pending',
            'knowledge_get_draft', 'knowledge_pilot_preview'))`)
    ) as Record<
      string,
      { language: string; volatility: string; definer: boolean }
    >
    expect(Object.keys(rows)).toHaveLength(12)
    expect(rows["private.knowledge_slot_state"]).toEqual({
      language: "sql",
      volatility: "s",
      definer: true,
    })
    for (const [name, fn] of Object.entries(rows)) {
      expect(fn.volatility, name).toBe("s")
      expect(fn.definer, name).toBe(true)
    }
  })
})

describe("one snapshot per B02 read (T9b)", () => {
  it("keeps every B02 read, and the reads the triage calls, STABLE and definer", () => {
    const rows = JSON.parse(
      psql(`select json_agg(json_build_object(
          'name', p.oid::regprocedure::text, 'volatility', p.provolatile, 'definer', p.prosecdef)
          order by p.oid::regprocedure::text)
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where (n.nspname = 'public' and p.proname in (
            'my_label_work', 'manager_triage_summary', 'my_contributions_feed',
            'my_venue_capabilities', 'my_asset_delete_impact', 'my_menu_waiting_items',
            'knowledge_to_confirm', 'knowledge_check', 'manager_menu_photo_overview',
            'venue_coverage_summary', 'contribution_groups_for_assets', 'contribution_group'))
          or (n.nspname = 'private' and p.proname in (
            'manager_read_venue', 'asset_needs_labels', 'feed_photo_json',
            'feed_task_send_json', 'feed_legacy_finding_json', 'feed_closed_assignment_json',
            'asset_removal_effects', 'knowledge_latest_send', 'viewer_sees_asset',
            'contribution_subject_exists'))`)
    ) as { name: string; volatility: string; definer: boolean }[]
    expect(rows.map((r) => r.name)).toEqual(
      expect.arrayContaining([
        "manager_triage_summary(uuid)",
        "manager_menu_photo_overview(uuid)",
        "venue_coverage_summary(uuid)",
        "knowledge_to_confirm(uuid)",
        "my_contributions_feed(text,integer)",
        "my_asset_delete_impact(uuid)",
        "private.asset_removal_effects(uuid,uuid)",
      ])
    )
    expect(rows).toHaveLength(22)
    for (const fn of rows) {
      expect(fn.volatility, fn.name).toBe("s")
      expect(fn.definer, fn.name).toBe(true)
    }
  })

  it("leaves the credit function byte-identical", () => {
    expect(
      psql(`select md5(pg_get_functiondef(
        'private.monthly_venue_completion_counts(uuid,uuid,date)'::regprocedure))`)
    ).toBe("b78b9daeb8ede1fec0b7224d99348659")
  })
})

describe("confirmation basis (WS5)", () => {
  it("refuses a confirmed decision with a self or rule basis, or without a person", () => {
    const def = psql(`select pg_get_constraintdef(c.oid) from pg_constraint c
      where c.conname = 'knowledge_decisions_confirmed_basis'
        and c.conrelid = 'public.knowledge_decisions'::regclass`)
    expect(def).toContain("confirmed")
    expect(def).toContain("venue_manager")
    expect(def).toContain("decided_by IS NOT NULL")
    expect(
      psql(`select count(*) from public.knowledge_decisions
        where decision = 'confirmed' and (decider_basis not in ('venue_manager', 'admin') or decided_by is null)`)
    ).toBe("0")
  })
})
