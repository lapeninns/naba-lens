import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// T-B10-07 (unit part): every job implementation, the database client and the
// email sender are mocked, so nothing here has a side effect. The job receipt
// writer itself is real; only its RPC is a spy. The SQL and route-backed
// receipt proof run later on the coordinator's isolated stack.
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  admin: vi.fn(),
  cleanup: vi.fn(),
  audit: vi.fn(),
  config: vi.fn(),
  watchdog: vi.fn(),
  store: vi.fn(() => ({})),
  sender: vi.fn(() => async () => {}),
  prepare: vi.fn(),
}))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }))
vi.mock("@/lib/server/lifecycle", () => ({ runCleanup: mocks.cleanup }))
vi.mock("@/lib/server/archive/audit", () => ({ runArchiveAudit: mocks.audit }))
vi.mock("@/lib/server/archive/config", () => ({
  readArchiveConfig: mocks.config,
}))
vi.mock("@/lib/server/archive-monitor", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runArchiveWatchdog: mocks.watchdog,
  createWatchdogStore: mocks.store,
  createWatchdogEmailSender: mocks.sender,
}))
vi.mock("@/lib/server/coverage/preparation", () => ({
  runScheduledPreparation: mocks.prepare,
}))

import {
  GET as cleanupGet,
  POST as cleanupPost,
} from "@/app/api/internal/cleanup/route"
import { GET as archiveGet } from "@/app/api/internal/media-archive/route"
import { GET as watchdogGet } from "@/app/api/internal/archive-monitor/watchdog/route"
import {
  GET as prepareGet,
  POST as preparePost,
} from "@/app/api/internal/coverage/monthly-preparation/route"
import { RECEIPT_FAILURE_CODE, startJobRun } from "@/lib/ops/heartbeat-writer"
import {
  HEARTBEAT_BREACH_INTERVALS,
  OPS_JOB_COUNT_FIELDS,
  OPS_JOB_ERROR_CODES,
  OPS_JOB_INTERVAL_MINUTES,
  OPS_JOBS,
  archiveAuditResult,
  cleanupResult,
  heartbeatState,
  jobRunArgs,
  monthlyPreparationResult,
  watchdogResult,
} from "@/lib/ops/heartbeats"
import type { ArchiveAuditReport } from "@/lib/server/archive/audit"
import type { CleanupReport } from "@/lib/server/lifecycle/cleanup"

const SECRET = "c".repeat(40)
const RUN_ID = "0b8f6a52-6f2e-4c1e-9a77-4f1f3c8f2d10"
const START = "2026-11-10T12:00:00.000Z"
const END = "2026-11-10T12:00:05.000Z"
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/** Upstream values that must never reach a receipt, a response or a log. */
const SENSITIVE = [
  "Jamie Example",
  "jamie@example.com",
  "note: the cellar door code",
  "wifi-ssid NabaGuest / password hunter2",
  "user-1/asset-1/original.jpg",
  "https://fixture.supabase.co/storage/v1/object/sign/media/x?token=eyJfake",
  "permission denied for table media_assets: secret detail",
]

function rpcReturns(data: unknown, error: unknown = null) {
  mocks.rpc.mockImplementation(() => ({
    abortSignal: vi.fn().mockResolvedValue({ data, error }),
  }))
}

/** The receipt arguments of every RPC call made so far. */
const receipts = () =>
  mocks.rpc.mock.calls.map(([fn, args]) => {
    expect(fn).toBe("ops_record_job_run")
    return args as Record<string, unknown>
  })

function expectOneReceipt(expected: {
  job: string
  outcome: string
  errorCode: string | null
  counts: Record<string, number>
}) {
  const sent = receipts()
  expect(sent).toHaveLength(1)
  const [args] = sent
  expect(Object.keys(args).sort()).toEqual([
    "p_counts",
    "p_error_code",
    "p_finished_at",
    "p_job",
    "p_outcome",
    "p_run_id",
    "p_started_at",
  ])
  expect(args.p_run_id).toMatch(UUID_V4)
  expect(args.p_started_at).toMatch(ISO)
  expect(args.p_finished_at).toMatch(ISO)
  expect(
    Date.parse(args.p_finished_at as string) >=
      Date.parse(args.p_started_at as string)
  ).toBe(true)
  expect(args).toMatchObject({
    p_job: expected.job,
    p_outcome: expected.outcome,
    p_error_code: expected.errorCode,
  })
  expect(args.p_counts).toEqual(expected.counts)
}

