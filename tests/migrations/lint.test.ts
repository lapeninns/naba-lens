// Phase `lint`: the reset database has no drift from the migrations,
// `supabase db lint` reports no findings in the app schemas beyond the
// allow-list, and the backup/restore ACL inventory treats a NULL ACL like the
// owner's default for every object kind.
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { env, laterTarget, supabase } from "./helpers"

// Pre-existing findings in private.menu_document_title and
// private.write_menu_document, kept until those functions are fixed. Each entry
// is matched exactly on function, level and message, with the number of times it
// is reported. Anything else fails, and so does an entry that no longer appears:
// delete it from this list when the finding is fixed.
const KNOWN_FINDINGS = [
  {
    fn: "private.menu_document_title",
    level: "warning",
    message: "routine is marked as STABLE, but expression is VOLATILE",
    count: 2,
  },
  {
    fn: "private.write_menu_document",
    level: "warning",
    message: "target type is different type than source type",
    count: 3,
  },
]

type LintResult = {
  function: string
  issues: { level: string; message: string }[]
}

const countFindings = (results: LintResult[]) => {
  const counts = new Map<string, number>()
  for (const r of results)
    for (const i of r.issues) {
      const key = JSON.stringify([r.function, i.level, i.message])
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  return counts
}

describe("schema checks", () => {
  it("has no TEST-ONLY migration in the workdir", () => {
    expect(existsSync(laterTarget)).toBe(false)
  })

  it("reports no supabase db lint findings beyond the known ones", () => {
    const out = supabase(
      "db", "lint", "--local", "--schema", "public,private",
      "--level", "warning", "--fail-on", "none", "--output-format", "json"
    )
    console.log(out.trim())
    const found = countFindings(JSON.parse(out).results as LintResult[])
    const known = new Map(
      KNOWN_FINDINGS.map((k) => [
        JSON.stringify([k.fn, k.level, k.message]),
        k.count,
      ])
    )
    const parse = (key: string) => JSON.parse(key).join(" | ")
    const unexpected = [...found]
      .filter(([key, n]) => n > (known.get(key) ?? 0))
      .map(([key, n]) => `${parse(key)} (found ${n}, allowed ${known.get(key) ?? 0})`)
    const stale = [...known]
      .filter(([key, n]) => (found.get(key) ?? 0) < n)
      .map(
        ([key, n]) =>
          `${parse(key)} (found ${found.get(key) ?? 0}, listed ${n}): remove or lower it in KNOWN_FINDINGS`
      )
    expect({ unexpected, stale }).toEqual({ unexpected: [], stale: [] })
  })

  it("shows no drift between the migrations and the database", () => {
    const out = supabase(
      "db", "diff", "--local", "--schema", "public,private", "--output-format", "json"
    )
    console.log(out.trim())
    const result = JSON.parse(out) as { diff: string; dropStatements: unknown[] }
    expect(result.diff).toBe("")
    expect(result.dropStatements).toEqual([])
  })
})

// pg_dump omits an explicit ACL equal to the owner's default, so a restore has
// NULL where the source had an ACL (e.g. a revoked sequence). Each probe pairs
// a NULL-ACL object with an explicit-default twin; scripts/db/app-acls.sql must
// list both with the same grants or restore-local.sh reports a privilege diff.
const PROBES = [
  {
    kind: "relation",
    stem: "seq",
    create: (name: string) => `create sequence private.${name};`,
    explicit: (name: string) =>
      `revoke all on sequence private.${name} from public;`,
    isNull: (name: string) =>
      `(select relacl is null from pg_class where oid = 'private.${name}'::regclass)`,
  },
  {
    kind: "relation",
    stem: "tbl",
    create: (name: string) => `create table private.${name} (id int);`,
    explicit: (name: string) =>
      `revoke all on table private.${name} from public;`,
    isNull: (name: string) =>
      `(select relacl is null from pg_class where oid = 'private.${name}'::regclass)`,
  },
  {
    kind: "function",
    stem: "fn",
    create: (name: string) =>
      `create function private.${name}() returns int language sql as 'select 1';`,
    explicit: (name: string) =>
      `grant execute on function private.${name}() to public;`,
    isNull: (name: string) =>
      `(select proacl is null from pg_proc where oid = 'private.${name}()'::regprocedure)`,
  },
  {
    kind: "type",
    stem: "dom",
    create: (name: string) => `create domain private.${name} as integer;`,
    explicit: (name: string) =>
      `grant usage on domain private.${name} to public;`,
    isNull: (name: string) =>
      `(select typacl is null from pg_type where oid = 'private.${name}'::regtype)`,
  },
]

type InventoryEntry = { kind: string; name: string; grants: unknown[] }

describe("restore ACL inventory (scripts/db/app-acls.sql)", () => {
  it("lists a NULL ACL exactly like the owner's explicit default", () => {
    const setup = PROBES.flatMap((p) => {
      const nul = `acl_probe_null_${p.stem}`
      const exp = `acl_probe_explicit_${p.stem}`
      return [p.create(nul), p.create(exp), p.explicit(exp)]
    }).join("\n")
    const starts = PROBES.map(
      (p) =>
        `${p.isNull(`acl_probe_null_${p.stem}`)} and not ${p.isNull(`acl_probe_explicit_${p.stem}`)}`
    ).join(" and ")
    // Through stdin, in one transaction that is rolled back.
    const out = execFileSync(
      "psql",
      [env.dbUrl, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
      {
        encoding: "utf8",
        input: `begin;\n${setup}\nselect 'starts:' || (${starts});\n${readFileSync("scripts/db/app-acls.sql", "utf8")}\nrollback;\n`,
      }
    )
    const lines = out.split("\n")
    expect(lines).toContain("starts:true")
    const inventory = JSON.parse(
      lines.filter((l) => l.startsWith("[")).pop()!
    ) as InventoryEntry[]
    const grants = (kind: string, name: string) =>
      inventory.find(
        (e) => e.kind === kind && e.name.replace(/\(.*$/, "") === `private.${name}`
      )?.grants
    for (const p of PROBES) {
      const nul = grants(p.kind, `acl_probe_null_${p.stem}`)
      expect(nul, p.stem).toBeDefined()
      expect(nul, p.stem).toEqual(grants(p.kind, `acl_probe_explicit_${p.stem}`))
    }
    // The case a restore hit: a sequence owner's default is SELECT, UPDATE, USAGE.
    expect(
      (grants("relation", "acl_probe_null_seq") as [string, string, string][])
        .map((g) => g[2])
        .sort()
    ).toEqual(["SELECT", "UPDATE", "USAGE"])
  })
})
