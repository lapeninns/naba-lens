// My contributions feed (docs/knowledge/b02-design.md R5, R6, R7):
// my_contributions_feed pages the caller's own photos, task sends and findings
// by (at, key) descending under one cursor. Task sends carry their position
// in the replacement chain; photos carry live menu decisions and whether one
// accepts the photo for menu use, never the menu-photo lock counter. Real
// signed-in identities through PostgREST; the service role and psql only
// build fixtures and read state back.
import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  createIdentity,
  markReady,
  type TestIdentity,
} from "../support/identities"
import {
  assign as assignRequirement,
  createRequirement,
  insertAsset,
  insertSubmittedItem,
  itemRevision,
  ok,
  psql,
  requestKey,
  review as reviewItem,
  submit as sendPhotos,
} from "./coverage-fixtures"
import {
  call,
  count,
  decide,
  json,
  photo,
  refused,
  service,
  submit,
  world,
  yes,
  type World,
} from "./knowledge-fixtures"
import {
  item,
  menu,
  publishMenu,
  readDocument,
  reserveReady,
  saveOk,
  section,
  type CatalogueRow,
} from "./menus-fixtures"

type FeedItem = Record<string, unknown> & {
  type: "photo" | "task_send" | "finding" | "assignment_closed"
  key: string
  at: string
}
type Feed = { items: FeedItem[]; nextCursor: string | null }

const PHOTO_KEYS = [
  "assetId",
  "at",
  "key",
  "labels",
  "mediaType",
  "menuDecisions",
  "menuUseAccepted",
  "sentAt",
  "type",
  "uploadState",
  "venueId",
  "venueName",
]
const TASK_KEYS = [
  "archived",
  "assetAvailable",
  "assetId",
  "at",
  "decidedAt",
  "itemId",
  "key",
  "reason",
  "replacesItemId",
  "replacesSentAt",
  "requirementId",
  "requirementTitle",
  "revision",
  "sentAt",
  "state",
  "submissionId",
  "type",
  "venueId",
  "venueName",
]
const DECISION_KEYS = [
  "decidedAt",
  "itemId",
  "itemName",
  "photoId",
  "reason",
  "state",
  "variantName",
]

const CURSOR = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z\|[ptcse]:/

function page(who: TestIdentity, cursor: string | null = null, limit = 20) {
  return json<Feed>(who, "my_contributions_feed", {
    p_cursor: cursor,
    p_limit: limit,
  })
}

/** Every item, following nextCursor to the end. */
async function all(who: TestIdentity, limit = 20) {
  const items: FeedItem[] = []
  let cursor: string | null = null
  for (let i = 0; i < 500; i++) {
    const p: Feed = await page(who, cursor, limit)
    items.push(...p.items)
    if (!p.nextCursor) return items
    expect(p.nextCursor).toMatch(CURSOR)
    cursor = p.nextCursor
  }
  throw new Error("feed did not end")
}

/** Every knowledge_my_contributions item, following its cursor. */
async function history(who: TestIdentity) {
  const items: Record<string, unknown>[] = []
  let cursor: string | null = null
  for (let i = 0; i < 100; i++) {
    const p: { items: Record<string, unknown>[]; nextCursor: string | null } =
      await json(who, "knowledge_my_contributions", {
        p_cursor: cursor,
        p_limit: 20,
      })
    items.push(...p.items)
    if (!p.nextCursor) return items
    cursor = p.nextCursor
  }
  throw new Error("history did not end")
}

const byKey = (items: FeedItem[], key: string) => {
  const found = items.filter((i) => i.key === key)
  expect(found, key).toHaveLength(1)
  return found[0]!
}

/** Keys descending in the "C" collation, which code-unit order matches. */
const desc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0)

function expectOrdered(items: FeedItem[]) {
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1]!
    const cur = items[i]!
    const a = Date.parse(prev.at)
    const b = Date.parse(cur.at)
    expect(a, `${prev.key} before ${cur.key}`).toBeGreaterThanOrEqual(b)
    if (prev.at === cur.at) {
      expect(desc(prev.key, cur.key), `${prev.key} before ${cur.key}`).toBe(-1)
    }
  }
}

function keysDeep(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => keysDeep(v, out))
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.push(k)
      keysDeep(v, out)
    }
  }
  return out
}

