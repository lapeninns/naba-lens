import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { renderMetricsDoc, renderRunbookIndex } from "@/lib/ops/docs"
import { formattedOpsDocs } from "@/scripts/ops/docs-format"
import {
  BASELINE_RELEASED,
  METRIC_FAMILIES,
  METRIC_UNITS,
  METRICS,
  OWNER_ROLES,
  SOURCE_BATCHES,
  evaluateMetric,
  metricAvailability,
  metricById,
  type SourceBatch,
} from "@/lib/ops/metrics"
import { RUNBOOKS } from "@/lib/ops/runbooks"

const root = fileURLToPath(new URL("../../", import.meta.url))
const metric = (id: string) => {
  const m = metricById(id)
  if (!m) throw new Error(`no ${id}`)
  return m
}

describe("T-B10-01 metric registry", () => {
  it("has exactly the 44 catalogue metrics, once each", () => {
    const ids = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => `M-${prefix}-${i + 1}`)
    expect(METRICS.map((m) => m.id)).toEqual([
      ...ids("JB", 6),
      ...ids("UP", 7),
      ...ids("KN", 6),
      ...ids("RV", 5),
      ...ids("DL", 8),
      ...ids("WD", 5),
      ...ids("AI", 4),
      ...ids("AD", 3),
    ])
  })

  it("groups them into the dashboard families", () => {
    const sizes = Object.fromEntries(
      METRIC_FAMILIES.map((f) => [
        f,
        METRICS.filter((m) => m.family === f).length,
      ])
    )
    expect(sizes).toEqual({
      jobs: 6,
      uploads: 7,
      knowledge: 6,
      review: 5,
      delivery: 13,
      ai: 4,
      adoption: 3,
    })
  })

  it("gives every metric a definition, source, batch, unit, owner and runbook links that exist", () => {
    const runbookIds = new Set(RUNBOOKS.map((r) => r.id))
    for (const m of METRICS) {
      for (const text of [
        m.title,
        m.definition,
        m.headline,
        m.window,
        m.source.ref,
      ])
        expect(text.trim(), m.id).not.toBe("")
      expect(SOURCE_BATCHES, m.id).toContain(m.availableFrom)
      for (const p of m.partial ?? [])
        expect(SOURCE_BATCHES, m.id).toContain(p.from)
      for (const b of m.alsoNeeds ?? [])
        expect(SOURCE_BATCHES, m.id).toContain(b)
      expect(METRIC_UNITS, m.id).toContain(m.unit)
      expect(m.owners.length, m.id).toBeGreaterThan(0)
      for (const o of m.owners) expect(OWNER_ROLES, m.id).toContain(o)
      for (const r of m.runbooks)
        expect(runbookIds.has(r), `${m.id} ${r}`).toBe(true)
      if (m.threshold) expect(m.threshold.text.trim(), m.id).not.toBe("")
    }
  })

  it("reads the knowledge metrics from the B03 status view only", () => {
    for (const id of ["M-KN-1", "M-KN-2", "M-KN-3"])
      expect(metric(id).source.ref).toContain(
        "private.knowledge_slot_state_b03"
      )
  })
})

describe("T-B10-02 generated documents", () => {
  it("the committed documents equal the registries, as written by scripts/ops/write-docs.ts", async () => {
    const docs = await formattedOpsDocs(root)
    expect(docs.map(([path]) => path)).toEqual([
      "docs/operations/metrics.md",
      "docs/operations/runbooks/README.md",
    ])
    for (const [path, text] of docs)
      expect(readFileSync(join(root, path), "utf8"), path).toBe(text)
  })

  it("lists every metric and runbook in the documents", () => {
    const metricsDoc = renderMetricsDoc()
    for (const m of METRICS) expect(metricsDoc).toContain(`| ${m.id} |`)
    const runbookDoc = renderRunbookIndex()
    for (const rb of RUNBOOKS) expect(runbookDoc).toContain(`## ${rb.id} `)
  })
})

