// G3 (docs/knowledge/b01-design.md §2.3): a catalogue-version migration
// generated after B01 records a definition change for every key; the version 1
// block (embedded in 20261107120000) is unchanged.
import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  BEGIN_MARKER,
  CATALOGUE_CSV,
  END_MARKER,
  catalogueInsertSql,
  parseCatalogueCsv,
} from "@/scripts/db/amenity-catalogue-sql"

const rows = parseCatalogueCsv(readFileSync(CATALOGUE_CSV, "utf8"))

describe("catalogue generator and knowledge definition changes", () => {
  it("leaves the version 1 block without knowledge calls", () => {
    const block = catalogueInsertSql(rows, 1)
    expect(block).not.toContain("knowledge")
    const seed = readFileSync("supabase/migrations/20261107120000_amenity_catalogue.sql", "utf8")
    const start = seed.indexOf(BEGIN_MARKER)
    expect(seed.slice(start, seed.indexOf(END_MARKER, start) + END_MARKER.length)).toBe(block)
  })

  it("notes a question version change for every key from version 2", () => {
    const block = catalogueInsertSql(rows, 2)
    const upsertEnd = block.indexOf("excluded.catalogue_version;")
    const call = block.indexOf(
      "select private.knowledge_note_definition_change(c.key, 'question_version_changed')"
    )
    expect(upsertEnd).toBeGreaterThan(0)
    expect(call).toBeGreaterThan(upsertEnd)
    expect(block).toContain("where c.catalogue_version = 2\norder by c.key;\n" + END_MARKER)
  })
})