const checkRevision = (w: World, key: string) =>
  count(
    `select revision from public.venue_amenity_checks where id = '${w.checks[key]}'`
  )

function legacyArgs(w: World, key: string) {
  return {
    p_check_id: w.checks[key],
    p_revision: checkRevision(w, key),
    p_idempotency_key: randomUUID(),
    p_answer: "no",
    p_finding: null,
    p_limitations: null,
    p_reason: "TEST none here",
    p_asset_ids: [],
    p_internal_metadata: null,
    p_redaction_confirmed: false,
  }
}

function assignCheck(w: World, key: string, staff: TestIdentity) {
  return json(w.manager, "amenity_assign_check", {
    p_check_id: w.checks[key],
    p_assignee_id: staff.id,
    p_revision: checkRevision(w, key),
  })
}

async function displayName(id: string) {
  const row = (await ok(
    service.from("profiles").select("display_name").eq("id", id).single()
  )) as { display_name: string }
  return row.display_name
}

/** An amenity-purpose upload, the same row shape as insertAsset. */
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

function sendReplacing(who: TestIdentity, asset: string, replaces: string) {
  return ok(
    who.client.rpc("submit_coverage_photos", {
      p_asset_ids: [asset],
      p_requirement_id: null as unknown as string,
      p_client_request_key: requestKey(),
      p_replaces_item_id: replaces,
    })
  )
}

/** A monthly-only send (replacing `replaces`) reviewed as needing another photo. */
async function requested(w: World, replaces: string | null = null) {
  const asset = await reserveReady(service, w.staffA)
  const [row] = replaces
    ? await sendReplacing(w.staffA, asset.id, replaces)
    : await sendPhotos(w.staffA, [asset.id])
  const id = row!.item_id
  const { revision } = await itemRevision(service, id)
  await ok(
    reviewItem(w.staffManager, id, revision, "needs_another_photo", "TEST dark")
  )
  return id
}

// Menu photo fixtures, as in manager-item-photos.test.ts.
type Tuple = { itemId: string; variantId: string | null }
const t = (row: CatalogueRow): Tuple => ({
  itemId: row.itemId,
  variantId: null,
})

const MENU = () =>
  menu("TEST feed photos", [
    section("mains", "Mains", [
      item("mains--korma", "Korma"),
      item("mains--tikka", "Tikka"),
      item("mains--dal", "Dal"),
      item("mains--bhaji", "Bhaji"),
    ]),
  ])

async function labelled(who: TestIdentity, version: string, tuples: Tuple[]) {
  const asset = await reserveReady(service, who)
  const saved = await saveOk(who, {
    asset: asset.id,
    revision: 0,
    types: ["dish"],
    items: tuples,
    catalogue: version,
  })
  return { id: asset.id, revision: saved!.revision as number }
}

async function head(itemId: string) {
  const { data, error } = await service
    .from("menu_item_photo_heads")
    .select("revision")
    .eq("item_id", itemId)
    .maybeSingle()
  if (error) throw error
  return data?.revision ?? 1
}

async function reviewPhoto(
  who: TestIdentity,
  asset: string,
  tuple: Tuple,
  decision: "accepted" | "better_photo_requested",
  reason?: string
) {
  const [row] = await ok(
    who.client.rpc("review_menu_item_photo", {
      p_asset_id: asset,
      p_item_id: tuple.itemId,
      p_variant_id: tuple.variantId as string,
      p_decision: decision,
      p_expected_revision: await head(tuple.itemId),
      ...(reason ? { p_reason: reason } : {}),
      p_make_primary: false,
    })
  )
  return row!
}

async function withdraw(who: TestIdentity, photoId: string, itemId: string) {
  return ok(
    who.client.rpc("withdraw_menu_item_photo", {
      p_photo_id: photoId,
      p_expected_revision: await head(itemId),
      p_reason: "TEST blurry",
    })
  )
}

async function menuRows(asset: string) {
  const { data, error } = await service
    .from("menu_item_photos")
    .select("id, item_id, item_name, variant_name, state, reason")
    .eq("asset_id", asset)
  if (error) throw error
  return data
}

