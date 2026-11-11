// Request keys on the legacy amenity check writes (docs/knowledge/b02-design.md
// R10). Every write runs as a signed-in identity through PostgREST; the
// service role and psql only build fixtures and read state back.
import { randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import { psql } from "./coverage-fixtures"
import {
  call,
  count,
  json,
  refused,
  service,
  world,
  yes,
  type World,
} from "./knowledge-fixtures"

type Keyed = { revision: number; replayed: boolean }
type KeyedAdd = { checkIds: string[]; replayed: boolean }
type Who = World["manager"]

const revision = (check: string) =>
  count(
    `select revision from public.venue_amenity_checks where id = '${check}'`
  )
const events = (check: string, kind: string) =>
  count(
    `select count(*) from public.amenity_check_events where check_id = '${check}' and kind = '${kind}'`
  )
const commands = (key: string) =>
  count(
    `select count(*) from public.amenity_commands where idempotency_key = '${key}'`
  )

async function activeGrant(managerId: string, venueId: string) {
  const { data, error } = await service
    .from("venue_manager_grants")
    .select("id")
    .eq("staff_id", managerId)
    .eq("venue_id", venueId)
    .is("revoked_at", null)
    .single()
  if (error) throw error
  return data.id as string
}

async function deactivate(id: string) {
  const { error } = await service
    .from("profiles")
    .update({ active: false })
    .eq("id", id)
  if (error) throw error
}

const notesArgs = (check: string, notes: string, key: string) => ({
  p_check_id: check,
  p_notes: notes,
  p_revision: revision(check),
  p_idempotency_key: key,
})

let w: World

beforeAll(async () => {
  w = await world("am-keys", {
    extra: ["darts", "pool_table", "board_games", "arcade", "snooker"],
  })
})

describe("a retry after a lost reply replays (R10)", () => {
  // Calls the keyed write twice with one key and the same arguments: the
  // second call returns the first result, and only one change is made.
  async function lostReply(
    who: Who,
    fn: string,
    check: string,
    kind: string,
    args: (n: number, key: string) => object
  ) {
    const n = revision(check)
    const before = events(check, kind)
    const key = randomUUID()
    const first = await json<Keyed>(who, fn, args(n, key))
    expect(first).toEqual({ revision: n + 1, replayed: false })
    const again = await json<Keyed>(who, fn, args(n, key))
    expect(again).toEqual({ revision: n + 1, replayed: true })
    expect(events(check, kind)).toBe(before + 1)
    expect(revision(check)).toBe(n + 1)
    expect(commands(key)).toBe(1)
  }

  it("assign", async () => {
    const check = w.checks.darts!
    await lostReply(
      w.manager,
      "amenity_assign_check",
      check,
      "assigned",
      (n, key) => ({
        p_check_id: check,
        p_assignee_id: w.staffA.id,
        p_revision: n,
        p_idempotency_key: key,
      })
    )
  })

  it("set notes", async () => {
    const check = w.checks.darts!
    await lostReply(
      w.manager,
      "amenity_set_check_notes",
      check,
      "notes_updated",
      (n, key) => ({
        p_check_id: check,
        p_notes: "TEST behind the bar",
        p_revision: n,
        p_idempotency_key: key,
      })
    )
  })

  it("reopen", async () => {
    const check = w.checks.onsite_parking!
    const sent = await yes(w.staffA, w, "onsite_parking")
    expect(sent.outcome).toBe("current")
    await lostReply(
      w.manager,
      "amenity_reopen_check",
      check,
      "reopened",
      (n, key) => ({
        p_check_id: check,
        p_revision: n,
        p_preset: "conditions_changed",
        p_reason: "TEST new layout",
        p_idempotency_key: key,
      })
    )
  })

  it("archive, then restore", async () => {
    const check = w.checks.pool_table!
    await lostReply(
      w.manager,
      "amenity_archive_check",
      check,
      "archived",
      (n, key) => ({ p_check_id: check, p_revision: n, p_idempotency_key: key })
    )
    await lostReply(
      w.manager,
      "amenity_restore_check",
      check,
      "restored",
      (n, key) => ({ p_check_id: check, p_revision: n, p_idempotency_key: key })
    )
  })

  it("add from the catalogue, returning the same ids in input order", async () => {
    const key = randomUUID()
    const args = {
      p_venue_id: w.venue,
      p_keys: ["takeaway_pickup", "guest_toilets"],
      p_idempotency_key: key,
    }
    const first = await json<KeyedAdd>(w.manager, "amenity_add_checks", args)
    expect(first.replayed).toBe(false)
    expect(first.checkIds).toHaveLength(2)
    expect(first.checkIds[1]).toBe(w.checks.guest_toilets)
    const added = first.checkIds[0]!
    expect(
      psql(
        `select template_key from public.venue_amenity_checks where id = '${added}'`
      )
    ).toBe("takeaway_pickup")
    const again = await json<KeyedAdd>(w.manager, "amenity_add_checks", args)
    expect(again).toEqual({ checkIds: first.checkIds, replayed: true })
    expect(events(added, "added")).toBe(1)
    expect(
      count(
        `select count(*) from public.venue_amenity_checks where venue_id = '${w.venue}' and template_key = 'takeaway_pickup'`
      )
    ).toBe(1)
    expect(commands(key)).toBe(1)
  })
})

describe("a reused key (R10)", () => {
  it("refuses other arguments, another command and another person", async () => {
    const check = w.checks.board_games!
    const key = randomUUID()
    const args = {
      p_check_id: check,
      p_assignee_id: w.staffA.id,
      p_revision: revision(check),
      p_idempotency_key: key,
    }
    await json<Keyed>(w.manager, "amenity_assign_check", args)
    const after = revision(check)
    await refused(
      w.manager,
      "amenity_assign_check",
      { ...args, p_assignee_id: w.staffB.id },
      "idempotency_key_reused"
    )
    await refused(
      w.manager,
      "amenity_set_check_notes",
      notesArgs(check, "TEST other command", key),
      "idempotency_key_reused"
    )
    for (const other of [w.admin, w.staffManager]) {
      await refused(
        other,
        "amenity_assign_check",
        args,
        "idempotency_key_reused"
      )
    }
    await refused(
      w.admin,
      "amenity_add_checks",
      { p_venue_id: w.venue, p_keys: ["arcade"], p_idempotency_key: key },
      "idempotency_key_reused"
    )
    expect(revision(check)).toBe(after)
    expect(commands(key)).toBe(1)
    expect(
      psql(
        `select assignee_user_id from public.venue_amenity_checks where id = '${check}'`
      )
    ).toBe(w.staffA.id)
  })
})

describe("refused writes (R10)", () => {
  it("still reports a genuine conflict under a fresh key", async () => {
    const check = w.checks.snooker!
    const stale = revision(check)
    await json<Keyed>(w.manager, "amenity_set_check_notes", {
      p_check_id: check,
      p_notes: "TEST first",
      p_revision: stale,
      p_idempotency_key: randomUUID(),
    })
    const key = randomUUID()
    await refused(
      w.manager,
      "amenity_set_check_notes",
      {
        p_check_id: check,
        p_notes: "TEST second",
        p_revision: stale,
        p_idempotency_key: key,
      },
      "amenity_conflict"
    )
    expect(commands(key)).toBe(0)
  })

  it("records nothing for a refused write, so its retry runs again", async () => {
    const check = w.checks.snooker!
    const key = randomUUID()
    const stale = {
      p_check_id: check,
      p_notes: "TEST retried",
      p_revision: revision(check) - 1,
      p_idempotency_key: key,
    }
    await refused(
      w.manager,
      "amenity_set_check_notes",
      stale,
      "amenity_conflict"
    )
    expect(commands(key)).toBe(0)
    await refused(
      w.manager,
      "amenity_set_check_notes",
      stale,
      "amenity_conflict"
    )
    expect(commands(key)).toBe(0)
    const n = revision(check)
    const done = await json<Keyed>(w.manager, "amenity_set_check_notes", {
      ...stale,
      p_revision: n,
    })
    expect(done).toEqual({ revision: n + 1, replayed: false })
    expect(commands(key)).toBe(1)
  })

  it("refuses staff without a grant, as the old signatures do", async () => {
    const v = await world("am-keys-staff", { extra: ["darts"] })
    const check = v.checks.darts!
    // The assignee can read the check, so the refusal is about managing it.
    await json(v.manager, "amenity_assign_check", {
      p_check_id: check,
      p_assignee_id: v.staffA.id,
      p_revision: revision(check),
    })
    await refused(
      v.staffA,
      "amenity_set_check_notes",
      {
        p_check_id: check,
        p_notes: "TEST staff",
        p_revision: revision(check),
      },
      "not_venue_manager"
    )
    const key = randomUUID()
    await refused(
      v.staffA,
      "amenity_set_check_notes",
      notesArgs(check, "TEST staff", key),
      "not_venue_manager"
    )
    await refused(
      v.staffA,
      "amenity_archive_check",
      {
        p_check_id: check,
        p_revision: revision(check),
        p_idempotency_key: randomUUID(),
      },
      "not_venue_manager"
    )
    await refused(
      v.staffA,
      "amenity_add_checks",
      { p_venue_id: v.venue, p_keys: ["arcade"], p_idempotency_key: key },
      "not_venue_manager"
    )
    expect(commands(key)).toBe(0)
  })
})

describe("the old signatures (R10)", () => {
  it("still return the new revision without a key", async () => {
    const v = await world("am-keys-old", { extra: ["darts"] })
    const check = v.checks.darts!
    const step = async (fn: string, args: object) => {
      const n = revision(check)
      const r = await json<number>(v.manager, fn, {
        p_check_id: check,
        p_revision: n,
        ...args,
      })
      expect(r).toBe(n + 1)
    }
    await step("amenity_assign_check", { p_assignee_id: v.staffA.id })
    await step("amenity_set_check_notes", { p_notes: "TEST old" })
    await step("amenity_archive_check", {})
    await step("amenity_restore_check", {})
    await yes(v.staffA, v, "guest_toilets")
    const toilets = v.checks.guest_toilets!
    const n = revision(toilets)
    expect(
      await json<number>(v.manager, "amenity_reopen_check", {
        p_check_id: toilets,
        p_revision: n,
        p_preset: "wrong_area",
        p_reason: null,
      })
    ).toBe(n + 1)
    const ids = await json<string[]>(v.manager, "amenity_add_checks", {
      p_venue_id: v.venue,
      p_keys: ["arcade", "darts"],
    })
    expect(ids).toHaveLength(2)
    expect(ids[1]).toBe(check)
    expect(
      count(
        `select count(*) from public.amenity_commands where venue_id = '${v.venue}'`
      )
    ).toBe(0)
  })
})

describe("a lost grant or account (R10)", () => {
  it("refuses a deactivated account, even on a replay", async () => {
    const v = await world("am-keys-off", { extra: ["darts"] })
    const check = v.checks.darts!
    const key = randomUUID()
    const args = notesArgs(check, "TEST before leaving", key)
    await json<Keyed>(v.staffManager, "amenity_set_check_notes", args)
    await deactivate(v.staffManager.id)
    await refused(
      v.staffManager,
      "amenity_set_check_notes",
      args,
      "not_active_user"
    )
    await refused(
      v.staffManager,
      "amenity_add_checks",
      { p_venue_id: v.venue, p_keys: ["arcade"], p_idempotency_key: key },
      "not_active_user"
    )
    expect(commands(key)).toBe(1)
  })

  it("serves an ended grant the stored result of its key, and refuses a new key as today", async () => {
    const v = await world("am-keys-grant", { extra: ["darts"] })
    const check = v.checks.darts!
    const key = randomUUID()
    const args = {
      p_check_id: check,
      p_assignee_id: v.staffA.id,
      p_revision: revision(check),
      p_idempotency_key: key,
    }
    const first = await json<Keyed>(v.manager, "amenity_assign_check", args)
    await json(v.admin, "revoke_venue_manager", {
      p_grant_id: await activeGrant(v.manager.id, v.venue),
      p_reason: "TEST revoke",
    })
    const before = events(check, "assigned")
    const n = revision(check)
    const again = await json<Keyed>(v.manager, "amenity_assign_check", args)
    expect(again).toEqual({ revision: first.revision, replayed: true })
    expect(events(check, "assigned")).toBe(before)
    expect(revision(check)).toBe(n)

    const today = await call(v.manager, "amenity_set_check_notes", {
      p_check_id: check,
      p_notes: "TEST after the grant",
      p_revision: n,
    })
    expect(today.error).not.toBeNull()
    const fresh = randomUUID()
    await refused(
      v.manager,
      "amenity_set_check_notes",
      notesArgs(check, "TEST after the grant", fresh),
      today.error!.message
    )
    await refused(
      v.manager,
      "amenity_add_checks",
      { p_venue_id: v.venue, p_keys: ["arcade"], p_idempotency_key: fresh },
      "not_venue_manager"
    )
    expect(commands(fresh)).toBe(0)
  })
})

describe("amenity_commands (R10)", () => {
  type Untyped = {
    from(table: string): {
      select(columns: string): PromiseLike<{
        data: unknown[] | null
        error: { message: string } | null
      }>
      insert(row: object): PromiseLike<{ error: { message: string } | null }>
    }
  }

  it("is closed to signed-in clients and append-only", async () => {
    const key = randomUUID()
    const check = w.checks.darts!
    await json<Keyed>(
      w.manager,
      "amenity_set_check_notes",
      notesArgs(check, "TEST closed table", key)
    )
    for (const who of [w.manager, w.admin, w.staffA]) {
      const client = who.client as unknown as Untyped
      const read = await client.from("amenity_commands").select("*")
      expect(read.error !== null || (read.data ?? []).length === 0).toBe(true)
      const write = await client.from("amenity_commands").insert({
        idempotency_key: randomUUID(),
        actor_id: who.id,
        command: "archive",
        request_hash: "0".repeat(64),
        venue_id: w.venue,
        check_id: check,
        result: { revision: 1, replayed: false },
      })
      expect(write.error).not.toBeNull()
    }
    for (const sql of [
      `update public.amenity_commands set result = '{}'::jsonb where idempotency_key = '${key}'`,
      `delete from public.amenity_commands where idempotency_key = '${key}'`,
    ]) {
      expect(() => psql(sql)).toThrow(/append|immutable|42501/i)
    }
    expect(commands(key)).toBe(1)
  })
})
