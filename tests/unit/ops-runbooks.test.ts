import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { metricById, OWNER_ROLES } from "@/lib/ops/metrics"
import { RUNBOOKS } from "@/lib/ops/runbooks"
import { switchById } from "@/lib/ops/switches"

const root = join(__dirname, "..", "..")

describe("T-B10-10 runbook index", () => {
  it("lists RB-01 to RB-21 once each", () => {
    expect(RUNBOOKS.map((r) => r.id)).toEqual(
      Array.from(
        { length: 21 },
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

  it("has passed no drill, and names what each waiting drill needs", () => {
    for (const rb of RUNBOOKS) {
      expect(["not_exercised", "queued"], rb.id).toContain(rb.drill.status)
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
      "RB-17",
      "RB-18",
      "RB-19",
      "RB-20",
      "RB-21",
    ])
    expect(by("partly_ready")).toEqual(["RB-07", "RB-12"])
  })

  it("queues only internal drills that a released source can run", () => {
    const queued = RUNBOOKS.filter((rb) => rb.drill.status === "queued")
    for (const rb of queued) {
      expect(rb.scope, rb.id).toBe("internal")
      expect(rb.drill.readiness, rb.id).not.toBe("waiting")
    }
    expect(queued.map((rb) => rb.id)).toEqual([
      "RB-01",
      "RB-02",
      "RB-03",
      "RB-06",
      "RB-07",
      "RB-11",
      "RB-12",
      "RB-13",
      "RB-18",
      "RB-19",
      "RB-20",
      "RB-21",
    ])
  })

  it("marks the external delivery runbooks out of scope (owner correction, 11 Nov 2026)", () => {
    expect(
      RUNBOOKS.filter((rb) => rb.scope === "out_of_scope").map((rb) => rb.id)
    ).toEqual(["RB-08", "RB-09", "RB-15"])
  })
})

describe("B10-02 runbook claims against the source", () => {
  it("names only switches that exist in the catalogue", () => {
    for (const rb of RUNBOOKS)
      for (const id of rb.switches)
        expect(switchById(id), `${rb.id} ${id}`).toBeDefined()
  })

  it("points every check at a test, script or source that exists", () => {
    const scripts = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
      .scripts as Record<string, string>
    for (const rb of RUNBOOKS)
      for (const check of rb.checks) {
        if (check.ref.startsWith("pnpm "))
          expect(scripts, `${rb.id} ${check.ref}`).toHaveProperty(
            check.ref.slice("pnpm ".length)
          )
        else
          expect(
            existsSync(join(root, check.ref)),
            `${rb.id} ${check.ref}`
          ).toBe(true)
        expect(check.proves.trim(), rb.id).not.toBe("")
      }
  })

  it("never tells an operator to change application rows by hand", () => {
    const handEdit =
      /\b(update|delete from|truncate|insert into)\s+(public|private|storage|auth)\./i
    for (const rb of RUNBOOKS)
      for (const text of [rb.firstChecks, rb.steps, rb.drill.description])
        expect(text, rb.id).not.toMatch(handEdit)
  })

  it("RB-12: the local restore loads in replica mode, as the caveat says", () => {
    expect(
      readFileSync(join(root, "scripts/db/restore-local.sh"), "utf8")
    ).toMatch(/session_replication_role\s*=\s*replica/)
  })

  it("RB-18: every released migration since B01 carries a rollback note", () => {
    // Released: B01 (PR #25) and B02 (PR #26). B10-m1 is not released.
    const released = readdirSync(join(root, "supabase/migrations")).filter(
      (f) => f >= "20261109145234" && f <= "20261110095911_~"
    )
    expect(released.length).toBe(13)
    for (const file of released)
      expect(
        readFileSync(join(root, "supabase/migrations", file), "utf8"),
        file
      ).toMatch(/rollback/i)
  })
})
