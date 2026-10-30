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
      "--level", "warning", "--fail-on", "warning"
    )
    console.log(out.trim())
    expect(out).toMatch(/No schema errors found/i)
  })

  it("shows no drift between the migrations and the database", () => {
    const out = supabase("db", "diff", "--local", "--schema", "public,private")
    console.log(out.trim() || "(empty diff)")
    expect(out).not.toMatch(/\b(create|alter|drop|grant|revoke)\b/i)
  })
})
