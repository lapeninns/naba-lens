import { describe, expect, it } from "vitest"

import {
  ASSIST_JOBS,
  FIXTURE_PROVIDER_ID,
  getAssistJob,
  mayRunOn,
} from "@/lib/server/assist/catalogue"
import { ASSIST_JOB_KEYS } from "@/lib/server/assist/types"

describe("assist job catalogue (B09-01a)", () => {
  it("holds exactly the four designed jobs, one version each", () => {
    expect(ASSIST_JOBS.map((j) => `${j.key}@${j.version}`).sort()).toEqual(
      ASSIST_JOB_KEYS.map((k) => `${k}@1`).sort()
    )
  })

  it("gives every job a decision point, a domain command and prohibited inferences", () => {
    for (const job of ASSIST_JOBS) {
      expect(job.decisionPoint.length).toBeGreaterThan(10)
      expect(job.domainCommand.length).toBeGreaterThan(5)
      expect(job.prohibitedInferences.length).toBeGreaterThan(0)
      expect(job.schemaVersion).toBe(`${job.key}@${job.version}`)
    }
  })

  it("starts with no owner sign-off on any job", () => {
    expect(ASSIST_JOBS.every((j) => j.signedOffBy === null)).toBe(true)
  })

  it("refuses an unknown job or version", () => {
    expect(getAssistJob("auto_publish", 1)).toEqual({
      ok: false,
      reason: "assist_job_unknown",
    })
    expect(getAssistJob("label_suggest", 2)).toEqual({
      ok: false,
      reason: "assist_job_unknown",
    })
    expect(getAssistJob("label_suggest", 1).ok).toBe(true)
  })

  it("lets a job without sign-off run on the fixture provider only", () => {
    const lookup = getAssistJob("evidence_describe", 1)
    if (!lookup.ok) throw new Error("missing job")
    expect(mayRunOn(lookup.job, FIXTURE_PROVIDER_ID)).toBe(true)
    expect(mayRunOn(lookup.job, "any-real-provider")).toBe(false)
    expect(mayRunOn({ ...lookup.job, signedOffBy: "OD-B9-1" }, "p")).toBe(true)
  })

  it("lets only admins request the menu-import draft", () => {
    const lookup = getAssistJob("menu_import_draft", 1)
    expect(lookup.ok && lookup.job.requesters).toEqual(["admin"])
  })
})
