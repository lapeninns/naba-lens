import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { renderMetricsDoc, renderRunbookIndex } from "@/lib/ops/docs"
import { formattedOpsDocs } from "@/scripts/ops/docs-format"
import {
  OPS_BYTES_MAX,
  OPS_COUNT_MAX,
  OPS_JOB_COUNT_FIELDS,
  OPS_JOB_ERROR_CODES,
  OPS_JOB_INTERVAL_MINUTES,
  OPS_JOB_PARTIAL,
  OPS_JOBS,
  heartbeatState,
} from "@/lib/ops/heartbeats"
import {
  OpsMetricsContractError,
  S2_METRIC_COVERAGE,
  parseOpsMetrics,
  readMetric,
} from "@/lib/ops/metrics-snapshot"
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

  it("describes M-DL-8 with B07 §7.7's receipt kinds and optional fields", () => {
    const { definition } = metric("M-DL-8")
    for (const value of [
      "provider_received",
      "provider_awaiting_review",
      "provider_approved",
      "provider_sent",
      "provider_confirmed",
      "provider_rejected",
      "provider_failed",
      "provider_uncertain",
      "provider_closed",
      "providerDetail",
      "behind_in_flight",
      "source_changed_during_flight",
      "source_withdrawn_during_flight",
      "closeReason",
      "already_satisfied",
      "unsupported",
      "not_linked",
      "superseded",
      "withdrawn_at_source",
      "epoch_reset",
    ])
      expect(definition, value).toContain(value)
  })

  it("keys M-DL-8's latest receipt by publication epoch as well as revision", () => {
    const { definition } = metric("M-DL-8")
    expect(definition).toContain(
      "Latest provider receipt per publication epoch, destination, venue, field key and publication revision"
    )
    expect(definition).not.toContain("per destination, venue")
    expect(definition).toContain(
      "Publication revisions restart in each new epoch"
    )
    expect(definition).toContain("receipts from earlier epochs are historical")
  })

  it("separates M-DL-8's confirmed writes from values that already matched", () => {
    const { definition } = metric("M-DL-8")
    expect(definition).toContain(
      "provider_confirmed means NabaPresence's readback confirmed the value after an attempted provider write"
    )
    expect(definition).toContain(
      "provider_received, provider_awaiting_review, provider_approved and provider_sent are pending, awaiting-review, approved or sent work, not confirmation"
    )
    expect(definition).toContain(
      "provider_closed with closeReason already_satisfied records a fresh provider observation that already matched, so no write was required; it is not a confirmed write"
    )
    expect(definition).not.toContain("provider_sent and the earlier kinds")
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

// --- B10-m1: the ops_metrics contract (T-B10-04, T-B10-05 unit part) ---------
//
// The SQL itself runs only on the coordinator's isolated stack
// (tests/security/ops-metrics.test.ts). Here the migration text is checked
// against the TypeScript vocabulary, and the reading adapter against
// synthetic snapshots shaped like the function's output.

const MIGRATION = "supabase/migrations/20261110220000_b10m1_ops_metrics.sql"
const migration = () => readFileSync(join(root, MIGRATION), "utf8")
const sqlCode = () =>
  migration()
    .replace(/\bcomment\s+on\b[\s\S]*?;/gi, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
const functionBody = (name: string) => {
  const sql = sqlCode()
  const start = sql.indexOf(`create function ${name}(`)
  if (start < 0) throw new Error(`no ${name}`)
  const open = sql.indexOf("$$", start)
  return sql.slice(open + 2, sql.indexOf("$$", open + 2))
}
const sqlArray = (body: string, arm: string) => {
  const match = new RegExp(`when '${arm}' then\\s*array\\[([^\\]]*)\\]`).exec(
    body
  )
  if (!match) throw new Error(`no arm ${arm}`)
  return [...match[1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1])
}

describe("B10-m1 migration matches the receipt vocabulary", () => {
  it("is the only B10 migration and the newest one", () => {
    const files = readdirSync(join(root, "supabase/migrations")).sort()
    expect(files.filter((f) => /b10|ops_/.test(f))).toEqual([
      "20261110220000_b10m1_ops_metrics.sql",
    ])
    expect(files.at(-1)).toBe("20261110220000_b10m1_ops_metrics.sql")
  })

  it("declares the same jobs, intervals, codes and count fields as lib/ops/heartbeats", () => {
    const jobs = [
      ...functionBody("private.ops_jobs").matchAll(
        /\((\d+), '([a-z_]+)', (\d+)\)/g
      ),
    ].map((m) => [Number(m[1]), m[2], Number(m[3])])
    expect(jobs).toEqual(
      OPS_JOBS.map((job, i) => [i + 1, job, OPS_JOB_INTERVAL_MINUTES[job]])
    )
    const codes = functionBody("private.ops_job_error_codes")
    const fields = functionBody("private.ops_job_count_fields")
    for (const job of OPS_JOBS) {
      expect(sqlArray(codes, job)).toEqual([...OPS_JOB_ERROR_CODES[job]])
      expect(sqlArray(fields, job)).toEqual([...OPS_JOB_COUNT_FIELDS[job]])
    }
    expect(sqlCode()).toContain(
      `job text not null check (job in (${OPS_JOBS.map((j) => `'${j}'`).join(", ")}))`
    )
    const counts = functionBody("private.ops_job_counts_valid")
    expect(counts).toContain(`then ${OPS_BYTES_MAX} else ${OPS_COUNT_MAX} end`)
    // Only monthly preparation may be partial, in SQL as in TypeScript.
    expect(functionBody("private.ops_job_outcome_valid")).toContain(
      "p_job = 'monthly_preparation'"
    )
    expect(OPS_JOBS.filter((job) => OPS_JOB_PARTIAL[job])).toEqual([
      "monthly_preparation",
    ])
  })

  it("keeps the table private, append-only and closed to every API role", () => {
    const sql = sqlCode()
    expect(sql).toMatch(/create table private\.ops_job_runs \(/)
    expect(sql).not.toMatch(/create table public\./)
    expect(sql).toContain(
      "constraint ops_job_runs_finished_after_start check (finished_at >= started_at)"
    )
    expect(sql).toMatch(
      /before update or delete on private\.ops_job_runs\s+for each row execute function private\.append_only_guard\(\)/
    )
    expect(sql).toMatch(
      /before truncate on private\.ops_job_runs\s+for each statement execute function private\.append_only_guard\(\)/
    )
    expect(sql).toContain(
      "revoke all on table private.ops_job_runs from public, anon, authenticated, service_role;"
    )
    expect(sql).not.toMatch(/grant[^;]*on table/i)
    expect(sql).not.toMatch(/\b(to|from)\s+[^;]*\bpostgres\b/)
    expect(sql).not.toMatch(
      /alter (default privileges|publication|role)|create policy|grant usage/i
    )
    expect(sql).not.toMatch(/insert into (public|private)\.(?!ops_job_runs)/)
    expect(sql).not.toMatch(
      /\b(update|delete from|truncate)\s+(public|private|storage)\./
    )
  })

  it("grants only the writer wrapper and the reading, only to service_role, after revoking", () => {
    const sql = sqlCode()
    const grants = [...sql.matchAll(/grant ([^;]*);/g)].map((m) =>
      m[1].replace(/\s+/g, " ").trim()
    )
    expect(grants).toEqual([
      "execute on function public.ops_record_job_run(uuid, text, timestamptz, timestamptz, text, jsonb, text) to service_role",
      "execute on function private.ops_metrics(timestamptz, uuid) to service_role",
    ])
    const created = [...sql.matchAll(/create function ([a-z_.]+)\(/g)].map(
      (m) => m[1]
    )
    expect(created.filter((f) => f.startsWith("public."))).toEqual([
      "public.ops_record_job_run",
    ])
    const revokes = [...sql.matchAll(/revoke all on function([^;]*);/g)]
      .map((m) => m[1].replace(/\s+/g, " "))
      .join(" ")
    for (const fn of created) {
      expect(revokes, fn).toContain(`${fn}(`)
    }
    for (const statement of sql.match(/revoke all on function[^;]*;/g) ?? [])
      expect(statement).toMatch(
        /from public, anon, authenticated, service_role;$/
      )
    // Revokes come before the grant they guard.
    expect(sql.lastIndexOf("revoke all on function")).toBeLessThan(
      sql.indexOf("grant execute")
    )
  })

  it("fixes an empty search path on every function and qualifies every table", () => {
    const sql = sqlCode()
    const headers = sql.split(/create function /).slice(1)
    expect(headers).toHaveLength(10)
    for (const header of headers) {
      const head = header.slice(0, header.indexOf("$$"))
      expect(head, head.slice(0, 40)).toContain("set search_path = ''")
    }
    const definers = headers
      .filter((h) => h.slice(0, h.indexOf("$$")).includes("security definer"))
      .map((h) => h.slice(0, h.indexOf("(")))
    expect(definers).toEqual([
      "public.ops_record_job_run",
      "private.ops_metrics",
    ])
    const bodies = sql
      .split("$$")
      .filter((_, i) => i % 2 === 1)
      .join("\n")
    for (const ref of bodies.matchAll(
      /(?<!distinct )\b(?:from|join)\s+([a-z_]+(?:\.[a-z_]+)?)/g
    )) {
      const name = ref[1]
      if (["lateral", "jsonb_each", "private.ops_jobs"].includes(name)) continue
      expect(name, `unqualified ${name}`).toMatch(/^(public|private|storage)\./)
    }
  })

  it("reads no free text, names, paths, messages or payloads in ops_metrics", () => {
    const body = functionBody("private.ops_metrics")
    const forbidden =
      /\b[a-z]\.(name|email|original_filename|original_path|preview_path|thumbnail_path|message|error_message|last_error|input|detail|notes|reason|decision_reason|code|blob_key|manifest)\b/g
    const hits = [...body.matchAll(forbidden)]
      .map((m) => m[0])
      // The tombstone check matches object names but never returns them.
      .filter((hit) => hit !== "o.name")
    expect(hits).toEqual([])
    expect(body.match(/\bo\.name\b/g)).toHaveLength(1)
    expect(body).toMatch(
      /and o\.name like a\.uploader_id::text \|\| '\/' \|\| a\.id::text \|\| '\/%'/
    )
    expect(body).not.toMatch(
      /to_jsonb|row_to_json|jsonb_agg\(\s*[a-z]\s*\)|\.\*/
    )
    expect(body).not.toMatch(
      /\bnow\(\)|current_timestamp|clock_timestamp|current_london_month/
    )
    expect(body).not.toMatch(/(public|private)\.knowledge_/)
  })

  it("gives every catalogue metric exactly one entry with the reason the adapter expects", () => {
    const body = functionBody("private.ops_metrics")
    const computedIds = [
      ...body.matchAll(/jsonb_build_object\('(M-[A-Z]{2}-\d)'/g),
    ].map((m) => m[1])
    const listed = Object.fromEntries(
      [...body.matchAll(/\('(M-[A-Z]{2}-\d)', '([a-z_]+)'\)/g)].map((m) => [
        m[1],
        m[2],
      ])
    )
    const all = [...computedIds, ...Object.keys(listed)].sort()
    expect(all).toEqual(METRICS.map((m) => m.id).sort())
    expect(new Set(all).size).toBe(44)
    for (const m of METRICS) {
      const expected = S2_METRIC_COVERAGE[m.id]
      if (expected.kind === "available" || expected.kind === "partial")
        expect(computedIds, m.id).toContain(m.id)
      else if (m.id === "M-UP-4") expect(computedIds).toContain("M-UP-4")
      else
        expect(listed[m.id], m.id).toBe("reason" in expected && expected.reason)
    }
    expect(body).toContain(
      "'availability', 'not_available', 'reason', 'missing_history'"
    )
    expect(body).toContain(
      "'missing', jsonb_build_array('failed_transition_history', 'finalisation_history')"
    )
  })
})

describe("S2 coverage of the catalogue", () => {
  it("has an entry for each of the 44 metrics and nothing else", () => {
    expect(Object.keys(S2_METRIC_COVERAGE).sort()).toEqual(
      METRICS.map((m) => m.id).sort()
    )
  })

  it("computes only main and B10 sources and keeps M-UP-4 unavailable", () => {
    const kinds = (kind: string) =>
      Object.entries(S2_METRIC_COVERAGE)
        .filter(([, c]) => c.kind === kind)
        .map(([id]) => id)
    expect(kinds("available")).toEqual([
      "M-JB-1",
      "M-JB-2",
      "M-JB-3",
      "M-UP-1",
      "M-UP-2",
      "M-UP-3",
      "M-UP-5",
      "M-UP-6",
      "M-RV-3",
    ])
    expect(kinds("partial")).toEqual(["M-WD-4"])
    expect(kinds("not_measured")).toEqual(["M-UP-7", "M-DL-6"])
    for (const id of [...kinds("available"), ...kinds("partial")])
      expect(["main", "B10", "B01"]).toContain(metric(id).availableFrom)
    for (const id of kinds("not_measured"))
      expect(metric(id).availableFrom).toBe("log_source")
    expect(S2_METRIC_COVERAGE["M-UP-4"]).toEqual({
      kind: "not_available",
      reason: "missing_history",
    })
    // Catalogue says main for M-UP-4; the exact history is still missing.
    expect(metric("M-UP-4").availableFrom).toBe("main")
    for (const [id, coverage] of Object.entries(S2_METRIC_COVERAGE))
      if (
        coverage.kind === "not_available" &&
        coverage.reason === "source_unreleased"
      )
        expect(["main", "B01", "B10", "log_source"], id).not.toContain(
          metric(id).availableFrom
        )
  })
})

const AS_OF = "2026-11-10T12:00:00.000000Z"
const VENUE_A = "a0000000-0000-4000-8000-00000000000a"
const VENUE_B = "b0000000-0000-4000-8000-00000000000b"

/** A snapshot shaped exactly like private.ops_metrics output. */
function snapshotFixture(): Record<string, unknown> {
  const unavailable = Object.fromEntries(
    Object.entries(S2_METRIC_COVERAGE)
      .filter(
        ([, c]) => c.kind === "not_available" || c.kind === "not_measured"
      )
      .map(([id, c]) => [
        id,
        c.kind === "not_available" || c.kind === "not_measured"
          ? { availability: c.kind, reason: c.reason }
          : null,
      ])
  )
  return {
    contract: "b10.ops_metrics.v1",
    asOf: AS_OF,
    venueId: null,
    metrics: {
      ...unavailable,
      "M-JB-1": {
        availability: "available",
        scope: "global",
        jobs: [
          {
            job: "cleanup",
            intervalMinutes: 60,
            lastOkAt: "2026-11-10T11:17:04.123456Z",
            secondsSinceOk: 2575,
            state: "ok",
          },
          {
            job: "media_archive",
            intervalMinutes: 10,
            lastOkAt: "2026-11-10T11:30:00.000000Z",
            secondsSinceOk: 1800,
            state: "breach",
          },
          {
            job: "archive_watchdog",
            intervalMinutes: 5,
            lastOkAt: null,
            secondsSinceOk: null,
            state: "no_evidence",
          },
          {
            job: "monthly_preparation",
            intervalMinutes: 60,
            lastOkAt: "2026-11-10T11:07:01.000000Z",
            secondsSinceOk: 3179,
            state: "ok",
          },
        ],
      },
      "M-JB-2": {
        availability: "available",
        scope: "global",
        jobs: [
          {
            job: "cleanup",
            failed24h: 0,
            partial24h: 0,
            consecutiveFailures: 0,
            lastOutcome: "ok",
            lastErrorCode: null,
            lastFinishedAt: "2026-11-10T11:17:04.123456Z",
          },
          {
            job: "media_archive",
            failed24h: 3,
            partial24h: 0,
            consecutiveFailures: 3,
            lastOutcome: "failed",
            lastErrorCode: "archive_audit_timeout",
            lastFinishedAt: "2026-11-10T11:50:00.000000Z",
          },
          {
            job: "archive_watchdog",
            failed24h: 0,
            partial24h: 0,
            consecutiveFailures: 0,
            lastOutcome: null,
            lastErrorCode: null,
            lastFinishedAt: null,
          },
          {
            job: "monthly_preparation",
            failed24h: 0,
            partial24h: 1,
            consecutiveFailures: 0,
            lastOutcome: "ok",
            lastErrorCode: null,
            lastFinishedAt: "2026-11-10T11:07:01.000000Z",
          },
        ],
      },
      "M-JB-3": {
        availability: "available",
        scope: "venue",
        period: "2026-11-01",
        successDueAt: "2026-11-03T00:00:00.000000Z",
        lastSuccessAt: "2026-11-01T00:07:02.000000Z",
        venuesMissingTargets: 1,
        venues: [{ venueId: VENUE_B, staffWithoutTarget: 2 }],
      },
      "M-UP-1": {
        availability: "available",
        scope: "venue",
        totals: { uploading: 1, processing: 1, ready: 5, failed: 2 },
        venues: [
          {
            venueId: VENUE_A,
            uploading: 1,
            processing: 1,
            ready: 3,
            failed: 2,
          },
          {
            venueId: VENUE_B,
            uploading: 0,
            processing: 0,
            ready: 2,
            failed: 0,
          },
        ],
      },
      "M-UP-2": {
        availability: "available",
        scope: "venue",
        total: 1,
        venues: [{ venueId: VENUE_A, count: 1, oldestAgeSeconds: 2400 }],
      },
      "M-UP-3": {
        availability: "available",
        scope: "venue",
        total: 0,
        venues: [],
      },
      "M-UP-4": {
        availability: "not_available",
        reason: "missing_history",
        missing: ["failed_transition_history", "finalisation_history"],
      },
      "M-UP-5": {
        availability: "available",
        scope: "venue",
        totals: { count: 1, olderThan24h: 1 },
        venues: [
          {
            venueId: VENUE_B,
            count: 1,
            olderThan24h: 1,
            oldestAgeSeconds: 90000,
          },
        ],
      },
      "M-UP-6": {
        availability: "available",
        scope: "venue",
        totals: {
          needsAttention: 1,
          needsAttentionOlderThan7d: 1,
          stalePending: 1,
        },
        venues: [
          {
            venueId: VENUE_A,
            needsAttention: 1,
            needsAttentionOlderThan7d: 1,
            oldestNeedsAttentionAgeSeconds: 691200,
            stalePending: 1,
            oldestStalePendingAgeSeconds: 3600,
          },
        ],
      },
      "M-RV-3": {
        availability: "available",
        scope: "venue",
        total: 2,
        venues: [
          { venueId: VENUE_A, count: 1, oldestAgeSeconds: 86400 },
          { venueId: VENUE_B, count: 1, oldestAgeSeconds: 777600 },
        ],
      },
      "M-WD-4": {
        availability: "partial",
        scope: "venue",
        parts: {
          amenity_evidence_lost: {
            availability: "available",
            totals: { events: 2, checks: 1 },
            venues: [{ venueId: VENUE_A, events: 2, checks: 1 }],
          },
          knowledge_evidence_withdrawn: {
            availability: "not_available",
            reason: "not_in_slice",
          },
        },
      },
    },
  }
}

const SENSITIVE_UPSTREAM = [
  "Jamie Example",
  "jamie@example.com",
  "note: the cellar door code",
  "wifi-ssid NabaGuest / password hunter2",
  "user-1/asset-1/original.jpg",
  "https://fixture.supabase.co/storage/v1/object/sign/media/x?token=eyJfake",
  "permission denied for table media_assets: secret detail",
]

type Tree = Record<string, unknown>
const at = (tree: Tree, path: string[]): Tree =>
  path.reduce<Tree>((node, key) => node[key] as Tree, tree)

describe("T-B10-04/05 ops_metrics reading adapter", () => {
  it("accepts the exact contract and keeps its values and venue split", () => {
    const snapshot = parseOpsMetrics(snapshotFixture())
    expect(Object.keys(snapshot).sort()).toEqual([
      "asOf",
      "contract",
      "metrics",
      "venueId",
    ])
    expect(Object.keys(snapshot.metrics).sort()).toEqual(
      METRICS.map((m) => m.id).sort()
    )
    const upload = readMetric(snapshot, "M-UP-1")
    expect(upload).toMatchObject({ kind: "value", partial: false })
    expect(upload.kind === "value" && upload.entry).toEqual(
      snapshotFixture().metrics &&
        (at(snapshotFixture(), ["metrics"]) as Tree)["M-UP-1"]
    )
    // Two venues stay apart; neither total hides the other.
    const review = readMetric(snapshot, "M-RV-3")
    expect(review.kind === "value" && review.entry.venues).toEqual([
      { venueId: VENUE_A, count: 1, oldestAgeSeconds: 86400 },
      { venueId: VENUE_B, count: 1, oldestAgeSeconds: 777600 },
    ])
    // A supported, empty source is a real zero.
    expect(readMetric(snapshot, "M-UP-3")).toEqual({
      kind: "value",
      partial: false,
      entry: {
        availability: "available",
        scope: "venue",
        total: 0,
        venues: [],
      },
    })
  })

  it("reads missing sources as not available and log-only metrics as not measured, never 0", () => {
    const snapshot = parseOpsMetrics(snapshotFixture())
    expect(readMetric(snapshot, "M-UP-4")).toEqual({
      kind: "not_available",
      reason: "missing_history",
      missing: ["failed_transition_history", "finalisation_history"],
    })
    expect(readMetric(snapshot, "M-UP-7")).toEqual({
      kind: "not_measured",
      reason: "log_source_missing",
    })
    expect(readMetric(snapshot, "M-DL-6")).toEqual({
      kind: "not_measured",
      reason: "log_source_missing",
    })
    expect(readMetric(snapshot, "M-JB-4")).toEqual({
      kind: "not_available",
      reason: "external_checker",
    })
    expect(readMetric(snapshot, "M-AD-3")).toEqual({
      kind: "not_available",
      reason: "external_record",
    })
    expect(readMetric(snapshot, "M-KN-1")).toEqual({
      kind: "not_available",
      reason: "source_unreleased",
    })
    expect(readMetric(snapshot, "M-RV-1")).toEqual({
      kind: "not_available",
      reason: "not_in_slice",
    })
    for (const m of METRICS) {
      const reading = readMetric(snapshot, m.id)
      if (reading.kind !== "value")
        expect(JSON.stringify(reading)).not.toMatch(/\d/)
    }
    // M-WD-4 is partial: the amenity part has a value, the knowledge part none.
    const lost = readMetric(snapshot, "M-WD-4")
    expect(lost).toMatchObject({ kind: "value", partial: true })
    expect(lost.kind === "value" && lost.entry.parts).toMatchObject({
      knowledge_evidence_withdrawn: {
        availability: "not_available",
        reason: "not_in_slice",
      },
    })
  })

  it("keeps global job health apart from venue readings and checks the heartbeat clock", () => {
    const snapshot = parseOpsMetrics(snapshotFixture())
    expect(snapshot.metrics["M-JB-1"].scope).toBe("global")
    expect(snapshot.metrics["M-JB-1"].jobs.map((j) => j.state)).toEqual([
      "ok",
      "breach",
      "no_evidence",
      "ok",
    ])
    const now = new Date(snapshot.asOf)
    for (const entry of snapshot.metrics["M-JB-1"].jobs)
      expect(heartbeatState(entry.job, entry.lastOkAt, now).state).toBe(
        entry.state
      )
  })

  const breach = (mutate: (tree: Tree) => void) => {
    const tree = snapshotFixture()
    mutate(tree)
    return () => parseOpsMetrics(tree)
  }
  const metricsOf = (tree: Tree) => tree.metrics as Tree

  it.each<[string, (tree: Tree) => void]>([
    ["an extra top-level key", (t) => (t.detail = SENSITIVE_UPSTREAM[6])],
    ["another contract", (t) => (t.contract = "b10.ops_metrics.v2")],
    ["a local-time as-of", (t) => (t.asOf = "2026-11-10T12:00:00+00:00")],
    ["a venue name for the venue", (t) => (t.venueId = SENSITIVE_UPSTREAM[0])],
    ["a missing metric", (t) => delete metricsOf(t)["M-AI-4"]],
    [
      "an unknown metric",
      (t) => (metricsOf(t)["M-XX-1"] = { availability: "available" }),
    ],
    [
      "a zero for an unavailable metric",
      (t) => ((metricsOf(t)["M-JB-5"] as Tree).value = 0),
    ],
    [
      "an available claim for M-UP-4",
      (t) =>
        (metricsOf(t)["M-UP-4"] = {
          availability: "available",
          scope: "venue",
          total: 0,
          venues: [],
        }),
    ],
    [
      "M-UP-4 without its missing history",
      (t) => ((metricsOf(t)["M-UP-4"] as Tree).missing = []),
    ],
    [
      "a measured log-only metric",
      (t) =>
        (metricsOf(t)["M-UP-7"] = {
          availability: "available",
          scope: "venue",
        }),
    ],
    [
      "an unknown reason",
      (t) => ((metricsOf(t)["M-KN-1"] as Tree).reason = "coming_soon"),
    ],
    [
      "a note on a venue row",
      (t) =>
        ((at(t, ["metrics", "M-RV-3", "venues"]) as unknown as Tree[])[0].note =
          SENSITIVE_UPSTREAM[2]),
    ],
    [
      "a path in a venue ID",
      (t) =>
        ((
          at(t, ["metrics", "M-UP-5", "venues"]) as unknown as Tree[]
        )[0].venueId = SENSITIVE_UPSTREAM[4]),
    ],
    [
      "a signed URL in a count",
      (t) => (at(t, ["metrics", "M-UP-2"]).total = SENSITIVE_UPSTREAM[5]),
    ],
    ["a string count", (t) => (at(t, ["metrics", "M-UP-2"]).total = "1")],
    ["a negative count", (t) => (at(t, ["metrics", "M-UP-2"]).total = -1)],
    ["a fractional count", (t) => (at(t, ["metrics", "M-UP-2"]).total = 0.5)],
    [
      "a nested object for a count",
      (t) => (at(t, ["metrics", "M-UP-2"]).total = { n: 1 }),
    ],
    [
      "a Wi-Fi value on a part",
      (t) =>
        (at(t, ["metrics", "M-WD-4", "parts", "amenity_evidence_lost"]).wifi =
          SENSITIVE_UPSTREAM[3]),
    ],
    [
      "an email as an error code",
      (t) =>
        ((
          at(t, ["metrics", "M-JB-2", "jobs"]) as unknown as Tree[]
        )[1].lastErrorCode = SENSITIVE_UPSTREAM[1]),
    ],
    [
      "a raw SQLSTATE as an error code",
      (t) =>
        ((
          at(t, ["metrics", "M-JB-2", "jobs"]) as unknown as Tree[]
        )[1].lastErrorCode = "23505"),
    ],
    [
      "an unknown job",
      (t) =>
        ((at(t, ["metrics", "M-JB-1", "jobs"]) as unknown as Tree[])[0].job =
          "media_use_sweep"),
    ],
    [
      "jobs out of order",
      (t) =>
        (at(t, ["metrics", "M-JB-1", "jobs"]) as unknown as Tree[]).reverse(),
    ],
    [
      "a missing job",
      (t) => (at(t, ["metrics", "M-JB-2", "jobs"]) as unknown as Tree[]).pop(),
    ],
    [
      "a changed schedule interval",
      (t) =>
        ((
          at(t, ["metrics", "M-JB-1", "jobs"]) as unknown as Tree[]
        )[2].intervalMinutes = 60),
    ],
    [
      "a healthy state the clock does not give",
      (t) =>
        ((at(t, ["metrics", "M-JB-1", "jobs"]) as unknown as Tree[])[1].state =
          "ok"),
    ],
    [
      "health claimed from an empty ledger",
      (t) =>
        ((at(t, ["metrics", "M-JB-1", "jobs"]) as unknown as Tree[])[2].state =
          "ok"),
    ],
    [
      "an age without a last ok time",
      (t) =>
        ((
          at(t, ["metrics", "M-JB-1", "jobs"]) as unknown as Tree[]
        )[2].secondsSinceOk = 0),
    ],
    [
      "a global scope on a venue metric",
      (t) => (at(t, ["metrics", "M-UP-1"]).scope = "global"),
    ],
    ["a list as the metrics", (t) => (t.metrics = [])],
  ])("rejects %s as a contract breach naming no value", (_label, mutate) => {
    const parse = breach(mutate)
    expect(parse).toThrow(OpsMetricsContractError)
    try {
      parse()
    } catch (error) {
      expect((error as Error).message).toBe("ops_metrics_contract_breach")
      for (const value of SENSITIVE_UPSTREAM)
        expect(String(error)).not.toContain(value)
    }
  })

  it("contains no sensitive upstream value in an accepted snapshot", () => {
    const text = JSON.stringify(parseOpsMetrics(snapshotFixture()))
    for (const value of SENSITIVE_UPSTREAM) expect(text).not.toContain(value)
    expect(text).not.toMatch(/@|https?:|\/original\.|wifi|password/i)
  })
})
