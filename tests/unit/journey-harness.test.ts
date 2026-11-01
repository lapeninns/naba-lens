import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { inferNeeds } from "../../scripts/ci/journeys/needs.mjs"
import { outcomeFromReport } from "../../scripts/ci/journeys/outcome.mjs"
import {
  loadJourneys,
  selectJourneys,
  validateDefinition,
} from "../../scripts/ci/journeys/registry.mjs"
import { allocateRunDir, scrub } from "../../scripts/ci/journeys/run.mjs"
import {
  validateResult,
  validateRunDir,
} from "../../scripts/ci/journeys/validate.mjs"
import { stackSpec } from "../../scripts/ci/stack.mjs"

const base = () => ({
  schema: "nabalens.journey-result/v1",
  journey: "menus.activation",
  title: "Admin activates a reviewed draft menu",
  result: "pass",
  reason: null,
  revision: { commit: "a".repeat(40), branch: "ws1/menus", dirty: false },
  stack: { name: "ws1", apiPort: 64121, migrations: "20261030160000:cee297c7" },
  runner: { kind: "playwright", version: "1.64.1" },
  startedAt: "2026-10-31T10:00:00.000Z",
  finishedAt: "2026-10-31T10:01:12.000Z",
  scenarios: ["MENUS-QA-03"],
  checks: { passed: 2, failed: 0, skipped: 0 },
  evidence: [],
})

describe("journey result validation", () => {
  it("accepts a well-formed pass", () => {
    expect(validateResult(base())).toEqual([])
  })

  it("requires a reason for fail and unavailable, and none for a pass", () => {
    expect(validateResult({ ...base(), result: "fail" })).toContain(
      "reason is required when result is fail"
    )
    expect(
      validateResult({ ...base(), result: "unavailable", reason: " " })
    ).toContain("reason is required when result is unavailable")
    expect(validateResult({ ...base(), reason: "because" })).toContain(
      "reason must be null for a pass"
    )
  })

  it("never accepts a pass without a held deterministic check", () => {
    const noChecks: Record<string, unknown> = base()
    delete noChecks.checks
    expect(validateResult(noChecks).join()).toMatch(/a pass needs checks/)
    expect(
      validateResult({
        ...base(),
        checks: { passed: 0, failed: 0, skipped: 0 },
      }).join()
    ).toMatch(/a pass needs checks/)
    expect(
      validateResult({
        ...base(),
        checks: { passed: 3, failed: 0, skipped: 1 },
      }).join()
    ).toMatch(/a pass needs checks/)
  })

  it("ties historical.reproducedOnHead to the result", () => {
    const historical = {
      source: "docs/qa/menus-qa-report.md#4-defects-for-the-lead",
      id: "MENUS-D2",
    }
    expect(
      validateResult({
        ...base(),
        historical: { ...historical, reproducedOnHead: false },
      })
    ).toEqual([])
    expect(
      validateResult({
        ...base(),
        historical: { ...historical, reproducedOnHead: true },
      })
    ).toContain("a passing historical journey has reproducedOnHead false")
    expect(
      validateResult({
        ...base(),
        result: "fail",
        reason: "axe",
        historical: { ...historical, reproducedOnHead: true },
      })
    ).toEqual([])
  })

  it("rejects malformed revision, ids and timestamps", () => {
    const problems = validateResult({
      ...base(),
      journey: "Menus",
      revision: { commit: "abc", branch: "", dirty: "no" },
      finishedAt: "2026-10-31T09:00:00.000Z",
      scenarios: ["nope"],
    }).join("\n")
    expect(problems).toMatch(/journey must be/)
    expect(problems).toMatch(/revision.commit/)
    expect(problems).toMatch(/revision.branch/)
    expect(problems).toMatch(/revision.dirty/)
    expect(problems).toMatch(/finishedAt is before startedAt/)
    expect(problems).toMatch(/not an acceptance id/)
  })

  it("checks evidence files, paths, traces and credentials", () => {
    const dir = mkdtempSync(join(tmpdir(), "journey-validate-"))
    mkdirSync(join(dir, "logs"))
    writeFileSync(join(dir, "logs/ok.log"), "fine\n")
    writeFileSync(
      join(dir, "logs/leak.log"),
      `token eyJhbGciOiJIUzI1NiJ9.${"a".repeat(20)}.${"b".repeat(20)}\n`
    )
    const evidence = (path: string) => [{ kind: "log", path, description: "x" }]
    const check = (path: string) =>
      validateResult(
        { ...base(), evidence: evidence(path) },
        { resultsDir: dir }
      )
    expect(check("logs/ok.log")).toEqual([])
    expect(check("logs/missing.log").join()).toMatch(/does not exist/)
    expect(check("../outside.log").join()).toMatch(/relative/)
    expect(check("/etc/passwd").join()).toMatch(/relative/)
    expect(check("trace.zip").join()).toMatch(/traces, cookies/)
    expect(check("logs/leak.log").join()).toMatch(/contains a credential/)
  })

  it("flags a run directory whose summary disagrees with the journey files", () => {
    const dir = mkdtempSync(join(tmpdir(), "journey-run-"))
    mkdirSync(join(dir, "journeys"))
    const result = {
      ...base(),
      result: "unavailable",
      reason: "stack ws1 is stopped",
      checks: undefined,
    }
    writeFileSync(
      join(dir, "journeys/menus.activation.json"),
      JSON.stringify(result)
    )
    writeFileSync(join(dir, "summary.md"), "# run\n")
    const summary = {
      schema: "nabalens.journey-summary/v1",
      runId: "r1",
      revision: result.revision,
      totals: { pass: 1, fail: 0, unavailable: 0 },
      journeys: [{ journey: "menus.activation", result: "pass" }],
    }
    writeFileSync(join(dir, "summary.json"), JSON.stringify(summary))
    const { errors } = validateRunDir(dir)
    expect(errors.join("\n")).toMatch(/summary and file disagree/)
    expect(errors.join("\n")).toMatch(/totals.pass does not match/)
  })
})

