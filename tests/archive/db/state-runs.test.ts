import { randomUUID } from "node:crypto"

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  STATE_COLUMNS,
  anonClient,
  assertVerificationStack,
  createFixtures,
  psql,
  readState,
  resetState,
  type Fixtures,
  type StateRow,
} from "../support/db"

// Real-database checks for the audit state columns and the runs table
// (§4.2): constraints, grants, RLS, append-only, retention, conditional
// checkpoints. The state row is global, so it is snapshotted and restored.
let fx: Fixtures
let snapshot: StateRow
const DAY = 86_400_000

const OUTCOMES = [
  "completed_cycle",
  "partial",
  "locked",
  "timeout",
  "lease_lost",
  "failed",
  "idle",
]
const ERRORS = [
  "archive_audit_failed",
  "archive_audit_timeout",
  "archive_lease_lost",
  "archive_checkpoint_failed",
  "archive_store_unavailable",
  "archive_source_unavailable",
]

beforeAll(async () => {
  assertVerificationStack()
  fx = await createFixtures()
  snapshot = await readState(fx.service)
})
beforeEach(async () => {
  await resetState(fx.service)
})
afterAll(async () => {
  const { name, ...rest } = snapshot
  void name
  await fx.service
    .from("media_archive_audit_state")
    .update(rest as never)
    .eq("name", "originals")
})

const patchState = (patch: Record<string, unknown>) =>
  fx.service
    .from("media_archive_audit_state")
    .update(patch as never)
    .eq("name", "originals")

const runRow = (overrides: Record<string, unknown> = {}) => {
  const at = new Date().toISOString()
  return {
    run_id: randomUUID(),
    cycle_id: null,
    started_at: at,
    finished_at: at,
    outcome: "partial",
    checked: 3,
    copied: 0,
    missing: 0,
    bytes_verified: 4096,
    error: null,
    cursor_from: 0,
    cursor_to: 3,
    ...overrides,
  }
}
const insertRun = (row: Record<string, unknown>) =>
  fx.service.from("media_archive_audit_runs").insert(row as never)

