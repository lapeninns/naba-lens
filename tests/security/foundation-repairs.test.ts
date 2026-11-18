// S2-FIX: regression tests for the Sprint 1 foundation review findings owned
// by S2-FIX (docs/plans/full-app-v1/reviews/S1-foundation-review.md), fixed in
// supabase/migrations/20261118108000..108600. Each test reproduces the
// review's scenario and shows it is now refused or correct. Real signed-in
// identities through PostgREST; the service role and psql (as the owner) only
// build fixtures, hold a racing transaction open, and read state back.
//
// R27 (manager-era uploads) is covered by the OD-9 test in
// manager-uploads.test.ts, which now accepts the manager-era upload.
import { spawn } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import {
  assign,
  createRequirement,
  fails,
  insertAsset,
  legacyStaffGrant,
  makeManager,
  ok,
  psql,
  requestKey,
} from "./coverage-fixtures"
import {
  admin as sharedAdmin,
  call,
  json,
  londonToday,
  refused,
  sleep,
  world as knowledgeWorld,
} from "./knowledge-fixtures"
import {
  createDraft,
  item,
  menu,
  publishMenu,
  readDocument,
  section,
} from "./menus-fixtures"

const service = serviceClient()

type Rpc<T = unknown> = PromiseLike<{
  data: T | null
  error: { message: string; code: string; details?: string } | null
}>

let admin: TestIdentity

beforeAll(async () => {
  admin = await sharedAdmin()
})

const staffAt = (label: string, venueId: string) =>
  createIdentity(service, { label, role: "staff", venueId })

const venue = async (label: string) => (await createVenue(service, label)).id

const setRole = (
  profileId: string,
  venueId: string,
  role: "staff" | "manager",
  reason: string | null = "TEST role"
) =>
  call(admin, "admin_set_venue_membership", {
    p_profile_id: profileId,
    p_venue_id: venueId,
    p_role: role,
    p_reason: reason,
  }) as Rpc<string>

const switchTo = (who: TestIdentity, venueId: string) =>
  ok(call(who, "switch_active_venue", { p_venue_id: venueId }) as Rpc)

const openGrantVenues = (profileId: string) =>
  psql(
    `select coalesce(string_agg(venue_id::text, ',' order by venue_id), '')
     from public.venue_manager_grants where staff_id = '${profileId}' and revoked_at is null`
  )
    .split(",")
    .filter(Boolean)
    .sort()

const openMembership = (profileId: string, venueId: string) =>
  psql(
    `select coalesce((select role from public.venue_memberships
      where profile_id = '${profileId}' and venue_id = '${venueId}' and ended_at is null), 'none')`
  )

/**
 * Runs SQL in its own psql session as the owner inside one transaction, for
 * holding locks while another session acts. Resolves with the exit code and
 * output.
 */
function ownerSession(
  body: string
): Promise<{ code: number; out: string; err: string }> {
  const url = process.env.NABALENS_TEST_DB_URL!
  if (!/^postgresql:\/\/[^@]+@(127\.0\.0\.1|localhost):/.test(url ?? "")) {
    throw new Error("Run through `pnpm test:security <workdir>` (local DB).")
  }
  return new Promise((resolveRun) => {
    const child = spawn("psql", [url, "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
      stdio: ["pipe", "pipe", "pipe"],
    })
    let out = ""
    let err = ""
    child.stdout.on("data", (d) => (out += d))
    child.stderr.on("data", (d) => (err += d))
    child.on("close", (code) => resolveRun({ code: code ?? 1, out, err }))
    child.stdin.end(`begin;\n${body}\ncommit;\n`)
  })
}

/** Waits until the session tagged `marker` is inside its pg_sleep. */
async function waitForHold(marker: string) {
  for (let i = 0; i < 100; i += 1) {
    const n = psql(
      `select count(*) from pg_stat_activity
       where state = 'active' and query like '%pg_sleep%' and query like '%${marker}%'
         and pid <> pg_backend_pid()`
    )
    if (Number(n) > 0) return
    await sleep(50)
  }
  throw new Error("the holding session never reached its sleep")
}

// ---------------------------------------------------------------------------
// R5: legacy side effects act on the venues a change is about
// ---------------------------------------------------------------------------

