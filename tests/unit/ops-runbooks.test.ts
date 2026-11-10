import { describe, expect, it } from "vitest"

import { metricById, OWNER_ROLES } from "@/lib/ops/metrics"
import { RUNBOOKS } from "@/lib/ops/runbooks"

describe("T-B10-10 runbook index", () => {
  it("lists RB-01 to RB-16 once each", () => {
    expect(RUNBOOKS.map((r) => r.id)).toEqual(
      Array.from(
        { length: 16 },
        (_, i) => `RB-${String(i + 1).padStart(2, "0")}`
      )
    )
  })

  it("fills every field plan §19 requires", () => {
    for (const rb of RUNBOOKS) {
      for (const text of [
        rb.title,
        rb.firstChecks,
        rb.steps,
        rb.narrowestSwitch,
        rb.dataImplications,
        rb.pendingDelivery,
        rb.readbackProof,
        rb.drill.description,
      ])
        expect(text.trim(), rb.id).not.toBe("")
      expect(OWNER_ROLES, rb.id).toContain(rb.operatorRole)
      expect(
        rb.triggerMetrics.length + rb.otherTriggers.length,
        rb.id
      ).toBeGreaterThan(0)
      expect(rb.evidencePath).toBe(`evidence/b10-02/${rb.id}/`)
    }
  })

  it("links triggers and metrics both ways", () => {
    for (const rb of RUNBOOKS)
      for (const id of rb.triggerMetrics) {
        const metric = metricById(id)
        expect(metric, `${rb.id} ${id}`).toBeDefined()
        expect(metric?.runbooks, `${rb.id} ${id}`).toContain(rb.id)
      }
  })

  it("has run no drill yet, and names what each waiting drill needs", () => {
    for (const rb of RUNBOOKS) {
      expect(rb.drill.status).toBe("not_exercised")
      if (rb.drill.readiness === "ready_on_main")
        expect(rb.drill.waitingFor, rb.id).toEqual([])
      else expect(rb.drill.waitingFor.length, rb.id).toBeGreaterThan(0)
    }
    const by = (r: string) =>
      RUNBOOKS.filter((rb) => rb.drill.readiness === r).map((rb) => rb.id)
    expect(by("ready_on_main")).toEqual([
      "RB-01",
      "RB-02",
      "RB-03",
      "RB-06",
      "RB-11",
      "RB-13",
    ])
    expect(by("partly_ready")).toEqual(["RB-07", "RB-12"])
  })
})