describe("media_archive_audit_state: columns and constraints (§4.2)", () => {
  it("has every contract column with the contract defaults", async () => {
    const row = await readState(fx.service)
    expect(Object.keys(row).sort()).toEqual([...STATE_COLUMNS].sort())
    expect(typeof row.cycle_checked).toBe("number")
    expect(typeof row.consecutive_failures).toBe("number")
    const columns = psql(
      `select column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') from information_schema.columns where table_schema='public' and table_name='media_archive_audit_state' order by 1`
    ).out.split("\n")
    const find = (name: string) =>
      columns.find((line) => line.startsWith(`${name}:`))
    expect(find("cycle_id")).toBe("cycle_id:uuid:YES:")
    expect(find("cycle_started_at")).toBe(
      "cycle_started_at:timestamp with time zone:YES:"
    )
    expect(find("cycle_target_id")).toBe("cycle_target_id:bigint:YES:")
    expect(find("cycle_target_count")).toBe("cycle_target_count:bigint:YES:")
    expect(find("cycle_checked")).toBe("cycle_checked:bigint:NO:0")
    expect(find("consecutive_failures")).toBe(
      "consecutive_failures:integer:NO:0"
    )
    expect(find("last_cycle_duration_seconds")).toBe(
      "last_cycle_duration_seconds:integer:YES:"
    )
    expect(find("last_complete_cycle_started_at")).toBe(
      "last_complete_cycle_started_at:timestamp with time zone:YES:"
    )
    expect(find("last_run_outcome")).toBe("last_run_outcome:text:YES:")
  })

  it("accepts every contract outcome and every contract error code, and nothing else", async () => {
    for (const outcome of OUTCOMES)
      expect((await patchState({ last_run_outcome: outcome })).error).toBeNull()
    for (const error of ERRORS)
      expect((await patchState({ last_error: error })).error).toBeNull()
    for (const bad of ["done", "FAILED", "", "completed"])
      expect((await patchState({ last_run_outcome: bad })).error?.code).toBe(
        "23514"
      )
    for (const bad of [
      "boom",
      "ECONNREFUSED 10.0.0.1 password=hunter2",
      "archive_audit_fail",
    ])
      expect((await patchState({ last_error: bad })).error?.code).toBe("23514")
  })

  it("keeps the cycle columns all-or-nothing and the cursor inside the cycle", async () => {
    const cycle = {
      cycle_id: randomUUID(),
      cycle_started_at: new Date().toISOString(),
      cycle_target_id: 10,
      cycle_target_count: 10,
    }
    expect((await patchState(cycle)).error).toBeNull()
    expect((await patchState({ cursor_id: 10 })).error).toBeNull()
    expect((await patchState({ cursor_id: 11 })).error?.code).toBe("23514")
    for (const partial of [
      { cycle_started_at: null },
      { cycle_target_id: null },
      { cycle_target_count: null },
      { cycle_id: null },
    ])
      expect((await patchState(partial)).error?.code).toBe("23514")
    await resetState(fx.service)
    expect((await patchState({ cursor_id: 5 })).error?.code).toBe("23514")
  })

  it("rejects negative counters, a null counter and a negative duration", async () => {
    for (const patch of [
      { consecutive_failures: -1 },
      { consecutive_failures: null },
      { cycle_checked: -1 },
      { cycle_checked: null },
      { last_cycle_duration_seconds: -5 },
    ])
      expect((await patchState(patch)).error).not.toBeNull()
  })

  it("denies anonymous, staff and admin clients read and write access to the new columns", async () => {
    for (const client of [anonClient(), fx.staff.client, fx.admin.client]) {
      const read = await client
        .from("media_archive_audit_state")
        .select("cycle_id,cycle_checked,last_run_outcome,consecutive_failures")
      expect(read.error?.code).toBe("42501")
      expect(read.data ?? []).toHaveLength(0)
      const write = await client
        .from("media_archive_audit_state")
        .update({ consecutive_failures: 99 } as never)
        .eq("name", "originals")
      expect(write.error?.code).toBe("42501")
    }
    expect((await readState(fx.service)).consecutive_failures).toBe(0)
  })

  it("limits the state table to the service role (which also keeps Supabase's default table privileges, as before this change)", () => {
    const grants = (table: string, role: string) =>
      psql(
        `select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where table_schema='public' and table_name='${table}' and grantee='${role}'`
      ).out
    const service = grants("media_archive_audit_state", "service_role").split(
      ","
    )
    for (const needed of ["INSERT", "SELECT", "UPDATE"])
      expect(service).toContain(needed)
    for (const role of ["anon", "authenticated", "PUBLIC"])
      expect(grants("media_archive_audit_state", role)).toBe("")
  })

  it("has row level security enabled on both audit tables", () => {
    const rls = psql(
      `select relname||':'||relrowsecurity from pg_class where relname in ('media_archive_audit_state','media_archive_audit_runs') order by 1`
    ).out
    expect(rls).toBe(
      "media_archive_audit_runs:true\nmedia_archive_audit_state:true"
    )
  })
})