function cron(path: string, token?: string, method = "GET") {
  return new Request(`https://fixture.example${path}`, {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
}

const NO_STORE = { "cache-control": "no-store" }
const PRIVATE_NO_STORE = { "cache-control": "private, no-store" }

async function expectResponse(
  response: Response,
  status: number,
  body: unknown,
  headers: Record<string, string>
) {
  expect(response.status).toBe(status)
  for (const [name, value] of Object.entries(headers))
    expect(response.headers.get(name)).toBe(value)
  expect(response.headers.get("set-cookie")).toBeNull()
  expect(await response.json()).toEqual(body)
}

let errors: ReturnType<typeof vi.spyOn>
let infos: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.stubEnv("CLEANUP_SECRET", SECRET)
  vi.stubEnv("CRON_SECRET", SECRET)
  vi.stubEnv("VERCEL_ENV", "production")
  mocks.admin.mockImplementation(() => ({ rpc: mocks.rpc }))
  mocks.config.mockReturnValue({})
  rpcReturns("recorded")
  errors = vi.spyOn(console, "error").mockImplementation(() => {})
  infos = vi.spyOn(console, "info").mockImplementation(() => {})
})
afterEach(() => {
  // Nothing sensitive in any log line, from the job or from the writer.
  const logged = JSON.stringify([
    ...errors.mock.calls.map((call: unknown[]) => call.map(String)),
    ...infos.mock.calls,
  ])
  for (const value of SENSITIVE) expect(logged).not.toContain(value)
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.store.mockImplementation(() => ({}))
  mocks.sender.mockImplementation(() => async () => {})
})

const completed = (
  overrides: Partial<Extract<CleanupReport, { status: "completed" }>> = {}
): CleanupReport => ({
  status: "completed",
  reaped: { assetIds: ["a1", "a2"], reason: "stale_processing" },
  removed: {
    assets: 3,
    objects: 7,
    byState: { uploading: 1, processing: 0, ready: 2, failed: 0 },
  },
  failed: [],
  more: false,
  ...overrides,
})

const archiveReport = (
  outcome: ArchiveAuditReport["outcome"],
  overrides: Partial<ArchiveAuditReport> = {}
): ArchiveAuditReport => ({
  outcome,
  complete: outcome === "completed_cycle",
  checked: 50,
  copied: 2,
  missing: 0,
  bytesVerified: 123_456,
  error: null,
  cursorFrom: 10,
  cursorTo: 60,
  ...overrides,
})

const PREP_RUN = {
  id: "7d5e1b8e-3a43-4a8f-8d1c-111111111111",
  period: "2026-11",
  venueId: null,
  trigger: "scheduled",
  startedAt: "2026-11-02T07:00:00Z",
  finishedAt: "2026-11-02T07:00:01Z",
  status: "succeeded",
  staffConsidered: 5,
  targetsCopied: 2,
  placeholdersCreated: 3,
  alreadyPresent: 1,
  candidatesAdded: 12,
  errorCode: null as string | null,
}
const prepView = (run: typeof PREP_RUN) => ({
  period: run.period,
  status: run.status,
  staffConsidered: run.staffConsidered,
  targetsCopied: run.targetsCopied,
  placeholdersCreated: run.placeholdersCreated,
  alreadyPresent: run.alreadyPresent,
  candidatesAdded: run.candidatesAdded,
  errorCode: run.errorCode,
})

// --- Vocabulary ----------------------------------------------------------------

