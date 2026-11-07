// Phase `withdraw`: tests/migrations/coverage-withdraw-access.sql removes every
// end-user capability the coverage and Our menu item-photo migrations added
// (and the scheduled preparation from the service role), keeps every row, and
// touches nothing else. Runs inside one transaction that is rolled back.
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { psql } from "../../scripts/db/lib/drill"
import { env } from "./helpers"

const MIGRATIONS = [
  "20261102130000_venue_manager_grants.sql",
  "20261102140000_coverage_domain.sql",
  "20261102150000_coverage_procedures.sql",
  "20261106130000_menu_item_photos.sql",
  "20261107100100_manager_account_access.sql",
  "20261107100200_manager_staff_denials.sql",
  "20261107100300_manager_item_photo_rules.sql",
  "20261107100400_manager_item_photo_writes.sql",
  "20261107100500_manager_item_photo_reads.sql",
  "20261107100700_manager_review_queue_dedupe.sql",
]
const script = readFileSync(
  join(import.meta.dirname, "coverage-withdraw-access.sql"),
  "utf8"
)
const sources = MIGRATIONS.map((f) =>
  readFileSync(join("supabase", "migrations", f), "utf8")
).join("\n")

const publicFunctions = [
  ...sources.matchAll(/^create function public\.([a-z_]+)\(/gm),
].map((m) => m[1]!)
const publicTables = [
  ...sources.matchAll(/^create table public\.([a-z_]+) \(/gm),
].map((m) => m[1]!)

/** Privileges as seen inside a transaction that ran the script, then rolled back. */
function privilegesAfterScript(): { fn: string; role: string; ok: boolean }[] {
  const checks = [
    ...publicFunctions.flatMap((fn) =>
      ["authenticated", "service_role"].map(
        (role) =>
          `select '${fn}' as fn, '${role}' as role, bool_or(has_function_privilege('${role}', p.oid, 'execute')) as ok
           from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = '${fn}'`
      )
    ),
    ...publicTables.map(
      (t) =>
        `select '${t}', 'authenticated', has_table_privilege('authenticated', 'public.${t}', 'select')`
    ),
  ].join(" union all ")
  // Through stdin: `psql -c` would print only the final ROLLBACK's result.
  const out = execFileSync(
    "psql",
    [env.dbUrl, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
    {
      encoding: "utf8",
      input: `begin;\n${script}\nselect coalesce(jsonb_agg(t), '[]') from (${checks}) t;\nrollback;\n`,
    }
  )
  return JSON.parse(
    out
      .split("\n")
      .filter((l) => l.startsWith("["))
      .pop()!
  )
}

describe("coverage access withdrawal", () => {
  it("names every coverage RPC and table", () => {
    expect(publicFunctions.length).toBe(45)
    expect(publicTables.length).toBe(16)
    for (const fn of publicFunctions)
      expect(script, fn).toContain(`public.${fn}(`)
    for (const t of publicTables) expect(script, t).toContain(`public.${t}`)
    expect(script).not.toMatch(
      /\b(drop|delete|truncate|alter|update|insert)\b/i
    )
  })

  it("leaves signed-in users no coverage capability and stops the scheduled run", () => {
    const rows = privilegesAfterScript()
    expect(rows).toHaveLength(publicFunctions.length * 2 + publicTables.length)
    expect(rows.filter((r) => r.ok && r.role === "service_role").length).toBe(
      publicFunctions.length - 1
    )
    const stillGranted = rows.filter(
      (r) =>
        r.ok &&
        (r.role === "authenticated" ||
          r.fn === "prepare_coverage_month_scheduled")
    )
    expect(stillGranted).toEqual([])
  })

  it("adds the manager role in a file of its own", () => {
    // A new enum value cannot be used in the transaction that adds it.
    const enumFile = readFileSync(
      join("supabase", "migrations", "20261107100000_manager_account_role.sql"),
      "utf8"
    )
    expect(
      enumFile
        .replace(/--[^\n]*/g, "")
        .split(";")
        .map((statement) => statement.trim())
        .filter(Boolean)
    ).toEqual(["alter type public.app_role add value if not exists 'manager'"])
  })

  it("keeps the manager role and every security fix in place", () => {
    // Enum values cannot be dropped: withdrawal removes capabilities only.
    const out = execFileSync(
      "psql",
      [env.dbUrl, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
      {
        encoding: "utf8",
        input: `begin;\n${script}\nselect 'manager' = any(enum_range(null::public.app_role))
          and position('v_role not in (''staff'', ''admin'')' in
            pg_get_functiondef('public.save_media_labels'::regproc)) > 0
          and exists (select 1 from pg_trigger
            where tgname = 'coverage_review_events_deny_manager_writes')
          and position('coalesce(v_venue = v_manager_venue, false)' in
            pg_get_functiondef('private.menu_photo_read_venue'::regproc)) > 0
          and exists (select 1 from pg_trigger
            where tgname = 'menu_item_photos_no_manager_self_review')
          and (select bool_and(position('is_active_manager' in pg_get_expr(pl.polqual, pl.polrelid)) > 0)
            from pg_policy pl
            where pl.polname in ('menu_item_photos_select', 'menu_item_photo_events_select')
            having count(*) = 2);\nrollback;\n`,
      }
    )
    expect(out.trim().split("\n").pop()).toBe("t")
  })

  it("keeps every grant in place outside the transaction", () => {
    expect(
      psql(
        env,
        "select has_function_privilege('authenticated', 'public.review_coverage_item(uuid, integer, text, text, text)', 'execute')"
      )
    ).toBe("t")
  })
})
