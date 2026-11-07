// Phase `sibling-upgrade` (tests/migrations/run.mjs has just run
// `supabase db reset --local --version 20261106130000 --no-seed`):
// 1. the reset applied the migrations up to and including the sibling base
//    (20261106130000_menu_item_photos) and no later ones;
// 2. sibling-era-seed.sql writes item-photo decisions (accepted primary,
//    needs_recheck, withdrawn) with their heads and events, a staff-held venue
//    manager grant and coverage audit rows, through that schema's own RPCs;
// 3. `supabase migration up` applies the manager-workspace migrations
//    (20261107100000..) over those rows, as a hosted upgrade would, and every
//    row survives as a staff-label decision under validated constraints while
//    the legacy staff grant stays effective.
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { psql, psqlJson } from "../../scripts/db/lib/drill"
import { env, repoVersions, SIBLING_BASE, state, supabase } from "./helpers"

const VENUE = "00000000-0000-4000-8000-00000000a001"
const PILOT = "00000000-0000-4000-8000-0000000000b4"
const TABLES = [
  "menu_item_photos",
  "menu_item_photo_heads",
  "menu_item_photo_events",
  "coverage_audit_events",
] as const

type Row = Record<string, unknown>

/** Rows as written before the upgrade (columns the upgrade adds left out). */
const rows = (table: string) =>
  psqlJson<Row[]>(
    env,
    `select to_jsonb(t) - 'basis' - 'corrects_item_id' - 'corrects_variant_id' as row
     from public.${table} t
     order by ${table === "menu_item_photo_heads" ? "t.item_id" : "t.id"}`
  )

const unvalidated = () =>
  psqlJson<{ table: string; conname: string }[]>(
    env,
    `select conrelid::regclass::text as table, conname from pg_constraint
     where conrelid = any (array[${TABLES.map((t) => `'public.${t}'::regclass`).join(", ")}])
       and not convalidated order by 1, 2`
  )

const asPilot = (sql: string) =>
  psql(
    env,
    `set role authenticated;
     select set_config('request.jwt.claims', '{"sub":"${PILOT}","role":"authenticated"}', false) is null;
     ${sql}`
  )
    .split("\n")
    .at(-1)

