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
    expect(publicFunctions.length).toBe(33)
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

  it("keeps every grant in place outside the transaction", () => {
    expect(
      psql(
        env,
        "select has_function_privilege('authenticated', 'public.review_coverage_item(uuid, integer, text, text, text)', 'execute')"
      )
    ).toBe("t")
  })
})
