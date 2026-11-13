// B02-b contribution groups (docs/knowledge/b02-design.md W1, OD-7). Real
// signed-in identities through PostgREST; the service role and psql only
// build fixtures and read state back. Groups add no state, visibility or
// credit: every member read goes through the viewer's existing asset gates.
import { randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import { createIdentity, markReady } from "../support/identities"
import {
  assign,
  createRequirement,
  insertAsset,
  legacyStaffGrant,
  ok,
  psql,
  requirementProgress,
  submit as submitCoverage,
} from "./coverage-fixtures"
import {
  call,
  count,
  json,
  photo,
  refused,
  service,
  world,
  type World,
} from "./knowledge-fixtures"
import {
  item,
  menu,
  publishMenu,
  readDocument,
  section,
} from "./menus-fixtures"

type GroupView = {
  groupId: string
  venueId: string
  mine: boolean
  subject: { kind: string; id: string | null; name: string | null }
  members: {
    assetId: string
    position: number
    uploadState: string
    mine: boolean
    /** B05-m5, privileged viewers only. */
    technical?: string
  }[]
}

const key = () => `TEST-${randomUUID()}`

const start = (
  who: World["staffA"],
  k: string,
  kind: string,
  id: string | null = null
) =>
  json<string>(who, "contribution_group_start", {
    p_key: k,
    p_subject_kind: kind,
    p_subject_id: id,
  })

const add = (who: World["staffA"], group: string, assets: string[]) =>
  json<number>(who, "contribution_group_add", {
    p_group_id: group,
    p_asset_ids: assets,
  })

const view = (who: World["staffA"], group: string) =>
  json<GroupView>(who, "contribution_group", { p_group_id: group })

/** A ready amenity-evidence upload (never in Photos). */
async function amenityAsset(uploader: string, venue: string) {
  const id = randomUUID()
  await ok(
    service.from("media_assets").insert({
      id,
      uploader_id: uploader,
      venue_id: venue,
      original_path: `${uploader}/${id}/original.jpg`,
      original_filename: "TEST amenity.jpg",
      media_type: "image",
      size_bytes: 4,
      client_upload_key: randomUUID(),
      purpose: "amenity",
    })
  )
  await markReady(service, id, "image/jpeg")
  return id
}

/** The ids `who` may see through today's community Photos gate. */
async function communityVisible(who: World["staffA"], ids: string[]) {
  const rows = await json<{ id: string }[]>(who, "community_readable_assets", {
    p_asset_ids: ids,
  })
  return new Set(rows.map((r) => r.id))
}

/** The task ids `who` may read through the coverage_requirements policy. */
async function readableTasks(who: World["staffA"], ids: string[]) {
  const { data, error } = await who.client
    .from("coverage_requirements")
    .select("id")
    .in("id", ids)
  expect(error).toBeNull()
  return (data ?? []).map((r) => r.id).sort()
}

const scope = async (who: World["staffA"]) =>
  (
    await json<{ role: string; manager_venue_id: string | null }[]>(
      who,
      "coverage_access_scope"
    )
  )[0]!

const noSubject = { kind: "none", id: null, name: null }

describe("contribution groups (W1)", () => {
  let w: World
  let other: World

  beforeAll(async () => {
    w = await world("kn-b02-groups", { extra: ["darts"] })
    other = await world("kn-b02-groups-other")
  })

  it("starts idempotently by key and checks the subject at the caller's venue", async () => {
    const k = key()
    const g = await start(w.staffA, k, "none")
    expect(await start(w.staffA, k, "none")).toBe(g)
    await refused(
      w.staffA,
      "contribution_group_start",
      {
        p_key: k,
        p_subject_kind: "question",
        p_subject_id: w.checks.guest_toilets,
      },
      "idempotency_key_reused"
    )
    // The same key from another person is their own group.
    expect(await start(w.staffB, k, "none")).not.toBe(g)

    // A working-list question, a task and a menu item at the venue.
    const q = await start(w.staffA, key(), "question", w.checks.guest_toilets!)
    expect((await view(w.staffA, q)).subject).toMatchObject({
      kind: "question",
      id: w.checks.guest_toilets,
      name: expect.any(String),
    })
    const task = await createRequirement(w.staffManager, w.venue, {
      title: "TEST group task",
    })
    const t = await start(w.staffA, key(), "task", task)
    expect((await view(w.staffA, t)).subject).toMatchObject({
      kind: "task",
      name: "TEST group task",
    })
    const version = await publishMenu(
      w.admin,
      w.venue,
      menu("TEST group menu", [
        section("mains", "Mains", [item("mains--korma", "Korma")]),
      ])
    )
    const korma = (await readDocument(service, version)).byKey["mains--korma"]!
    const m = await start(w.staffA, key(), "menu_item", korma.itemId)
    expect((await view(w.staffA, m)).subject).toMatchObject({
      kind: "menu_item",
      name: "Korma",
    })

    // Unknown, off-list and other-venue subjects.
    for (const [kind, id] of [
      ["question", randomUUID()],
      ["question", w.checks.darts!],
      ["question", other.checks.guest_toilets!],
      ["task", randomUUID()],
      ["menu_item", randomUUID()],
    ] as const)
      await refused(
        w.staffA,
        "contribution_group_start",
        { p_key: key(), p_subject_kind: kind, p_subject_id: id },
        "contribution_subject_not_found",
        "P0002"
      )
    await refused(
      w.staffA,
      "contribution_group_start",
      { p_key: "short", p_subject_kind: "none", p_subject_id: null },
      "invalid_group_key",
      "22023"
    )
  })

  it("lets accounts that upload start a group: staff, and a manager account at its venue (B02-c)", async () => {
    await refused(
      w.admin,
      "contribution_group_start",
      { p_key: key(), p_subject_kind: "none", p_subject_id: null },
      "not_active_staff",
      "42501"
    )
    const g = await start(w.manager, key(), "question", w.checks.guest_toilets!)
    expect((await view(w.manager, g)).venueId).toBe(w.venue)
    // Its venue's subjects only.
    await refused(
      w.manager,
      "contribution_group_start",
      {
        p_key: key(),
        p_subject_kind: "question",
        p_subject_id: other.checks.guest_toilets,
      },
      "contribution_subject_not_found",
      "P0002"
    )
  })

  it("adds the creator's own assets idempotently, one group per asset, at most 10", async () => {
    const g = await start(w.staffA, key(), "none")
    const [a1, a2] = [
      await photo(w.staffA.id, w.venue),
      await photo(w.staffA.id, w.venue),
    ]
    expect(await add(w.staffA, g, [a1, a2])).toBe(2)
    expect(await add(w.staffA, g, [a2, a1])).toBe(2)
    expect(
      (await view(w.staffA, g)).members.map((m) => [m.assetId, m.position])
    ).toEqual([
      [a1, 1],
      [a2, 2],
    ])

    // Another person's, another venue's and a deleted asset.
    const theirs = await photo(w.staffB.id, w.venue)
    const elsewhere = await photo(other.staffA.id, other.venue)
    const gone = await photo(w.staffA.id, w.venue)
    await ok(call(w.staffA, "delete_media_asset", { p_asset_id: gone }))
    for (const [asset, reason] of [
      [theirs, "not_own"],
      [elsewhere, "not_found"],
      [gone, "deleted"],
    ] as const) {
      const e = await refused(
        w.staffA,
        "contribution_group_add",
        { p_group_id: g, p_asset_ids: [asset] },
        "evidence_not_eligible"
      )
      expect(JSON.parse(e.details!)).toMatchObject({ assetId: asset, reason })
    }

    // Only the creator adds.
    await refused(
      w.staffB,
      "contribution_group_add",
      { p_group_id: g, p_asset_ids: [theirs] },
      "contribution_group_not_found",
      "P0002"
    )
    // One group per asset (OD-7).
    const second = await start(w.staffA, key(), "none")
    await refused(
      w.staffA,
      "contribution_group_add",
      { p_group_id: second, p_asset_ids: [a1] },
      "asset_in_other_group"
    )
    // At most 10 members; a refused add records nothing.
    const eight = await Promise.all(
      Array.from({ length: 8 }, () => photo(w.staffA.id, w.venue))
    )
    expect(await add(w.staffA, g, eight)).toBe(10)
    const extra = await photo(w.staffA.id, w.venue)
    await refused(
      w.staffA,
      "contribution_group_add",
      { p_group_id: g, p_asset_ids: [extra] },
      "contribution_group_full"
    )
    expect(
      count(
        `select count(*) from public.media_contribution_group_members where group_id = '${g}'`
      )
    ).toBe(10)
  })

  it("never widens visibility: each viewer sees only the members today's gates show", async () => {
    const general = await photo(w.staffA.id, w.venue)
    const evidence = await amenityAsset(w.staffA.id, w.venue)
    const before = await communityVisible(w.staffB, [general, evidence])
    expect(before.has(evidence)).toBe(false)

    const g = await start(w.staffA, key(), "none")
    await add(w.staffA, g, [general, evidence])

    // The creator sees both (own uploads).
    expect(
      (await view(w.staffA, g)).members.map((m) => m.assetId).sort()
    ).toEqual([general, evidence].sort())
    // A colleague sees the general photo, as community Photos already
    // shows it, and never the amenity evidence; grouping changed neither.
    expect([...before]).toEqual([general])
    expect([
      ...(await communityVisible(w.staffB, [general, evidence])),
    ]).toEqual([general])
    const colleague = await view(w.staffB, g)
    expect(colleague.members.map((m) => m.assetId)).toEqual([general])
    expect(colleague.mine).toBe(false)
    const lookup = await json<{ asset_id: string; group_id: string }[]>(
      w.staffB,
      "contribution_groups_for_assets",
      { p_asset_ids: [general, evidence] }
    )
    expect(lookup).toEqual([{ asset_id: general, group_id: g }])

    // Another venue's staff see what organisation Photos already shows them:
    // the eligible general staff photo, never the amenity evidence.
    expect([
      ...(await communityVisible(other.staffA, [general, evidence])),
    ]).toEqual([general])
    const elsewhere = await view(other.staffA, g)
    expect(elsewhere.members.map((m) => m.assetId)).toEqual([general])
    expect(elsewhere.mine).toBe(false)
    expect(
      await json(other.staffA, "contribution_groups_for_assets", {
        p_asset_ids: [general, evidence],
      })
    ).toEqual([{ asset_id: general, group_id: g }])

    // A group of private members only: another venue's staff see nothing.
    const loose = await amenityAsset(w.staffA.id, w.venue)
    expect((await communityVisible(other.staffA, [loose])).size).toBe(0)
    const hidden = await start(w.staffA, key(), "none")
    await add(w.staffA, hidden, [loose])
    expect(
      (await view(w.staffA, hidden)).members.map((m) => m.assetId)
    ).toEqual([loose])
    await refused(
      other.staffA,
      "contribution_group",
      { p_group_id: hidden },
      "contribution_group_not_found",
      "P0002"
    )
    expect(
      await json(other.staffA, "contribution_groups_for_assets", {
        p_asset_ids: [loose],
      })
    ).toEqual([])
    // An unknown group reads like a forbidden one.
    await refused(
      w.staffA,
      "contribution_group",
      { p_group_id: randomUUID() },
      "contribution_group_not_found",
      "P0002"
    )
  })

  it("names a task subject only to viewers who may read the task (OD-7 default)", async () => {
    const task = await createRequirement(w.staffManager, w.venue, {
      title: "TEST private group task",
    })
    const general = await photo(w.staffA.id, w.venue)
    const g = await start(w.staffA, key(), "task", task)
    await add(w.staffA, g, [general])
    const named = { kind: "task", id: task, name: "TEST private group task" }

    // The author, the venue's staff manager and an admin read the task.
    for (const who of [w.staffA, w.staffManager, w.admin]) {
      const seen = await view(who, g)
      expect(seen.subject, who.id).toEqual(named)
      expect(
        seen.members.map((m) => m.assetId),
        who.id
      ).toEqual([general])
    }

    // Another venue's staff see the general member, as Photos shows it, but
    // cannot read the task, so the group names no subject.
    const { data: rows, error } = await other.staffA.client
      .from("coverage_requirements")
      .select("id")
      .eq("id", task)
    expect(error).toBeNull()
    expect(rows).toEqual([])
    const elsewhere = await view(other.staffA, g)
    expect(elsewhere.members.map((m) => m.assetId)).toEqual([general])
    expect(elsewhere.subject).toEqual({ kind: "none", id: null, name: null })
    expect(
      await json(other.staffA, "contribution_groups_for_assets", {
        p_asset_ids: [general],
      })
    ).toEqual([{ asset_id: general, group_id: g }])
  })

  it("names a task subject to the venue's effective manager account, never through another venue's or an ineffective grant", async () => {
    const title = "TEST reviewer group task"
    const task = await createRequirement(w.admin, w.venue, { title })
    await assign(w.admin, task, [w.staffA.id])
    const general = await photo(w.staffA.id, w.venue)
    await submitCoverage(w.staffA, [general], task)
    const g = await start(w.staffA, key(), "task", task)
    await add(w.staffA, g, [general])

    // The manager account is not the venue's current staff and has no photos
    // on the task, so the table policy shows it no row; its effective grant
    // opens the venue's progress read, which lists the task.
    expect(await scope(w.manager)).toMatchObject({
      role: "manager",
      manager_venue_id: w.venue,
    })
    expect(await readableTasks(w.manager, [task])).toEqual([])
    expect(
      (await requirementProgress(w.manager, w.venue)).map(
        (r) => r.requirement_id
      )
    ).toContain(task)
    const managed = await view(w.manager, g)
    expect(managed.subject).toEqual({ kind: "task", id: task, name: title })
    expect(managed.members.map((m) => m.assetId)).toEqual([general])

    // Another venue's effective grant, and an open grant for this venue held
    // by staff assigned elsewhere (not effective). Photos still shows each the
    // general member, so the group reads, but it names no subject.
    const stray = await createIdentity(service, {
      label: "kn-b02-groups-stray",
      role: "staff",
      venueId: other.venue,
    })
    await legacyStaffGrant(service, w.admin, stray.id, w.venue)
    for (const [who, managerVenue] of [
      [other.staffManager, other.venue],
      [stray, null],
    ] as const) {
      expect((await scope(who)).manager_venue_id, who.id).toBe(managerVenue)
      await refused(
        who,
        "coverage_requirement_progress",
        { p_venue_id: w.venue, p_include_closed: false },
        "not_venue_manager",
        "42501"
      )
      expect(await readableTasks(who, [task]), who.id).toEqual([])
      expect([...(await communityVisible(who, [general]))], who.id).toEqual([
        general,
      ])
      const seen = await view(who, g)
      expect(
        seen.members.map((m) => m.assetId),
        who.id
      ).toEqual([general])
      expect(seen.subject, who.id).toEqual(noSubject)
      expect(JSON.stringify(seen), who.id).not.toContain(task)
      expect(JSON.stringify(seen), who.id).not.toContain(title)
    }
    // Another venue's manager account sees no member, so no group.
    await refused(
      other.manager,
      "contribution_group",
      { p_group_id: g },
      "contribution_group_not_found",
      "P0002"
    )
  })

  it("names a task to a transferred author only through their own photos on that task, at the group's venue", async () => {
    const mover = await createIdentity(service, {
      label: "kn-b02-groups-mover",
      role: "staff",
      venueId: w.venue,
    })
    const ownTitle = "TEST own-history group task"
    const otherTitle = "TEST unrelated group task"
    const own = await createRequirement(w.admin, w.venue, { title: ownTitle })
    const unrelated = await createRequirement(w.admin, w.venue, {
      title: otherTitle,
    })
    await assign(w.admin, own, [mover.id])
    const submitted = await photo(mover.id, w.venue)
    await submitCoverage(mover, [submitted], own)
    const loose = await photo(mover.id, w.venue)
    const gOwn = await start(mover, key(), "task", own)
    await add(mover, gOwn, [submitted])
    const gUnrelated = await start(mover, key(), "task", unrelated)
    await add(mover, gUnrelated, [loose])
    const ownNamed = { kind: "task", id: own, name: ownTitle }

    // As the venue's current staff, the mover reads both tasks.
    expect((await view(mover, gOwn)).subject).toEqual(ownNamed)
    expect((await view(mover, gUnrelated)).subject).toEqual({
      kind: "task",
      id: unrelated,
      name: otherTitle,
    })

    await ok(
      service
        .from("profiles")
        .update({ venue_id: other.venue })
        .eq("id", mover.id)
    )

    // After the transfer the task policy shows the mover only the task their
    // own photos are on. The old venue's progress read refuses them: it has
    // no own-photo arm.
    expect(await readableTasks(mover, [own, unrelated])).toEqual([own])
    await refused(
      mover,
      "coverage_requirement_progress",
      { p_venue_id: w.venue, p_include_closed: false },
      "not_venue_manager",
      "42501"
    )
    const kept = await view(mover, gOwn)
    expect(kept.subject).toEqual(ownNamed)
    expect(kept.members.map((m) => m.assetId)).toEqual([submitted])
    const lost = await view(mover, gUnrelated)
    expect(lost.subject).toEqual(noSubject)
    expect(lost.members.map((m) => m.assetId)).toEqual([loose])

    // The task must be at the group's venue. contribution_group_start only
    // names subjects at the caller's venue, so psql writes this group: at the
    // mover's new venue, naming the old venue's task they have photos on.
    const misplaced = psql(
      `with g as (
         insert into public.media_contribution_groups
           (venue_id, created_by, subject_kind, subject_id, client_group_key)
         values ('${other.venue}', '${mover.id}', 'task', '${own}', '${key()}')
         returning id)
       select id from g`
    )
    expect(await view(mover, misplaced)).toMatchObject({
      venueId: other.venue,
      mine: true,
      subject: noSubject,
      members: [],
    })

    // The mover's new colleague sees both general members, as Photos shows
    // them, and neither task.
    expect(await readableTasks(other.staffA, [own, unrelated])).toEqual([])
    expect(
      [...(await communityVisible(other.staffA, [submitted, loose]))].sort()
    ).toEqual([submitted, loose].sort())
    for (const [g, member] of [
      [gOwn, submitted],
      [gUnrelated, loose],
    ] as const) {
      const seen = await view(other.staffA, g)
      expect(seen.members.map((m) => m.assetId)).toEqual([member])
      expect(seen.subject).toEqual(noSubject)
      for (const hidden of [own, unrelated, ownTitle, otherTitle])
        expect(JSON.stringify(seen)).not.toContain(hidden)
    }
  })

  // B05-m5 (OD-B5-01-7): the creator now also sees a deleted member, as
  // removed; everyone else still never does.
  it("keeps each member's own state, and shows a deleted member to its creator only", async () => {
    const ready = await photo(w.staffA.id, w.venue)
    const pending = (
      await insertAsset(service, {
        uploader: w.staffA.id,
        venue: w.venue,
        ready: false,
      })
    ).id
    const g = await start(w.staffA, key(), "none")
    await add(w.staffA, g, [ready, pending])
    await ok(
      service
        .from("media_assets")
        .update({ upload_state: "failed" })
        .eq("id", pending)
    )
    const states = Object.fromEntries(
      (await view(w.staffA, g)).members.map((m) => [m.assetId, m.uploadState])
    )
    expect(states).toEqual({ [ready]: "ready", [pending]: "failed" })

    await ok(call(w.staffA, "delete_media_asset", { p_asset_id: ready }))
    expect(
      (await view(w.staffA, g)).members.map((m) => [m.assetId, m.technical])
    ).toEqual([
      [ready, "removed"],
      [pending, "failed"],
    ])
    expect((await view(w.admin, g)).members.map((m) => m.assetId)).toEqual([
      pending,
    ])
    // Membership is kept.
    expect(
      count(
        `select count(*) from public.media_contribution_group_members where group_id = '${g}'`
      )
    ).toBe(2)
  })

  it("keeps the tables closed to clients and append-only", async () => {
    const g = await start(w.staffA, key(), "none")
    await add(w.staffA, g, [await photo(w.staffA.id, w.venue)])
    const rows: [string, string][] = [
      ["media_contribution_groups", `id = '${g}'`],
      ["media_contribution_group_members", `group_id = '${g}'`],
    ]
    for (const [table, where] of rows) {
      const { data, error } = await (
        w.staffA.client as unknown as {
          from(t: string): {
            select(
              c: string
            ): PromiseLike<{ data: unknown[] | null; error: unknown }>
          }
        }
      )
        .from(table)
        .select("*")
      expect(error !== null || (data ?? []).length === 0, table).toBe(true)
      expect(
        () => psql(`delete from public.${table} where ${where}`),
        table
      ).toThrow()
      expect(
        () =>
          psql(`update public.${table} set venue_id = venue_id where ${where}`),
        table
      ).toThrow()
    }
    expect(
      count(
        `select count(*) from public.media_contribution_group_members where group_id = '${g}'`
      )
    ).toBe(1)
  })
})