describe("manager-workspace migrations over sibling-era item-photo data", () => {
  const siblingVersions = repoVersions.filter((v) => v <= SIBLING_BASE)
  const before: Record<string, Row[]> = {}

  it("starts from a reset to the sibling base with no data", () => {
    expect(
      readFileSync(join(state, "sibling-upgrade-reset.log"), "utf8")
    ).toMatch(/Reset(ting)? local database/)
    expect(siblingVersions.at(-1)).toBe(SIBLING_BASE)
    // Not vacuous: there are later migrations still to apply.
    expect(repoVersions.length).toBeGreaterThan(siblingVersions.length)
    expect(
      psqlJson<{ version: string }[]>(
        env,
        "select version from supabase_migrations.schema_migrations order by version"
      ).map((r) => r.version)
    ).toEqual(siblingVersions)
    expect(psql(env, "select count(*) from public.profiles")).toBe("0")
    expect(
      psql(
        env,
        "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'menu_item_photos' and column_name = 'basis'"
      )
    ).toBe("0")
  })

  it("seeds item-photo decisions, a staff-held grant and audit rows through the sibling RPCs", () => {
    execFileSync(
      "psql",
      [
        env.dbUrl,
        "-X",
        "-q",
        "-v",
        "ON_ERROR_STOP=1",
        "-f",
        join(import.meta.dirname, "sibling-era-seed.sql"),
      ],
      { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] }
    )
    for (const t of TABLES) before[t] = rows(t)
    expect(
      psqlJson<Row[]>(
        env,
        "select item_name, state, recheck_kind, is_primary from public.menu_item_photos order by item_name"
      )
    ).toEqual([
      {
        item_name: "Dal",
        state: "withdrawn",
        recheck_kind: null,
        is_primary: false,
      },
      {
        item_name: "Korma",
        state: "needs_recheck",
        recheck_kind: "name_changed",
        is_primary: false,
      },
      {
        item_name: "Tikka",
        state: "accepted",
        recheck_kind: null,
        is_primary: true,
      },
    ])
    expect(before.menu_item_photo_heads).toHaveLength(3)
    // accepted x3, withdrawn, carried (Tikka), needs_recheck (Korma).
    expect(before.menu_item_photo_events).toHaveLength(6)
    expect(
      psqlJson<Row[]>(
        env,
        "select entity, action from public.coverage_audit_events order by id"
      )
    ).toEqual([
      { entity: "manager_grant", action: "granted" },
      { entity: "requirement", action: "created" },
    ])
    expect(
      psqlJson<Row[]>(
        env,
        `select p.role, g.revoked_at from public.venue_manager_grants g
         join public.profiles p on p.id = g.staff_id where g.staff_id = '${PILOT}'`
      )
    ).toEqual([{ role: "staff", revoked_at: null }])
  })

  it("applies the later migrations without a reset", () => {
    supabase("migration", "up", "--local")
    expect(
      psqlJson<{ version: string }[]>(
        env,
        "select version from supabase_migrations.schema_migrations order by version"
      ).map((r) => r.version)
    ).toEqual(repoVersions)
  })

  it("keeps every earlier row, each decision as a staff-label decision", () => {
    for (const t of TABLES) {
      const after = rows(t)
      // coverage_audit_events is append-only: earlier rows stay as written.
      expect(after.slice(0, before[t]!.length)).toEqual(before[t])
    }
    for (const t of TABLES.slice(0, 3)) expect(rows(t)).toEqual(before[t])
    expect(
      psqlJson<Row[]>(
        env,
        "select basis, corrects_item_id, corrects_variant_id, count(*)::int as n from public.menu_item_photos group by 1, 2, 3"
      )
    ).toEqual([
      {
        basis: "staff_label",
        corrects_item_id: null,
        corrects_variant_id: null,
        n: 3,
      },
    ])
  })

  it("validates every item-photo and coverage audit constraint over the earlier rows", () => {
    expect(unvalidated()).toEqual([])
    // The 20261107100300 checks and composite keys and the swapped audit
    // entity check exist (and so were checked against the rows above).
    expect(
      psqlJson<{ conname: string }[]>(
        env,
        `select conname from pg_constraint where conrelid = 'public.menu_item_photos'::regclass
         and conname in ('menu_item_photos_basis_check', 'menu_item_photos_corrects_basis',
           'menu_item_photos_corrects_variant', 'menu_item_photos_corrects_other',
           'menu_item_photos_corrects_item_fkey', 'menu_item_photos_corrects_variant_fkey')
         order by 1`
      ).map((r) => r.conname)
    ).toHaveLength(6)
    expect(
      psql(
        env,
        "select pg_get_constraintdef(oid) from pg_constraint where conname = 'coverage_audit_events_entity_check'"
      )
    ).toContain("'account_role'")
  })

  it("keeps the legacy staff-held grant effective", () => {
    expect(
      psql(env, `select private.effective_manager_venue_id('${PILOT}')`)
    ).toBe(VENUE)
    expect(
      psql(env, `select role from public.profiles where id = '${PILOT}'`)
    ).toBe("staff")
    expect(
      asPilot("select manager_venue_id from public.coverage_access_scope();")
    ).toBe(VENUE)
  })

  it("lets the legacy manager re-accept the needs-recheck decision, still a staff-label one", () => {
    const [photo] = psqlJson<
      { asset_id: string; item_id: string; variant_id: string }[]
    >(
      env,
      "select asset_id, item_id, variant_id from public.menu_item_photos where state = 'needs_recheck'"
    )
    const head = psql(
      env,
      `select revision from public.menu_item_photo_heads where item_id = '${photo!.item_id}'`
    )
    expect(
      asPilot(
        `select state from public.review_menu_item_photo('${photo!.asset_id}', '${photo!.item_id}',
           '${photo!.variant_id}', 'accepted', ${head}, null, false, 'sibling-upgrade-reaccept-1');`
      )
    ).toBe("accepted")
    expect(
      psqlJson<Row[]>(
        env,
        `select state, basis, revision from public.menu_item_photos where asset_id = '${photo!.asset_id}'`
      )
    ).toEqual([{ state: "accepted", basis: "staff_label", revision: 3 }])
    expect(unvalidated()).toEqual([])
  })
})