describe("closed job receipt vocabulary", () => {
  it("names exactly the four scheduled jobs with their vercel.json intervals", () => {
    expect(OPS_JOBS).toEqual([
      "cleanup",
      "media_archive",
      "archive_watchdog",
      "monthly_preparation",
    ])
    expect(OPS_JOB_INTERVAL_MINUTES).toEqual({
      cleanup: 60,
      media_archive: 10,
      archive_watchdog: 5,
      monthly_preparation: 60,
    })
    expect(OPS_JOB_ERROR_CODES).toEqual({
      cleanup: ["cleanup_failed"],
      media_archive: [
        "archive_audit_failed",
        "archive_audit_timeout",
        "archive_lease_lost",
      ],
      archive_watchdog: ["watchdog_unavailable", "watchdog_failed"],
      monthly_preparation: ["preparation_failed"],
    })
    expect(OPS_JOB_COUNT_FIELDS).toEqual({
      cleanup: [
        "reaped_assets",
        "removed_assets",
        "removed_objects",
        "failed_assets",
      ],
      media_archive: ["checked", "copied", "missing", "bytes_verified"],
      archive_watchdog: ["delivered"],
      monthly_preparation: [
        "succeeded_runs",
        "failed_runs",
        "staff_considered",
        "targets_copied",
        "placeholders_created",
        "already_present",
        "candidates_added",
      ],
    })
  })

  const base = {
    runId: RUN_ID,
    job: "cleanup",
    startedAt: START,
    finishedAt: END,
  }

  it("builds exactly the writer arguments for a valid receipt", () => {
    expect(
      jobRunArgs({
        ...base,
        result: { outcome: "ok", counts: { removed_assets: 3 } },
      })
    ).toEqual({
      p_run_id: RUN_ID,
      p_job: "cleanup",
      p_started_at: START,
      p_finished_at: END,
      p_outcome: "ok",
      p_counts: { removed_assets: 3 },
      p_error_code: null,
    })
    expect(
      jobRunArgs({
        ...base,
        job: "monthly_preparation",
        result: {
          outcome: "partial",
          errorCode: "preparation_failed",
          counts: { succeeded_runs: 2, failed_runs: 1 },
        },
      })
    ).toMatchObject({
      p_outcome: "partial",
      p_error_code: "preparation_failed",
    })
    expect(
      jobRunArgs({
        ...base,
        job: "media_archive",
        result: {
          outcome: "ok",
          counts: { bytes_verified: Number.MAX_SAFE_INTEGER },
        },
      })
    ).not.toBeNull()
    expect(
      jobRunArgs({ ...base, finishedAt: START, result: { outcome: "ok" } })
    ).toMatchObject({ p_counts: {} })
  })

  it.each([
    ["an unknown job", { job: "media_use_sweep" }],
    ["a malformed run ID", { runId: "not-a-uuid" }],
    ["a reversed time", { startedAt: END, finishedAt: START }],
    ["a non-UTC time", { startedAt: "2026-11-10T12:00:00+01:00" }],
    ["an impossible time", { finishedAt: "2026-02-30T12:00:00.000Z" }],
    ["an unknown outcome", { result: { outcome: "skipped" } }],
    [
      "an ok run with a code",
      { result: { outcome: "ok", errorCode: "cleanup_failed" } },
    ],
    ["a failure without a code", { result: { outcome: "failed" } }],
    ["a raw SQLSTATE", { result: { outcome: "failed", errorCode: "23505" } }],
    [
      "another job's code",
      { result: { outcome: "failed", errorCode: "watchdog_failed" } },
    ],
    [
      "sensitive error text",
      { result: { outcome: "failed", errorCode: SENSITIVE[6] } },
    ],
    [
      "partial for a job that cannot be partial",
      { result: { outcome: "partial", errorCode: "cleanup_failed" } },
    ],
    [
      "an untrusted extra key",
      { result: { outcome: "ok", detail: SENSITIVE[2] } },
    ],
    [
      "an unknown count key",
      { result: { outcome: "ok", counts: { email: 1 } } },
    ],
    [
      "another job's count key",
      { result: { outcome: "ok", counts: { delivered: 1 } } },
    ],
    [
      "a nested count",
      { result: { outcome: "ok", counts: { removed_assets: { n: 1 } } } },
    ],
    [
      "a string count",
      { result: { outcome: "ok", counts: { removed_assets: "3" } } },
    ],
    [
      "a negative count",
      { result: { outcome: "ok", counts: { removed_assets: -1 } } },
    ],
    [
      "a fractional count",
      { result: { outcome: "ok", counts: { removed_assets: 1.5 } } },
    ],
    [
      "an out-of-range count",
      { result: { outcome: "ok", counts: { removed_assets: 2 ** 31 } } },
    ],
    [
      "a non-finite count",
      { result: { outcome: "ok", counts: { removed_assets: Infinity } } },
    ],
    ["counts as a list", { result: { outcome: "ok", counts: [1] } }],
    ["a missing result", { result: null }],
  ])("refuses %s", (_label, change) => {
    expect(
      jobRunArgs({
        ...base,
        result: { outcome: "ok" },
        ...(change as Record<string, unknown>),
      })
    ).toBeNull()
  })
})

describe("what each route's result records", () => {
  it("cleanup: a lease skip or bounded remaining work is ok; failed removals fail", () => {
    expect(cleanupResult({ status: "skipped", reason: "locked" })).toEqual({
      outcome: "ok",
      counts: {},
    })
    expect(cleanupResult(completed({ more: true }))).toEqual({
      outcome: "ok",
      counts: {
        reaped_assets: 2,
        removed_assets: 3,
        removed_objects: 7,
        failed_assets: 0,
      },
    })
    expect(
      cleanupResult(
        completed({ failed: [{ assetId: "a9", error: SENSITIVE[6] }] })
      )
    ).toEqual({
      outcome: "failed",
      errorCode: "cleanup_failed",
      counts: {
        reaped_assets: 2,
        removed_assets: 3,
        removed_objects: 7,
        failed_assets: 1,
      },
    })
  })

  it("media archive: normal cycle continuations are ok; timeout and lease loss keep their codes", () => {
    for (const outcome of [
      "completed_cycle",
      "partial",
      "locked",
      "idle",
    ] as const)
      expect(archiveAuditResult(archiveReport(outcome))).toEqual({
        outcome: "ok",
        counts: { checked: 50, copied: 2, missing: 0, bytes_verified: 123_456 },
      })
    expect(archiveAuditResult(archiveReport("timeout"))).toMatchObject({
      outcome: "failed",
      errorCode: "archive_audit_timeout",
    })
    expect(archiveAuditResult(archiveReport("lease_lost"))).toMatchObject({
      outcome: "failed",
      errorCode: "archive_lease_lost",
    })
    expect(
      archiveAuditResult(
        archiveReport("failed", { error: "archive_store_unavailable" })
      )
    ).toMatchObject({ outcome: "failed", errorCode: "archive_audit_failed" })
    // An unknown missing count is omitted, not filled in.
    expect(
      archiveAuditResult(archiveReport("partial", { missing: null })).counts
    ).toEqual({ checked: 50, copied: 2, bytes_verified: 123_456 })
  })

  it("watchdog: a stopped monitor is unavailable", () => {
    expect(watchdogResult({ ok: true, delivered: 2 })).toEqual({
      outcome: "ok",
      counts: { delivered: 2 },
    })
    expect(watchdogResult({ ok: false, delivered: 0 })).toEqual({
      outcome: "failed",
      errorCode: "watchdog_unavailable",
      counts: { delivered: 0 },
    })
  })

  it("monthly preparation: all succeeded is ok, mixed is partial, none succeeded is failed", () => {
    const failed = { ...PREP_RUN, status: "failed", errorCode: "23505" }
    expect(monthlyPreparationResult([PREP_RUN, PREP_RUN])).toEqual({
      outcome: "ok",
      counts: {
        succeeded_runs: 2,
        failed_runs: 0,
        staff_considered: 10,
        targets_copied: 4,
        placeholders_created: 6,
        already_present: 2,
        candidates_added: 24,
      },
    })
    expect(monthlyPreparationResult([PREP_RUN, failed])).toMatchObject({
      outcome: "partial",
      errorCode: "preparation_failed",
      counts: { succeeded_runs: 1, failed_runs: 1 },
    })
    expect(monthlyPreparationResult([failed])).toMatchObject({
      outcome: "failed",
      errorCode: "preparation_failed",
      counts: { succeeded_runs: 0, failed_runs: 1 },
    })
    expect(monthlyPreparationResult([])).toEqual({
      outcome: "ok",
      counts: {
        succeeded_runs: 0,
        failed_runs: 0,
        staff_considered: 0,
        targets_copied: 0,
        placeholders_created: 0,
        already_present: 0,
        candidates_added: 0,
      },
    })
    // A raw SQLSTATE never becomes the receipt's code.
    expect(
      JSON.stringify(monthlyPreparationResult([PREP_RUN, failed]))
    ).not.toContain("23505")
  })
})

