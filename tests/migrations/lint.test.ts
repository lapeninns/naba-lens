// Phase `lint`: the reset database has no drift from the migrations and
// `supabase db lint` reports no findings in the app schemas beyond the allow-list.
import { existsSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { laterTarget, supabase } from "./helpers"

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