describe("photo items (R5, R6, R7)", () => {
  it("lists own general uploads in any upload state with labels and live menu decisions", async () => {
    const w = await world("feed-photo")
    const version = await publishMenu(w.admin, w.venue, MENU())
    const items = (await readDocument(service, version)).byKey
    const tikka = t(items["mains--tikka"]!)
    const dal = t(items["mains--dal"]!)
    const bhaji = t(items["mains--bhaji"]!)
    const korma = t(items["mains--korma"]!)

    const accepted = await labelled(w.staffA, version, [tikka])
    const better = await labelled(w.staffA, version, [dal])
    const withdrawn = await labelled(w.staffA, version, [bhaji])
    const invalidated = await labelled(w.staffA, version, [korma])
    const bare = await reserveReady(service, w.staffA)
    const uploading = await insertAsset(service, {
      uploader: w.staffA.id,
      venue: w.venue,
      ready: false,
    })

    await reviewPhoto(w.manager, accepted.id, tikka, "accepted")
    await reviewPhoto(
      w.manager,
      better.id,
      dal,
      "better_photo_requested",
      "TEST too dark"
    )
    const gone = await reviewPhoto(w.manager, withdrawn.id, bhaji, "accepted")
    await withdraw(w.manager, gone.photo_id, bhaji.itemId)
    await reviewPhoto(w.manager, invalidated.id, korma, "accepted")
    // Removing the reviewed label invalidates the acceptance.
    await saveOk(w.staffA, {
      asset: invalidated.id,
      revision: invalidated.revision,
      types: ["dish"],
      items: [],
      catalogue: version,
    })
    expect((await menuRows(withdrawn.id))[0]!.state).toBe("withdrawn")
    expect((await menuRows(invalidated.id))[0]!.state).toBe("invalidated")

    const feed = await all(w.staffA)
    expectOrdered(feed)
    const photos = feed.filter((i) => i.type === "photo")
    expect(photos.map((p) => p.assetId as string).sort()).toEqual(
      [
        accepted.id,
        better.id,
        withdrawn.id,
        invalidated.id,
        bare.id,
        uploading.id,
      ].sort()
    )
    for (const p of photos) {
      expect(Object.keys(p).sort()).toEqual(PHOTO_KEYS)
      expect(p.key).toBe(`p:${p.assetId}`)
      expect(p).toMatchObject({
        venueId: w.venue,
        venueName: w.venueName,
        mediaType: "image",
      })
      expect(p.sentAt).toBe(p.at)
      for (const d of p.menuDecisions as Record<string, unknown>[]) {
        expect(Object.keys(d).sort()).toEqual(DECISION_KEYS)
      }
      // R6: the menu-photo row's revision is a lock counter, never shown.
      expect(keysDeep(p)).not.toContain("revision")
    }

    const of = (id: string) => byKey(feed, `p:${id}`)
    const live = async (asset: string) =>
      (await menuRows(asset))
        .filter((r) => !["withdrawn", "invalidated"].includes(r.state))
        .map((r) => ({
          photoId: r.id,
          itemId: r.item_id,
          itemName: r.item_name,
          variantName: r.variant_name,
          state: r.state,
          reason: r.reason,
          decidedAt: expect.any(String),
        }))

    expect(of(accepted.id)).toMatchObject({
      uploadState: "ready",
      labels: { hasLabels: true, needsLabels: false, needsAttention: false },
      menuUseAccepted: true,
      menuDecisions: await live(accepted.id),
    })
    expect(of(accepted.id).menuDecisions).toEqual([
      expect.objectContaining({ itemId: tikka.itemId, state: "accepted" }),
    ])
    expect(of(better.id)).toMatchObject({
      menuUseAccepted: false,
      menuDecisions: await live(better.id),
    })
    expect(of(better.id).menuDecisions).toEqual([
      expect.objectContaining({
        itemId: dal.itemId,
        state: "better_photo_requested",
        reason: "TEST too dark",
      }),
    ])
    expect(of(withdrawn.id)).toMatchObject({
      menuUseAccepted: false,
      menuDecisions: [],
    })
    expect(of(invalidated.id)).toMatchObject({
      menuUseAccepted: false,
      menuDecisions: [],
    })
    expect(of(bare.id)).toMatchObject({
      uploadState: "ready",
      labels: { hasLabels: false, needsLabels: true, needsAttention: false },
      menuUseAccepted: false,
      menuDecisions: [],
    })
    expect(of(uploading.id)).toMatchObject({
      uploadState: "uploading",
      labels: { hasLabels: false, needsLabels: false, needsAttention: false },
    })
  })

  it("excludes deleted uploads and amenity evidence uploads", async () => {
    const w = await world("feed-deleted")
    const kept = await photo(w.staffA.id, w.venue)
    const removed = await photo(w.staffA.id, w.venue)
    const amenity = await amenityAsset(w.staffA.id, w.venue)
    const [sent] = await sendPhotos(w.staffA, [removed])
    await ok(call(w.staffA, "delete_media_asset", { p_asset_id: removed }))

    const feed = await all(w.staffA)
    const assets = feed.filter((i) => i.type === "photo").map((i) => i.assetId)
    expect(assets).toEqual([kept])
    expect(assets).not.toContain(amenity)
    // The send stays, with its photo no longer available.
    expect(byKey(feed, `t:${sent!.item_id}`)).toMatchObject({
      assetId: removed,
      assetAvailable: false,
    })
  })
})

