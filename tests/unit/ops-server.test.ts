// S1-OPS server modules with a stubbed database client: settings save sends
// only changes with the base revision and maps errors to fields; activity
// filters are cleaned before they reach the database; the notification job
// records its run; the orphan window comes from Settings with a safe
// fallback; integrations never expose a secret; the watchdog recipient is
// configurable.
import { beforeEach, describe, expect, it, vi } from "vitest"

import { DEFAULT_SETTINGS, settingsForm } from "@/lib/ops/settings"
import { watchdogRecipient, WATCHDOG_OWNER } from "@/lib/server/archive-monitor"
import { cleanActivityFilters, loadActivity } from "@/lib/server/audit"
import { markRead, runNotificationJobs } from "@/lib/server/notifications"
import { orphanCleanupInterval } from "@/lib/server/ops/cleanup-window"
import { integrationStatus } from "@/lib/server/ops/integrations"
import { saveOpsSettings } from "@/lib/server/ops/settings"

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }))

type Call = { fn: string; args: unknown }

function fakeDb(
  answers: Record<
    string,
    { data?: unknown; error?: { message: string; code: string } | null }
  >
) {
  const calls: Call[] = []
  const db = {
    rpc: vi.fn(async (fn: string, args: unknown) => {
      calls.push({ fn, args })
      const a = answers[fn] ?? { data: null, error: null }
      return { data: a.data ?? null, error: a.error ?? null }
    }),
  }
  return { db: db as never, calls }
}

const base = { ...DEFAULT_SETTINGS, revision: 4 }

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("saveOpsSettings", () => {
  it("does not call the database when nothing changed", async () => {
    const { db, calls } = fakeDb({})
    expect(await saveOpsSettings({ db }, settingsForm(base), base)).toEqual({
      ok: true,
      settings: base,
      changed: false,
    })
    expect(calls).toHaveLength(0)
  })

  it("sends the changed fields with the base revision and reason", async () => {
    const { db, calls } = fakeDb({
      ops_settings_set: {
        data: { ...base, quietStart: "22:00", revision: 5, changed: true },
      },
    })
    const result = await saveOpsSettings(
      { db },
      { ...settingsForm(base), quietStart: "22:00", reason: "Later close" },
      base
    )
    expect(calls).toEqual([
      {
        fn: "ops_settings_set",
        args: {
          p_expected_revision: 4,
          p_patch: { quietStart: "22:00" },
          p_reason: "Later close",
        },
      },
    ])
    expect(result).toMatchObject({
      ok: true,
      changed: true,
      settings: { revision: 5 },
    })
  })

  it("reports a stale revision and maps a database field error", async () => {
    const stale = fakeDb({
      ops_settings_set: { error: { message: "stale_revision", code: "40001" } },
    })
    expect(
      await saveOpsSettings(
        { db: stale.db },
        { ...settingsForm(base), quietEnd: "07:00", reason: "x" },
        base
      )
    ).toMatchObject({ ok: false, stale: true })

    const field = fakeDb({
      ops_settings_set: {
        error: { message: "invalid_storage_quota", code: "22023" },
      },
    })
    expect(
      await saveOpsSettings(
        { db: field.db },
        { ...settingsForm(base), storageQuotaGb: "5", reason: "x" },
        base
      )
    ).toMatchObject({
      ok: false,
      fieldErrors: { storageQuotaGb: "Choose a whole number of GB, from 1." },
    })
  })
})

describe("activity", () => {
  it("drops malformed filters before they reach the database", () => {
    expect(
      cleanActivityFilters({
        venueId: "not-a-uuid",
        actorId: "00000000-0000-4000-8000-000000000001",
        action: "DROP TABLE",
        source: "nope",
        limit: 1000,
      })
    ).toEqual({
      p_venue_id: null,
      p_actor_id: "00000000-0000-4000-8000-000000000001",
      p_action: null,
      p_source: null,
      p_before: null,
      p_limit: 200,
    })
  })

  it("maps a refusal to forbidden", async () => {
    const { db } = fakeDb({
      admin_activity: { error: { message: "not_admin", code: "42501" } },
    })
    expect(await loadActivity({ db })).toMatchObject({
      ok: false,
      code: "forbidden",
      status: 403,
    })
  })
})

describe("notifications", () => {
  it("refuses bad ids without calling the database", async () => {
    const { db, calls } = fakeDb({})
    expect(await markRead({ db }, [1, -2])).toMatchObject({
      ok: false,
      code: "invalid_input",
    })
    expect(calls).toHaveLength(0)
  })

  it("records a successful and a failed job run", async () => {
    const ok = fakeDb({
      ops_run_notification_jobs: {
        data: { digests: 2, exceptions: 1, resolved: 0 },
      },
    })
    expect(await runNotificationJobs(ok.db)).toEqual({
      ok: true,
      report: { digests: 2, exceptions: 1, resolved: 0 },
    })
    expect(ok.calls[1]).toMatchObject({
      fn: "ops_record_job_run",
      args: { p_job: "notification_jobs", p_state: "succeeded" },
    })

    const bad = fakeDb({
      ops_run_notification_jobs: { error: { message: "boom", code: "XX000" } },
    })
    expect(await runNotificationJobs(bad.db)).toEqual({
      ok: false,
      errorCode: "notification_job_failed",
    })
    expect(bad.calls[1]).toMatchObject({
      fn: "ops_record_job_run",
      args: { p_state: "failed", p_error_code: "notification_job_failed" },
    })
  })
})

describe("orphan window", () => {
  function service(result: { data: unknown; error: unknown }) {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => result,
    }
    return { from: () => chain } as never
  }

  it("uses the admin's days", async () => {
    expect(
      await orphanCleanupInterval(
        service({ data: { orphan_cleanup_days: 10 }, error: null })
      )
    ).toBe("240 hours")
  })

  it("falls back to 7 days, never shorter, when the setting can't be read", async () => {
    expect(
      await orphanCleanupInterval(
        service({ data: null, error: { code: "x", message: "down" } })
      )
    ).toBe("168 hours")
  })
})

describe("integrations and the watchdog", () => {
  it("says whether each integration is set up, never its value", () => {
    const secret = "s".repeat(40)
    const list = integrationStatus({
      CLEANUP_SECRET: secret,
      ARCHIVE_WATCHDOG_RESEND_API_KEY: "re_secret_value",
    })
    expect(list.find((i) => i.id === "scheduler")?.configured).toBe(true)
    expect(list.find((i) => i.id === "watchdog_email")?.configured).toBe(false)
    expect(JSON.stringify(list)).not.toContain(secret)
    expect(JSON.stringify(list)).not.toContain("re_secret_value")
  })

  it("emails the configured recipient, else the original owner", () => {
    expect(
      watchdogRecipient({ ARCHIVE_WATCHDOG_EMAIL_TO: " ops@example.com " })
    ).toBe("ops@example.com")
    expect(
      watchdogRecipient({
        ARCHIVE_WATCHDOG_EMAIL_TO: "a@example.com, b@example.com",
      })
    ).toBe(WATCHDOG_OWNER)
    expect(watchdogRecipient({})).toBe(WATCHDOG_OWNER)
  })
})
