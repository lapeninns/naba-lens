import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { UNAVAILABLE_DETAILS } from "@/app/api/knowledge/_reader/contract"
import {
  classifySlotStatus,
  countFreshness,
  countSlotStatuses,
  unavailablePairs,
} from "@/lib/ops/knowledge-status"

const root = fileURLToPath(new URL("../../", import.meta.url))

describe("T-B10-08 closed (reason, detail) table (the part runnable now)", () => {
  it("uses exactly the reader's own pairs", () => {
    const fromReader = Object.entries(UNAVAILABLE_DETAILS).flatMap(([r, ds]) =>
      (ds as readonly string[]).map((d) => `${r} / ${d}`)
    )
    expect(unavailablePairs()).toEqual(fromReader)
    for (const pair of fromReader) {
      const [reason, detail] = pair.split(" / ")
      expect(
        classifySlotStatus({ status: "unavailable", reason, detail })
      ).toEqual({
        kind: "unavailable",
        pair,
      })
    }
  })

  it("reports any pair outside the table as a contract breach", () => {
    const breaches = [
      {
        status: "unavailable",
        reason: "stale",
        detail: "temporary_until_passed",
      },
      { status: "unavailable", reason: "not_permitted", detail: null },
      { status: "unavailable", reason: null, detail: null },
      { status: "available", reason: "stale", detail: "expired" },
      { status: "maybe", reason: null, detail: null },
    ]
    for (const row of breaches)
      expect(classifySlotStatus(row).kind, JSON.stringify(row)).toBe(
        "contract_breach"
      )
  })

  it("never adds a breach to another count", () => {
    const counts = countSlotStatuses([
      { status: "available", reason: null, detail: null },
      {
        status: "unavailable",
        reason: "withdrawn",
        detail: "answer_withdrawn",
      },
      { status: "unavailable", reason: "stale", detail: "expired" },
      { status: "unavailable", reason: "stale", detail: "expired" },
      {
        status: "unavailable",
        reason: "stale",
        detail: "temporary_until_passed",
      },
    ])
    expect(counts).toEqual({
      available: 1,
      unavailable: { "withdrawn / answer_withdrawn": 1, "stale / expired": 2 },
      contractBreaches: { "stale / temporary_until_passed": 1 },
    })
  })

  it("counts freshness per use, keeps unrated apart and flags unknown states", () => {
    expect(
      countFreshness([
        { use: "internal", state: "expired" },
        { use: "internal", state: "unrated" },
        { use: "public", state: "current" },
        { use: "public", state: "stale" },
      ])
    ).toEqual({
      byUse: { internal: { expired: 1, unrated: 1 }, public: { current: 1 } },
      contractBreaches: { "public / stale": 1 },
    })
  })
})

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

describe("T-B10-08 static ban", () => {
  it("operations code never reads the B01 resolver directly", () => {
    const files = ["lib/ops", "scripts/ops"].flatMap((d) => walk(join(root, d)))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files)
      expect(readFileSync(file, "utf8"), file).not.toMatch(
        /knowledge_slot_state(?!_b03)/
      )
  })
})
