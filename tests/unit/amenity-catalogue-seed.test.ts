// The latest catalogue migration must seed exactly the CSV, through the
// generator, and agree with the contract's fixed catalogue facts.
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  CORE_CHECK_KEYS,
  EVIDENCE_RULES,
  LEGACY_COVERAGE_MATCHES,
  REOPEN_PRESET_LABEL,
  WIFI_KEY,
} from "@/lib/amenities/contract"
import {
  BEGIN_MARKER,
  CATALOGUE_CSV,
  CATALOGUE_VERSION,
  END_MARKER,
  catalogueInsertSql,
  parseCatalogueCsv,
} from "@/scripts/db/amenity-catalogue-sql"

const MIGRATIONS = "supabase/migrations"
// Defines the catalogue's tables and RPCs (legacy keys, reopen labels).
const MIGRATION = `${MIGRATIONS}/20261107120000_amenity_catalogue.sql`
const csv = readFileSync(CATALOGUE_CSV, "utf8")
const migration = readFileSync(MIGRATION, "utf8")
const rows = parseCatalogueCsv(csv)

/** The newest migration holding a generated catalogue block (names sort by time). */
function latestCatalogueMigration(): { file: string; sql: string } {
  const file = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse()
    .find((f) =>
      readFileSync(join(MIGRATIONS, f), "utf8").includes(BEGIN_MARKER)
    )
  if (!file) throw new Error("No migration embeds the catalogue block")
  return { file, sql: readFileSync(join(MIGRATIONS, file), "utf8") }
}

describe("amenity catalogue seed", () => {
  it("embeds the generator's output for the CSV once, in the latest catalogue migration", () => {
    const { file, sql } = latestCatalogueMigration()
    expect(sql.split(BEGIN_MARKER), file).toHaveLength(2)
    const start = sql.indexOf(BEGIN_MARKER)
    const end = sql.indexOf(END_MARKER, start) + END_MARKER.length
    expect(sql.slice(start, end), file).toBe(catalogueInsertSql(rows))
    expect(Number.isInteger(CATALOGUE_VERSION)).toBe(true)
    expect(CATALOGUE_VERSION).toBeGreaterThanOrEqual(1)
  })

  it("re-runs over an earlier catalogue by updating every mutable column", () => {
    const block = catalogueInsertSql(rows)
    expect(block).toContain("on conflict (key) do update set")
    for (const column of [
      "category",
      "question",
      "capture_brief",
      "evidence_rule",
      "is_core",
      "position",
      "catalogue_version",
    ])
      expect(block).toContain(`  ${column} = excluded.${column}`)
    expect(block).not.toContain("key = excluded.key")
    expect(catalogueInsertSql(rows.slice(0, 1), 2)).toContain(
      `, ${rows[0]!.position}, 2)\non conflict`
    )
  })

  it("has 39 unique keys in CSV order with valid evidence rules", () => {
    expect(rows).toHaveLength(39)
    expect(new Set(rows.map((r) => r.key)).size).toBe(39)
    expect(rows.map((r) => r.position)).toEqual(
      Array.from({ length: 39 }, (_, i) => i + 1)
    )
    for (const r of rows) {
      expect(EVIDENCE_RULES).toContain(r.evidenceRule)
    }
    expect(rows.find((r) => r.key === WIFI_KEY)?.evidenceRule).toBe("both")
    expect(rows.find((r) => r.key === "step_free_entrance")?.evidenceRule).toBe(
      "video"
    )
  })

  it("marks exactly the contract's core keys", () => {
    expect(
      rows
        .filter((r) => r.isCore)
        .map((r) => r.key)
        .sort()
    ).toEqual([...CORE_CHECK_KEYS].sort())
  })

  it("maps legacy Coverage keys exactly as the contract", () => {
    const body = /amenity_legacy_coverage_keys[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(
      migration
    )![1]!
    const mapped = Object.fromEntries(
      [...body.matchAll(/\('([a-z0-9_]+)', array\[([^\]]*)\]\)/g)].map((m) => [
        m[1],
        [...m[2]!.matchAll(/'([a-z0-9_]+)'/g)].map((k) => k[1]),
      ])
    )
    expect(mapped).toEqual(LEGACY_COVERAGE_MATCHES)
    const keys = new Set(rows.map((r) => r.key))
    for (const key of Object.keys(LEGACY_COVERAGE_MATCHES)) {
      expect(keys.has(key), key).toBe(true)
    }
  })

  it("uses the contract's reopen preset labels", () => {
    for (const [preset, label] of Object.entries(REOPEN_PRESET_LABEL)) {
      expect(migration).toContain(`when '${preset}' then '${label}'`)
    }
  })

  it("rejects malformed CSV", () => {
    const header = csv.split("\n")[0]
    expect(() =>
      parseCatalogueCsv(`${header}\nbad key,Games,Q?,photo,Brief,false\n`)
    ).toThrow(/invalid key/)
    expect(() =>
      parseCatalogueCsv(`${header}\na,Games,Q?,sound,Brief,false\n`)
    ).toThrow(/evidence rule/)
    expect(() =>
      parseCatalogueCsv(
        `${header}\na,Games,Q?,photo,Brief,false\na,Games,Q?,photo,Brief,false\n`
      )
    ).toThrow(/duplicate/)
    expect(() => parseCatalogueCsv(`${header}\na,Games,"Q?,photo\n`)).toThrow(
      /Unterminated/
    )
  })
})