describe("task send items (R5, R6)", () => {
  it("lists own sends with their requirement, decision and venue", async () => {
    const w = await world("feed-task")
    const requirement = await createRequirement(w.staffManager, w.venue, {
      title: "TEST feed requirement",
    })
    await assignRequirement(w.staffManager, requirement, [w.staffA.id])
    const toRequirement = await reserveReady(service, w.staffA)
    const monthly = await reserveReady(service, w.staffA)
    const [onRequirement] = await sendPhotos(
      w.staffA,
      [toRequirement.id],
      requirement
    )
    const [plain] = await sendPhotos(w.staffA, [monthly.id])
    const { revision } = await itemRevision(service, plain!.item_id)
    await ok(reviewItem(w.staffManager, plain!.item_id, revision, "accepted"))

    const feed = await all(w.staffA)
    expectOrdered(feed)
    const sends = feed.filter((i) => i.type === "task_send")
    expect(sends).toHaveLength(2)
    for (const s of sends) {
      expect(Object.keys(s).sort()).toEqual(TASK_KEYS)
      expect(s.key).toBe(`t:${s.itemId}`)
      expect(s.sentAt).toBe(s.at)
    }
    const submission = async (id: string) =>
      (
        (await ok(
          service
            .from("coverage_submission_items")
            .select("submission_id")
            .eq("id", id)
            .single()
        )) as { submission_id: string }
      ).submission_id

    expect(byKey(feed, `t:${onRequirement!.item_id}`)).toMatchObject({
      itemId: onRequirement!.item_id,
      submissionId: await submission(onRequirement!.item_id),
      requirementId: requirement,
      requirementTitle: "TEST feed requirement",
      venueId: w.venue,
      venueName: w.venueName,
      assetId: toRequirement.id,
      assetAvailable: true,
      state: "submitted",
      reason: null,
      decidedAt: null,
      archived: false,
      replacesItemId: null,
      replacesSentAt: null,
      revision: 1,
    })
    expect(byKey(feed, `t:${plain!.item_id}`)).toMatchObject({
      submissionId: await submission(plain!.item_id),
      requirementId: null,
      requirementTitle: null,
      assetId: monthly.id,
      state: "accepted",
      decidedAt: expect.any(String),
      revision: 1,
    })
  })

  it("numbers a replacement chain 1, 2, 3 and names the replaced send", async () => {
    const w = await world("feed-chain")
    const first = await requested(w)
    const second = await requested(w, first)
    const third = await reserveReady(service, w.staffA)
    const [last] = await sendReplacing(w.staffA, third.id, second)

    const feed = await all(w.staffA)
    const one = byKey(feed, `t:${first}`)
    const two = byKey(feed, `t:${second}`)
    const three = byKey(feed, `t:${last!.item_id}`)
    expect(one).toMatchObject({
      revision: 1,
      replacesItemId: null,
      replacesSentAt: null,
      state: "needs_another_photo",
      reason: "TEST dark",
      decidedAt: expect.any(String),
    })
    expect(two).toMatchObject({
      revision: 2,
      replacesItemId: first,
      replacesSentAt: one.sentAt,
      state: "needs_another_photo",
    })
    expect(three).toMatchObject({
      revision: 3,
      replacesItemId: second,
      replacesSentAt: two.sentAt,
      state: "submitted",
    })
  })
})