describe("M-JB-1 heartbeat at a fixed clock", () => {
  const now = new Date("2026-11-10T12:00:00.000Z")
  it("breaches only after two expected intervals without an ok run", () => {
    expect(HEARTBEAT_BREACH_INTERVALS).toBe(2)
    expect(heartbeatState("cleanup", "2026-11-10T10:00:00.000Z", now)).toEqual({
      state: "ok",
      intervalsSinceOk: 2,
    })
    expect(
      heartbeatState("cleanup", "2026-11-10T09:59:59.999Z", now).state
    ).toBe("breach")
    expect(
      heartbeatState("archive_watchdog", "2026-11-10T11:50:00.000Z", now)
    ).toEqual({ state: "ok", intervalsSinceOk: 2 })
    expect(
      heartbeatState("archive_watchdog", "2026-11-10T11:49:00.000Z", now)
    ).toMatchObject({ state: "breach" })
    expect(
      heartbeatState("media_archive", "2026-11-10T11:41:00.000Z", now)
    ).toMatchObject({ state: "ok" })
    expect(
      heartbeatState("media_archive", "2026-11-10T11:39:00.000Z", now)
    ).toMatchObject({ state: "breach" })
    expect(
      heartbeatState("monthly_preparation", "2026-11-10T11:07:00.000Z", now)
    ).toMatchObject({ state: "ok" })
  })
  it("claims neither health nor a missed run without any ok receipt", () => {
    expect(heartbeatState("cleanup", null, now)).toEqual({
      state: "no_evidence",
      intervalsSinceOk: null,
    })
  })
})

// --- Writer ------------------------------------------------------------------