describe("checkpoint and cycle-start writes are conditional (§4.3)", () => {
  it("a checkpoint only moves the cursor forward within its own cycle", async () => {
    const cycleId = randomUUID()
    await patchState({
      cycle_id: cycleId,
      cycle_started_at: new Date().toISOString(),
      cycle_target_id: 100,
      cycle_target_count: 100,
    })
    const checkpoint = (cycle: string, cursor: number) =>
      fx.service
        .from("media_archive_audit_state")
        .update({ cursor_id: cursor, cycle_checked: cursor } as never)
        .eq("name", "originals")
        .eq("cycle_id", cycle)
        .lt("cursor_id", cursor)
        .select("cursor_id")
    expect((await checkpoint(cycleId, 40)).data).toHaveLength(1)
    // A stale writer with a lower or equal cursor changes nothing.
    expect((await checkpoint(cycleId, 30)).data).toHaveLength(0)
    expect((await checkpoint(cycleId, 40)).data).toHaveLength(0)
    // A writer from a different (replaced) cycle changes nothing either.
    expect((await checkpoint(randomUUID(), 90)).data).toHaveLength(0)
    expect((await readState(fx.service)).cursor_id).toBe(40)
    expect((await checkpoint(cycleId, 90)).data).toHaveLength(1)
  })

  it("racing cycle starters: exactly one wins and the loser sees zero rows", async () => {
    const start = () =>
      fx.service
        .from("media_archive_audit_state")
        .update({
          cycle_id: randomUUID(),
          cycle_started_at: new Date().toISOString(),
          cycle_target_id: 7,
          cycle_target_count: 7,
          cursor_id: 0,
          cycle_checked: 0,
        } as never)
        .eq("name", "originals")
        .is("cycle_id", null)
        .select("cycle_id")
    const results = await Promise.all(Array.from({ length: 12 }, start))
    expect(results.every((r) => r.error === null)).toBe(true)
    expect(results.filter((r) => (r.data ?? []).length === 1)).toHaveLength(1)
  })

  it("checkpoints survive a new connection (durability)", async () => {
    const cycleId = randomUUID()
    await patchState({
      cycle_id: cycleId,
      cycle_started_at: new Date().toISOString(),
      cycle_target_id: 50,
      cycle_target_count: 50,
      cursor_id: 25,
      cycle_checked: 25,
    })
    const other = (await import("../support/db")).serviceClient()
    const row = await readState(other)
    expect(row).toMatchObject({
      cycle_id: cycleId,
      cursor_id: 25,
      cycle_checked: 25,
    })
  })
})

