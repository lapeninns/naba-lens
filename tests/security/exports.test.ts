// S1-EXPORT (spec §14.1, §14.2 manual, §8 A5, §3.3; AC13, AC14, AC16, AC31,
// AC32, AC33): export packages and manual publication records.
//
//   export_candidates, export_package_create, export_packages_list,
//   export_package_detail, export_package_download_start/_finish,
//   export_package_rebuild, export_asset_status, export_profiles,
//   export_profile_set, publication_destination_save, publication_record,
//   publication_overview
//
// Each function is checked for its own venue's manager, another venue's
// manager, staff, an admin, an inactive account and anon. Real signed-in
// identities through PostgREST; the service role and psql only build
// fixtures and probe guards. One test builds a real ZIP through
// lib/server/exports/download.ts.
import { randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import type { CurrentProfile } from "@/lib/auth/profile"
import { startPackageDownload } from "@/lib/server/exports/download"
import type { MediaActor } from "@/lib/server/media/types"
import sharp from "sharp"

import {
  anonClient,
  createIdentity,
  type TestIdentity,
} from "../support/identities"
import { legacyStaffGrant, ok, psql } from "./coverage-fixtures"
import {
  admin as sharedAdmin,
  call,
  json,
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
  reserveReady,
  saveOk,
  section,
} from "./menus-fixtures"

type Publication = { state: string; exportedAt: string | null }
type Candidate = {
  assetId: string
  subjectKind: "menu_item" | "place" | "amenity"
  subjectId: string
  subjectLabel: string
  category: string
  approvalLevel: "public" | "internal"
  publication: Publication
}
type Candidates = { venueId: string; mode: string; items: Candidate[] }
type Created = { packageId: string; itemCount: number; replayed: boolean }
type Started =
  | { state: "invalidated"; removed: string[] }
  | {
      state: "ready"
      downloadId: string
      items: Array<{ assetId: string; filenameStem: string }>
    }
type PackageJson = {
  id: string
  venueId: string | null
  state: string
  staleAssets: string[]
  items?: Array<{ assetId: string; eligible: boolean }>
}

const key = () => `test-${randomUUID()}`

const candidates = (who: { client: unknown }, venue: string, mode = "public") =>
  json<Candidates>(who, "export_candidates", {
    p_venue_id: venue,
    p_mode: mode,
  })

function create(
  who: { client: unknown },
  items: Array<
    Pick<Candidate, "assetId" | "subjectKind" | "subjectId"> & {
      altText?: string
    }
  >,
  opts: {
    mode?: string
    profile?: string
    key?: string
    width?: number
    height?: number
  } = {}
) {
  return call(who, "export_package_create", {
    p_request_key: opts.key ?? key(),
    p_mode: opts.mode ?? "public",
    p_profile_key: opts.profile ?? "website",
    p_items: items.map((i) => ({
      assetId: i.assetId,
      subjectKind: i.subjectKind,
      subjectId: i.subjectId,
      ...(i.altText ? { altText: i.altText } : {}),
    })),
    ...(opts.width ? { p_custom_width: opts.width } : {}),
    ...(opts.height ? { p_custom_height: opts.height } : {}),
  })
}

const start = (who: { client: unknown }, pkg: string) =>
  json<Started>(who, "export_package_download_start", { p_package_id: pkg })

const finish = (who: { client: unknown }, download: string) =>
  json(who, "export_package_download_finish", {
    p_download_id: download,
    p_completed: true,
    p_files: [{ assetId: "x", file: "x.webp" }],
  })

const decideArea = (
  who: TestIdentity,
  label: string,
  action: "accepted" | "needs_another_photo" | "withdrawn",
  reason?: string
) =>
  ok(
    who.client.rpc("decide_area_photo", {
      p_label_id: label,
      p_action: action,
      ...(reason ? { p_reason: reason } : {}),
    })
  )

function place(venue: string, adminId: string, label: string) {
  return psql(
    `insert into public.knowledge_subjects (venue_id, kind, label, created_by)
     values ('${venue}', 'area', '${label}', '${adminId}') returning id`
  )
}

/** A ready photo by `who` labelled with a place; its asset and label ids. */
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

type Venue = {
  w: World
  /** Legacy-grant manager (a staff account) who decides area photos. */
  reviewer: TestIdentity
  places: Record<"bar" | "garden" | "snug" | "cellar", string>
  /** Asset ids by state. */
  accepted: { asset: string; label: string; subject: string }
  waiting: { asset: string; subject: string }
  retake: { asset: string; subject: string }
}

async function venue(label: string): Promise<Venue> {
  const w = await world(label)
  const reviewer = await createIdentity(service, {
    label: `${label}-rev`,
    role: "staff",
    venueId: w.venue,
  })
  await legacyStaffGrant(service, w.admin, reviewer.id, w.venue)
  const places = {
    bar: place(w.venue, w.admin.id, "Bar"),
    garden: place(w.venue, w.admin.id, "Garden"),
    snug: place(w.venue, w.admin.id, "Snug"),
    cellar: place(w.venue, w.admin.id, "Cellar"),
  }
  const bar = await areaPhoto(w.staffA, places.bar)
  await decideArea(reviewer, bar.label, "accepted")
  const garden = await areaPhoto(w.staffA, places.garden)
  const snug = await areaPhoto(w.staffA, places.snug)
  await decideArea(reviewer, snug.label, "needs_another_photo", "Too dark")
  return {
    w,
    reviewer,
    places,
    accepted: { asset: bar.asset, label: bar.label, subject: places.bar },
    waiting: { asset: garden.asset, subject: places.garden },
    retake: { asset: snug.asset, subject: places.snug },
  }
}

const placeItem = (asset: string, subject: string) => ({
  assetId: asset,
  subjectKind: "place" as const,
  subjectId: subject,
})

let v: Venue
let other: Venue
let anon: { client: unknown }
let inactiveManager: TestIdentity
let admin: TestIdentity

beforeAll(async () => {
  admin = await sharedAdmin()
  ;[v, other] = await Promise.all([venue("export-a"), venue("export-b")])
  anon = { client: anonClient() }
  inactiveManager = await createIdentity(service, {
    label: "export-a-gone",
    role: "staff",
    venueId: v.w.venue,
  })
  await legacyStaffGrant(service, admin, inactiveManager.id, v.w.venue)
  await ok(
    service
      .from("profiles")
      .update({ active: false })
      .eq("id", inactiveManager.id)
  )
})

describe("export_candidates: who may see what", () => {
  it("gives the venue's manager only public-approved, current photos", async () => {
    for (const who of [v.w.manager, v.w.staffManager]) {
      const read = await candidates(who, v.w.venue)
      const ids = read.items.map((i) => i.assetId)
      expect(ids).toContain(v.accepted.asset)
      expect(ids).not.toContain(v.waiting.asset)
      expect(ids).not.toContain(v.retake.asset)
      const bar = read.items.find((i) => i.assetId === v.accepted.asset)!
      expect(bar).toMatchObject({
        subjectKind: "place",
        subjectLabel: "Bar",
        category: "spaces",
        approvalLevel: "public",
        publication: { state: "not_selected" },
      })
    }
  })

  it("adds unreviewed photos, marked internal, only for an admin's internal export", async () => {
    const read = await candidates(admin, v.w.venue, "internal")
    const levels = Object.fromEntries(
      read.items.map((i) => [i.assetId, i.approvalLevel])
    )
    expect(levels[v.accepted.asset]).toBe("public")
    expect(levels[v.waiting.asset]).toBe("internal")
    expect(levels[v.retake.asset]).toBe("internal")
    await refused(
      v.w.manager,
      "export_candidates",
      { p_venue_id: v.w.venue, p_mode: "internal" },
      "export_not_allowed",
      "42501"
    )
  })

  it("refuses another venue, staff, an inactive account and anon (AC13, AC14)", async () => {
    const args = { p_venue_id: v.w.venue, p_mode: "public" }
    for (const who of [
      other.w.manager,
      other.reviewer,
      v.w.staffA,
      inactiveManager,
    ]) {
      await refused(
        who,
        "export_candidates",
        args,
        "export_not_allowed",
        "42501"
      )
    }
    const { error } = await call(anon, "export_candidates", args)
    expect(error?.code).toBe("42501")
  })

  it("lets an admin read any venue", async () => {
    const read = await candidates(admin, other.w.venue)
    expect(read.items.map((i) => i.assetId)).toContain(other.accepted.asset)
  })
})

describe("menu photos", () => {
  it("lists an accepted dish photo on the active menu under Food", async () => {
    const version = await publishMenu(
      admin,
      v.w.venue,
      menu("TEST export menu", [
        section("mains", "Mains", [item("mains--momo", "Chicken momo")]),
      ])
    )
    const momo = (await readDocument(service, version)).byKey["mains--momo"]!
    const asset = await reserveReady(service, v.w.staffA)
    await saveOk(v.w.staffA, {
      asset: asset.id,
      revision: 0,
      items: [{ itemId: momo.itemId, variantId: null }],
      catalogue: version,
    })
    await ok(
      v.w.manager.client.rpc("review_menu_item_photo", {
        p_asset_id: asset.id,
        p_item_id: momo.itemId,
        p_variant_id: null as unknown as string,
        p_decision: "accepted",
        p_expected_revision: 1,
        p_make_primary: false,
      })
    )
    const read = await candidates(v.w.manager, v.w.venue)
    expect(read.items.find((i) => i.assetId === asset.id)).toMatchObject({
      subjectKind: "menu_item",
      subjectId: momo.itemId,
      subjectLabel: "Chicken momo",
      category: "food",
      approvalLevel: "public",
    })
    const created = (await ok(
      create(v.w.manager, [
        { assetId: asset.id, subjectKind: "menu_item", subjectId: momo.itemId },
      ])
    )) as Created
    const detail = await json<{ items: Array<{ filenameStem: string }> }>(
      v.w.manager,
      "export_package_detail",
      { p_package_id: created.packageId }
    )
    // Venue slug, subject slug, first 8 of the asset id: no names or notes.
    expect(detail.items[0]!.filenameStem).toMatch(
      new RegExp(`-chicken-momo-${asset.id.replace(/-/g, "").slice(0, 8)}$`)
    )
  })
})

describe("export_package_create", () => {
  it("records the snapshot, replays a request key and refuses a reused one", async () => {
    const k = key()
    const items = [
      {
        ...placeItem(v.accepted.asset, v.accepted.subject),
        altText: "The bar at night",
      },
    ]
    const first = (await ok(create(v.w.manager, items, { key: k }))) as Created
    expect(first).toMatchObject({ itemCount: 1, replayed: false })
    const again = (await ok(create(v.w.manager, items, { key: k }))) as Created
    expect(again).toMatchObject({ packageId: first.packageId, replayed: true })
    const { error } = await create(v.w.manager, items, {
      key: k,
      profile: "social",
    })
    expect(error?.message).toBe("request_key_reused")

    const row = psql(
      `select venue_id || '|' || mode || '|' || (profile ->> 'key') || '|' || item_count
       from public.export_packages where id = '${first.packageId}'`
    )
    expect(row).toBe(`${v.w.venue}|public|website|1`)
    const snapshot = psql(
      `select subject_label || '|' || category || '|' || approval_kind || '|' || approval_level || '|' || alt_text
       from public.export_package_items where package_id = '${first.packageId}'`
    )
    expect(snapshot).toBe(
      "Bar|spaces|area_photo_decision|public|The bar at night"
    )
  })

  it("refuses unreviewed photos in a public export (AC16)", async () => {
    const { error } = await create(v.w.manager, [
      placeItem(v.waiting.asset, v.waiting.subject),
    ])
    expect(error?.message).toBe("export_item_unavailable")
  })

  it("refuses another venue's photo, staff, inactive accounts and anon (AC13)", async () => {
    const foreign = [placeItem(other.accepted.asset, other.accepted.subject)]
    for (const who of [v.w.manager, v.w.staffA, inactiveManager]) {
      const { error } = await create(who, foreign)
      expect(error?.message).toBe("export_not_allowed")
    }
    const { error } = await create(anon, foreign)
    expect(error?.code).toBe("42501")
    const internal = await create(
      v.w.manager,
      [placeItem(v.accepted.asset, v.accepted.subject)],
      {
        mode: "internal",
      }
    )
    expect(internal.error?.message).toBe("export_not_allowed")
  })

  it("lets an admin export across venues, and internal photos only in internal mode", async () => {
    const both = (await ok(
      create(admin, [
        placeItem(v.accepted.asset, v.accepted.subject),
        placeItem(other.accepted.asset, other.accepted.subject),
      ])
    )) as Created
    expect(
      psql(
        `select coalesce(venue_id::text, 'none') from public.export_packages where id = '${both.packageId}'`
      )
    ).toBe("none")
    const internal = (await ok(
      create(admin, [placeItem(v.waiting.asset, v.waiting.subject)], {
        mode: "internal",
        profile: "original",
      })
    )) as Created
    expect(
      psql(
        `select array_to_string(use_restrictions, ',') from public.export_package_items where package_id = '${internal.packageId}'`
      )
    ).toContain("internal_only")
    // The venue's manager cannot open an internal package.
    await refused(
      v.w.manager,
      "export_package_detail",
      { p_package_id: internal.packageId },
      "export_package_not_found",
      "P0002"
    )
  })

  it("takes a Custom size only with both dimensions in range", async () => {
    const one = [placeItem(v.accepted.asset, v.accepted.subject)]
    expect(
      (await create(v.w.manager, one, { profile: "custom" })).error?.message
    ).toBe("export_size_invalid")
    expect(
      (
        await create(v.w.manager, one, {
          profile: "custom",
          width: 20,
          height: 900,
        })
      ).error?.message
    ).toBe("export_size_invalid")
    expect(
      (
        await create(v.w.manager, one, {
          profile: "website",
          width: 800,
          height: 800,
        })
      ).error?.message
    ).toBe("export_size_invalid")
    const ok1 = (await ok(
      create(v.w.manager, one, { profile: "custom", width: 800, height: 600 })
    )) as Created
    expect(
      psql(
        `select (profile ->> 'maxWidth') || 'x' || (profile ->> 'maxHeight') from public.export_packages where id = '${ok1.packageId}'`
      )
    ).toBe("800x600")
  })
})

describe("download: Exported, never Published (AC31)", () => {
  it("records a finished download as Exported and the photo reads Exported", async () => {
    const created = (await ok(
      create(v.w.manager, [placeItem(v.accepted.asset, v.accepted.subject)])
    )) as Created
    const started = await start(v.w.manager, created.packageId)
    expect(started.state).toBe("ready")
    if (started.state !== "ready") return
    expect(started.items[0]!.assetId).toBe(v.accepted.asset)
    // Only the person who started it may finish it.
    await refused(
      v.w.staffManager,
      "export_package_download_finish",
      {
        p_download_id: started.downloadId,
        p_completed: true,
        p_files: [{}],
      },
      "export_download_not_found",
      "P0002"
    )
    await finish(v.w.manager, started.downloadId)
    const again = await json<{ replayed: boolean }>(
      v.w.manager,
      "export_package_download_finish",
      {
        p_download_id: started.downloadId,
        p_completed: false,
      }
    )
    expect(again.replayed).toBe(true)

    const detail = await json<PackageJson>(
      v.w.manager,
      "export_package_detail",
      { p_package_id: created.packageId }
    )
    expect(detail.state).toBe("exported")
    const read = await candidates(v.w.manager, v.w.venue)
    const bar = read.items.find((i) => i.assetId === v.accepted.asset)!
    expect(bar.publication.state).toBe("exported")
    expect(bar.publication.exportedAt).not.toBeNull()
  })

  it("rechecks access at download: other venue, staff, inactive and anon see nothing", async () => {
    const created = (await ok(
      create(v.w.manager, [placeItem(v.accepted.asset, v.accepted.subject)])
    )) as Created
    for (const who of [other.w.manager, v.w.staffA, inactiveManager]) {
      await refused(
        who,
        "export_package_download_start",
        { p_package_id: created.packageId },
        "export_package_not_found",
        "P0002"
      )
      await refused(
        who,
        "export_package_detail",
        { p_package_id: created.packageId },
        "export_package_not_found",
        "P0002"
      )
    }
    const { error } = await call(anon, "export_package_download_start", {
      p_package_id: created.packageId,
    })
    expect(error?.code).toBe("42501")
    // A manager who loses the venue loses the package too.
    const leaver = await createIdentity(service, {
      label: "export-a-leaver",
      role: "staff",
      venueId: v.w.venue,
    })
    await legacyStaffGrant(service, admin, leaver.id, v.w.venue)
    const mine = (await ok(
      create(leaver, [placeItem(v.accepted.asset, v.accepted.subject)])
    )) as Created
    // Moved to another venue: the grant no longer applies.
    await ok(
      service
        .from("profiles")
        .update({ venue_id: other.w.venue })
        .eq("id", leaver.id)
    )
    await refused(
      leaver,
      "export_package_download_start",
      { p_package_id: mine.packageId },
      "export_package_not_found",
      "P0002"
    )
  })
})

describe("withdrawal invalidates a prepared package (AC32)", () => {
  it("refuses the download, marks the package and rebuilds without the file", async () => {
    const extra = await areaPhoto(v.w.staffB, v.places.cellar)
    await decideArea(v.reviewer, extra.label, "accepted")
    const created = (await ok(
      create(v.w.manager, [
        placeItem(v.accepted.asset, v.accepted.subject),
        placeItem(extra.asset, v.places.cellar),
      ])
    )) as Created

    await decideArea(v.reviewer, extra.label, "withdrawn", "Not the cellar")

    // The list shows it before anyone tries to download.
    const listed = await json<{ items: PackageJson[] }>(
      v.w.manager,
      "export_packages_list",
      { p_venue_id: v.w.venue }
    )
    const row = listed.items.find((p) => p.id === created.packageId)!
    expect(row.state).toBe("needs_rebuild")
    expect(row.staleAssets).toEqual([extra.asset])

    const started = await start(v.w.manager, created.packageId)
    expect(started).toEqual({
      state: "invalidated",
      packageId: created.packageId,
      reason: "item_withdrawn",
      removed: [extra.asset],
    })
    expect(
      Number(
        psql(
          `select count(*) from public.export_package_downloads where package_id = '${created.packageId}'`
        )
      )
    ).toBe(0)
    // Stays invalidated.
    expect((await start(v.w.manager, created.packageId)).state).toBe(
      "invalidated"
    )

    const rebuilt = await json<{ packageId: string; removed: string[] }>(
      v.w.manager,
      "export_package_rebuild",
      {
        p_request_key: key(),
        p_package_id: created.packageId,
      }
    )
    expect(rebuilt.removed).toEqual([extra.asset])
    const detail = await json<PackageJson>(
      v.w.manager,
      "export_package_detail",
      { p_package_id: rebuilt.packageId }
    )
    expect(detail.items!.map((i) => i.assetId)).toEqual([v.accepted.asset])
    expect((await start(v.w.manager, rebuilt.packageId)).state).toBe("ready")
  })

  it("has nothing to rebuild when every file was withdrawn", async () => {
    const lone = await areaPhoto(v.w.staffB, v.places.garden)
    await decideArea(v.reviewer, lone.label, "accepted")
    const created = (await ok(
      create(v.w.manager, [placeItem(lone.asset, v.places.garden)])
    )) as Created
    await decideArea(v.reviewer, lone.label, "withdrawn", "Wrong garden")
    await refused(
      v.w.manager,
      "export_package_rebuild",
      { p_request_key: key(), p_package_id: created.packageId },
      "export_nothing_left",
      "22023"
    )
  })

  it("stops a photo withdrawn through media use from entering a new export", async () => {
    const used = await areaPhoto(v.w.staffA, v.places.snug)
    await decideArea(v.reviewer, used.label, "accepted")
    expect(
      (await candidates(v.w.manager, v.w.venue)).items.map((i) => i.assetId)
    ).toContain(used.asset)
    // A deleted asset (the same path a removal takes) leaves every export.
    await ok(
      service
        .from("media_assets")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", used.asset)
    )
    expect(
      (await candidates(v.w.manager, v.w.venue)).items.map((i) => i.assetId)
    ).not.toContain(used.asset)
  })
})

describe("export_profiles", () => {
  it("is read by managers and admins, changed only by admins", async () => {
    const read = await json<{
      items: Array<{ key: string; revision: number; label: string }>
    }>(v.w.manager, "export_profiles")
    expect(read.items.map((p) => p.key)).toEqual([
      "original",
      "website",
      "social",
      "custom",
    ])
    for (const who of [v.w.staffA, inactiveManager]) {
      await refused(who, "export_profiles", {}, "export_not_allowed", "42501")
    }
    const social = read.items.find((p) => p.key === "social")!
    const args = {
      p_key: "social",
      p_label: "Social image",
      p_format: "jpeg",
      p_max_width: 1080,
      p_max_height: 1080,
      p_quality: 85,
      p_expected_revision: social.revision,
    }
    await refused(
      v.w.manager,
      "export_profile_set",
      args,
      "export_not_allowed",
      "42501"
    )
    await refused(
      admin,
      "export_profile_set",
      { ...args, p_max_width: null },
      "export_profile_invalid",
      "22023"
    )
    await refused(
      admin,
      "export_profile_set",
      { ...args, p_key: "original", p_expected_revision: 1 },
      "export_profile_invalid",
      "22023"
    )
    const changed = await json<{ changed: boolean; revision: number }>(
      admin,
      "export_profile_set",
      args
    )
    expect(changed).toMatchObject({
      changed: true,
      revision: social.revision + 1,
    })
    await refused(admin, "export_profile_set", args, "stale_revision", "40001")
    // Put it back.
    await json(admin, "export_profile_set", {
      ...args,
      p_max_height: 1350,
      p_expected_revision: social.revision + 1,
    })
    expect(
      Number(
        psql(
          `select count(*) from public.export_profile_events where key = 'social'`
        )
      )
    ).toBeGreaterThanOrEqual(2)
  })
})

describe("publication records (AC31, AC33)", () => {
  let site: string
  let otherSite: string

  beforeAll(async () => {
    site = (
      await json<{ id: string }>(admin, "publication_destination_save", {
        p_destination_id: null,
        p_venue_id: v.w.venue,
        p_label: `TEST website ${randomUUID().slice(0, 6)}`,
        p_url: "https://example.test/",
        p_active: true,
      })
    ).id
    otherSite = (
      await json<{ id: string }>(admin, "publication_destination_save", {
        p_destination_id: null,
        p_venue_id: other.w.venue,
        p_label: `TEST other ${randomUUID().slice(0, 6)}`,
        p_url: null,
        p_active: true,
      })
    ).id
  })

  const record = (who: { client: unknown }, args: Record<string, unknown>) =>
    call(who, "publication_record", {
      p_request_key: key(),
      p_occurred_on: new Date().toISOString().slice(0, 10),
      ...args,
    })

  it("lets only admins configure destinations", async () => {
    for (const who of [v.w.manager, v.w.staffA, inactiveManager]) {
      await refused(
        who,
        "publication_destination_save",
        {
          p_destination_id: null,
          p_venue_id: v.w.venue,
          p_label: "Nope",
          p_url: null,
          p_active: true,
        },
        "publication_not_allowed",
        "42501"
      )
    }
    await refused(
      admin,
      "publication_destination_save",
      {
        p_destination_id: site,
        p_venue_id: v.w.venue,
        p_label: "Renamed",
        p_url: null,
        p_active: true,
        p_expected_revision: 99,
      },
      "stale_revision",
      "40001"
    )
  })

  it("records Published with where, when and who; Exported alone is not Published", async () => {
    const photo = await areaPhoto(v.w.staffA, v.places.bar)
    await decideArea(v.reviewer, photo.label, "accepted")

    for (const who of [v.w.manager, v.w.staffA]) {
      const { error } = await record(who, {
        p_destination_id: site,
        p_asset_id: photo.asset,
        p_action: "published",
        p_external_url: "https://example.test/bar",
      })
      expect(error?.message).toBe("publication_not_allowed")
    }
    const noWhere = await record(admin, {
      p_destination_id: site,
      p_asset_id: photo.asset,
      p_action: "published",
    })
    expect(noWhere.error?.message).toBe("publication_where_required")
    const wrongVenue = await record(admin, {
      p_destination_id: otherSite,
      p_asset_id: photo.asset,
      p_action: "published",
      p_external_ref: "x",
    })
    expect(wrongVenue.error?.message).toBe("publication_scope_mismatch")
    const future = await record(admin, {
      p_destination_id: site,
      p_asset_id: photo.asset,
      p_action: "published",
      p_external_ref: "x",
      p_occurred_on: "2099-01-01",
    })
    expect(future.error?.message).toBe("publication_date_invalid")
    const notEligible = await record(admin, {
      p_destination_id: site,
      p_asset_id: v.waiting.asset,
      p_action: "published",
      p_external_ref: "x",
    })
    expect(notEligible.error?.message).toBe("publication_not_eligible")

    const published = (await ok(
      record(admin, {
        p_destination_id: site,
        p_asset_id: photo.asset,
        p_action: "published",
        p_external_url: "https://example.test/bar",
      })
    )) as { state: string; generation: number }
    expect(published).toMatchObject({
      state: "published_confirmed",
      generation: 1,
    })
    const read = await candidates(v.w.manager, v.w.venue)
    expect(
      read.items.find((i) => i.assetId === photo.asset)?.publication.state
    ).toBe("published_confirmed")

    // Withdrawn internally: the destination stays Withdrawal pending until a
    // person confirms the external copy is gone (AC33, §14.2).
    await decideArea(v.reviewer, photo.label, "withdrawn", "Refurbished")
    const overview = await json<{
      outstanding: Array<{
        assetId: string
        state: string
        destinationId: string
      }>
      canRecord: boolean
    }>(admin, "publication_overview", { p_venue_id: v.w.venue })
    expect(overview.outstanding).toContainEqual(
      expect.objectContaining({
        assetId: photo.asset,
        destinationId: site,
        state: "withdrawal_pending",
      })
    )
    const status = await json<{ publication: Publication }>(
      v.w.manager,
      "export_asset_status",
      { p_asset_id: photo.asset }
    )
    expect(status.publication.state).toBe("withdrawal_pending")
    // Not eligible any more: cannot be re-published.
    const again = await record(admin, {
      p_destination_id: site,
      p_asset_id: photo.asset,
      p_action: "published",
      p_external_ref: "x",
    })
    expect(again.error?.message).toBe("publication_not_eligible")

    const withdrawn = (await ok(
      record(admin, {
        p_destination_id: site,
        p_asset_id: photo.asset,
        p_action: "withdrawn",
        p_note: "Taken down",
      })
    )) as { state: string; generation: number }
    expect(withdrawn).toMatchObject({
      state: "withdrawn_confirmed",
      generation: 2,
    })
    const after = await json<{ outstanding: Array<{ assetId: string }> }>(
      admin,
      "publication_overview",
      { p_venue_id: v.w.venue }
    )
    expect(after.outstanding.map((o) => o.assetId)).not.toContain(photo.asset)
    const nothing = await record(admin, {
      p_destination_id: site,
      p_asset_id: photo.asset,
      p_action: "withdrawn",
    })
    expect(nothing.error?.message).toBe("publication_nothing_published")
  })

  it("lets a manager read their venue's publication status, nobody else's", async () => {
    const mine = await json<{
      canRecord: boolean
      destinations: Array<{ id: string }>
    }>(v.w.manager, "publication_overview", { p_venue_id: v.w.venue })
    expect(mine.canRecord).toBe(false)
    expect(mine.destinations.map((d) => d.id)).toContain(site)
    expect(mine.destinations.map((d) => d.id)).not.toContain(otherSite)
    for (const who of [other.w.manager, v.w.staffA, inactiveManager]) {
      await refused(
        who,
        "publication_overview",
        { p_venue_id: v.w.venue },
        "publication_not_allowed",
        "42501"
      )
    }
    await refused(
      other.w.manager,
      "export_asset_status",
      { p_asset_id: v.accepted.asset },
      "media_asset_not_found",
      "P0002"
    )
    const { error } = await call(anon, "publication_overview", {
      p_venue_id: v.w.venue,
    })
    expect(error?.code).toBe("42501")
  })
})

describe("export_asset_thumb: the thumbnail gate", () => {
  const gate = async (who: { client: unknown }, asset: string) => {
    const { data, error } = await call(who, "export_asset_thumb", {
      p_asset_id: asset,
    })
    if (error) return error.code
    return (data as Array<{ asset_id: string }>).map((r) => r.asset_id)
  }

  it("opens exportable photos to the venue's manager, internal ones to admins", async () => {
    expect(await gate(v.w.manager, v.accepted.asset)).toEqual([
      v.accepted.asset,
    ])
    expect(await gate(v.w.manager, v.waiting.asset)).toEqual([])
    expect(await gate(admin, v.waiting.asset)).toEqual([v.waiting.asset])
  })

  it("is closed to another venue, staff, inactive accounts and anon", async () => {
    for (const who of [other.w.manager, v.w.staffA, inactiveManager]) {
      expect(await gate(who, v.accepted.asset)).toEqual([])
    }
    expect(await gate(anon, v.accepted.asset)).toBe("42501")
  })
})

describe("tables are reachable only through the functions", () => {
  it("gives signed-in users no table access and keeps records append-only", async () => {
    for (const table of [
      "export_packages",
      "export_package_items",
      "export_package_downloads",
      "publication_events",
      "publication_destinations",
      "export_profiles",
    ]) {
      const { error } = await v.w.manager.client
        .from(table as "profiles")
        .select("*")
        .limit(1)
      expect(error?.code).toBe("42501")
    }
    expect(() =>
      psql(
        `update public.export_package_items set subject_label = 'x' where position = 1`
      )
    ).toThrow(/append_only|immutable/i)
    expect(() => psql(`delete from public.export_packages`)).toThrow(
      /export_record_immutable/
    )
    expect(() => psql(`update public.export_packages set note = 'x'`)).toThrow(
      /export_record_immutable/
    )
    expect(() => psql(`delete from public.publication_events`)).toThrow(
      /append_only|immutable/i
    )
  })
})

describe("the ZIP (lib/server/exports/download.ts)", () => {
  async function storedPhoto(who: TestIdentity, bytes: Uint8Array) {
    const { data, error } = await who.client.rpc("reserve_media_asset", {
      p_client_upload_key: randomUUID(),
      p_size_bytes: bytes.length,
      p_media_type: "image",
      p_extension: "jpg",
      p_original_filename: "IMG_0001 by Anna.jpg",
    })
    if (error) throw error
    const row = data[0]!
    const put = await who.client.storage
      .from("media")
      .upload(row.original_path, bytes, { contentType: "image/jpeg" })
    if (put.error) throw put.error
    await ok(
      service
        .from("media_assets")
        .update({ upload_state: "processing" })
        .eq("id", row.id)
    )
    await ok(
      service
        .from("media_assets")
        .update({
          upload_state: "ready",
          validated_mime_type: "image/jpeg",
          size_bytes: bytes.length,
          width: 2400,
          height: 1600,
        })
        .eq("id", row.id)
    )
    return row.id as string
  }

  function actorFor(who: TestIdentity): MediaActor {
    return {
      profile: { id: who.id } as CurrentProfile,
      db: who.client,
      service,
      storage: {
        url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
        serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      },
    }
  }

  it("streams resized files with a manifest and records Exported", async () => {
    const jpeg = new Uint8Array(
      await sharp({
        create: {
          width: 2400,
          height: 1600,
          channels: 3,
          background: "#336699",
        },
      })
        .withExif({
          IFD3: { GPSLatitudeRef: "N", GPSLatitude: "52/1 13/1 0/1" },
        })
        .jpeg()
        .toBuffer()
    )
    const asset = await storedPhoto(v.w.staffA, jpeg)
    const snug = place(
      v.w.venue,
      admin.id,
      `Back room ${randomUUID().slice(0, 4)}`
    )
    const [row] = (await ok(
      v.w.staffA.client.rpc("set_media_area_label", {
        p_asset_id: asset,
        p_subject_id: snug,
      })
    ))!
    await decideArea(
      v.reviewer,
      (row as { label_id: string }).label_id,
      "accepted"
    )
    const created = (await ok(
      create(v.w.manager, [
        { ...placeItem(asset, snug), altText: "The back room" },
      ])
    )) as Created

    const outcome = await startPackageDownload(
      actorFor(v.w.manager),
      created.packageId
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.response.headers.get("content-type")).toBe("application/zip")
    expect(outcome.response.headers.get("cache-control")).toBe(
      "private, no-store"
    )
    const zip = new Uint8Array(await outcome.response.arrayBuffer())

    const names: string[] = []
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    const end = zip.length - 22
    let p = view.getUint32(end + 16, true)
    const files: Record<string, Uint8Array> = {}
    for (let i = 0; i < view.getUint16(end + 10, true); i++) {
      const size = view.getUint32(p + 20, true)
      const nameLen = view.getUint16(p + 28, true)
      const offset = view.getUint32(p + 42, true)
      const name = new TextDecoder().decode(
        zip.subarray(p + 46, p + 46 + nameLen)
      )
      const start = offset + 30 + view.getUint16(offset + 26, true)
      files[name] = zip.subarray(start, start + size)
      names.push(name)
      p += 46 + nameLen
    }
    const photo = names.find((n) => n.endsWith(".webp"))!
    expect(photo).toMatch(/^[a-z0-9-]+-back-room-[a-z0-9]+-[0-9a-f]{8}\.webp$/)
    expect(photo).not.toMatch(/anna|img/i)
    expect(names).toEqual(
      expect.arrayContaining(["manifest.json", "manifest.csv", "READ-ME.txt"])
    )
    const meta = await sharp(files[photo]!).metadata()
    expect([meta.width, meta.height]).toEqual([1600, 1067])
    expect(meta.exif).toBeUndefined()
    const manifest = JSON.parse(
      new TextDecoder().decode(files["manifest.json"]!)
    )
    expect(manifest.state).toBe("exported")
    expect(manifest.files[0]).toMatchObject({
      file: photo,
      assetId: asset,
      venueId: v.w.venue,
      sourceVenueId: v.w.venue,
      subjectKind: "place",
      subjectId: snug,
      approvalKind: "area_photo_decision",
      approvalLevel: "public",
      altText: "The back room",
      captureTimeSource: "unknown",
      width: 1600,
      height: 1067,
    })
    expect(
      new TextDecoder().decode(files["manifest.csv"]!).split("\r\n")[0]
    ).toContain("assetId,renditionId")

    const detail = await json<
      PackageJson & {
        downloads: Array<{ completedAt: string | null; fileCount: number }>
      }
    >(v.w.manager, "export_package_detail", { p_package_id: created.packageId })
    expect(detail.state).toBe("exported")
    expect(detail.downloads[0]).toMatchObject({ fileCount: 1 })
    expect(detail.downloads[0]!.completedAt).not.toBeNull()
  })

  it("answers an invalidated package without bytes", async () => {
    const photo = await areaPhoto(v.w.staffA, v.places.cellar)
    await decideArea(v.reviewer, photo.label, "accepted")
    const created = (await ok(
      create(v.w.manager, [placeItem(photo.asset, v.places.cellar)])
    )) as Created
    await decideArea(v.reviewer, photo.label, "withdrawn", "Wrong room")
    const outcome = await startPackageDownload(
      actorFor(v.w.manager),
      created.packageId
    )
    expect(outcome).toMatchObject({
      ok: false,
      status: 409,
      code: "export_package_invalidated",
      removed: [photo.asset],
    })
    const foreign = await startPackageDownload(
      actorFor(other.w.manager),
      created.packageId
    )
    expect(foreign).toMatchObject({ ok: false, status: 404 })
  })
})