const report = (tests: { status: string; error?: string }[]) => ({
  suites: [
    {
      file: "x.spec.ts",
      specs: tests.map((t, i) => ({
        title: `test ${i}`,
        tests: [
          {
            projectName: "chromium",
            status: t.status,
            results: [
              {
                status: t.status === "expected" ? "passed" : "failed",
                error: t.error ? { message: t.error } : undefined,
                attachments: [],
              },
            ],
          },
        ],
      })),
    },
  ],
  errors: [],
})

describe("Playwright outcome mapping", () => {
  it("passes only when every test ran and held", () => {
    const outcome = outcomeFromReport(report([{ status: "expected" }]))
    expect(outcome).toMatchObject({
      result: "pass",
      checks: { passed: 1, failed: 0, skipped: 0 },
    })
  })

  it("fails with the first failing assertion", () => {
    const outcome = outcomeFromReport(
      report([
        { status: "expected" },
        {
          status: "unexpected",
          error: "\u001b[31mexpect(received).toBe(expected)\u001b[39m\nmore",
        },
      ])
    )
    expect(outcome.result).toBe("fail")
    expect(outcome.reason).toMatch(
      /1 of 2 test\(s\) failed.*expect\(received\)\.toBe\(expected\)/
    )
  })

  it("never counts skipped, flaky or absent tests as a pass", () => {
    expect(outcomeFromReport(report([{ status: "skipped" }])).result).toBe(
      "unavailable"
    )
    expect(
      outcomeFromReport(report([{ status: "expected" }, { status: "skipped" }]))
        .result
    ).toBe("unavailable")
    expect(outcomeFromReport(report([{ status: "flaky" }])).result).toBe("fail")
    expect(outcomeFromReport({ suites: [], errors: [] })).toMatchObject({
      result: "unavailable",
      reason: "no tests matched the journey's spec and grep",
    })
  })
})

describe("journey registry", () => {
  const def = {
    id: "menus.activation",
    title: "t",
    spec: "tests/journeys/auth.login-smoke.spec.ts",
    scenarios: ["MENUS-QA-03"],
  }

  it("validates declarations", () => {
    expect(validateDefinition(def, process.cwd())).toEqual([])
    const problems = validateDefinition(
      {
        ...def,
        id: "x",
        spec: "tests/nope.spec.ts",
        projects: ["ie"],
        extra: 1,
      },
      process.cwd()
    ).join("\n")
    expect(problems).toMatch(/id must be/)
    expect(problems).toMatch(/does not exist/)
    expect(problems).toMatch(/projects must be/)
    expect(problems).toMatch(/extra: unknown field/)
  })

  it("selects by id and glob and reports unknown selectors", () => {
    const journeys = [
      { id: "menus.activation" },
      { id: "menus.import" },
      { id: "media.recovery" },
    ]
    expect(selectJourneys(journeys, ["menus.*"], false).selected).toHaveLength(
      2
    )
    expect(
      selectJourneys(journeys, ["media.recovery"], false).selected
    ).toHaveLength(1)
    expect(selectJourneys(journeys, ["nope.x"], false).unknown).toEqual([
      "nope.x",
    ])
    expect(selectJourneys(journeys, [], true).selected).toHaveLength(3)
  })
})

