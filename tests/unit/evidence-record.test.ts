import { describe, expect, it } from "vitest"

import {
  aggregate,
  describeOutcome,
  renderRecord,
} from "../../tests/journeys/evidence-record.mjs"
import { parseCatalogue } from "../../tests/journeys/acceptance-coverage.mjs"

const catalogue = parseCatalogue(
  [
    "| `MENUS-QA-14` | matrix | docs/a.md:1 | `menus.responsive-a11y`, `menus.d1` | covered | n |",
    "| `MENUS-D1` | defect | docs/a.md:2 | `menus.d1` | covered | n |",
    "| `MENUS-O2` | observation | docs/a.md:3 | `menus.o2` | covered | n |",
    "| `MEDIA-X` | media | docs/a.md:4 | - | gap | later |",
  ].join("\n")
)

const result = (journey: string, over: Record<string, unknown> = {}) => ({
  journey,
  result: "pass",
  reason: null,
  scenarios: [],
  runner: { kind: "playwright", version: "1.64.1" },
  revision: { commit: "a".repeat(40), branch: "ws1/evidence", dirty: false },
  checks: { passed: 1, failed: 0, skipped: 0 },
  ...over,
})

const summary = {
  runId: "20261031T150407Z-aaaaaaa",
  revision: { commit: "a".repeat(40), branch: "ws1/evidence", dirty: false },
  stack: { name: "ws1", apiPort: 64121, migrations: "2026:abc" },
  startedAt: "2026-10-31T15:00:00.000Z",
  finishedAt: "2026-10-31T15:01:00.000Z",
  exitCode: 1,
  totals: { pass: 1, fail: 2, unavailable: 0 },
}

const env = { label: "test", node: "v24", pnpm: "pnpm 10" }

describe("evidence record", () => {
  it("takes the worst result and never turns unavailable into a pass", () => {
    expect(aggregate([])).toBeNull()
    expect(aggregate(["pass", "pass"])).toBe("pass")
    expect(aggregate(["pass", "unavailable"])).toBe("unavailable")
    expect(aggregate(["unavailable", "fail", "pass"])).toBe("fail")
  })

  it("calls a failed observation reproduced, not a defect", () => {
    expect(describeOutcome("observation", "fail")).toBe(
      "fail: observation reproduced (not a defect)"
    )
    expect(describeOutcome("defect", "fail")).toBe(
      "fail: defect reproduces on this commit"
    )
    expect(describeOutcome("defect", "unavailable")).toBe("unavailable")
    expect(describeOutcome("matrix", "pass")).toBe("pass")
    expect(describeOutcome("matrix", null)).toBe("not run")
  })

  it("renders per-id results and historical verdicts from the result files", () => {
    const md = renderRecord({
      summary,
      results: [
        result("menus.d1", {
          result: "fail",
          reason: "label-content-name-mismatch",
          scenarios: ["MENUS-D1", "MENUS-QA-14"],
          historical: {
            source: "docs/qa/menus-qa-report.md#4",
            id: "MENUS-D1",
            reproducedOnHead: true,
          },
        }),
        result("menus.o2", {
          result: "fail",
          reason: "section name truncated",
          scenarios: ["MENUS-O2"],
          historical: {
            source: "docs/qa/menus-qa-report.md#4",
            id: "MENUS-O2",
            reproducedOnHead: true,
          },
        }),
        result("menus.responsive-a11y", { scenarios: ["MENUS-QA-14"] }),
      ],
      catalogue,
      env,
    })
    expect(md).toContain(
      "| `MENUS-QA-14` | matrix | fail | `menus.responsive-a11y` pass, `menus.d1` fail | covered |"
    )
    expect(md).toContain(
      "| `MENUS-D1` | defect | fail: defect reproduces on this commit |"
    )
    expect(md).toContain(
      "| `MENUS-O2` | observation | fail: observation reproduced (not a defect) |"
    )
    expect(md).toContain("| `MEDIA-X` | media | no journey (gap) | - | gap |")
    expect(md).toContain(
      "| `MENUS-D1` | `menus.d1` | fail | still reproduces |"
    )
    expect(md).toContain(
      "| `MENUS-O2` | `menus.o2` | fail | observation reproduced (not a defect) |"
    )
  })

  it("does not call an unavailable historical journey resolved", () => {
    const md = renderRecord({
      summary,
      results: [
        result("menus.d1", {
          result: "unavailable",
          reason: "stack down",
          historical: {
            source: "docs/qa/menus-qa-report.md#4",
            id: "MENUS-D1",
            reproducedOnHead: null,
          },
        }),
      ],
      catalogue,
      env,
    })
    expect(md).toContain("unknown: unavailable, not resolved")
    expect(md).not.toContain("resolved on this commit")
  })
})
