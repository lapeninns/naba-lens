// B04-e database contract (b04-design §8.2, §8.5, §13.2 activation guard, L1;
// task B04-05): dry runs over a reviewed crosswalk, per-line review with
// bulk accept only for exact source-key and exact price, releases confirmed
// for one lines hash and activated with their catalogue version in one
// transaction, an injected failure and a retried key, two successive source
// versions (rename by key, removed dishes, price changes, carried and
// tombstoned lines), the same file again, and a changed or expired base. One
// psql session and one transaction that always rolls back, on the shared
// fixture world of tests/fixtures/menus/recheck-public-withdrawal; the SQL
// lives in menus-imports-fixtures.ts.
import { execFileSync } from "node:child_process"

import { beforeAll, describe, expect, it } from "vitest"

import { psql } from "./coverage-fixtures"
import { checkpoints, importsScript } from "./menus-imports-fixtures"

const CREDIT_MD5 = "b78b9daeb8ede1fec0b7224d99348659"

type Report = {
  counts: Record<string, unknown>
  renamed: { locator: string; from: string; to: string }[]
  moved: { locator: string; from: string; to: string }[]
  uncertain: { locator: string }[]
  removed: { name: string }[]
  duplicates: { name: string; sections: string[] }[]
  variantsRemoved: { variant: string }[]
  priceChanges: { locator: string; from: number; to: number }[]
}

function localDbUrl(): string {
  const url = process.env.NABALENS_TEST_DB_URL
  if (!url || !/^postgresql:\/\/[^@]+@(127\.0\.0\.1|localhost):/.test(url)) {
    throw new Error("Run through `pnpm test:security <workdir>` (local DB).")
  }
  return url
}

let out: Record<string, unknown>
const at = <T = Record<string, unknown>>(label: string) => out[label] as T

