// Phase `lint`: the reset database has no drift from the migrations and
// `supabase db lint` reports no schema errors in the app schemas.
import { existsSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { laterTarget, supabase } from "./helpers"

describe("schema checks", () => {
  it("has no TEST-ONLY migration in the workdir", () => {
    expect(existsSync(laterTarget)).toBe(false)
  })

  it("passes supabase db lint at warning level", () => {
    const out = supabase(
      "db", "lint", "--local", "--schema", "public,private",
      "--level", "warning", "--fail-on", "warning", "--output-format", "json"
    )
    console.log(out.trim())
    const result = JSON.parse(out) as { results: unknown[] }
    expect(result.results).toEqual([])
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