describe("job receipt writer", () => {
  const client = () => ({ rpc: mocks.rpc })
  const clock = (...times: string[]) => {
    const queue = times.map((t) => new Date(t))
    return () => queue.shift() ?? new Date(times.at(-1) as string)
  }

  it("writes one bounded receipt with a stable run ID and only the first finish", async () => {
    const run = startJobRun("cleanup", { client, now: clock(START, END) })
    const first = run.finish({ outcome: "ok", counts: { removed_assets: 1 } })
    const second = run.finish({
      outcome: "failed",
      errorCode: "cleanup_failed",
    })
    expect(await first).toBe("recorded")
    expect(await second).toBe("recorded")
    expectOneReceipt({
      job: "cleanup",
      outcome: "ok",
      errorCode: null,
      counts: { removed_assets: 1 },
    })
    const [args] = receipts()
    expect(args).toMatchObject({ p_started_at: START, p_finished_at: END })
    const abort = mocks.rpc.mock.results[0].value.abortSignal
    expect(abort).toHaveBeenCalledOnce()
    expect(abort.mock.calls[0][0]).toBeInstanceOf(AbortSignal)
  })

  it("never finishes before it started when the wall clock steps back", async () => {
    const run = startJobRun("archive_watchdog", {
      client,
      now: clock(END, START),
    })
    await run.finish({ outcome: "ok" })
    expect(receipts()[0]).toMatchObject({
      p_started_at: END,
      p_finished_at: END,
    })
  })

  it("accepts a replayed receipt as stored", async () => {
    rpcReturns("replayed")
    expect(
      await startJobRun("cleanup", { client }).finish({ outcome: "ok" })
    ).toBe("replayed")
  })

  it.each([
    [
      "a database error",
      () => rpcReturns(null, { code: "42501", message: SENSITIVE[6] }),
    ],
    ["an unexpected answer", () => rpcReturns({ detail: SENSITIVE[0] })],
    [
      "a rejected call",
      () =>
        mocks.rpc.mockImplementation(() => ({
          abortSignal: vi.fn().mockRejectedValue(new Error(SENSITIVE[5])),
        })),
    ],
    [
      "a throwing client",
      () =>
        mocks.rpc.mockImplementation(() => {
          throw new Error(SENSITIVE[1])
        }),
    ],
  ])(
    "reports %s as not recorded with one sanitized log line",
    async (_l, arrange) => {
      arrange()
      const status = await startJobRun("cleanup", { client }).finish({
        outcome: "ok",
      })
      expect(status).toBe("not_recorded")
      expect(errors).toHaveBeenCalledExactlyOnceWith(
        "ops job receipt not recorded",
        { job: "cleanup", code: RECEIPT_FAILURE_CODE }
      )
    }
  )

  it("does not call the database for a receipt outside the vocabulary", async () => {
    const status = await startJobRun("cleanup", { client }).finish({
      outcome: "failed",
      errorCode: SENSITIVE[6],
      counts: { removed_assets: 1, note: SENSITIVE[2] } as never,
    })
    expect(status).toBe("not_recorded")
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("isolates a result that throws while it is read", async () => {
    const status = await startJobRun("cleanup", { client }).finish(() => {
      throw new Error(SENSITIVE[4])
    })
    expect(status).toBe("not_recorded")
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("gives up on a hanging database within the bound, without retrying", async () => {
    mocks.rpc.mockImplementation(() => ({
      abortSignal: () => new Promise(() => {}),
    }))
    const started = Date.now()
    const status = await startJobRun("cleanup", {
      client,
      timeoutMs: 20,
    }).finish({ outcome: "ok" })
    expect(status).toBe("not_recorded")
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })

  it("uses the service client only when it writes", async () => {
    const run = startJobRun("cleanup")
    expect(mocks.admin).not.toHaveBeenCalled()
    await run.finish({ outcome: "ok" })
    expect(mocks.admin).toHaveBeenCalledOnce()
  })
})

// --- Routes ------------------------------------------------------------------

/** A recorder whose every write fails in a different way. */
const RECORDER_FAILURES: [string, () => void][] = [
  ["returns an error", () => rpcReturns(null, { code: "XX000" })],
  [
    "rejects",
    () =>
      mocks.rpc.mockImplementation(() => ({
        abortSignal: vi.fn().mockRejectedValue(new Error(SENSITIVE[6])),
      })),
  ],
  [
    "throws",
    () =>
      mocks.rpc.mockImplementation(() => {
        throw new Error(SENSITIVE[6])
      }),
  ],
]

describe("cleanup route receipts", () => {
  const path = "/api/internal/cleanup"

  it("records nothing and creates no client when unconfigured or unauthorized", async () => {
    vi.stubEnv("CLEANUP_SECRET", "short")
    await expectResponse(
      await cleanupPost(cron(path, "short")),
      503,
      { error: "cleanup_not_configured" },
      NO_STORE
    )
    vi.stubEnv("CLEANUP_SECRET", SECRET)
    for (const token of [undefined, `${SECRET}x`])
      await expectResponse(
        await cleanupGet(cron(path, token)),
        401,
        { error: "unauthorized" },
        NO_STORE
      )
    expect(mocks.cleanup).not.toHaveBeenCalled()
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("records ok for a normal, bounded or locked run and keeps the 200 report", async () => {
    for (const report of [
      completed(),
      completed({ more: true }),
      { status: "skipped", reason: "locked" } as const,
    ]) {
      mocks.rpc.mockClear()
      mocks.cleanup.mockResolvedValueOnce(report)
      await expectResponse(
        await cleanupPost(cron(path, SECRET, "POST")),
        200,
        report,
        NO_STORE
      )
      expectOneReceipt({
        job: "cleanup",
        outcome: "ok",
        errorCode: null,
        counts:
          report.status === "completed"
            ? {
                reaped_assets: 2,
                removed_assets: 3,
                removed_objects: 7,
                failed_assets: 0,
              }
            : {},
      })
    }
    expect(mocks.cleanup).toHaveBeenCalledTimes(3)
  })

  it("records failed removals as cleanup_failed with counts and keeps the 500 report", async () => {
    const report = completed({ failed: [{ assetId: "a9", error: "x" }] })
    mocks.cleanup.mockResolvedValueOnce(report)
    await expectResponse(
      await cleanupGet(cron(path, SECRET)),
      500,
      report,
      NO_STORE
    )
    expectOneReceipt({
      job: "cleanup",
      outcome: "failed",
      errorCode: "cleanup_failed",
      counts: {
        reaped_assets: 2,
        removed_assets: 3,
        removed_objects: 7,
        failed_assets: 1,
      },
    })
  })

  it("records a thrown run as cleanup_failed without counts", async () => {
    mocks.cleanup.mockRejectedValueOnce(new Error("runner exploded"))
    await expectResponse(
      await cleanupGet(cron(path, SECRET)),
      500,
      { error: "cleanup_failed" },
      NO_STORE
    )
    expectOneReceipt({
      job: "cleanup",
      outcome: "failed",
      errorCode: "cleanup_failed",
      counts: {},
    })
  })

  it.each(RECORDER_FAILURES)(
    "keeps the business response when the recorder %s",
    async (_label, arrange) => {
      arrange()
      mocks.cleanup.mockResolvedValueOnce(completed())
      await expectResponse(
        await cleanupGet(cron(path, SECRET)),
        200,
        completed(),
        NO_STORE
      )
      const failed = completed({ failed: [{ assetId: "a9", error: "x" }] })
      mocks.cleanup.mockResolvedValueOnce(failed)
      await expectResponse(
        await cleanupGet(cron(path, SECRET)),
        500,
        failed,
        NO_STORE
      )
      expect(mocks.cleanup).toHaveBeenCalledTimes(2)
      expect(mocks.rpc).toHaveBeenCalledTimes(2)
    }
  )
})

describe("media archive route receipts", () => {
  const path = "/api/internal/media-archive"

  it("records nothing on guard exits, the disabled staging skip or invalid configuration", async () => {
    vi.stubEnv("CLEANUP_SECRET", "")
    await expectResponse(
      await archiveGet(cron(path, SECRET)),
      503,
      { error: "unconfigured" },
      PRIVATE_NO_STORE
    )
    vi.stubEnv("CLEANUP_SECRET", SECRET)
    await expectResponse(
      await archiveGet(cron(path)),
      401,
      { error: "unauthorized" },
      PRIVATE_NO_STORE
    )
    vi.stubEnv("NABALENS_ENVIRONMENT", "staging")
    mocks.config.mockReturnValueOnce(null)
    await expectResponse(
      await archiveGet(cron(path, SECRET)),
      200,
      { status: "disabled", skipped: true },
      PRIVATE_NO_STORE
    )
    mocks.config.mockImplementationOnce(() => {
      throw new Error("archive_environment_project_mismatch")
    })
    await expectResponse(
      await archiveGet(cron(path, SECRET)),
      500,
      { error: "archive_audit_failed" },
      PRIVATE_NO_STORE
    )
    vi.stubEnv("NABALENS_ENVIRONMENT", "")
    vi.stubEnv("VERCEL_ENV", "")
    mocks.config.mockReturnValueOnce(null)
    await expectResponse(
      await archiveGet(cron(path, SECRET)),
      500,
      { error: "archive_audit_failed" },
      PRIVATE_NO_STORE
    )
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("records healthy cycle continuations as ok and keeps the 200 report", async () => {
    for (const outcome of [
      "completed_cycle",
      "partial",
      "locked",
      "idle",
    ] as const) {
      mocks.rpc.mockClear()
      const report = archiveReport(outcome)
      mocks.audit.mockResolvedValueOnce(report)
      await expectResponse(
        await archiveGet(cron(path, SECRET)),
        200,
        report,
        PRIVATE_NO_STORE
      )
      expectOneReceipt({
        job: "media_archive",
        outcome: "ok",
        errorCode: null,
        counts: { checked: 50, copied: 2, missing: 0, bytes_verified: 123_456 },
      })
    }
  })

  it("records timeout, lease loss, audit failure and a throw with their own codes", async () => {
    const cases = [
      ["timeout", 503, "archive_audit_timeout"],
      ["lease_lost", 503, "archive_lease_lost"],
    ] as const
    for (const [outcome, status, code] of cases) {
      mocks.rpc.mockClear()
      const report = archiveReport(outcome, { missing: null })
      mocks.audit.mockResolvedValueOnce(report)
      await expectResponse(
        await archiveGet(cron(path, SECRET)),
        status,
        report,
        PRIVATE_NO_STORE
      )
      expectOneReceipt({
        job: "media_archive",
        outcome: "failed",
        errorCode: code,
        counts: { checked: 50, copied: 2, bytes_verified: 123_456 },
      })
    }
    mocks.rpc.mockClear()
    mocks.audit.mockResolvedValueOnce(
      archiveReport("failed", { error: "archive_store_unavailable" })
    )
    await expectResponse(
      await archiveGet(cron(path, SECRET)),
      500,
      { error: "archive_audit_failed", outcome: "failed" },
      PRIVATE_NO_STORE
    )
    expect(receipts()[0]).toMatchObject({
      p_outcome: "failed",
      p_error_code: "archive_audit_failed",
    })
    mocks.rpc.mockClear()
    mocks.audit.mockRejectedValueOnce(new Error(SENSITIVE[4]))
    await expectResponse(
      await archiveGet(cron(path, SECRET)),
      500,
      { error: "archive_audit_failed" },
      PRIVATE_NO_STORE
    )
    expectOneReceipt({
      job: "media_archive",
      outcome: "failed",
      errorCode: "archive_audit_failed",
      counts: {},
    })
  })

  it.each(RECORDER_FAILURES)(
    "keeps the business response when the recorder %s",
    async (_label, arrange) => {
      arrange()
      const report = archiveReport("partial")
      mocks.audit.mockResolvedValueOnce(report)
      await expectResponse(
        await archiveGet(cron(path, SECRET)),
        200,
        report,
        PRIVATE_NO_STORE
      )
      const timeout = archiveReport("timeout")
      mocks.audit.mockResolvedValueOnce(timeout)
      await expectResponse(
        await archiveGet(cron(path, SECRET)),
        503,
        timeout,
        PRIVATE_NO_STORE
      )
      expect(mocks.audit).toHaveBeenCalledTimes(2)
      expect(mocks.rpc).toHaveBeenCalledTimes(2)
    }
  )
})

describe("archive watchdog route receipts", () => {
  const path = "/api/internal/archive-monitor/watchdog"

  it("records nothing for a preview, an unconfigured or a wrong credential", async () => {
    vi.stubEnv("VERCEL_ENV", "preview")
    await expectResponse(
      await watchdogGet(cron(path, SECRET)),
      503,
      { error: "unconfigured" },
      PRIVATE_NO_STORE
    )
    vi.stubEnv("VERCEL_ENV", "production")
    await expectResponse(
      await watchdogGet(cron(path, "w".repeat(40))),
      401,
      { error: "unauthorized" },
      PRIVATE_NO_STORE
    )
    expect(mocks.watchdog).not.toHaveBeenCalled()
    expect(mocks.store).not.toHaveBeenCalled()
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("records ok, a stopped monitor and a thrown run", async () => {
    mocks.watchdog.mockResolvedValueOnce({
      ok: true,
      stopped: false,
      delivered: 2,
    })
    await expectResponse(
      await watchdogGet(cron(path, SECRET)),
      200,
      { ok: true, stopped: false, delivered: 2 },
      PRIVATE_NO_STORE
    )
    expectOneReceipt({
      job: "archive_watchdog",
      outcome: "ok",
      errorCode: null,
      counts: { delivered: 2 },
    })
    mocks.rpc.mockClear()
    mocks.watchdog.mockResolvedValueOnce({
      ok: false,
      stopped: true,
      delivered: 0,
    })
    await expectResponse(
      await watchdogGet(cron(path, SECRET)),
      503,
      { ok: false, stopped: true, delivered: 0 },
      PRIVATE_NO_STORE
    )
    expectOneReceipt({
      job: "archive_watchdog",
      outcome: "failed",
      errorCode: "watchdog_unavailable",
      counts: { delivered: 0 },
    })
    mocks.rpc.mockClear()
    mocks.watchdog.mockRejectedValueOnce(new Error("watchdog_failed"))
    await expectResponse(
      await watchdogGet(cron(path, SECRET)),
      503,
      { error: "watchdog_failed" },
      PRIVATE_NO_STORE
    )
    expectOneReceipt({
      job: "archive_watchdog",
      outcome: "failed",
      errorCode: "watchdog_failed",
      counts: {},
    })
    expect(mocks.watchdog).toHaveBeenCalledTimes(3)
  })

  it.each(RECORDER_FAILURES)(
    "keeps the business response when the recorder %s",
    async (_label, arrange) => {
      arrange()
      mocks.watchdog.mockResolvedValueOnce({
        ok: true,
        stopped: false,
        delivered: 1,
      })
      await expectResponse(
        await watchdogGet(cron(path, SECRET)),
        200,
        { ok: true, stopped: false, delivered: 1 },
        PRIVATE_NO_STORE
      )
      expect(mocks.watchdog).toHaveBeenCalledOnce()
      expect(mocks.rpc).toHaveBeenCalledOnce()
    }
  )
})

describe("monthly preparation route receipts", () => {
  const path = "/api/internal/coverage/monthly-preparation"

  it("records nothing when unconfigured or unauthorized", async () => {
    vi.stubEnv("CLEANUP_SECRET", "s".repeat(31))
    await expectResponse(
      await prepareGet(cron(path, "s".repeat(31))),
      503,
      { error: "not_configured" },
      PRIVATE_NO_STORE
    )
    vi.stubEnv("CLEANUP_SECRET", SECRET)
    await expectResponse(
      await preparePost(cron(path, "wrong", "POST")),
      401,
      { error: "unauthorized" },
      PRIVATE_NO_STORE
    )
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("records ok with the aggregate counts and keeps the 200 body", async () => {
    mocks.prepare.mockResolvedValueOnce({
      ok: true,
      failed: false,
      runs: [PREP_RUN],
    })
    await expectResponse(
      await preparePost(cron(path, SECRET, "POST")),
      200,
      { status: "succeeded", runs: [prepView(PREP_RUN)] },
      PRIVATE_NO_STORE
    )
    expectOneReceipt({
      job: "monthly_preparation",
      outcome: "ok",
      errorCode: null,
      counts: {
        succeeded_runs: 1,
        failed_runs: 0,
        staff_considered: 5,
        targets_copied: 2,
        placeholders_created: 3,
        already_present: 1,
        candidates_added: 12,
      },
    })
  })

  it("records a mixed report as partial and an all-failed report as failed, both still 500", async () => {
    const failed = { ...PREP_RUN, status: "failed", errorCode: "23505" }
    mocks.prepare.mockResolvedValueOnce({
      ok: true,
      failed: true,
      runs: [PREP_RUN, failed],
    })
    await expectResponse(
      await prepareGet(cron(path, SECRET)),
      500,
      { status: "failed", runs: [prepView(PREP_RUN), prepView(failed)] },
      PRIVATE_NO_STORE
    )
    expectOneReceipt({
      job: "monthly_preparation",
      outcome: "partial",
      errorCode: "preparation_failed",
      counts: {
        succeeded_runs: 1,
        failed_runs: 1,
        staff_considered: 10,
        targets_copied: 4,
        placeholders_created: 6,
        already_present: 2,
        candidates_added: 24,
      },
    })
    mocks.rpc.mockClear()
    mocks.prepare.mockResolvedValueOnce({
      ok: true,
      failed: true,
      runs: [failed],
    })
    expect((await prepareGet(cron(path, SECRET))).status).toBe(500)
    expect(receipts()[0]).toMatchObject({
      p_outcome: "failed",
      p_error_code: "preparation_failed",
      p_counts: { succeeded_runs: 0, failed_runs: 1 },
    })
    expect(JSON.stringify(receipts())).not.toContain("23505")
  })

  it("records an unavailable result or a throw as failed without counts", async () => {
    mocks.prepare.mockResolvedValueOnce({ ok: false })
    await expectResponse(
      await prepareGet(cron(path, SECRET)),
      500,
      { error: "preparation_failed" },
      PRIVATE_NO_STORE
    )
    expectOneReceipt({
      job: "monthly_preparation",
      outcome: "failed",
      errorCode: "preparation_failed",
      counts: {},
    })
    mocks.rpc.mockClear()
    mocks.prepare.mockRejectedValueOnce(new Error(SENSITIVE[6]))
    await expectResponse(
      await prepareGet(cron(path, SECRET)),
      500,
      { error: "preparation_failed" },
      PRIVATE_NO_STORE
    )
    expectOneReceipt({
      job: "monthly_preparation",
      outcome: "failed",
      errorCode: "preparation_failed",
      counts: {},
    })
  })

  it.each(RECORDER_FAILURES)(
    "keeps the business response when the recorder %s",
    async (_label, arrange) => {
      arrange()
      mocks.prepare.mockResolvedValueOnce({
        ok: true,
        failed: false,
        runs: [PREP_RUN],
      })
      await expectResponse(
        await prepareGet(cron(path, SECRET)),
        200,
        { status: "succeeded", runs: [prepView(PREP_RUN)] },
        PRIVATE_NO_STORE
      )
      mocks.prepare.mockResolvedValueOnce({ ok: false })
      await expectResponse(
        await prepareGet(cron(path, SECRET)),
        500,
        { error: "preparation_failed" },
        PRIVATE_NO_STORE
      )
      expect(mocks.prepare).toHaveBeenCalledTimes(2)
      expect(mocks.rpc).toHaveBeenCalledTimes(2)
    }
  )
})

describe("receipt arguments carry no upstream text", () => {
  it("drops every sensitive upstream value from all four routes' receipts", async () => {
    mocks.cleanup.mockResolvedValueOnce(
      completed({
        reaped: { assetIds: [SENSITIVE[4]], reason: "stale_processing" },
        failed: [{ assetId: SENSITIVE[4], error: SENSITIVE[6] }],
      })
    )
    await cleanupGet(cron("/api/internal/cleanup", SECRET))
    mocks.audit.mockResolvedValueOnce({
      ...archiveReport("partial"),
      note: SENSITIVE[2],
      url: SENSITIVE[5],
    })
    await archiveGet(cron("/api/internal/media-archive", SECRET))
    mocks.watchdog.mockResolvedValueOnce({
      ok: true,
      stopped: false,
      delivered: 1,
      email: SENSITIVE[1],
    })
    await watchdogGet(cron("/api/internal/archive-monitor/watchdog", SECRET))
    mocks.prepare.mockResolvedValueOnce({
      ok: true,
      failed: true,
      runs: [
        {
          ...PREP_RUN,
          status: "failed",
          errorCode: "P0001",
          venueName: SENSITIVE[0],
          wifi: SENSITIVE[3],
        },
      ],
    })
    await prepareGet(cron("/api/internal/coverage/monthly-preparation", SECRET))
    const sent = JSON.stringify(receipts())
    expect(receipts()).toHaveLength(4)
    for (const value of [...SENSITIVE, "P0001"])
      expect(sent).not.toContain(value)
  })
})