describe("media_archive_audit_runs (§4.2)", () => {
  it("accepts a valid row, returns bigint counters as numbers and defaults bytes_verified to 0", async () => {
    const row = runRow()
    const { bytes_verified, ...withoutBytes } = row
    void bytes_verified
    expect((await insertRun(row)).error).toBeNull()
    const noBytes = runRow()
    const { bytes_verified: ignored, ...rest } = noBytes
    void ignored
    expect((await insertRun(rest)).error).toBeNull()
    const read = await fx.service
      .from("media_archive_audit_runs")
      .select("*")
      .eq("run_id", noBytes.run_id)
      .single()
    expect(read.data).toMatchObject({
      bytes_verified: 0,
      missing: 0,
      checked: 3,
    })
    expect(typeof read.data?.id).toBe("number")
    void withoutBytes
  })

  it("enforces uniqueness and the outcome/error/time constraints", async () => {
    const first = runRow()
    expect((await insertRun(first)).error).toBeNull()
    expect((await insertRun(first)).error?.code).toBe("23505")
    for (const outcome of OUTCOMES) {
      const needsError = ["timeout", "lease_lost", "failed"].includes(outcome)
      expect(
        (
          await insertRun(
            runRow({ outcome, error: needsError ? ERRORS[0] : null })
          )
        ).error
      ).toBeNull()
      // The error column and the failing outcomes must agree both ways.
      expect(
        (
          await insertRun(
            runRow({ outcome, error: needsError ? null : ERRORS[0] })
          )
        ).error?.code
      ).toBe("23514")
    }
    for (const error of ERRORS)
      expect(
        (await insertRun(runRow({ outcome: "failed", error }))).error
      ).toBeNull()
    expect((await insertRun(runRow({ outcome: "bogus" }))).error?.code).toBe(
      "23514"
    )
    expect(
      (
        await insertRun(
          runRow({ outcome: "failed", error: "message with details" })
        )
      ).error?.code
    ).toBe("23514")
    const now = Date.now()
    expect(
      (
        await insertRun(
          runRow({
            started_at: new Date(now).toISOString(),
            finished_at: new Date(now - 1000).toISOString(),
          })
        )
      ).error?.code
    ).toBe("23514")
    for (const bad of [
      { checked: -1 },
      { copied: -1 },
      { missing: -1 },
      { bytes_verified: -1 },
      { cursor_from: -1 },
      { cursor_to: -1 },
    ])
      expect((await insertRun(runRow(bad))).error?.code).toBe("23514")
  })

  it("allows locked and lease_lost rows with null cycle, missing and cursors", async () => {
    expect(
      (
        await insertRun(
          runRow({
            outcome: "locked",
            cycle_id: null,
            missing: null,
            cursor_from: null,
            cursor_to: null,
            checked: 0,
            bytes_verified: 0,
          })
        )
      ).error
    ).toBeNull()
  })

  it("is append-only: the service role cannot update, delete recent rows or truncate", async () => {
    const row = runRow()
    expect((await insertRun(row)).error).toBeNull()
    const update = await fx.service
      .from("media_archive_audit_runs")
      .update({ checked: 999 } as never)
      .eq("run_id", row.run_id)
    expect(update.error?.code).toBe("42501")
    const del = await fx.service
      .from("media_archive_audit_runs")
      .delete()
      .eq("run_id", row.run_id)
    expect(del.error?.code).toBe("42501")
    const still = await fx.service
      .from("media_archive_audit_runs")
      .select("checked")
      .eq("run_id", row.run_id)
      .single()
    expect(still.data?.checked).toBe(3)
    for (const sql of [
      "truncate public.media_archive_audit_runs",
      "set role service_role; truncate public.media_archive_audit_runs",
      "update public.media_archive_audit_runs set checked = checked",
    ]) {
      const result = psql(sql)
      expect(result.ok).toBe(false)
    }
    expect(
      (
        await fx.service
          .from("media_archive_audit_runs")
          .select("run_id")
          .eq("run_id", row.run_id)
      ).data
    ).toHaveLength(1)
  })

  it("retention: only rows finished more than 90 days ago may be deleted", async () => {
    const old = runRow({
      started_at: new Date(Date.now() - 100 * DAY).toISOString(),
      finished_at: new Date(Date.now() - 100 * DAY).toISOString(),
    })
    const nearlyOld = runRow({
      started_at: new Date(Date.now() - 89 * DAY).toISOString(),
      finished_at: new Date(Date.now() - 89 * DAY).toISOString(),
    })
    expect((await insertRun(old)).error).toBeNull()
    expect((await insertRun(nearlyOld)).error).toBeNull()
    const cutoff = new Date(Date.now() - 90 * DAY).toISOString()
    const pruned = await fx.service
      .from("media_archive_audit_runs")
      .delete()
      .lt("finished_at", cutoff)
      .select("run_id")
    expect(pruned.error).toBeNull()
    const ids = (pruned.data ?? []).map((r) => r.run_id)
    expect(ids).toContain(old.run_id)
    expect(ids).not.toContain(nearlyOld.run_id)
    // A delete that also targets a recent row fails as a whole.
    const mixed = await fx.service
      .from("media_archive_audit_runs")
      .delete()
      .eq("run_id", nearlyOld.run_id)
    expect(mixed.error?.code).toBe("42501")
  })

  it("denies anonymous, staff and admin clients every operation", async () => {
    const row = runRow()
    expect((await insertRun(row)).error).toBeNull()
    for (const client of [anonClient(), fx.staff.client, fx.admin.client]) {
      const read = await client.from("media_archive_audit_runs").select("*")
      expect(read.error?.code).toBe("42501")
      expect(read.data ?? []).toHaveLength(0)
      expect(
        (
          await client
            .from("media_archive_audit_runs")
            .insert(runRow() as never)
        ).error?.code
      ).toBe("42501")
      expect(
        (
          await client
            .from("media_archive_audit_runs")
            .delete()
            .eq("run_id", row.run_id)
        ).error?.code
      ).toBe("42501")
    }
  })

  it("grants the service role exactly select, insert and delete", () => {
    const grants = (role: string) =>
      psql(
        `select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where table_schema='public' and table_name='media_archive_audit_runs' and grantee='${role}'`
      ).out
    expect(grants("service_role")).toBe("DELETE,INSERT,SELECT")
    for (const role of ["anon", "authenticated", "PUBLIC"])
      expect(grants(role)).toBe("")
  })

  it("has the finished_at index for retention and operator queries", () => {
    expect(
      psql(
        "select indexname from pg_indexes where tablename='media_archive_audit_runs' and indexname='media_archive_audit_runs_finished_idx'"
      ).out
    ).toBe("media_archive_audit_runs_finished_idx")
  })
})