beforeAll(() => {
  out = checkpoints(
    execFileSync(
      "psql",
      [localDbUrl(), "-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
      {
        encoding: "utf8",
        input: importsScript(),
        maxBuffer: 16 * 1024 * 1024,
      }
    )
      .split("\n")
      .filter((line) => line.length > 0)
  )
})

describe("dry run and report (§8.2 #1, #2, #6)", () => {
  it("needs the crosswalk run on the snapshot, and an admin", () => {
    expect(out.NO_CROSSWALK).toBe("crosswalk_not_run")
    expect(out.DRY_RUN_MANAGER).toBe("not_active_admin")
    expect(out.SAME_REVISION_OTHER_BYTES).toBe("snapshot_revision_conflict")
  })

  it("reports renamed, moved, uncertain, duplicate and removed-variant entries against the base", () => {
    const report = at<{ report: Report }>("RUN1").report
    expect(report.counts).toMatchObject({
      entries: 10,
      matched: 9,
      added: 0,
      uncertain: 1,
      renamed: 1,
      moved: 1,
      removed: 0,
      variantsRemoved: 1,
      duplicates: 1,
      proposals: { exact: 6, ambiguous: 2, unparseable: 1 },
    })
    expect(report.renamed[0]).toMatchObject({
      locator: "food--a",
      from: "Fixture Alpha Pie",
      to: "Fixture Alpha Pasty",
    })
    expect(report.moved[0]).toMatchObject({
      locator: "food--b",
      from: "Food",
      to: "Drinks",
    })
    // The same name in two sections stays two entries (never merged).
    expect(report.duplicates).toEqual([
      { name: "Fixture Hotel Spritz", sections: ["Bar", "Drinks"] },
    ])
    expect(report.uncertain.map((u) => u.locator)).toEqual(["bar--h"])
    expect(report.variantsRemoved.map((v) => v.variant)).toEqual(["Lamb"])
  })

  it("parses each price as exact, ambiguous or unparseable, never guessed, and keeps unmapped entries without a dish", () => {
    expect(at("PROPOSALS1")).toMatchObject({
      "food--a": {
        status: "exact",
        amount: 850,
        mapped: true,
        basis: "source_key_exact",
      },
      "food--d": { status: "ambiguous", amount: null },
      "food--e": { status: "ambiguous", amount: null },
      "food--f": { status: "unparseable", amount: null },
      "bar--h": { status: "exact", mapped: false, basis: null },
    })
    expect(at("PROPOSALS1")).not.toHaveProperty("drinks--h")
  })

  it("reports the same file again as already imported, with the earlier run", () => {
    expect(at("SAME_FILE")).toMatchObject({
      status: "already_imported",
      runId: expect.any(String),
      releaseId: expect.any(String),
    })
  })
})

describe("per-line review (§8.2 #3)", () => {
  it("bulk-accepts only exact source-key matches with an exact parse; refuses ambiguous and unmapped lines", () => {
    expect(at("BULK1")).toMatchObject({ accepted: 5 })
    expect(out.ACCEPT_AMBIGUOUS).toBe("invalid_price")
    expect(out.ACCEPT_UNMAPPED).toBe("menu_trading_proposal_unmapped")
    expect(out.DECIDE_STALE_REVISION).toBe("menu_trading_conflict")
    expect(at("EDIT_E")).toMatchObject({
      decision: "edited",
      value: { amountMinor: 995 },
    })
    expect(out.REJECT_D).toBe("rejected")
    // Reviewed crosswalk rows are manual or carried, so nothing is bulk-accepted.
    expect(out.BULK2).toBe("0")
  })

  it("freezes proposals once their release is active", () => {
    expect(out.DECIDE_AFTER_ACTIVATION).toBe("menu_trading_proposal_immutable")
  })
})

describe("releases and activation (§8.2 #4, #5; §13.2)", () => {
  it("applies once, onto a draft built on the dry run's base", () => {
    expect(out.APPLY_WRONG_DRAFT).toBe("menu_import_draft_mismatch")
    expect(out.APPLY_TWICE).toBe("menu_import_already_applied")
  })

  it("confirms only the content the reviewer saw; a later change makes activation stale until re-confirmed", () => {
    expect(out.CONFIRM_WRONG_HASH).toBe("menu_release_stale")
    expect(out.ACTIVATE_UNCONFIRMED).toBe("menu_release_not_confirmed")
    expect(out.CONFIRM1).toBe("confirmed")
    expect(out.EDIT_G_AFTER_CONFIRM).toBe("edited")
    expect(out.ACTIVATE_STALE).toBe("menu_release_stale")
    expect(out.RECONFIRM1).toBe("confirmed")
  })

  it("refuses today's activation once a trading field has authority nabalens, and an arbitrary flag", () => {
    expect(out.AUTHORITY_NABALENS).toBe(true)
    expect(out.PLAIN_ACTIVATE_REFUSED).toBe("menu_release_required")
    expect(out.FLAG_ARBITRARY).toBe("menu_release_required")
  })

  it("leaves the previous version and nothing written after an injected failure; the same key then succeeds once and replays", () => {
    expect(out.ACTIVATE_INJECTED).toBe("fx_injected_failure")
    expect(at("AFTER_FAILURE")).toEqual({
      v1: "active",
      v2: "draft",
      release: "confirmed",
      assertions: 0,
      releaseLines: 0,
    })
    expect(at("ACTIVATE1")).toMatchObject({
      written: 6,
      carried: 0,
      tombstones: 0,
      previousReleaseId: null,
      replayed: false,
    })
    expect(out.ACTIVATE1_REPLAY).toBe("true")
  })

  it("writes one confirmed source-mapping or correction assertion per line and runs the photo reconcile once", () => {
    const after = at<{
      v1: string
      v2: string
      release: string
      prices: Record<
        string,
        { amount: number; basis: string; assertions: number }
      >
      lines: Record<string, string>
      photoA: string
      events: string[]
    }>("AFTER_RELEASE1")
    expect(after).toMatchObject({
      v1: "retired",
      v2: "active",
      release: "current",
    })
    expect(after.prices).toEqual({
      A: { amount: 850, basis: "source_mapping", assertions: 1 },
      B: { amount: 400, basis: "source_mapping", assertions: 1 },
      C: { amount: 1200, basis: "source_mapping", assertions: 1 },
      E: { amount: 995, basis: "correction", assertions: 1 },
      G: { amount: 1550, basis: "correction", assertions: 1 },
      I: { amount: 520, basis: "source_mapping", assertions: 1 },
    })
    expect(Object.values(after.lines)).toEqual(["1", "1", "1", "1", "1", "1"])
    // v2 renames A: accepted, then needs_recheck (name_changed), exactly once.
    expect(after.photoA).toBe("needs_recheck:name_changed:2")
    expect(after.events.at(-1)).toBe("release_activated")
  })
})

describe("successive source versions (§8.5)", () => {
  it("reports a rename by the same key, removed dishes and two price changes", () => {
    const report = at<Report>("RUN2")
    expect(report.renamed[0]).toMatchObject({
      locator: "food--a",
      to: "Fixture Alpha Pie Deluxe",
    })
    expect(report.counts).toMatchObject({ removed: 6, priceChanges: 2 })
    expect(report.priceChanges.map((p) => [p.locator, p.from, p.to])).toEqual([
      ["food--a", 850, 875],
      ["food--b", 400, 425],
    ])
  })

  it("keeps ids and price history: a rejected change carries, an unchanged value adds nothing, removed dishes are tombstoned", () => {
    expect(at("ACTIVATE2")).toMatchObject({
      written: 1,
      carried: 1,
      tombstones: 3,
    })
    const after = at<{
      release1: string
      release2: string
      numbers: number[]
      prices: Record<string, { amount: number; assertions: number }>
      lines: Record<string, string>
      itemA: string
    }>("AFTER_RELEASE2")
    expect(after).toMatchObject({
      release1: "superseded",
      release2: "current",
      numbers: [1, 2],
      itemA: "Fixture Alpha Pie Deluxe",
    })
    expect(after.prices.A).toMatchObject({ amount: 850, assertions: 1 })
    expect(after.prices.B).toMatchObject({ amount: 425, assertions: 2 })
    expect(after.prices.C).toMatchObject({ amount: 1200, assertions: 1 })
    expect(after.lines).toEqual({
      A: "1",
      B: "1",
      C: "1",
      E: "tombstone",
      G: "tombstone",
      I: "tombstone",
    })
  })

  it("refuses an apply after 24 hours or once the base changed", () => {
    expect(out.APPLY_EXPIRED).toBe("import_base_changed")
    expect(out.APPLY_BASE_CHANGED).toBe("import_base_changed")
  })

  it("leaves the credit function unchanged", () => {
    expect(out.CREDIT_BEFORE).toBe(CREDIT_MD5)
    expect(out.CREDIT_AFTER).toBe(CREDIT_MD5)
  })
})

describe("catalogue and privileges", () => {
  it("keeps every new table private with RLS on", () => {
    for (const table of [
      "public.menu_import_runs",
      "public.menu_trading_proposals",
      "public.menu_trading_releases",
      "public.menu_trading_release_lines",
      "public.menu_trading_events",
    ])
      expect(
        psql(`select has_table_privilege('authenticated', '${table}', 'select') || ':' ||
          has_table_privilege('anon', '${table}', 'select') || ':' ||
          (select relrowsecurity from pg_class where oid = '${table}'::regclass)`),
        table
      ).toBe("false:false:true")
  })

  it("exposes the commands to signed-in users only, and fires the guard after the version guard", () => {
    for (const fn of [
      "public.menu_import_dry_run(uuid,uuid)",
      "public.menu_import_apply(uuid,uuid,uuid)",
      "public.menu_trading_proposal_decide(uuid,integer,text,jsonb,uuid)",
      "public.menu_trading_proposals_accept_exact(uuid,uuid)",
      "public.menu_release_confirm(uuid,text,uuid)",
      "public.menu_activate_with_release(uuid,integer,uuid,uuid)",
      "public.menu_import_run(uuid)",
    ])
      expect(
        psql(`select has_function_privilege('anon', '${fn}', 'execute') || ':' ||
          has_function_privilege('authenticated', '${fn}', 'execute') || ':' ||
          has_function_privilege('service_role', '${fn}', 'execute')`),
        fn
      ).toBe("false:true:false")
    expect(
      psql(`select string_agg(tgname, ',' order by tgname) from pg_trigger
        where tgrelid = 'public.menu_versions'::regclass and not tgisinternal
          and tgname in ('menu_versions_guard', 'menu_versions_require_release')`)
    ).toBe("menu_versions_guard,menu_versions_require_release")
    expect(
      psql(`select provolatile::text || ':' || prosecdef || ':' || array_to_string(proconfig, ',')
        from pg_proc where oid = 'public.menu_import_run(uuid)'::regprocedure`)
    ).toBe('s:true:search_path=""')
  })
})