describe("T-B10-03 threshold states", () => {
  const all = [...SOURCE_BATCHES] as SourceBatch[]

  it("never shows an unreleased metric as 0", () => {
    const result = evaluateMetric(
      metric("M-KN-1"),
      { value: 0 },
      BASELINE_RELEASED
    )
    expect(result.state).toBe("not_available")
    expect(result.availability.missing).toEqual(["B03"])
  })

  it("reads a log-only metric as not measured until a log source exists", () => {
    expect(
      evaluateMetric(metric("M-UP-7"), { value: 3 }, BASELINE_RELEASED).state
    ).toBe("not_measured")
    // M-DL-6 also needs B01's reader, so at the baseline it is not available.
    expect(
      evaluateMetric(metric("M-DL-6"), { value: 3 }, BASELINE_RELEASED).state
    ).toBe("not_available")
  })

  it("reads a missing reading as not measured", () => {
    expect(
      evaluateMetric(metric("M-UP-1"), null, BASELINE_RELEASED).state
    ).toBe("not_measured")
  })

  it("keeps information-only metrics ok", () => {
    expect(
      evaluateMetric(metric("M-UP-1"), { value: 9 }, BASELINE_RELEASED).state
    ).toBe("ok")
  })

  it("applies warn and breach limits strictly beyond the limit", () => {
    const rv1 = metric("M-RV-1")
    expect(evaluateMetric(rv1, { value: 7 }, all).state).toBe("ok")
    expect(evaluateMetric(rv1, { value: 8 }, all).state).toBe("warning")
    expect(evaluateMetric(rv1, { value: 14 }, all).state).toBe("warning")
    expect(evaluateMetric(rv1, { value: 15 }, all).state).toBe("breach")
  })

  it("applies limits below a value", () => {
    const dl7 = metric("M-DL-7")
    expect(evaluateMetric(dl7, { value: 30 }, all).state).toBe("ok")
    expect(evaluateMetric(dl7, { value: 13 }, all).state).toBe("warning")
    expect(evaluateMetric(dl7, { value: -1 }, all).state).toBe("breach")
  })

  it("needs at least 10 observed attempts before judging completion", () => {
    const ad3 = metric("M-AD-3")
    expect(evaluateMetric(ad3, { value: 50, sample: 9 }, all).state).toBe(
      "not_measured"
    )
    expect(evaluateMetric(ad3, { value: 89, sample: 10 }, all).state).toBe(
      "breach"
    )
    expect(evaluateMetric(ad3, { value: 90, sample: 10 }, all).state).toBe("ok")
  })

  it("evaluates a partly released metric and says what is missing", () => {
    const result = evaluateMetric(
      metric("M-WD-4"),
      { value: 2 },
      BASELINE_RELEASED
    )
    expect(result.availability).toEqual({ status: "partial", missing: ["B01"] })
    expect(result.state).toBe("ok")
  })
})

describe("availability at the production baseline", () => {
  const at = (status: string) =>
    METRICS.filter(
      (m) => metricAvailability(m, BASELINE_RELEASED).status === status
    ).map((m) => m.id)

  it("computes only the metrics whose sources are on main", () => {
    expect(at("available")).toEqual([
      "M-JB-3",
      "M-JB-4",
      "M-UP-1",
      "M-UP-2",
      "M-UP-3",
      "M-UP-4",
      "M-UP-5",
      "M-UP-6",
      "M-RV-3",
    ])
    expect(at("partial")).toEqual(["M-WD-4"])
  })

  it("keeps every metric that needs B03, B06 or B07 unavailable", () => {
    for (const m of METRICS) {
      const needs = [m.availableFrom, ...(m.alsoNeeds ?? [])]
      if (needs.some((b) => b === "B03" || b === "B06" || b === "B07"))
        expect(metricAvailability(m, BASELINE_RELEASED).status, m.id).toBe(
          "unavailable"
        )
    }
  })
})
