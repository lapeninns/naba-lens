// The photo recheck kinds the database allows, the server's list and the
// declared kinds WS2 adds to it cannot drift (b04-design §18.1 item 1): the
// latest menu_item_photos.recheck_kind check in the migrations must be the
// server's RECHECK_KINDS plus, until WS2 lists them, the five declared kinds.
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const ROOT = join(__dirname, "../..")
const DECLARED = [
  "variant_meaning_changed",
  "presentation_changed",
  "recipe_changed",
  "portion_changed",
  "reviewer_flag",
]

function sqlKinds(): string[] {
  const dir = join(ROOT, "supabase/migrations")
  let latest: string[] | null = null
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(join(dir, file), "utf8")
    const re = /check\s*\(\s*recheck_kind\s+in\s*\(([^)]*)\)/gi
    for (const m of sql.matchAll(re))
      latest = [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!)
  }
  if (!latest) throw new Error("no recheck_kind check found")
  return latest
}

function serverKinds(): string[] {
  const src = readFileSync(join(ROOT, "lib/server/menu-photos/read.ts"), "utf8")
  const m = /const RECHECK_KINDS[^=]*=\s*\[([^\]]*)\]/.exec(src)
  if (!m) throw new Error("RECHECK_KINDS not found in read.ts")
  return [...m[1]!.matchAll(/"([a-z_]+)"/g)].map((x) => x[1]!)
}

describe("photo recheck kinds (SQL check, server list, declared kinds)", () => {
  it("allows exactly the server's kinds plus the five declared kinds", () => {
    const sql = sqlKinds()
    const server = serverKinds()
    expect(new Set(sql).size).toBe(sql.length)
    expect([...new Set([...server, ...DECLARED])].sort()).toEqual(
      [...sql].sort()
    )
  })

  it("keeps today's three automatic kinds in the server list", () => {
    expect(serverKinds()).toEqual(
      expect.arrayContaining([
        "name_changed",
        "section_changed",
        "variant_removed",
      ])
    )
  })
})
