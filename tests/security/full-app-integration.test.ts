// Full App v1, S2-INT: the Sprint 1 pieces wired together (migrations
// 20261118109000-109300). One file covers the hand-off's items 1 to 8:
//   1 sold out keeps a slot in the total      5 capture time in exports
//   2 freshness reaches coverage (AC30)       6 memberships for upload, album
//   3 duplicates add no coverage (AC21)         and manager scope (AC14)
//   4 exports read the review level (AC16)    7 admin checks need aal2
//   8 a policy Yes needs no photo (FA-32)
// Real signed-in identities through PostgREST; the service role and psql
// only build fixtures and read state back.
import { createHash, randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import {
  anonClient,
  createIdentity,
  createVenue,
  type TestIdentity,
} from "../support/identities"
import { ok, psql } from "./coverage-fixtures"
import {
  admin as knowledgeAdmin,
  call,
  decide,
  json,
  refused,
  service,
  submit,
  submitArgs,
  wifiNotes,
  world,
  yes,
  type World,
} from "./knowledge-fixtures"
import {
  item,
  menu,
  publishMenu,
  readDocument,
  reserve,
  reserveReady,
  saveOk,
  section,
  type CatalogueRow,
} from "./menus-fixtures"

type Slot = {
  kind: "dish" | "amenity" | "area"
  slotId: string
  state: string
  counted: boolean
  unavailable: boolean
}
type Coverage = { slots: Slot[]; totals: Record<string, number> }
type Candidate = {
  assetId: string
  subjectKind: "menu_item" | "place" | "amenity"
  subjectId: string
  approvalLevel: "public" | "internal"
}

const coverage = (who: TestIdentity, venue?: string) =>
  json<Coverage>(who, "coverage_slots", venue ? { p_venue_id: venue } : {})
const slotOf = async (who: TestIdentity, slotId: string, venue?: string) =>
  (await coverage(who, venue)).slots.find((s) => s.slotId === slotId)!

async function errorOf(p: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await p
  return error?.message ?? null
}

/** The value of a SQL expression evaluated as `userId` (JWT claims set). */
function asCaller(userId: string, expr: string, aal = "aal2"): string {
  const claims = JSON.stringify({ sub: userId, role: "authenticated", aal })
  const out = psql(
    `select set_config('request.jwt.claims', '${claims}', false); select ${expr};`
  )
  return out.split("\n").at(-1)!
}

const head = (itemId: string) =>
  Number(
    psql(
      `select coalesce((select revision from public.menu_item_photo_heads where item_id = '${itemId}'), 1)`
    )
  )

type V = {
  w: World
  version: string
  items: Record<string, CatalogueRow>
  places: { bar: string; garden: string }
}

async function venue(label: string): Promise<V> {
  const w = await world(label, {
    extra: ["dogs_inside"],
    inScope: ["dogs_inside"],
  })
  const version = await publishMenu(
    w.admin,
    w.venue,
    menu("TEST integration", [
      section("mains", "Mains", [
        item("mains--pie", "Pie"),
        item("mains--fish", "Fish"),
        item("mains--soup", "Soup"),
        item("mains--stew", "Stew"),
      ]),
      section("drinks", "Drinks", [item("drinks--ale", "Ale")], "drinks"),
    ])
  )
  const items = (await readDocument(service, version)).byKey
  const place = (name: string) =>
    psql(
      `insert into public.knowledge_subjects (venue_id, kind, label, created_by)
       values ('${w.venue}', 'area', '${name}', '${w.admin.id}') returning id`
    )
  return {
    w,
    version,
    items,
    places: { bar: place("Bar"), garden: place("Garden") },
  }
}

/**
 * A photo finalised as the processing path does (service role), with a
 * content hash and an optional capture time from its metadata.
 */
async function finalised(
  who: TestIdentity,
  sha: string,
  capturedAt?: string
): Promise<string> {
  const r = await reserve(who)
  await ok(
    service
      .from("media_assets")
      .update({ upload_state: "processing" })
      .eq("id", r.id)
  )
  await ok(
    service.rpc("complete_media_finalise", {
      p_asset_id: r.id,
      p_validated_mime_type: "image/jpeg",
      p_size_bytes: 4,
      p_width: 2000,
      p_height: 1500,
      p_content_sha256: sha,
      ...(capturedAt ? { p_captured_at: capturedAt } : {}),
    })
  )
  return r.id
}

const sha = () => createHash("sha256").update(randomUUID()).digest("hex")

async function label(v: V, who: TestIdentity, asset: string, itemId: string) {
  await saveOk(who, {
    asset,
    revision: 0,
    items: [{ itemId, variantId: null }],
    catalogue: v.version,
  })
}

async function dishPhoto(v: V, who: TestIdentity, itemId: string) {
  const asset = (await reserveReady(service, who)).id
  await label(v, who, asset, itemId)
  return asset
}

const setLevel = (
  who: TestIdentity,
  asset: string,
  itemId: string,
  level: "public" | "reference"
) =>
  call(who, "set_menu_item_photo_level", {
    p_asset_id: asset,
    p_item_id: itemId,
    p_variant_id: null,
    p_level: level,
    p_expected_revision: head(itemId),
  })

async function areaPhoto(who: TestIdentity, subject: string) {
  const asset = (await reserveReady(service, who)).id
  const [row] = (await ok(
    who.client.rpc("set_media_area_label", {
      p_asset_id: asset,
      p_subject_id: subject,
    })
  ))!
  return { asset, label: (row as { label_id: string }).label_id }
}

const decideArea = (who: TestIdentity, labelId: string, level = "public") =>
  call(who, "decide_area_photo_level", {
    p_label_id: labelId,
    p_action: "accepted",
    p_level: level,
  })

const candidates = (who: TestIdentity, venueId: string, mode = "public") =>
  json<{ items: Candidate[] }>(who, "export_candidates", {
    p_venue_id: venueId,
    p_mode: mode,
  })

let v: V
let other: V
let inactive: TestIdentity

beforeAll(async () => {
  await knowledgeAdmin()
  ;[v, other] = await Promise.all([venue("int-a"), venue("int-b")])
  inactive = await createIdentity(service, {
    label: "int-inactive",
    role: "staff",
    venueId: v.w.venue,
  })
  await ok(
    service.from("profiles").update({ active: false }).eq("id", inactive.id)
  )
})

// ---------------------------------------------------------------------------

describe("1. a sold-out dish stays in the total (AC26, inv. 7)", () => {
  it("keeps its state and its place in the denominator, and clears on the until date", async () => {
    const pie = v.items["mains--pie"]!.itemId
    const asset = await dishPhoto(v, v.w.staffA, pie)
    expect((await setLevel(v.w.manager, asset, pie, "public")).error).toBe(null)
    const before = await coverage(v.w.staffB)
    expect(before.slots.find((s) => s.slotId === pie)).toMatchObject({
      state: "covered",
      unavailable: false,
    })

    // Staff, another venue's manager and the inactive cannot mark it.
    const soldOut = (who: TestIdentity) =>
      call(who, "menu_item_availability_set", {
        p_item_id: pie,
        p_available: false,
        p_until: null,
        p_reason: "TEST sold out",
      })
    expect(await errorOf(soldOut(v.w.staffA))).not.toBeNull()
    expect(await errorOf(soldOut(other.w.manager))).not.toBeNull()
    expect(await errorOf(soldOut(inactive))).not.toBeNull()
    expect((await soldOut(v.w.manager)).error).toBeNull()

    const after = await coverage(v.w.staffB)
    expect(after.slots.find((s) => s.slotId === pie)).toMatchObject({
      state: "covered",
      unavailable: true,
      counted: true,
    })
    expect(after.totals.total).toBe(before.totals.total)
    expect(after.totals.covered).toBe(before.totals.covered)
    expect(after.totals.unavailable).toBe(before.totals.unavailable! + 1)
    // The admin reads the same; another venue cannot read it.
    expect((await slotOf(v.w.admin, pie, v.w.venue)).unavailable).toBe(true)
    expect(
      await errorOf(
        call(other.w.manager, "coverage_slots", { p_venue_id: v.w.venue })
      )
    ).toBe("wrong_venue")

    // An until date that has passed reads as available again.
    psql(`begin;
      set local session_replication_role = replica;
      update public.menu_item_availability set until_on = current_date - 2 where item_id = '${pie}';
      commit;`)
    expect((await slotOf(v.w.staffB, pie)).unavailable).toBe(false)
  })

  it("marks an amenity whose Yes is temporarily unavailable, and keeps it counted", async () => {
    const check = v.w.checks.guest_toilets!
    const sent = await yes(v.w.staffA, v.w, "guest_toilets")
    const asset = psql(
      `select asset_id from public.knowledge_contribution_assets
       where contribution_id = '${sent.contributionId}' limit 1`
    )
    expect(
      (
        await call(v.w.manager, "decide_amenity_photo", {
          p_check_id: check,
          p_asset_id: asset,
          p_action: "accepted",
          p_level: "public",
        })
      ).error
    ).toBeNull()
    expect((await slotOf(v.w.staffB, check)).unavailable).toBe(false)
    psql(`insert into public.knowledge_contribution_details
        (contribution_id, venue_id, question_version, value_schema, value_schema_version, detail, request_hash)
      select x.id, x.venue_id,
        (select max(q.version) from public.knowledge_question_versions q where q.key = x.question_key),
        'facility', 1, '{"availability": {"state": "temporarily_unavailable"}}'::jsonb,
        encode(sha256('TEST'::bytea), 'hex')
      from public.knowledge_contributions x where x.id = '${sent.contributionId}'`)
    const slot = await slotOf(v.w.staffB, check)
    expect(slot).toMatchObject({ unavailable: true, counted: true })
  })
})

describe("2. freshness reaches coverage (AC30, FA-11)", () => {
  it("makes a place check due on a reported change, restores it on Still right, and needs a replacement on a known change", async () => {
    const bar = v.places.bar
    const photo = await areaPhoto(v.w.staffA, bar)
    expect((await decideArea(v.w.manager, photo.label)).error).toBeNull()
    expect((await slotOf(v.w.staffB, bar)).state).toBe("covered")
    const covered = (await coverage(v.w.manager)).totals.covered!

    await json(v.w.staffA, "area_photo_report_change", {
      p_subject_id: bar,
      p_reason: "TEST new bar top",
    })
    const due = await coverage(v.w.manager)
    expect(due.slots.find((s) => s.slotId === bar)).toMatchObject({
      state: "check_due",
      counted: true,
    })
    expect(due.totals.covered).toBe(covered - 1)
    expect(
      asCaller(
        v.w.admin.id,
        `private.coverage_check_due('area', '${bar}', null)`
      )
    ).toBe("t")

    // Still right, without a new photo: a manager's call, never staff's.
    expect(
      await errorOf(
        call(v.w.staffA, "area_photo_reconfirm", { p_subject_id: bar })
      )
    ).not.toBeNull()
    await json(v.w.manager, "area_photo_reconfirm", { p_subject_id: bar })
    expect((await slotOf(v.w.staffB, bar)).state).toBe("covered")

    await json(v.w.manager, "area_photo_report_change", {
      p_subject_id: bar,
      p_reason: "TEST rebuilt",
      p_replacement: true,
    })
    expect((await slotOf(v.w.staffB, bar)).state).toBe("replacement_needed")
    // A new photo waiting shows as pending until it is decided.
    const next = await areaPhoto(v.w.staffB, bar)
    expect((await slotOf(v.w.staffA, bar)).state).toBe("pending")
    expect((await decideArea(v.w.manager, next.label)).error).toBeNull()
    expect((await slotOf(v.w.staffA, bar)).state).toBe("covered")
  })

  it("makes an amenity check due while its answer is not confirmed", async () => {
    const check = v.w.checks.onsite_parking!
    const sent = await yes(v.w.staffA, v.w, "onsite_parking")
    expect(sent.outcome).toBe("current")
    const asset = psql(
      `select asset_id from public.knowledge_contribution_assets
       where contribution_id = '${sent.contributionId}' limit 1`
    )
    expect(
      (
        await call(v.w.manager, "decide_amenity_photo", {
          p_check_id: check,
          p_asset_id: asset,
          p_action: "accepted",
          p_level: "public",
        })
      ).error
    ).toBeNull()
    expect((await slotOf(v.w.staffB, check)).state).toBe("covered")

    // Past its check date the answer is check due, and so is the slot.
    psql(`begin;
      set local session_replication_role = replica;
      update public.amenity_submissions s set created_at = s.created_at - interval '120 days'
      from public.venue_amenity_checks c
      where c.id = '${check}' and s.id = c.current_submission_id;
      update public.knowledge_decisions d set created_at = d.created_at - interval '120 days'
      from public.venue_amenity_checks c
      where c.id = '${check}'
        and (d.submission_id = c.current_submission_id or d.resulting_submission_id = c.current_submission_id);
      commit;`)
    const slot = await slotOf(v.w.staffB, check)
    expect(slot).toMatchObject({ state: "check_due", counted: true })
    expect(
      asCaller(
        v.w.admin.id,
        `private.coverage_check_due('amenity', '${check}', null)`
      )
    ).toBe("t")
  })
})

describe("3. duplicates add no coverage or credit (AC21, FA-35; R4, R9)", () => {
  const credited = (asset: string) =>
    psql(
      `select count(*) from private.monthly_credit_items(date_trunc('month', now() at time zone 'Europe/London')::date) c
       where c.asset_id = '${asset}'`
    )

  it("neither covers nor counts while its original is accepted, and counts once the original is removed", async () => {
    const fish = v.items["mains--fish"]!.itemId
    const soup = v.items["mains--soup"]!.itemId
    const hash = sha()
    const original = await finalised(v.w.staffA, hash)
    const copy = await finalised(v.w.staffB, hash)
    expect(
      psql(
        `select duplicate_of_asset_id from public.media_assets where id = '${copy}'`
      )
    ).toBe(original)

    await label(v, v.w.staffA, original, fish)
    expect(
      (await setLevel(v.w.manager, original, fish, "public")).error
    ).toBeNull()
    expect((await slotOf(v.w.staffA, fish)).state).toBe("covered")
    expect(credited(original)).toBe("1")

    // The same bytes labelled to another dish: not pending, and accepting
    // it for public use covers nothing and earns nothing (R4).
    await label(v, v.w.staffB, copy, soup)
    expect((await slotOf(v.w.staffA, soup)).state).toBe("missing")
    const before = (await coverage(v.w.manager)).totals.covered!
    expect((await setLevel(v.w.manager, copy, soup, "public")).error).toBe(null)
    expect((await slotOf(v.w.staffA, soup)).state).toBe("missing")
    expect((await coverage(v.w.manager)).totals.covered).toBe(before)
    expect(credited(copy)).toBe("0")
    // Our menu agrees with the rule.
    const summary = await json<Array<{ covered_items: number }>>(
      v.w.manager,
      "menu_item_photo_summary",
      {}
    )
    const dishCovered = (await coverage(v.w.manager)).slots.filter(
      (s) => s.kind === "dish" && s.state === "covered"
    ).length
    expect(summary.reduce((n, s) => n + s.covered_items, 0)).toBe(dishCovered)

    // The original is removed: the copy is now the photo that counts (R9).
    psql(
      `update public.media_assets set deleted_at = now() where id = '${original}'`
    )
    expect((await slotOf(v.w.staffA, soup)).state).toBe("covered")
    expect(credited(copy)).toBe("1")
  })

  it("leaves a duplicate place photo out while its original is accepted", async () => {
    const cellar = psql(
      `insert into public.knowledge_subjects (venue_id, kind, label, created_by)
       values ('${v.w.venue}', 'area', 'Cellar', '${v.w.admin.id}') returning id`
    )
    const garden = v.places.garden
    const hash = sha()
    const original = await finalised(v.w.staffA, hash)
    const [first] = (await ok(
      v.w.staffA.client.rpc("set_media_area_label", {
        p_asset_id: original,
        p_subject_id: cellar,
      })
    ))!
    expect(
      (await decideArea(v.w.manager, (first as { label_id: string }).label_id))
        .error
    ).toBeNull()
    const copy = await finalised(v.w.staffB, hash)
    const [row] = (await ok(
      v.w.staffB.client.rpc("set_media_area_label", {
        p_asset_id: copy,
        p_subject_id: garden,
      })
    ))!
    expect((await slotOf(v.w.staffA, garden)).state).toBe("missing")
    expect(
      (await decideArea(v.w.manager, (row as { label_id: string }).label_id))
        .error
    ).toBeNull()
    expect((await slotOf(v.w.staffA, garden)).state).toBe("missing")
    expect((await slotOf(v.w.staffA, cellar)).state).toBe("covered")
  })

  it("keeps the credit wrapper off every signed-in role (R11)", () => {
    expect(
      psql(
        `select string_agg(has_function_privilege(r, 'private.monthly_credit_items(date)', 'execute')::text, ',' order by r)
         from unnest(array['anon', 'authenticated', 'public', 'service_role']) r`
      )
    ).toBe("false,false,false,true")
  })
})

describe("4. exports read the review level (AC16) and freshness (§9.3)", () => {
  it("never offers a reference photo for public export or a package", async () => {
    const stew = v.items["mains--stew"]!.itemId
    const asset = await dishPhoto(v, v.w.staffA, stew)
    expect(
      (await setLevel(v.w.manager, asset, stew, "reference")).error
    ).toBeNull()
    const pub = await candidates(v.w.manager, v.w.venue)
    expect(pub.items.map((c) => c.assetId)).not.toContain(asset)
    const internal = await candidates(v.w.admin, v.w.venue, "internal")
    expect(internal.items.find((c) => c.assetId === asset)).toMatchObject({
      approvalLevel: "internal",
    })
    expect(
      await errorOf(
        call(v.w.manager, "export_package_create", {
          p_request_key: `test-${randomUUID()}`,
          p_mode: "public",
          p_profile_key: "website",
          p_items: [
            { assetId: asset, subjectKind: "menu_item", subjectId: stew },
          ],
        })
      )
    ).not.toBeNull()

    // Approved for public use: offered.
    expect(
      (await setLevel(v.w.manager, asset, stew, "public")).error
    ).toBeNull()
    expect(
      (await candidates(v.w.manager, v.w.venue)).items.find(
        (c) => c.assetId === asset
      )
    ).toMatchObject({ approvalLevel: "public" })
  })

  it("keeps a place photo with a reported change out of new public packages", async () => {
    const subject = psql(
      `insert into public.knowledge_subjects (venue_id, kind, label, created_by)
       values ('${v.w.venue}', 'area', 'Snug', '${v.w.admin.id}') returning id`
    )
    const photo = await areaPhoto(v.w.staffA, subject)
    expect((await decideArea(v.w.manager, photo.label)).error).toBeNull()
    expect(
      (await candidates(v.w.manager, v.w.venue)).items.map((c) => c.assetId)
    ).toContain(photo.asset)
    await json(v.w.manager, "area_photo_report_change", {
      p_subject_id: subject,
      p_reason: "TEST new seats",
    })
    expect(
      (await candidates(v.w.manager, v.w.venue)).items.map((c) => c.assetId)
    ).not.toContain(photo.asset)
    // A reference place photo is never public either.
    const ref = await areaPhoto(v.w.staffB, subject)
    expect(
      (await decideArea(v.w.manager, ref.label, "reference")).error
    ).toBeNull()
    expect(
      (await candidates(v.w.manager, v.w.venue)).items.map((c) => c.assetId)
    ).not.toContain(ref.asset)
  })

  it("refuses candidates to staff, another venue's manager and anon", async () => {
    expect(
      await errorOf(
        call(v.w.staffA, "export_candidates", {
          p_venue_id: v.w.venue,
          p_mode: "public",
        })
      )
    ).not.toBeNull()
    expect(
      await errorOf(
        call(other.w.manager, "export_candidates", {
          p_venue_id: v.w.venue,
          p_mode: "public",
        })
      )
    ).not.toBeNull()
    const anon = await anonClient().rpc(
      "export_candidates" as never,
      { p_venue_id: v.w.venue, p_mode: "public" } as never
    )
    expect(anon.error).not.toBeNull()
  })
})

describe("5. capture time in exports", () => {
  it("fills capturedAt from the photo, and unknown when it has none", async () => {
    const ale = other.items["drinks--ale"]!.itemId
    const pie = other.items["mains--pie"]!.itemId
    const takenAt = "2026-10-03T18:45:00.000Z"
    const known = await finalised(other.w.staffA, sha(), takenAt)
    const unknown = await finalised(other.w.staffB, sha())
    await label(other, other.w.staffA, known, ale)
    await label(other, other.w.staffB, unknown, pie)
    for (const [asset, itemId] of [
      [known, ale],
      [unknown, pie],
    ] as const)
      expect(
        (await setLevel(other.w.manager, asset, itemId, "public")).error
      ).toBeNull()

    const created = await json<{ packageId: string }>(
      other.w.manager,
      "export_package_create",
      {
        p_request_key: `test-${randomUUID()}`,
        p_mode: "public",
        p_profile_key: "website",
        p_items: [
          { assetId: known, subjectKind: "menu_item", subjectId: ale },
          { assetId: unknown, subjectKind: "menu_item", subjectId: pie },
        ],
      }
    )
    // Another venue's manager cannot start it.
    expect(
      await errorOf(
        call(v.w.manager, "export_package_download_start", {
          p_package_id: created.packageId,
        })
      )
    ).toBe("export_package_not_found")
    const started = await json<{
      state: string
      items: Array<{
        assetId: string
        capturedAt: string | null
        captureTimeSource: string
      }>
    }>(other.w.manager, "export_package_download_start", {
      p_package_id: created.packageId,
    })
    expect(started.state).toBe("ready")
    const byAsset = new Map(started.items.map((i) => [i.assetId, i]))
    expect(byAsset.get(known)).toMatchObject({
      captureTimeSource: "metadata",
    })
    expect(new Date(byAsset.get(known)!.capturedAt!).toISOString()).toBe(
      takenAt
    )
    expect(byAsset.get(unknown)).toMatchObject({
      capturedAt: null,
      captureTimeSource: "unknown",
    })
  })
})

describe("6. memberships for upload, album and manager scope (AC14, AC12)", () => {
  let dual: TestIdentity

  const reserveAt = (who: TestIdentity, venueId?: string) =>
    who.client.rpc("reserve_media_asset", {
      p_client_upload_key: randomUUID(),
      p_size_bytes: 4,
      p_media_type: "image",
      p_extension: "jpg",
      p_original_filename: "TEST int.jpg",
      ...(venueId ? { p_venue_id: venueId } : {}),
    })
  const switchTo = (who: TestIdentity, venueId: string) =>
    ok(who.client.rpc("switch_active_venue", { p_venue_id: venueId }))
  const canManage = (who: TestIdentity, venueId: string) =>
    asCaller(who.id, `private.can_manage_venue('${venueId}')`)
  const canViewAlbum = (who: TestIdentity, venueId: string) =>
    asCaller(who.id, `private.can_view_venue_album('${venueId}')`)

  beforeAll(async () => {
    // Staff at B, then made manager at A by an admin.
    dual = await createIdentity(service, {
      label: "int-dual",
      role: "staff",
      venueId: other.w.venue,
    })
    await ok(
      v.w.admin.client.rpc("admin_set_venue_membership", {
        p_profile_id: dual.id,
        p_venue_id: v.w.venue,
        p_role: "manager",
        p_reason: "TEST manages A",
      })
    )
  })

  it("gives manager rights at A only while A is the active venue, and none at B", async () => {
    await switchTo(dual, v.w.venue)
    expect(canManage(dual, v.w.venue)).toBe("t")
    expect(canManage(dual, other.w.venue)).toBe("f")
    // Ops digests reach the venue's managers (S1-OPS), never at B.
    expect(
      psql(
        `select count(*) from private.ops_venue_managers('${other.w.venue}') m where m = '${dual.id}'`
      )
    ).toBe("0")
    // Export access follows can_manage_venue.
    expect(
      (
        await call(dual, "export_candidates", {
          p_venue_id: v.w.venue,
          p_mode: "public",
        })
      ).error
    ).toBeNull()
    expect(
      await errorOf(
        call(dual, "export_candidates", {
          p_venue_id: other.w.venue,
          p_mode: "public",
        })
      )
    ).not.toBeNull()

    // As manager at A: an upload is made at A, never at B.
    const atA = await reserveAt(dual)
    expect(atA.error).toBeNull()
    expect(atA.data![0]!.venue_id).toBe(v.w.venue)
    expect(await errorOf(reserveAt(dual, other.w.venue))).toBe("wrong_venue")
    expect(canViewAlbum(dual, v.w.venue)).toBe("t")
    expect(canViewAlbum(dual, other.w.venue)).toBe("f")

    // Switching to B ends the manager rights at A, but not the upload in
    // flight at A, where the person still manages (review R10).
    await switchTo(dual, other.w.venue)
    expect(canManage(dual, v.w.venue)).toBe("f")
    const stillAllowed = () =>
      psql(
        `select private.media_upload_venue_allowed(a.uploader_id, a.uploader_role, a.venue_id)
         from public.media_assets a where a.id = '${atA.data![0]!.id}'`
      )
    expect(stillAllowed()).toBe("t")
    expect(
      await errorOf(
        call(dual, "export_candidates", {
          p_venue_id: v.w.venue,
          p_mode: "public",
        })
      )
    ).not.toBeNull()
    const atB = await reserveAt(dual, other.w.venue)
    expect(atB.error).toBeNull()
    expect(atB.data![0]!.venue_id).toBe(other.w.venue)
    expect(canViewAlbum(dual, other.w.venue)).toBe("t")
    expect(canViewAlbum(dual, v.w.venue)).toBe("f")

    // Ending the manager role at A stops that upload (AC12).
    await ok(
      v.w.admin.client.rpc("admin_set_venue_membership", {
        p_profile_id: dual.id,
        p_venue_id: v.w.venue,
        p_role: "staff",
        p_reason: "TEST no longer manages A",
      })
    )
    expect(stillAllowed()).toBe("f")
  })

  it("stops upload and album access when the membership ends", async () => {
    const leaver = await createIdentity(service, {
      label: "int-leaver",
      role: "staff",
      venueId: v.w.venue,
    })
    expect((await reserveAt(leaver)).error).toBeNull()
    expect(canViewAlbum(leaver, v.w.venue)).toBe("t")
    // A membership that ends while the profile still names the venue.
    psql(`begin;
      set local session_replication_role = replica;
      update public.venue_memberships set ended_at = now(), end_kind = 'removed', end_reason = 'TEST'
      where profile_id = '${leaver.id}' and ended_at is null;
      commit;`)
    expect(await errorOf(reserveAt(leaver))).toBe("venue_unavailable")
    expect(canViewAlbum(leaver, v.w.venue)).toBe("f")
  })

  it("lets an admin upload to any active venue it names, never an inactive one", async () => {
    const admin = v.w.admin
    expect(await errorOf(reserveAt(admin))).toBe("venue_required")
    const atB = await reserveAt(admin, other.w.venue)
    expect(atB.error).toBeNull()
    expect(atB.data![0]!.venue_id).toBe(other.w.venue)
    expect(
      psql(
        `select uploader_role from public.media_assets where id = '${atB.data![0]!.id}'`
      )
    ).toBe("admin")
    expect(
      psql(
        `select private.media_upload_venue_allowed('${admin.id}', 'admin', '${other.w.venue}')`
      )
    ).toBe("t")
    const closed = (await createVenue(service, "int-closed", false)).id
    expect(await errorOf(reserveAt(admin, closed))).toBe("venue_unavailable")
    // Without the second factor the admin's own upload stops (FA-23).
    expect(
      asCaller(
        admin.id,
        `private.media_upload_venue_allowed('${admin.id}', 'admin', '${other.w.venue}')`,
        "aal1"
      )
    ).toBe("f")
  })

  it("keeps staff to their own venue and refuses the inactive and anon", async () => {
    expect((await reserveAt(v.w.staffA, v.w.venue)).error).toBeNull()
    expect(await errorOf(reserveAt(v.w.staffA, other.w.venue))).toBe(
      "wrong_venue"
    )
    expect(await errorOf(reserveAt(other.w.manager, v.w.venue))).toBe(
      "wrong_venue"
    )
    expect(await errorOf(reserveAt(inactive))).not.toBeNull()
    const anon = await anonClient().rpc(
      "reserve_media_asset" as never,
      {
        p_client_upload_key: randomUUID(),
        p_size_bytes: 4,
        p_media_type: "image",
        p_extension: "jpg",
        p_original_filename: "TEST.jpg",
      } as never
    )
    expect(anon.error).not.toBeNull()
  })
})

describe("7. admin checks need the second factor (FA-23)", () => {
  it("reads labels and the admin scope only on aal2", async () => {
    const admin = v.w.admin
    const asset = (await reserveReady(service, v.w.staffA)).id
    expect(
      asCaller(admin.id, `private.can_read_asset_labels('${asset}')`, "aal2")
    ).toBe("t")
    expect(
      asCaller(admin.id, `private.can_read_asset_labels('${asset}')`, "aal1")
    ).toBe("f")
    expect(
      asCaller(
        admin.id,
        `(select is_admin from public.coverage_access_scope())`,
        "aal2"
      )
    ).toBe("t")
    expect(
      asCaller(
        admin.id,
        `(select is_admin from public.coverage_access_scope())`,
        "aal1"
      )
    ).toBe("f")
    // Staff keep reading their own labels; not a colleague's.
    expect(
      asCaller(v.w.staffA.id, `private.can_read_asset_labels('${asset}')`)
    ).toBe("t")
    expect(
      asCaller(v.w.staffB.id, `private.can_read_asset_labels('${asset}')`)
    ).toBe("f")
  })
})

describe("8. a policy Yes needs no photo (FA-32, catalogue version 2)", () => {
  it("moves the six policy questions to evidence rule none, with a question version", () => {
    expect(
      psql(
        `select string_agg(key || ':' || evidence_rule || ':' || catalogue_version, ',' order by key)
         from public.amenity_catalogue
         where key in ('guest_wifi', 'dogs_inside', 'dogs_outside', 'live_music', 'pub_quiz', 'curbside_pickup')`
      )
    ).toBe(
      "curbside_pickup:none:2,dogs_inside:none:2,dogs_outside:none:2,guest_wifi:none:2,live_music:none:2,pub_quiz:none:2"
    )
    expect(
      psql(
        `select count(*) from public.knowledge_question_versions v
         where v.evidence_rule = 'none' and v.change_kind = 'rule'
           and v.version = (select max(x.version) from public.knowledge_question_versions x where x.key = v.key)`
      )
    ).toBe("6")
    // Every other question keeps its rule.
    expect(
      psql(
        `select evidence_rule from public.amenity_catalogue where key = 'onsite_parking'`
      )
    ).toBe("photo")
  })

  it("accepts a policy Yes with no media and still refuses one elsewhere", async () => {
    const sent = await submit(v.w.manager, v.w, "dogs_inside", {
      answer: "yes",
    })
    expect(sent.contributionId).toEqual(expect.any(String))
    await refused(
      v.w.staffA,
      "knowledge_submit",
      submitArgs(v.w, "step_free_entrance", { answer: "yes" }),
      "evidence_rule_unmet"
    )
  })

  it("lets a staff Wi-Fi Yes without media wait for the manager, who confirms it (AC25)", async () => {
    const sent = await submit(other.w.staffA, other.w, "guest_wifi", {
      answer: "yes",
      metadata: wifiNotes(),
      redaction: true,
    })
    expect(sent.outcome).toBe("awaiting_confirmation")
    expect(
      psql(
        `select evidence_rule from public.knowledge_contributions where id = '${sent.contributionId}'`
      )
    ).toBe("none")
    expect(
      (
        await decide(
          other.w.manager,
          other.w,
          "guest_wifi",
          { type: "contribution", id: sent.contributionId },
          "confirm"
        )
      ).error
    ).toBeNull()
    expect(
      psql(
        `select progress || ',' || answer from public.venue_amenity_checks where id = '${other.w.checks.guest_wifi}'`
      )
    ).toBe("complete,yes")
    // A policy question has no photo slot: the fact is enough.
    expect(
      (await slotOf(other.w.staffB, other.w.checks.guest_wifi!)).state
    ).toBe("inactive")
  })

  it("keeps answers recorded under the earlier rule readable", () => {
    expect(
      psql(
        `select count(*) from public.amenity_submissions
         where evidence_rule not in ('photo', 'video', 'either', 'both', 'none')`
      )
    ).toBe("0")
    expect(psql(`select private.amenity_rule_met('none', '{}')`)).toBe("t")
    expect(psql(`select private.amenity_rule_met('photo', '{}')`)).toBe("f")
  })
})

describe("Sprint 1 review findings owned by S2-INT", () => {
  it("R2: an amenity photo accepted in its own review is retained and visible to colleagues", async () => {
    const check = other.w.checks.onsite_parking!
    const sent = await yes(other.w.staffA, other.w, "onsite_parking")
    const asset = psql(
      `select asset_id from public.knowledge_contribution_assets
       where contribution_id = '${sent.contributionId}' limit 1`
    )
    // Before the review the uploader may still withdraw it (not tested
    // destructively); the colleague does not see it (FA-20).
    expect(
      asCaller(other.w.staffB.id, `private.media_visible_to_caller('${asset}')`)
    ).toBe("f")
    expect(
      (
        await call(other.w.manager, "decide_amenity_photo", {
          p_check_id: check,
          p_asset_id: asset,
          p_action: "accepted",
          p_level: "reference",
        })
      ).error
    ).toBeNull()
    expect(psql(`select private.asset_is_accepted('${asset}')`)).toBe("t")
    expect(
      asCaller(other.w.staffB.id, `private.media_visible_to_caller('${asset}')`)
    ).toBe("t")
    expect(
      await errorOf(
        call(other.w.staffA, "delete_media_asset", { p_asset_id: asset })
      )
    ).toBe("media_asset_retained")
    expect(
      psql(
        `select (deleted_at is null)::text from public.media_assets where id = '${asset}'`
      )
    ).toBe("true")
    const impact = await json<{ amenityPhotos: number; token: string }>(
      other.w.manager,
      "media_removal_impact",
      { p_asset_id: asset }
    )
    expect(impact.amenityPhotos).toBe(1)
  })

  it("R17: changing a place photo's review level keeps its reported change", async () => {
    const subject = psql(
      `insert into public.knowledge_subjects (venue_id, kind, label, created_by)
       values ('${other.w.venue}', 'area', 'Porch', '${other.w.admin.id}') returning id`
    )
    const photo = await areaPhoto(other.w.staffA, subject)
    expect((await decideArea(other.w.manager, photo.label)).error).toBeNull()
    await json(other.w.manager, "area_photo_report_change", {
      p_subject_id: subject,
      p_reason: "TEST new door",
    })
    const state = () =>
      psql(`select private.area_photo_freshness('${photo.label}') ->> 'state'`)
    expect(state()).toBe("check_due")
    // public -> reference -> public: no inspection happened.
    expect(
      (await decideArea(other.w.manager, photo.label, "reference")).error
    ).toBeNull()
    expect(
      (await decideArea(other.w.manager, photo.label, "public")).error
    ).toBeNull()
    expect(state()).toBe("check_due")
    expect((await slotOf(other.w.staffB, subject)).state).toBe("check_due")
    // A real reconfirmation still restores it.
    await json(other.w.manager, "area_photo_reconfirm", {
      p_subject_id: subject,
    })
    expect(state()).toBe("current")
  })

  it("R21: an amenity photo is never public without its own public review and a public grant", async () => {
    const check = v.w.checks.guest_toilets!
    const assets = psql(
      `select string_agg(r.asset_id::text, ',' order by r.asset_id)
       from private.amenity_photo_rows('${v.w.venue}') r where r.check_id = '${check}'`
    ).split(",")
    const pub = (await candidates(v.w.admin, v.w.venue)).items
    for (const a of assets) expect(pub.map((c) => c.assetId)).not.toContain(a)
    // Internal packages still list them, marked internal.
    const internal = (await candidates(v.w.admin, v.w.venue, "internal")).items
    expect(
      internal
        .filter((c) => assets.includes(c.assetId))
        .map((c) => c.approvalLevel)
    ).not.toContain("public")
  })

  it("R21: a withdrawn public grant keeps a dish photo out of public packages whatever internal grant remains", async () => {
    const run = randomUUID().slice(0, 8)
    const internalDest = `test_inti_${run}`
    const publicDest = `test_intp_${run}`
    const version = `test-int-${run}`
    psql(`insert into public.media_use_destinations
        (key, label, audience, venue_id, owner_workstream, requires_derivative, active) values
      ('${internalDest}', 'TEST int internal ${run}', 'internal', '${v.w.venue}', 'WS5', false, true),
      ('${publicDest}', 'TEST int public ${run}', 'public', null, 'WS5', true, true);
      insert into private.media_use_clearance_versions (version, keys, active)
      values ('${version}', array['a_ok'], true)`)
    const ale = v.items["drinks--ale"]!.itemId
    const asset = await dishPhoto(v, v.w.staffA, ale)
    expect((await setLevel(v.w.manager, asset, ale, "public")).error).toBe(null)
    expect(
      (await candidates(v.w.manager, v.w.venue)).items.map((c) => c.assetId)
    ).toContain(asset)
    const grant = (dest: string, audience: string) =>
      psql(`insert into public.media_use_grants (asset_id, venue_id, destination_key, audience, purpose,
          subject_kind, derivative_profile_key, effective_from, authorised_by, authority_basis,
          clearance_version, clearance, request_key)
        values ('${asset}', '${v.w.venue}', '${dest}', '${audience}', 'general_gallery', 'none',
          ${audience === "public" ? "'public_image'" : "null"},
          now() - interval '1 hour', '${v.w.admin.id}', 'admin',
          '${version}', '{"a_ok": true}',
          'TESTint${randomUUID().replace(/-/g, "")}')
        returning id`)
    grant(internalDest, "internal")
    const pubGrant = grant(publicDest, "public")
    psql(`insert into public.media_use_grant_withdrawals (grant_id, withdrawn_by, reason_code)
      values ('${pubGrant}', '${v.w.admin.id}', 'granter_withdrawn')`)
    expect(
      psql(`select private.media_asset_use_state('${asset}', now())`)
    ).toBe("granted")
    expect(
      (await candidates(v.w.manager, v.w.venue)).items.map((c) => c.assetId)
    ).not.toContain(asset)
  })

  it("R22: an admin cannot remove a photo recorded as published", async () => {
    const pie = other.items["mains--pie"]!.itemId
    const asset = await dishPhoto(other, other.w.staffA, pie)
    expect(
      (await setLevel(other.w.manager, asset, pie, "public")).error
    ).toBeNull()
    const site = (
      await json<{ id: string }>(
        other.w.admin,
        "publication_destination_save",
        {
          p_destination_id: null,
          p_venue_id: other.w.venue,
          p_label: `TEST int site ${randomUUID().slice(0, 6)}`,
          p_url: "https://example.test/",
          p_active: true,
        }
      )
    ).id
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/London",
    }).format(new Date())
    expect(
      (
        await call(other.w.admin, "publication_record", {
          p_request_key: `test-${randomUUID()}`,
          p_destination_id: site,
          p_asset_id: asset,
          p_action: "published",
          p_occurred_on: today,
          p_external_url: "https://example.test/pie",
        })
      ).error
    ).toBeNull()
    const impact = await json<{
      publications: number
      blocked: boolean
      token: string
    }>(other.w.admin, "media_removal_impact", { p_asset_id: asset })
    expect(impact).toMatchObject({ publications: 1, blocked: true })
    expect(
      await errorOf(
        call(other.w.admin, "admin_delete_media_asset", {
          p_asset_id: asset,
          p_reason: "TEST remove",
          p_impact_token: impact.token,
        })
      )
    ).toBe("media_asset_published")
    // A manager may preview but never remove; staff not even preview.
    expect(
      await errorOf(
        call(other.w.manager, "admin_delete_media_asset", {
          p_asset_id: asset,
          p_reason: "TEST remove",
          p_impact_token: impact.token,
        })
      )
    ).toBe("not_permitted")
    expect(
      await errorOf(
        call(other.w.staffA, "media_removal_impact", { p_asset_id: asset })
      )
    ).toBe("media_asset_not_found")
  })
})

describe("privileges", () => {
  it("keeps the new helpers private and the upload command off anon", () => {
    expect(
      psql(
        `select string_agg(has_function_privilege(r, f, 'execute')::text, ',')
         from unnest(array['authenticated', 'anon']) r,
           unnest(array['private.coverage_area_freshness(uuid, timestamptz)',
             'private.coverage_amenity_facts(uuid, timestamptz)',
             'private.coverage_temporarily_unavailable(text, uuid)',
             'private.coverage_check_due(text, uuid, timestamptz)',
             'private.media_upload_venue_allowed(uuid, public.app_role, uuid)',
             'private.media_duplicate_suppressed(uuid)',
             'private.media_removal_impact_of(uuid)',
             'private.export_candidate_rows(uuid, text)']) f`
      )
    ).toBe(Array(16).fill("false").join(","))
    expect(
      psql(
        `select has_function_privilege('anon',
           'public.reserve_media_asset(public.media_type, text, text, bigint, text, text, text, uuid)', 'execute')::text
         || ',' || has_function_privilege('authenticated',
           'public.reserve_media_asset(public.media_type, text, text, bigint, text, text, text, uuid)', 'execute')::text`
      )
    ).toBe("false,true")
  })
})