describe("finding items (R5)", () => {
  it("are exactly the knowledge_my_contributions items, legacy answers and closed assignments included", async () => {
    const w = await world("feed-findings", { extra: ["darts"] })
    await assignCheck(w, "guest_toilets", w.staffB)
    await assignCheck(w, "darts", w.staffB)
    const unknown = await submit(w.staffB, w, "onsite_parking", {
      answer: "unknown",
    })
    const withPhoto = await yes(w.staffB, w, "step_free_entrance")
    await ok(call(w.staffB, "amenity_submit_finding", legacyArgs(w, "darts")))
    const legacy = psql(
      `select id from public.amenity_submissions where check_id = '${w.checks.darts}'`
    )
    // Someone else answers staffB's assignment.
    const other = await submit(w.staffA, w, "guest_toilets", { answer: "no" })
    if (other.outcome !== "current") {
      await ok(
        decide(
          w.manager,
          w,
          "guest_toilets",
          { type: "contribution", id: other.contributionId },
          "confirm"
        )
      )
    }
    // Drafts stay out of the feed.
    await json(w.staffB, "knowledge_save_draft", {
      p_check_id: w.checks.guest_wifi,
      p_draft_revision: null,
      p_payload: { answer: "yes" },
      p_asset_ids: [],
      p_idempotency_key: randomUUID(),
    })

    const feed = await all(w.staffB)
    expectOrdered(feed)
    const findings = feed.filter(
      (i) => i.type === "finding" || i.type === "assignment_closed"
    )
    const strip = (i: FeedItem) => {
      const rest: Record<string, unknown> = { ...i }
      delete rest.type
      delete rest.key
      delete rest.at
      return rest
    }
    expect(findings.map(strip)).toEqual(await history(w.staffB))
    expect(JSON.stringify(feed)).not.toContain("savedAt")
    expect(JSON.stringify(feed)).not.toContain(w.checks.guest_wifi!)

    expect(byKey(feed, `c:${unknown.contributionId}`)).toMatchObject({
      type: "finding",
      findingRef: { type: "contribution", id: unknown.contributionId },
      venueId: w.venue,
      venueName: w.venueName,
      questionKey: "onsite_parking",
      answer: "unknown",
      state: "submitted",
    })
    const sent = byKey(feed, `c:${withPhoto.contributionId}`)
    expect(sent).toMatchObject({
      type: "finding",
      questionKey: "step_free_entrance",
    })
    expect(sent.sentAt).toBe(sent.at)
    expect(byKey(feed, `s:${legacy}`)).toMatchObject({
      type: "finding",
      findingRef: { type: "submission", id: legacy },
      checkId: w.checks.darts,
      questionKey: "darts",
      kind: "finding",
      answer: "no",
      venueName: w.venueName,
    })
    const closed = findings.filter((i) => i.type === "assignment_closed")
    expect(closed).toHaveLength(1)
    expect(closed[0]!.key).toMatch(/^e:\d{19}$/)
    expect(closed[0]).toMatchObject({
      kind: "assignment_closed",
      state: "assignment_closed",
      checkId: w.checks.guest_toilets,
      venueId: w.venue,
      questionKey: "guest_toilets",
      answeredBy: await displayName(w.staffA.id),
    })
    expect(closed[0]!.sentAt).toBe(closed[0]!.at)
    // The closing answer is staffA's, not staffB's.
    expect(JSON.stringify(feed)).not.toContain(other.contributionId)
  })
})