describe("R5: account conversions and transfers leave other venues alone", () => {
  it("converting a person to manager at B keeps their manager grant and membership at A", async () => {
    const [a, b] = await Promise.all([venue("r5-a"), venue("r5-b")])
    const p = await staffAt("r5-p", a)
    await makeManager(admin, p, a)
    await ok(setRole(p.id, b, "staff"))
    await switchTo(p, b)
    expect(openGrantVenues(p.id)).toEqual([a])

    await makeManager(admin, p, b)
    expect(openGrantVenues(p.id)).toEqual([a, b].sort())
    expect(openMembership(p.id, a)).toBe("manager")
    expect(openMembership(p.id, b)).toBe("manager")

    // Back to staff at B: only B's grant goes; A is still managed.
    await ok(
      call(admin, "convert_manager_to_staff", {
        p_profile_id: p.id,
        p_venue_id: b,
        p_reason: "TEST back to staff at B",
        p_client_request_key: requestKey(),
      }) as Rpc
    )
    expect(openGrantVenues(p.id)).toEqual([a])
    expect(openMembership(p.id, a)).toBe("manager")
    expect(openMembership(p.id, b)).toBe("staff")
    // The audit names B's grant, not A's.
    const before = JSON.parse(
      psql(
        `select e.before::text from public.coverage_audit_events e
         where e.entity = 'account_role' and e.entity_id = '${p.id}'
           and e.action = 'converted_to_staff' order by e.id desc limit 1`
      )
    ) as { grantId: string | null }
    expect(
      psql(
        `select venue_id from public.venue_manager_grants where id = '${before.grantId}'`
      )
    ).toBe(b)
  })

  it("a legacy transfer away from A keeps work, grants and membership at B", async () => {
    const [a, b, c] = await Promise.all([
      venue("r5-xa"),
      venue("r5-xb"),
      venue("r5-xc"),
    ])
    const [q, mgrB] = await Promise.all([
      staffAt("r5-q", a),
      staffAt("r5-mb", b),
    ])
    // Legacy coverage requirements are written by a staff-held grant.
    await legacyStaffGrant(service, admin, mgrB.id, b)
    await ok(setRole(q.id, b, "staff"))
    await switchTo(q, b)
    const requirement = await createRequirement(mgrB, b)
    await assign(mgrB, requirement, [q.id])
    await switchTo(q, a)

    await ok(service.from("profiles").update({ venue_id: c }).eq("id", q.id))

    expect(
      psql(
        `select count(*) from public.coverage_requirement_assignees
         where staff_id = '${q.id}' and requirement_id = '${requirement}' and ended_at is null`
      )
    ).toBe("1")
    expect(openMembership(q.id, a)).toBe("none")
    expect(openMembership(q.id, b)).toBe("staff")
    expect(openMembership(q.id, c)).toBe("staff")
  })

  it("deactivation still ends work and grants at every venue", async () => {
    const [a, b] = await Promise.all([venue("r5-da"), venue("r5-db")])
    const p = await staffAt("r5-d", a)
    await makeManager(admin, p, a)
    await ok(setRole(p.id, b, "manager", "TEST second venue"))
    expect(openGrantVenues(p.id)).toEqual([a, b].sort())
    await ok(service.from("profiles").update({ active: false }).eq("id", p.id))
    expect(openGrantVenues(p.id)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// R6: a removal deactivates only when no membership remains
// ---------------------------------------------------------------------------

describe("R6: removal with a membership at an inactive venue", () => {
  async function setup(label: string) {
    const [a, c] = await Promise.all([venue(`${label}-a`), venue(`${label}-c`)])
    const [x, mgrA] = await Promise.all([
      staffAt(`${label}-x`, a),
      staffAt(`${label}-m`, a),
    ])
    await makeManager(admin, mgrA, a)
    await ok(setRole(x.id, c, "staff"))
    return { a, c, x, mgrA }
  }
  const close = (venueId: string) =>
    ok(service.from("venues").update({ active: false }).eq("id", venueId))
  const remove = (who: TestIdentity, profileId: string, venueId: string) =>
    call(who, "remove_venue_member", {
      p_profile_id: profileId,
      p_venue_id: venueId,
      p_reason: "TEST left",
      p_replacement_id: null,
    }) as Rpc<{ outcome: string; active_venue_id: string | null }[]>
  const active = (id: string) =>
    psql(`select active::text from public.profiles where id = '${id}'`)

  it("never lets a manager deactivate the account or end the closed venue's membership", async () => {
    const { a, c, x, mgrA } = await setup("r6")
    await close(c)
    await fails(remove(mgrA, x.id, a), "needs_admin")
    expect(active(x.id)).toBe("true")
    expect(openMembership(x.id, a)).toBe("staff")
    expect(openMembership(x.id, c)).toBe("staff")
  })

  it("removes only that membership when the venue is not the active one", async () => {
    const { a, c, x, mgrA } = await setup("r6-away")
    await switchTo(x, c)
    await close(c)
    const [row] = await ok(remove(mgrA, x.id, a))
    expect(row).toMatchObject({ outcome: "removed", active_venue_id: c })
    expect(active(x.id)).toBe("true")
    expect(openMembership(x.id, a)).toBe("none")
    expect(openMembership(x.id, c)).toBe("staff")
  })

  it("moves the person to a remaining open venue and keeps the account", async () => {
    const { a, c, x, mgrA } = await setup("r6-open")
    const [row] = await ok(remove(mgrA, x.id, a))
    expect(row).toMatchObject({ outcome: "removed", active_venue_id: c })
    expect(active(x.id)).toBe("true")
  })

  it("still deactivates when the last membership goes", async () => {
    const a = await venue("r6-only")
    const [x, mgrA] = await Promise.all([
      staffAt("r6-y", a),
      staffAt("r6-mb", a),
    ])
    await makeManager(admin, mgrA, a)
    const [row] = await ok(remove(mgrA, x.id, a))
    expect(row!.outcome).toBe("deactivated")
    expect(active(x.id)).toBe("false")
  })
})

// ---------------------------------------------------------------------------
// R7/R25, R26: activity log
// ---------------------------------------------------------------------------

const activityCount = (objectId: string, action: string, venueId?: string) =>
  Number(
    psql(
      `select count(*) from public.activity_events
       where object_id = '${objectId}' and action = '${action}'
         ${venueId ? `and venue_id = '${venueId}'` : ""}`
    )
  )

describe("R7/R25: a self-service venue switch is not an account change", () => {
  it("logs no role or venue change when a person switches between their venues", async () => {
    const [a, b] = await Promise.all([venue("r7-a"), venue("r7-b")])
    const d = await staffAt("r7-d", a)
    await ok(setRole(d.id, b, "manager", "TEST manager at B"))
    const roles = activityCount(d.id, "account_role_changed")
    const venues = activityCount(d.id, "account_venue_changed")

    await switchTo(d, b)
    await switchTo(d, a)
    expect(activityCount(d.id, "account_role_changed")).toBe(roles)
    expect(activityCount(d.id, "account_venue_changed")).toBe(venues)

    // An admin's role change at the active venue is still logged.
    await ok(setRole(d.id, a, "manager", "TEST manager at A"))
    expect(activityCount(d.id, "account_role_changed")).toBe(roles + 1)
  })
})

describe("R26: membership grants and removals reach Activity", () => {
  it("logs a membership added and ended at a venue that is not the person's active venue", async () => {
    const [a, b] = await Promise.all([venue("r26-a"), venue("r26-b")])
    const [e, mgrB] = await Promise.all([
      staffAt("r26-e", a),
      staffAt("r26-mb", b),
    ])
    await makeManager(admin, mgrB, b)
    await ok(setRole(e.id, b, "staff", "TEST covers at B"))
    expect(activityCount(e.id, "membership_added", b)).toBe(1)

    await ok(
      call(mgrB, "remove_venue_member", {
        p_profile_id: e.id,
        p_venue_id: b,
        p_reason: "TEST no longer at B",
        p_replacement_id: null,
      }) as Rpc
    )
    expect(activityCount(e.id, "membership_ended", b)).toBe(1)

    const page = await json<{
      items: { action: string; objectId: string; venueId: string }[]
    }>(admin, "admin_activity", { p_venue_id: b, p_source: "activity" })
    expect(
      page.items
        .filter((i) => i.objectId === e.id)
        .map((i) => i.action)
        .sort()
    ).toEqual(["membership_added", "membership_ended"])
  })
})

// ---------------------------------------------------------------------------
// R24: ops finds a venue's managers per venue
// ---------------------------------------------------------------------------

describe("R24: a manager of two venues is a manager of both for monitoring", () => {
  it("counts the person at the venue that is not their active one", async () => {
    const [a, b] = await Promise.all([venue("r24-a"), venue("r24-b")])
    const m = await staffAt("r24-m", a)
    await makeManager(admin, m, a)
    await ok(setRole(m.id, b, "manager", "TEST second venue"))
    for (const v of [a, b]) {
      expect(
        psql(
          `select count(*) from private.ops_venue_managers('${v}') x where x = '${m.id}'`
        )
      ).toBe("1")
    }
    // Staff elsewhere is not a manager there.
    const s = await staffAt("r24-s", b)
    expect(
      psql(
        `select count(*) from private.ops_venue_managers('${b}') x where x = '${s.id}'`
      )
    ).toBe("0")
  })
})

// ---------------------------------------------------------------------------
// R8: concurrent finalise of identical bytes
// ---------------------------------------------------------------------------

describe("R8: two finalises of the same bytes at one venue", () => {
  it("links the second as a duplicate even while the first is uncommitted", async () => {
    const v = await venue("r8")
    const up = await staffAt("r8-s", v)
    const [first, second] = await Promise.all([
      insertAsset(service, { uploader: up.id, venue: v, ready: false }),
      insertAsset(service, { uploader: up.id, venue: v, ready: false }),
    ])
    await ok(
      service
        .from("media_assets")
        .update({ upload_state: "processing" })
        .in("id", [first.id, second.id])
    )
    const hash = createHash("sha256").update(randomUUID()).digest("hex")
    const marker = `r8_${randomUUID().replaceAll("-", "")}`

    const holding = ownerSession(
      `select became_ready from public.complete_media_finalise(
         '${first.id}', 'image/jpeg', 4, null, null, null, null, null, '${hash}', null);
       select pg_sleep(1.5) /* ${marker} */;`
    )
    await waitForHold(marker)
    const result = await service.rpc("complete_media_finalise", {
      p_asset_id: second.id,
      p_validated_mime_type: "image/jpeg",
      p_size_bytes: 4,
      p_content_sha256: hash,
    })
    const held = await holding
    expect(held.err).toBe("")
    expect(result.error).toBeNull()

    const dup = (id: string) =>
      psql(
        `select coalesce(duplicate_of_asset_id::text, 'null') from public.media_assets where id = '${id}'`
      )
    expect(dup(first.id)).toBe("null")
    expect(dup(second.id)).toBe(first.id)
  })
})

// ---------------------------------------------------------------------------
// R28: withdrawal racing an acceptance
// ---------------------------------------------------------------------------

describe("R28: a withdrawal waiting on an acceptance", () => {
  it("is refused once the acceptance commits, and the original is kept", async () => {
    const v = await venue("r28")
    const [up, mgr] = await Promise.all([
      staffAt("r28-s", v),
      staffAt("r28-m", v),
    ])
    await makeManager(admin, mgr, v)
    const asset = (await insertAsset(service, { uploader: up.id, venue: v })).id
    const marker = `r28_${randomUUID().replaceAll("-", "")}`

    // Every acceptance path locks the asset row first, then records.
    const holding = ownerSession(
      `select 1 from public.media_assets where id = '${asset}' for update;
       with s as (
         insert into public.knowledge_subjects (venue_id, kind, label, created_by)
         values ('${v}', 'area', 'TEST R28 place', '${mgr.id}') returning id, venue_id, label
       ), l as (
         insert into public.media_area_labels (asset_id, venue_id, subject_id, subject_kind, subject_label, added_by)
         select '${asset}', s.venue_id, s.id, 'area', s.label, '${mgr.id}' from s
         returning id, venue_id, asset_id
       )
       insert into public.area_photo_decisions (label_id, venue_id, asset_id, action, decided_by)
       select l.id, l.venue_id, l.asset_id, 'accepted', '${mgr.id}' from l;
       select pg_sleep(1.5) /* ${marker} */;`
    )
    await waitForHold(marker)
    const withdrawn = await call(up, "delete_media_asset", {
      p_asset_id: asset,
    })
    const held = await holding
    expect(held.err).toBe("")
    expect(withdrawn.error?.message).toBe("media_asset_retained")
    expect(
      psql(
        `select (deleted_at is null)::text from public.media_assets where id = '${asset}'`
      )
    ).toBe("true")
  })

  it("still lets the uploader withdraw an unreviewed upload", async () => {
    const v = await venue("r28-free")
    const up = await staffAt("r28-free-s", v)
    const asset = (await insertAsset(service, { uploader: up.id, venue: v })).id
    await ok(call(up, "delete_media_asset", { p_asset_id: asset }) as Rpc)
    expect(
      psql(
        `select (deleted_at is not null)::text from public.media_assets where id = '${asset}'`
      )
    ).toBe("true")
  })
})

// ---------------------------------------------------------------------------
// R12: core amenity checks on the older archive paths
// ---------------------------------------------------------------------------

describe("R12: core checks are admin-only on every archive path", () => {
  it("refuses a manager archiving a core check through the old RPCs", async () => {
    const k = await knowledgeWorld("r12-amen", { extra: ["pool_table"] })
    const core = k.checks["step_free_entrance"]!
    const revision = () =>
      Number(
        psql(
          `select revision from public.venue_amenity_checks where id = '${core}'`
        )
      )

    for (const who of [k.manager, k.staffManager]) {
      await refused(
        who,
        "amenity_archive_check",
        {
          p_check_id: core,
          p_revision: revision(),
          p_idempotency_key: randomUUID(),
        },
        "core_check_admin_only"
      )
      await refused(
        who,
        "amenity_archive_check",
        { p_check_id: core, p_revision: revision() },
        "core_check_admin_only"
      )
    }
    expect(
      psql(
        `select status from public.venue_amenity_checks where id = '${core}'`
      )
    ).toBe("active")

    // A manager's own non-core check archives as before; an admin may
    // archive a core one.
    const extra = k.checks["pool_table"]!
    await json(k.manager, "amenity_archive_check", {
      p_check_id: extra,
      p_revision: Number(
        psql(
          `select revision from public.venue_amenity_checks where id = '${extra}'`
        )
      ),
      p_idempotency_key: randomUUID(),
    })
    await json(k.admin, "amenity_archive_check", {
      p_check_id: core,
      p_revision: revision(),
      p_idempotency_key: randomUUID(),
    })
    expect(
      psql(
        `select status from public.venue_amenity_checks where id = '${core}'`
      )
    ).toBe("archived")
  })
})

// ---------------------------------------------------------------------------
// R13: clarification round trip
// ---------------------------------------------------------------------------

describe("R13: a request sent back for clarification", () => {
  let v: string
  let mgr: TestIdentity
  let staff: TestIdentity
  let otherMgr: TestIdentity

  beforeAll(async () => {
    const [venueA, venueB] = await Promise.all([venue("r13-a"), venue("r13-b")])
    v = venueA
    ;[mgr, staff, otherMgr] = await Promise.all([
      staffAt("r13-m", venueA),
      staffAt("r13-s", venueA),
      staffAt("r13-o", venueB),
    ])
    await Promise.all([
      makeManager(admin, mgr, venueA),
      makeManager(admin, otherMgr, venueB),
    ])
  })

  const create = async () =>
    json<{ requestId: string; revision: number }>(
      mgr,
      "menu_change_request_create",
      {
        p_venue_id: v,
        p_item_id: null,
        p_kind: "other",
        p_detail: "TEST add a vegan curry",
      }
    )

  const decide = (id: string, decision: string, revision: number) =>
    call(admin, "menu_change_request_decide", {
      p_request_id: id,
      p_decision: decision,
      p_reason: decision === "accepted" ? null : "TEST which curry?",
      p_revision: revision,
    }) as Rpc<{ status: string; revision: number }>

  const clarify = (who: TestIdentity, id: string, revision: number) =>
    call(who, "menu_change_request_clarify", {
      p_request_id: id,
      p_reply: "TEST the chickpea one",
      p_revision: revision,
    }) as Rpc<{ status: string; revision: number }>

  it("can be answered by the requester and then decided", async () => {
    const r = await create()
    await fails(clarify(mgr, r.requestId, 1), "menu_change_request_not_waiting")
    const asked = await ok(
      decide(r.requestId, "clarification_requested", r.revision)
    )
    expect(asked!.status).toBe("clarification_requested")

    for (const who of [staff, otherMgr]) {
      const { error } = await clarify(who, r.requestId, asked!.revision)
      expect(error).not.toBeNull()
    }
    const reopened = await ok(clarify(mgr, r.requestId, asked!.revision))
    expect(reopened).toMatchObject({ status: "open" })
    expect(
      psql(
        `select detail from public.menu_change_requests where id = '${r.requestId}'`
      )
    ).toContain("TEST the chickpea one")

    const accepted = await ok(
      decide(r.requestId, "accepted", reopened!.revision)
    )
    expect(accepted!.status).toBe("accepted")
  })

  it("can be decided by an admin without waiting for a reply", async () => {
    const r = await create()
    const asked = await ok(
      decide(r.requestId, "clarification_requested", r.revision)
    )
    const declined = await ok(decide(r.requestId, "declined", asked!.revision))
    expect(declined!.status).toBe("declined")
    await fails(
      decide(r.requestId, "accepted", declined!.revision),
      "menu_change_request_not_open"
    )
  })
})

// ---------------------------------------------------------------------------
// R14, R15: menu retirements
// ---------------------------------------------------------------------------

const V1 = () =>
  menu("TEST r14 v1", [
    section("mains", "Mains", [
      item("mains--korma", "Korma"),
      item("mains--dal", "Dal"),
      item("mains--bhaji", "Bhaji"),
    ]),
  ])

async function menuRevision(id: string) {
  return Number(
    psql(`select revision from public.menu_versions where id = '${id}'`)
  )
}

describe("R14: a schedule lapses when the set of retirements changes", () => {
  it("does not retire an item nobody confirmed, even with the same count", async () => {
    const v = await venue("r14")
    const active = await publishMenu(admin, v, V1())
    const { byKey } = await readDocument(service, active)
    const korma = byKey["mains--korma"]!.itemId
    const bhaji = byKey["mains--bhaji"]!.itemId

    // D keeps Korma: retires Dal and Bhaji (2, confirmed).
    const d = await createDraft(
      admin,
      v,
      menu("TEST r14 D", [
        section("mains", "Mains", [
          item("mains--korma", "Korma", { itemId: korma }),
          item("mains--naan", "Naan"),
        ]),
      ]),
      active
    )
    await ok(
      call(admin, "schedule_menu_version", {
        p_version_id: d,
        p_expected_revision: await menuRevision(d),
        p_at: new Date(Date.now() + 30 * 60_000).toISOString(),
        p_retirements: 2,
      }) as Rpc
    )

    // E becomes active first: Korma, Bhaji and a new Wrap (Dal retires).
    const e = await createDraft(
      admin,
      v,
      menu("TEST r14 E", [
        section("mains", "Mains", [
          item("mains--korma", "Korma", { itemId: korma }),
          item("mains--bhaji", "Bhaji", { itemId: bhaji }),
          item("mains--wrap", "Wrap"),
        ]),
      ]),
      active
    )
    await ok(
      call(admin, "activate_menu_version_confirmed", {
        p_version_id: e,
        p_expected_revision: await menuRevision(e),
        p_retirements: 1,
      }) as Rpc
    )

    // D would now retire Bhaji and Wrap: still two, but not the two approved.
    psql(
      `update public.menu_versions set scheduled_for = now() - interval '1 minute' where id = '${d}'`
    )
    expect(
      await json<number>(admin, "menu_activate_due", { p_venue_id: v })
    ).toBe(0)
    expect(
      psql(`select status from public.menu_versions where id = '${d}'`)
    ).toBe("draft")
    expect(
      psql(
        `select detail ->> 'reason' from public.menu_events
         where version_id = '${d}' and action = 'schedule_lapsed' order by id desc limit 1`
      )
    ).toBe("retirements_changed")
    expect(
      psql(
        `select coalesce(scheduled_retired_items::text, 'null') from public.menu_versions where id = '${d}'`
      )
    ).toBe("null")
  })

  it("promotes a schedule whose confirmed set is unchanged", async () => {
    const v = await venue("r14-ok")
    const active = await publishMenu(admin, v, V1())
    const { byKey } = await readDocument(service, active)
    const d = await createDraft(
      admin,
      v,
      menu("TEST r14 D2", [
        section("mains", "Mains", [
          item("mains--korma", "Korma", {
            itemId: byKey["mains--korma"]!.itemId,
          }),
        ]),
      ]),
      active
    )
    await ok(
      call(admin, "schedule_menu_version", {
        p_version_id: d,
        p_expected_revision: await menuRevision(d),
        p_at: new Date(Date.now() + 30 * 60_000).toISOString(),
        p_retirements: 2,
      }) as Rpc
    )
    psql(
      `update public.menu_versions set scheduled_for = now() - interval '1 minute' where id = '${d}'`
    )
    expect(
      await json<number>(admin, "menu_activate_due", { p_venue_id: v })
    ).toBe(1)
    expect(
      psql(`select status from public.menu_versions where id = '${d}'`)
    ).toBe("active")
  })
})

describe("R15: the legacy activation asks for the retirement confirmation", () => {
  it("refuses a draft that retires items and allows one that retires none", async () => {
    const v = await venue("r15")
    const active = await publishMenu(admin, v, V1())
    const { byKey } = await readDocument(service, active)
    const carry = (key: string, name: string) =>
      item(key, name, { itemId: byKey[key]!.itemId })

    const drops = await createDraft(
      admin,
      v,
      menu("TEST r15 drops", [
        section("mains", "Mains", [carry("mains--korma", "Korma")]),
      ]),
      active
    )
    await fails(
      call(admin, "activate_menu_version", {
        p_version_id: drops,
        p_expected_revision: await menuRevision(drops),
      }) as Rpc,
      "menu_retirements_unconfirmed"
    )
    expect(
      psql(`select status from public.menu_versions where id = '${drops}'`)
    ).toBe("draft")

    const keeps = await createDraft(
      admin,
      v,
      menu("TEST r15 keeps", [
        section("mains", "Mains", [
          carry("mains--korma", "Korma"),
          carry("mains--dal", "Dal"),
          carry("mains--bhaji", "Bhaji"),
          item("mains--naan", "Naan"),
        ]),
      ]),
      active
    )
    await ok(
      call(admin, "activate_menu_version", {
        p_version_id: keeps,
        p_expected_revision: await menuRevision(keeps),
      }) as Rpc
    )
    expect(
      psql(`select status from public.menu_versions where id = '${keeps}'`)
    ).toBe("active")
    // Still admin-only.
    const s = await staffAt("r15-s", v)
    const { error } = await call(s, "activate_menu_version", {
      p_version_id: drops,
      p_expected_revision: await menuRevision(drops),
    })
    expect(error).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// R19: "Still right" cannot predate a reported change
// ---------------------------------------------------------------------------

const shiftDays = (day: string, days: number) => {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

describe("R19: a backdated reconfirmation after a reported change", () => {
  it("is refused, and a check made after the report clears it", async () => {
    const w = await knowledgeWorld("r19")
    const patio = psql(
      `insert into public.knowledge_subjects (venue_id, kind, label, created_by)
       values ('${w.venue}', 'area', 'Patio', '${w.admin.id}') returning id`
    )
    const asset = (
      await insertAsset(service, { uploader: w.staffA.id, venue: w.venue })
    ).id
    const label = psql(
      `insert into public.media_area_labels (asset_id, venue_id, subject_id, subject_kind, subject_label, added_by)
       values ('${asset}', '${w.venue}', '${patio}', 'area', 'Patio', '${w.staffA.id}') returning id`
    )
    psql(
      `insert into public.area_photo_decisions (label_id, venue_id, asset_id, action, decided_by, decided_at)
       values ('${label}', '${w.venue}', '${asset}', 'accepted', '${w.admin.id}', now() - interval '20 days')`
    )
    await json(w.staffA, "area_photo_report_change", {
      p_subject_id: patio,
      p_reason: "TEST closed for works",
    })
    const state = () =>
      (
        JSON.parse(psql(`select private.area_photo_freshness('${label}')`)) as {
          state: string
        }
      ).state
    expect(state()).toBe("check_due")

    const error = await refused(
      w.manager,
      "area_photo_reconfirm",
      { p_subject_id: patio, p_checked_on: shiftDays(londonToday(), -5) },
      "invalid_value"
    )
    expect(error.details).toContain("before_reported_change")
    expect(state()).toBe("check_due")

    await json(w.manager, "area_photo_reconfirm", {
      p_subject_id: patio,
      p_checked_on: londonToday(),
    })
    expect(state()).toBe("current")
  })
})

// ---------------------------------------------------------------------------
// R23: export candidates evaluate the venue's candidates once
// ---------------------------------------------------------------------------

describe("R23: export_candidates with a published record", () => {
  it("works out the publication states once, not once per candidate", async () => {
    const w = await knowledgeWorld("r23")
    const place = psql(
      `insert into public.knowledge_subjects (venue_id, kind, label, created_by)
       values ('${w.venue}', 'area', 'Bar', '${w.admin.id}') returning id`
    )
    const assets: string[] = []
    for (let i = 0; i < 4; i += 1) {
      const asset = (
        await insertAsset(service, { uploader: w.staffA.id, venue: w.venue })
      ).id
      const label = psql(
        `insert into public.media_area_labels (asset_id, venue_id, subject_id, subject_kind, subject_label, added_by)
         values ('${asset}', '${w.venue}', '${place}', 'area', 'Bar', '${w.staffA.id}') returning id`
      )
      psql(
        `insert into public.area_photo_decisions (label_id, venue_id, asset_id, action, decided_by)
         values ('${label}', '${w.venue}', '${asset}', 'accepted', '${w.admin.id}')`
      )
      assets.push(asset)
    }
    const site = (
      await json<{ id: string }>(admin, "publication_destination_save", {
        p_destination_id: null,
        p_venue_id: w.venue,
        p_label: `TEST r23 ${randomUUID().slice(0, 6)}`,
        p_url: null,
        p_active: true,
      })
    ).id
    await json(admin, "publication_record", {
      p_request_key: requestKey(),
      p_destination_id: site,
      p_asset_id: assets[0],
      p_action: "published",
      p_occurred_on: new Date().toISOString().slice(0, 10),
      p_external_ref: "TEST-R23",
    })

    // Same states as before: the published one is confirmed, the rest not
    // selected.
    const read = await json<{
      items: { assetId: string; publication: { state: string } }[]
    }>(w.manager, "export_candidates", { p_venue_id: w.venue })
    const states = Object.fromEntries(
      read.items
        .filter((i) => assets.includes(i.assetId))
        .map((i) => [i.assetId, i.publication.state])
    )
    expect(states).toEqual({
      [assets[0]!]: "published_confirmed",
      [assets[1]!]: "not_selected",
      [assets[2]!]: "not_selected",
      [assets[3]!]: "not_selected",
    })
    expect(
      JSON.parse(
        psql(`select private.publication_asset_state('${assets[0]}')::text`)
      )
    ).toMatchObject({ state: "published_confirmed" })

    // The venue's candidate rule runs once for the list and once for the
    // publication pairs, however many candidates there are.
    const claims = JSON.stringify({ sub: w.manager.id, role: "authenticated" })
    const counted = await ownerSession(
      `set local track_functions = 'all';
       set local role authenticated;
       select set_config('request.jwt.claims', '${claims}', true) is not null;
       select jsonb_array_length(public.export_candidates('${w.venue}', 'public') -> 'items');
       reset role;
       select coalesce((select calls from pg_stat_xact_user_functions
         where schemaname = 'private' and funcname = 'export_candidate_rows'), 0);`
    )
    expect(counted.err).toBe("")
    const [, items, calls] = counted.out.trim().split("\n").map(Number)
    expect(items).toBeGreaterThanOrEqual(4)
    expect(calls).toBeLessThanOrEqual(2)
  })
})
