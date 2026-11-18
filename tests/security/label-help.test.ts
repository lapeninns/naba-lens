// Full App v1 S2-ADD (20261118112000_label_help.sql): "I'm not sure" (FA-4).
// request_label_help, my_label_help and label_help_queue with real signed-in
// identities through PostgREST: own venue, other venue, staff, manager,
// admin, inactive and anon. The service role and psql only build fixtures.
import { randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import {
  anonClient,
  createIdentity,
  type TestIdentity,
} from "../support/identities"
import { insertAsset, ok, psql } from "./coverage-fixtures"
import {
  admin as knowledgeAdmin,
  call,
  json,
  refused,
  service,
  world,
  type World,
} from "./knowledge-fixtures"

type Help = {
  assetId: string
  venueId: string
  requestedAt: string
  created: boolean
}

type QueueItem = {
  assetId: string
  reason: "not_sure" | "unmatched"
  note: string | null
  uploaderId: string
  uploaderName: string
  mediaType: string
  requestedAt: string | null
}

type Queue = {
  venueId: string
  unmatchedDays: number
  total: number
  notSure: number
  items: QueueItem[]
}

const daysAgo = (n: number) =>
  new Date(Date.now() - n * 24 * 3600 * 1000).toISOString()

/** A note-only label, as Match saves the optional note. */
function noteOn(asset: string, venue: string, by: string, note: string) {
  psql(
    `insert into public.media_labels (asset_id, venue_id, content_types, note, has_labels, revision, updated_by)
     values ('${asset}', '${venue}', '{}', '${note}', false, 1, '${by}')`
  )
}

/** Any label at all: the photo no longer needs one. */
function labelled(asset: string, venue: string, by: string) {
  psql(
    `insert into public.media_labels (asset_id, venue_id, content_types, has_labels, revision, updated_by)
     values ('${asset}', '${venue}', '{venue}', true, 1, '${by}')
     on conflict (asset_id) do update set content_types = '{venue}', has_labels = true`
  )
}

async function reserved(
  who: TestIdentity,
  purpose?: "amenity"
): Promise<string> {
  const { data, error } = await call(who, "reserve_media_asset", {
    ...(purpose ? { p_purpose: purpose } : {}),
    p_media_type: "image",
    p_extension: "jpg",
    p_original_filename: "TEST not sure.jpg",
    p_size_bytes: 4,
    p_client_upload_key: randomUUID(),
  })
  if (error) throw new Error(`${error.message} (${error.code})`)
  return (data as { id: string }[])[0]!.id
}

let v: World
let other: World
let mover: TestIdentity
let leaver: TestIdentity

beforeAll(async () => {
  await knowledgeAdmin()
  ;[v, other] = await Promise.all([world("help-a"), world("help-b")])
  ;[mover, leaver] = await Promise.all([
    createIdentity(service, {
      label: "help-mover",
      role: "staff",
      venueId: v.venue,
    }),
    createIdentity(service, {
      label: "help-leaver",
      role: "staff",
      venueId: v.venue,
    }),
  ])
})

describe("request_label_help", () => {
  it("lets the uploader ask from reservation on, once", async () => {
    const asset = await reserved(v.staffA)
    const first = await json<Help>(v.staffA, "request_label_help", {
      p_asset_id: asset,
    })
    expect(first).toMatchObject({
      assetId: asset,
      venueId: v.venue,
      created: true,
    })
    // Asking again (a retry after a lost answer) returns the same request.
    const again = await json<Help>(v.staffA, "request_label_help", {
      p_asset_id: asset,
    })
    expect(again).toMatchObject({
      assetId: asset,
      created: false,
      requestedAt: first.requestedAt,
    })
    expect(
      psql(
        `select count(*) from public.media_label_help_requests where asset_id = '${asset}'`
      )
    ).toBe("1")
  })

  it("reads someone else's photo as missing: colleague, manager, admin, other venue", async () => {
    const asset = await reserved(v.staffA)
    for (const who of [v.staffB, v.manager, other.staffA, other.manager])
      await refused(
        who,
        "request_label_help",
        { p_asset_id: asset },
        "media_asset_not_found",
        "P0002"
      )
    // An admin is no uploader either.
    await refused(
      v.admin,
      "request_label_help",
      { p_asset_id: asset },
      "media_asset_not_found",
      "P0002"
    )
    await refused(
      v.staffA,
      "request_label_help",
      { p_asset_id: randomUUID() },
      "media_asset_not_found",
      "P0002"
    )
  })

  it("refuses anon and an inactive account", async () => {
    const asset = await reserved(leaver)
    const { error } = await anonClient().rpc("request_label_help", {
      p_asset_id: asset,
    })
    expect(error).not.toBeNull()
    await ok(
      service.from("profiles").update({ active: false }).eq("id", leaver.id)
    )
    try {
      await refused(
        leaver,
        "request_label_help",
        { p_asset_id: asset },
        "not_active_user",
        "42501"
      )
    } finally {
      await ok(
        service.from("profiles").update({ active: true }).eq("id", leaver.id)
      )
    }
  })

  it("refuses after the uploader moved venue (AC11)", async () => {
    const asset = await reserved(mover)
    await ok(
      service
        .from("profiles")
        .update({ venue_id: other.venue })
        .eq("id", mover.id)
    )
    try {
      await refused(
        mover,
        "request_label_help",
        { p_asset_id: asset },
        "upload_access_ended",
        "42501"
      )
    } finally {
      await ok(
        service
          .from("profiles")
          .update({ venue_id: v.venue })
          .eq("id", mover.id)
      )
    }
  })

  it("is for album photos only: not evidence, not a removed photo", async () => {
    const evidence = await reserved(v.staffA, "amenity")
    await refused(
      v.staffA,
      "request_label_help",
      { p_asset_id: evidence },
      "label_help_not_allowed",
      "22023"
    )
    const gone = await insertAsset(service, {
      uploader: v.staffA.id,
      venue: v.venue,
    })
    psql(
      `update public.media_assets set deleted_at = now() where id = '${gone.id}'`
    )
    await refused(
      v.staffA,
      "request_label_help",
      { p_asset_id: gone.id },
      "media_asset_not_found",
      "P0002"
    )
  })

  it("never edits a request", () => {
    const row = psql(
      `select asset_id from public.media_label_help_requests limit 1`
    )
    let said = ""
    try {
      psql(
        `update public.media_label_help_requests set requested_at = now() where asset_id = '${row}'`
      )
    } catch (error) {
      said = String((error as { stderr?: unknown }).stderr ?? error)
    }
    expect(said).toMatch(/label_help_requests_are_kept/)
  })
})

describe("my_label_help", () => {
  it("lists the caller's own open requests only", async () => {
    const mine = await insertAsset(service, {
      uploader: v.staffB.id,
      venue: v.venue,
    })
    const done = await insertAsset(service, {
      uploader: v.staffB.id,
      venue: v.venue,
    })
    const never = await insertAsset(service, {
      uploader: v.staffB.id,
      venue: v.venue,
    })
    for (const id of [mine.id, done.id])
      await json(v.staffB, "request_label_help", { p_asset_id: id })
    labelled(done.id, v.venue, v.staffB.id)
    const ids = [mine.id, done.id, never.id]
    const read = await ok(
      call(v.staffB, "my_label_help", { p_asset_ids: ids }) as PromiseLike<{
        data: string[] | null
        error: null
      }>
    )
    expect(read).toEqual([mine.id])
    // A colleague asking about the same ids sees nothing.
    const theirs = await ok(
      call(v.staffA, "my_label_help", { p_asset_ids: ids }) as PromiseLike<{
        data: string[] | null
        error: null
      }>
    )
    expect(theirs).toEqual([])
    const { error } = await anonClient().rpc("my_label_help", {
      p_asset_ids: ids,
    })
    expect(error).not.toBeNull()
  })
})

describe("label_help_queue", () => {
  let notSure: string
  let oldUnmatched: string
  let freshUnmatched: string
  let closed: string

  beforeAll(async () => {
    notSure = (
      await insertAsset(service, { uploader: v.staffA.id, venue: v.venue })
    ).id
    await json(v.staffA, "request_label_help", { p_asset_id: notSure })
    noteOn(notSure, v.venue, v.staffA.id, "Left of the bar, new this week")
    oldUnmatched = (
      await insertAsset(service, {
        uploader: v.staffB.id,
        venue: v.venue,
        createdAt: daysAgo(8),
      })
    ).id
    freshUnmatched = (
      await insertAsset(service, {
        uploader: v.staffB.id,
        venue: v.venue,
        createdAt: daysAgo(1),
      })
    ).id
    closed = (
      await insertAsset(service, { uploader: v.staffA.id, venue: v.venue })
    ).id
    await json(v.staffA, "request_label_help", { p_asset_id: closed })
    labelled(closed, v.venue, v.manager.id)
  })

  it("shows the venue's manager every I'm not sure photo and the long-unmatched ones", async () => {
    const queue = await json<Queue>(v.manager, "label_help_queue", {})
    expect(queue.venueId).toBe(v.venue)
    expect(queue.unmatchedDays).toBe(7)
    const ids = queue.items.map((i) => i.assetId)
    expect(ids).toContain(notSure)
    expect(ids).toContain(oldUnmatched)
    // Matched since, or not left long enough: not here.
    expect(ids).not.toContain(closed)
    expect(ids).not.toContain(freshUnmatched)
    expect(queue.items.find((i) => i.assetId === notSure)).toMatchObject({
      reason: "not_sure",
      note: "Left of the bar, new this week",
      uploaderId: v.staffA.id,
      mediaType: "image",
    })
    expect(queue.items.find((i) => i.assetId === oldUnmatched)).toMatchObject({
      reason: "unmatched",
      requestedAt: null,
    })
    // Oldest first.
    expect(ids.indexOf(oldUnmatched)).toBeLessThan(ids.indexOf(notSure))
    expect(queue.notSure).toBeGreaterThanOrEqual(1)
    expect(queue.total).toBe(queue.items.length)
  })

  it("treats a staff account managing by grant as a manager of that venue (FA-22)", async () => {
    const queue = await json<Queue>(v.staffManager, "label_help_queue", {})
    expect(queue.items.map((i) => i.assetId)).toContain(notSure)
  })

  it("never crosses venues", async () => {
    const theirs = await json<Queue>(other.manager, "label_help_queue", {})
    expect(theirs.venueId).toBe(other.venue)
    expect(theirs.items.map((i) => i.assetId)).not.toContain(notSure)
    await refused(
      other.manager,
      "label_help_queue",
      { p_venue_id: v.venue },
      "not_venue_manager",
      "42501"
    )
  })

  it("is not for staff, inactive or anon", async () => {
    for (const who of [v.staffA, v.staffB])
      await refused(who, "label_help_queue", {}, "not_venue_manager", "42501")
    const { error } = await anonClient().rpc("label_help_queue", {})
    expect(error).not.toBeNull()
    const gone = await createIdentity(service, {
      label: "help-gone-mgr",
      role: "staff",
      venueId: v.venue,
    })
    await ok(
      service.from("profiles").update({ active: false }).eq("id", gone.id)
    )
    await refused(gone, "label_help_queue", {}, "not_active_user", "42501")
  })

  it("lets an admin read any venue they name", async () => {
    await refused(v.admin, "label_help_queue", {}, "venue_required", "22023")
    const queue = await json<Queue>(v.admin, "label_help_queue", {
      p_venue_id: v.venue,
      p_limit: 1,
    })
    expect(queue.items).toHaveLength(1)
    expect(queue.total).toBeGreaterThanOrEqual(2)
  })

  it("is the only way in: no direct table access", async () => {
    for (const who of [v.staffA, v.manager, v.admin]) {
      const { data, error } = await who.client
        .from("media_label_help_requests" as never)
        .select("*")
      expect(error !== null || (data as unknown[]).length === 0).toBe(true)
    }
  })
})