describe("whose rows", () => {
  it("never lists another person's photo, send or finding", async () => {
    const w = await world("feed-own")
    const mine = await photo(w.staffA.id, w.venue)
    const theirs = await photo(w.staffB.id, w.venue)
    const [theirSend] = await sendPhotos(w.staffB, [theirs])
    const theirFinding = await submit(w.staffB, w, "onsite_parking", {
      answer: "unknown",
    })

    const feed = await all(w.staffA)
    expect(feed.map((i) => i.key)).toEqual([`p:${mine}`])
    const text = JSON.stringify(feed)
    for (const id of [theirs, theirSend!.item_id, theirFinding.contributionId])
      expect(text).not.toContain(id)
    expect((await all(w.staffB)).map((i) => i.key).sort()).toEqual(
      [
        `p:${theirs}`,
        `t:${theirSend!.item_id}`,
        `c:${theirFinding.contributionId}`,
      ].sort()
    )
  })

  it("keeps rows from a former venue after a transfer", async () => {
    const w = await world("feed-move")
    const to = await world("feed-move-to")
    const asset = await photo(w.staffA.id, w.venue)
    const [sent] = await sendPhotos(w.staffA, [asset])
    const finding = await submit(w.staffA, w, "guest_toilets", {
      answer: "unknown",
    })
    const before = await all(w.staffA)
    await ok(
      service
        .from("profiles")
        .update({ venue_id: to.venue })
        .eq("id", w.staffA.id)
    )
    const after = await all(w.staffA)
    expect(after).toEqual(before)
    expect(after.map((i) => i.key).sort()).toEqual(
      [`p:${asset}`, `t:${sent!.item_id}`, `c:${finding.contributionId}`].sort()
    )
    for (const i of after) expect(i.venueId).toBe(w.venue)
  })

  it("gives a manager account its own findings and an admin an empty feed", async () => {
    const w = await world("feed-roles")
    const own = await yes(w.manager, w, "step_free_entrance", {
      confirmOwn: true,
    })
    const feed = await all(w.manager)
    expect(byKey(feed, `c:${own.contributionId}`)).toMatchObject({
      type: "finding",
      findingRef: { type: "contribution", id: own.contributionId },
      state: "current",
    })
    expect(
      feed
        .filter((i) => i.type === "finding")
        .map((i) => (i.findingRef as { id: string }).id)
    ).toEqual([own.contributionId])

    const freshAdmin = await createIdentity(service, {
      label: "feed-roles-admin",
      role: "admin",
    })
    expect(await page(freshAdmin)).toEqual({ items: [], nextCursor: null })
  })
})

describe("cursor (R5)", () => {
  it("pages rows sharing one instant across types once each, in (at, key) order", async () => {
    const w = await world("feed-tie")
    // Knowledge contributions always take the time of the call, so only
    // photos and task sends can be placed at a chosen instant.
    const instant = "2025-06-15T12:00:00.123456Z"
    const a = await insertAsset(service, {
      uploader: w.staffA.id,
      venue: w.venue,
      createdAt: instant,
    })
    const b = await insertAsset(service, {
      uploader: w.staffA.id,
      venue: w.venue,
      createdAt: instant,
    })
    const sendA = await insertSubmittedItem(service, {
      asset: a,
      venue: w.venue,
      author: w.staffA.id,
      submittedAt: instant,
    })
    const sendB = await insertSubmittedItem(service, {
      asset: b,
      venue: w.venue,
      author: w.staffA.id,
      submittedAt: instant,
    })
    const recent = await photo(w.staffA.id, w.venue)
    const finding = await submit(w.staffA, w, "onsite_parking", {
      answer: "unknown",
    })

    const tied = [`p:${a.id}`, `p:${b.id}`, `t:${sendA}`, `t:${sendB}`].sort(
      desc
    )
    const seen: FeedItem[] = []
    let cursor: string | null = null
    for (let i = 0; i < 20; i++) {
      const p: Feed = await page(w.staffA, cursor, 1)
      expect(p.items.length).toBeLessThanOrEqual(1)
      seen.push(...p.items)
      if (!p.nextCursor) break
      expect(p.nextCursor).toMatch(CURSOR)
      expect(p.nextCursor.split("|")[1]).toBe(p.items[0]!.key)
      cursor = p.nextCursor
    }
    const keys = seen.map((i) => i.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.slice(-4)).toEqual(tied)
    expect([...keys].sort()).toEqual(
      [...tied, `p:${recent}`, `c:${finding.contributionId}`].sort()
    )
    const atTie = seen.filter((i) => tied.includes(i.key))
    for (const i of atTie) {
      expect(i.at).toBe(atTie[0]!.at)
      expect(Date.parse(i.at)).toBe(Date.parse(instant))
    }
    expectOrdered(seen)

    // A full page gives the same rows in the same order.
    expect((await all(w.staffA)).map((i) => i.key)).toEqual(keys)
  })

  it("refuses a malformed cursor with invalid_cursor (22023)", async () => {
    const w = await world("feed-cursor")
    for (const bad of [
      "nope",
      "2026-01-01T00:00:00Z|p:abc",
      "2026-01-01T00:00:00.000000Z|x:abc",
      "2026-01-01T00:00:00.000000Z",
    ]) {
      await refused(
        w.staffA,
        "my_contributions_feed",
        { p_cursor: bad, p_limit: 20 },
        "invalid_cursor",
        "22023"
      )
    }
  })
})