describe("stack allocation and scrubbing", () => {
  it("keeps every stack on its contract port block", () => {
    expect(stackSpec("ws1")).toMatchObject({
      apiPort: 64121,
      dbPort: 64122,
      mailpitPort: 64124,
      appPort: 3641,
    })
    expect(stackSpec("ws2")).toMatchObject({ apiPort: 64221, appPort: 3642 })
    expect(stackSpec("gate")).toMatchObject({ apiPort: 64321, appPort: 3643 })
    expect(stackSpec("spare5")).toMatchObject({ apiPort: 64521, appPort: 3645 })
    for (const name of ["main", "ws3", "spare3", "spare10", "../ws1"]) {
      expect(() => stackSpec(name)).toThrow(/Unknown stack/)
    }
  })

  it("redacts JWTs, Supabase keys and known secrets from logs", () => {
    const jwt = `eyJhbGciOiJIUzI1NiJ9.${"a".repeat(20)}.${"b".repeat(20)}`
    const out = scrub(`a ${jwt} b sb_secret_abcdefghijkl c hunter2hunter2`, [
      "hunter2hunter2",
    ])
    expect(out).toBe("a [redacted] b [redacted] c [redacted]")
  })
})

describe("journey prerequisites", () => {
  const project = () => {
    const root = mkdtempSync(join(tmpdir(), "nabalens-needs-"))
    const write = (path: string, body: string) => {
      mkdirSync(join(root, path, ".."), { recursive: true })
      writeFileSync(join(root, path), body)
    }
    write(
      "tests/e2e/helpers/stack.ts",
      'export function psql(sql: string) { return execFileSync("psql", [sql]) }\n' +
        "export const provisioner = () => 1\n"
    )
    write(
      "tests/e2e/helpers/world.ts",
      'import { provisioner, psql } from "./stack"\nexport const make = () => psql("x")\n'
    )
    write(
      "tests/journeys/provisions.spec.ts",
      'import { make } from "../e2e/helpers/world"\n'
    )
    write(
      "tests/journeys/reads-only.spec.ts",
      'import { provisioner } from "../e2e/helpers/stack"\n'
    )
    write(
      "tests/journeys/direct.spec.ts",
      'import { spawnSync } from "node:child_process"\nspawnSync("psql", [])\n'
    )
    return root
  }

  it("needs psql when the spec reaches a module that imports the psql helper", () => {
    const root = project()
    expect(inferNeeds(root, "tests/journeys/provisions.spec.ts")).toEqual([
      "psql",
    ])
    expect(inferNeeds(root, "tests/journeys/direct.spec.ts")).toEqual(["psql"])
    expect(inferNeeds(root, "tests/journeys/reads-only.spec.ts")).toEqual([])
    expect(inferNeeds(root, "tests/journeys/missing.spec.ts")).toEqual([])
  })

  it("derives it for the declared journeys that provision fixtures", () => {
    const { journeys, problems } = loadJourneys(process.cwd())
    expect(problems).toEqual([])
    const needs = (id: string) => journeys.find((j) => j.id === id)?.needs
    // Provisions a world through createPeople(), which runs host psql.
    expect(needs("media.partial-batch")).toContain("psql")
    expect(needs("menus.label-conflict")).toContain("psql")
    // Signs in as the loaded fixture people and runs no SQL of its own.
    expect(needs("auth.login-smoke")).toEqual([])
    // Declared explicitly or inferred, never lost.
    for (const j of journeys) {
      if (j.spec.startsWith("tests/e2e/menus-")) {
        expect(j.needs).toContain("psql")
      }
    }
  })
})

describe("journey run directories", () => {
  const rootDir = () => mkdtempSync(join(tmpdir(), "nabalens-rundir-"))

  it("refuses an existing non-empty run id or results dir and writes nothing", () => {
    const root = rootDir()
    const first = allocateRunDir({ root, runId: "r1", defaultId: "d" })
    writeFileSync(join(first.dir, "keep.json"), "{}")
    expect(() => allocateRunDir({ root, runId: "r1", defaultId: "d" })).toThrow(
      /already exists and is not empty/
    )
    expect(() =>
      allocateRunDir({ root, resultsDir: first.dir, defaultId: "d" })
    ).toThrow(/never overwritten/)
    expect(readdirSync(first.dir)).toEqual(["keep.json"])
  })

  it("accepts an existing empty directory", () => {
    const root = rootDir()
    mkdirSync(join(root, "out"))
    const { dir } = allocateRunDir({ root, resultsDir: "out", defaultId: "d" })
    expect(existsSync(dir)).toBe(true)
  })

  it("gives colliding default ids a numeric suffix", () => {
    const root = rootDir()
    const ids = [1, 2, 3].map(() => {
      const { id, dir } = allocateRunDir({ root, defaultId: "20261031T1Z-abc" })
      writeFileSync(join(dir, "summary.json"), "{}")
      return id
    })
    expect(ids).toEqual([
      "20261031T1Z-abc",
      "20261031T1Z-abc-2",
      "20261031T1Z-abc-3",
    ])
  })
})
