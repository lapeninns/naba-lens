// v0.3 labelling server (packet F): lib/server/labels and the app/_labels
// Server Functions, driven as real signed-in identities against an isolated
// local stack. getMediaActor is replaced by the same MediaActor the app builds
// (tests/slice/media-actor.ts) because Server Functions read cookies in Next;
// every read and write below still goes through the caller's RLS client. The
// service role only arranges state (venues, accounts, ready/deleted assets,
// transfers, deactivation) and reads persisted rows back.
import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it, vi } from "vitest"

import {
  loadLabelCatalogue,
  loadLabelEditorContext,
  saveLabelBatch,
} from "../../app/_labels/actions"
import { parseMenuJson } from "../../lib/menus/import"
import {
  EMPTY_LABEL_SUMMARY,
  LABEL_LIMITS,
  type LabelCatalogue,
  type SaveLabelsInput,
} from "../../lib/menus/types"
import {
  getAssetLabelContext,
  getLabellingCatalogue,
  loadLabelSummaries,
  saveAssetLabels,
} from "../../lib/server/labels"
import type { MediaActor } from "../../lib/server/media/types"
import { actorFor } from "../slice/media-actor"
import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import {
  createDraft,
  item,
  menu,
  publishMenu,
  readDocument,
  reserve,
  reserveReady,
  section,
  type CatalogueRow,
} from "./menus-fixtures"

const session = vi.hoisted(() => ({ actor: null as MediaActor | null }))
vi.mock("@/lib/server/media/context", () => ({
  getMediaActor: async () =>
    session.actor
      ? { ok: true, actor: session.actor }
      : { ok: false, status: 401, message: "Sign in to continue." },
}))

const service = serviceClient()

let venueA: string
let venueB: string
let venueC: string
let venueEmpty: string
let admin: TestIdentity
let staffA: TestIdentity
let staffA2: TestIdentity
let staffB: TestIdentity
let staffC: TestIdentity
let railway: Record<string, CatalogueRow>
let railwayVersion: string
let bVersion: string
let bRows: Record<string, CatalogueRow>

const ref = (row: CatalogueRow, variant?: number) => ({
  itemId: row.itemId,
  variantId: variant === undefined ? null : row.variants[variant]!.variantId,
})

function input(
  assetId: string,
  patch: Partial<SaveLabelsInput> = {}
): SaveLabelsInput {
  return {
    assetId,
    expectedRevision: 0,
    catalogueVersionId: null,
    contentTypes: [],
    note: null,
    items: [],
    missingItem: null,
    ...patch,
  }
}

async function as(identity: TestIdentity) {
  const actor = await actorFor(identity)
  session.actor = actor
  return actor
}

async function tombstone(assetId: string) {
  const { error } = await service
    .from("media_assets")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", assetId)
  if (error) throw error
}

async function labelItemCount(assetId: string) {
  const { count, error } = await service
    .from("media_label_items")
    .select("id", { count: "exact", head: true })
    .eq("asset_id", assetId)
  if (error) throw error
  return count
}

function activeCatalogue(catalogue: LabelCatalogue) {
  if (catalogue.status !== "active") throw new Error("expected active")
  return catalogue
}

beforeAll(async () => {
  venueA = (await createVenue(service, "lsrv-a")).id
  venueB = (await createVenue(service, "lsrv-b")).id
  venueC = (await createVenue(service, "lsrv-c")).id
  venueEmpty = (await createVenue(service, "lsrv-empty")).id
  admin = await createIdentity(service, { label: "lsrv-admin", role: "admin" })
  staffA = await createIdentity(service, {
    label: "lsrv-staff-a",
    role: "staff",
    venueId: venueA,
  })
  staffA2 = await createIdentity(service, {
    label: "lsrv-staff-a2",
    role: "staff",
    venueId: venueA,
  })
  staffB = await createIdentity(service, {
    label: "lsrv-staff-b",
    role: "staff",
    venueId: venueB,
  })
  staffC = await createIdentity(service, {
    label: "lsrv-staff-c",
    role: "staff",
    venueId: venueC,
  })

  // Venue A: The Railway fixture through C's parser and B's RPCs (as admin).
  const parsed = parseMenuJson(
    readFileSync("tests/fixtures/menus/the-railway.food.json", "utf8")
  )
  if (!parsed.ok) throw new Error("fixture did not parse")
  railwayVersion = await publishMenu(admin, venueA, parsed.document)
  railway = (await readDocument(service, railwayVersion)).byKey

  bVersion = await publishMenu(
    admin,
    venueB,
    menu("B menu", [section("mains", "Mains", [item("mains--pie", "Pie", {})])])
  )
  bRows = (await readDocument(service, bVersion)).byKey
})

describe("getLabellingCatalogue", () => {
  it("gives staff their venue's active menu in order, without archived items", async () => {
    const actor = await as(staffA)
    const found = await getLabellingCatalogue(actor, venueA)
    expect(found.ok).toBe(true)
    if (!found.ok) return
    const catalogue = activeCatalogue(found.catalogue)
    expect(catalogue.versionId).toBe(railwayVersion)
    expect(catalogue.venueId).toBe(venueA)
    const parsed = parseMenuJson(
      readFileSync("tests/fixtures/menus/the-railway.food.json", "utf8")
    )
    if (!parsed.ok) throw new Error("fixture")
    expect(catalogue.sections.map((s) => s.slug)).toEqual(
      parsed.document.sections.map((s) => s.slug)
    )
    expect(catalogue.sections[0].items.map((i) => i.name)).toEqual(
      parsed.document.sections[0].items.map((i) => i.name)
    )
    const momo = catalogue.sections
      .flatMap((s) => s.items)
      .find((i) => i.itemId === railway["appetisers--momo-veg-chicken"].itemId)
    expect(momo?.variants.map((v) => v.name)).toEqual(["Veg", "Chicken"])
  })

  it("hides other venues from staff (404) but not from admins", async () => {
    expect((await getLabellingCatalogue(await as(staffA), venueB)).ok).toBe(
      false
    )
    const other = await getLabellingCatalogue(await as(staffA), venueB)
    expect(!other.ok && other.status).toBe(404)
    const unknown = await getLabellingCatalogue(await as(staffA), randomUUID())
    expect(!unknown.ok && unknown.status).toBe(404)
    const adminView = await getLabellingCatalogue(await as(admin), venueB)
    expect(adminView.ok && adminView.catalogue.status).toBe("active")
  })

  it("reports a venue without an active menu as status none", async () => {
    const found = await getLabellingCatalogue(await as(admin), venueEmpty)
    expect(found.ok).toBe(true)
    if (!found.ok) return
    expect(found.catalogue.status).toBe("none")
    expect(found.catalogue.venueName).toMatch(/lsrv-empty/)
    // A draft is never offered for labelling.
    await createDraft(
      admin,
      venueEmpty,
      menu("Draft", [section("s", "S", [item("s--x", "X")])])
    )
    const again = await getLabellingCatalogue(await as(admin), venueEmpty)
    expect(again.ok && again.catalogue.status).toBe("none")
  })
})

describe("getAssetLabelContext", () => {
  it("lists own ready assets and reports everything else as missing", async () => {
    const photo = await reserveReady(service, staffA, "image")
    const video = await reserveReady(service, staffA, "video")
    const unfinished = await reserve(staffA, "image")
    const deleted = await reserveReady(service, staffA, "image")
    await tombstone(deleted.id)
    const others = await reserveReady(service, staffA2, "image")
    const unknown = randomUUID()

    const actor = await as(staffA)
    const result = await getAssetLabelContext(actor, [
      photo.id,
      video.id,
      unfinished.id,
      deleted.id,
      others.id,
      unknown,
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.assets.map((a) => a.id)).toEqual([photo.id, video.id])
    expect(result.assets[1].mediaType).toBe("video")
    expect(result.assets[0].venueId).toBe(venueA)
    expect(result.assets[0].labels).toEqual(EMPTY_LABEL_SUMMARY)
    expect(result.missing.sort()).toEqual(
      [unfinished.id, deleted.id, others.id, unknown].sort()
    )

    // Admin: any ready asset, still not the unfinished or deleted one.
    const adminResult = await getAssetLabelContext(await as(admin), [
      others.id,
      unfinished.id,
      deleted.id,
    ])
    expect(adminResult.ok && adminResult.assets.map((a) => a.id)).toEqual([
      others.id,
    ])
  })

  it("rejects malformed and oversized requests", async () => {
    const actor = await as(staffA)
    const tooMany = Array.from(
      { length: LABEL_LIMITS.maxBatchAssets + 1 },
      () => randomUUID()
    )
    for (const ids of [[], ["not-a-uuid"], tooMany]) {
      const result = await getAssetLabelContext(actor, ids)
      expect(!result.ok && result.status).toBe(400)
    }
  })
})

describe("saving labels", () => {
  it("labels own photo and video with several items incl. variants, per-asset results", async () => {
    const photo = await reserveReady(service, staffA, "image")
    const video = await reserveReady(service, staffA, "video")
    const others = await reserveReady(service, staffA2, "image")
    await as(staffA)

    const context = await loadLabelEditorContext([photo.id, video.id])
    expect(context.ok).toBe(true)
    if (!context.ok) return
    const catalogue = activeCatalogue(context.catalogue!)
    expect(catalogue.versionId).toBe(railwayVersion)

    const items = [
      ref(railway["appetisers--momo-veg-chicken"], 0),
      ref(railway["appetisers--momo-veg-chicken"], 1),
      ref(railway["house-special--railway-lamb-flame-sizzler"]),
    ]
    const results = await saveLabelBatch([
      input(photo.id, {
        catalogueVersionId: catalogue.versionId,
        contentTypes: ["plating", "dish"],
        note: "  Saturday special  ",
        items,
      }),
      input(others.id, { catalogueVersionId: catalogue.versionId, items }),
      input(video.id, {
        catalogueVersionId: catalogue.versionId,
        contentTypes: ["preparation"],
        items: [items[2]],
      }),
    ])
    expect(results.map((r) => r.assetId)).toEqual([
      photo.id,
      others.id,
      video.id,
    ])
    expect(results.map((r) => (r.ok ? "ok" : r.code))).toEqual([
      "ok",
      "not_found",
      "ok",
    ])
    const saved = results[0]
    if (!saved.ok) return
    expect(saved.labels.revision).toBe(1)
    expect(saved.labels.contentTypes).toEqual(["dish", "plating"])
    expect(saved.labels.note).toBe("Saturday special")
    expect(saved.labels.hasLabels).toBe(true)
    const momo = railway["appetisers--momo-veg-chicken"]
    const lamb = railway["house-special--railway-lamb-flame-sizzler"]
    // Stable (added_at, id) order from media_label_details, not input order.
    const view = (i: {
      name: string
      variantName: string | null
      state: string
    }) => [i.name, i.variantName ?? "", i.state].join("|")
    expect(saved.labels.items.map(view).sort()).toEqual(
      [
        [momo.name, momo.variants[0].name, "current"],
        [momo.name, momo.variants[1].name, "current"],
        [lamb.name, "", "current"],
      ]
        .map((parts) => parts.join("|"))
        .sort()
    )
    expect(saved.labels.items.every((i) => i.labelledAs === null)).toBe(true)
    expect(await labelItemCount(others.id)).toBe(0)

    // The editor context now shows the saved labels.
    const reread = await getAssetLabelContext(session.actor!, [video.id])
    expect(reread.ok && reread.assets[0].labels.items).toHaveLength(1)
  })

  it("refuses another venue's item (invalid) and malformed input", async () => {
    const photo = await reserveReady(service, staffA, "image")
    const actor = await as(staffA)
    const wrongVenue = await saveAssetLabels(
      actor,
      input(photo.id, {
        catalogueVersionId: railwayVersion,
        items: [ref(bRows["mains--pie"])],
      })
    )
    expect(!wrongVenue.ok && wrongVenue.code).toBe("invalid")

    const bad: Partial<SaveLabelsInput>[] = [
      { contentTypes: ["selfie" as never] },
      { contentTypes: ["dish", "plating", "kitchen", "team", "venue"] },
      { note: "x".repeat(LABEL_LIMITS.maxNoteLength + 1) },
      { missingItem: "y".repeat(LABEL_LIMITS.maxMissingItemLength + 1) },
      { items: [{ itemId: "nope", variantId: null }] },
      { expectedRevision: -1 },
      {
        items: Array.from({ length: 21 }, () => ({
          itemId: randomUUID(),
          variantId: null,
        })),
      },
    ]
    for (const patch of bad) {
      const result = await saveAssetLabels(actor, input(photo.id, patch))
      expect(!result.ok && result.code, JSON.stringify(patch)).toBe("invalid")
    }
    const notUuid = await saveAssetLabels(actor, input("not-a-uuid"))
    expect(!notUuid.ok && notUuid.code).toBe("invalid")
    expect(await labelItemCount(photo.id)).toBe(0)
  })

  it("treats deleted and unfinished assets as not found; inactive staff as forbidden", async () => {
    const unfinished = await reserve(staffA, "image")
    const deleted = await reserveReady(service, staffA, "image")
    await tombstone(deleted.id)
    const actor = await as(staffA)
    for (const id of [unfinished.id, deleted.id, randomUUID()]) {
      const result = await saveAssetLabels(
        actor,
        input(id, { contentTypes: ["dish"] })
      )
      expect(!result.ok && result.code).toBe("not_found")
    }

    const inactive = await createIdentity(service, {
      label: "lsrv-inactive",
      role: "staff",
      venueId: venueA,
    })
    const own = await reserveReady(service, inactive, "image")
    const stale = await actorFor(inactive) // built while still active
    await service
      .from("profiles")
      .update({ active: false })
      .eq("id", inactive.id)
    const result = await saveAssetLabels(
      stale,
      input(own.id, { contentTypes: ["dish"] })
    )
    expect(!result.ok && result.code).toBe("forbidden")
    expect(await labelItemCount(own.id)).toBe(0)
  })

  it("returns conflict with the current labels on a stale revision; retries never duplicate", async () => {
    const photo = await reserveReady(service, staffA, "image")
    const actor = await as(staffA)
    const tuple = ref(railway["appetisers--momo-veg-chicken"], 1)
    const first = input(photo.id, {
      catalogueVersionId: railwayVersion,
      items: [tuple, tuple],
      contentTypes: ["dish"],
    })
    const ok = await saveAssetLabels(actor, first)
    expect(ok.ok).toBe(true)

    // A retry of the same request (e.g. after a lost response).
    const retry = await saveAssetLabels(actor, first)
    expect(retry.ok).toBe(false)
    if (retry.ok) return
    expect(retry.code).toBe("conflict")
    expect(retry.current?.revision).toBe(1)
    expect(retry.current?.items).toHaveLength(1)

    const again = await saveAssetLabels(actor, {
      ...first,
      expectedRevision: retry.current!.revision,
    })
    expect(again.ok && again.labels.revision).toBe(2)
    expect(await labelItemCount(photo.id)).toBe(1)
  })
})

describe("staff transfer", () => {
  it("labels an old asset against its original venue's catalogue", async () => {
    const mover = await createIdentity(service, {
      label: "lsrv-mover",
      role: "staff",
      venueId: venueA,
    })
    const old = await reserveReady(service, mover, "image")
    await service
      .from("profiles")
      .update({ venue_id: venueB })
      .eq("id", mover.id)

    await as(mover)
    expect(session.actor!.profile.venueId).toBe(venueB)
    const context = await loadLabelEditorContext([old.id])
    expect(context.ok).toBe(true)
    if (!context.ok) return
    expect(context.assets[0].venueId).toBe(venueA)
    const catalogue = activeCatalogue(context.catalogue!)
    expect(catalogue.venueId).toBe(venueA)

    const [result] = await saveLabelBatch([
      input(old.id, {
        catalogueVersionId: catalogue.versionId,
        items: [ref(railway["house-special--railway-lamb-flame-sizzler"])],
      }),
    ])
    expect(result.ok).toBe(true)
    // The new venue's item is refused for the old asset.
    const wrong = await saveAssetLabels(
      session.actor!,
      input(old.id, {
        expectedRevision: 1,
        catalogueVersionId: catalogue.versionId,
        items: [ref(bRows["mains--pie"])],
      })
    )
    expect(!wrong.ok && wrong.code).toBe("invalid")
    // And the new venue's catalogue is theirs too.
    expect((await loadLabelCatalogue(venueB)).ok).toBe(true)
  })
})

describe("catalogue lifecycle", () => {
  let v1: string
  let rows: Record<string, CatalogueRow>

  beforeAll(async () => {
    v1 = await publishMenu(
      admin,
      venueC,
      menu("C v1", [
        section("curries", "Curries", [
          item("curries--korma", "Korma", { variants: ["Chicken", "Lamb"] }),
          item("curries--dal", "Dal"),
          item("curries--saag", "Saag"),
        ]),
        section("drinks", "Drinks", [item("drinks--lassi", "Lassi")], "drinks"),
      ])
    )
    rows = (await readDocument(service, v1)).byKey
  })

  it("re-activation mid-edit -> catalogue_changed; existing items keep saving", async () => {
    const photo = await reserveReady(service, staffC, "image")
    const actor = await as(staffC)
    const saved = await saveAssetLabels(
      actor,
      input(photo.id, {
        catalogueVersionId: v1,
        items: [ref(rows["curries--dal"])],
      })
    )
    expect(saved.ok).toBe(true)

    // Admin re-activates (same content, new version) while the editor is open.
    const doc = await readDocument(service, v1)
    const v2 = await publishMenu(admin, venueC, { ...doc, title: "C v2" }, v1)

    const stale = await saveAssetLabels(
      actor,
      input(photo.id, {
        expectedRevision: 1,
        catalogueVersionId: v1,
        items: [ref(rows["curries--dal"]), ref(rows["drinks--lassi"])],
      })
    )
    expect(!stale.ok && stale.code).toBe("catalogue_changed")

    // Keeping the existing tuple + a note never needs the current menu.
    const keep = await saveAssetLabels(
      actor,
      input(photo.id, {
        expectedRevision: 1,
        catalogueVersionId: v1,
        items: [ref(rows["curries--dal"])],
        note: "kept",
      })
    )
    expect(keep.ok && keep.labels.note).toBe("kept")

    const fresh = await loadLabelCatalogue(venueC)
    expect(fresh.ok && activeCatalogue(fresh.catalogue).versionId).toBe(v2)
    v1 = v2
  })

  it("archived or removed items -> unavailable_items with ids", async () => {
    const photo = await reserveReady(service, staffC, "image")
    const { error } = await admin.client.rpc("set_menu_item_archived", {
      p_item_id: rows["curries--saag"].itemId,
      p_archived: true,
    })
    expect(error).toBeNull()
    const actor = await as(staffC)

    // The catalogue no longer offers it.
    const catalogue = await getLabellingCatalogue(actor, venueC)
    const ids =
      catalogue.ok && catalogue.catalogue.status === "active"
        ? catalogue.catalogue.sections.flatMap((s) =>
            s.items.map((i) => i.itemId)
          )
        : []
    expect(ids).not.toContain(rows["curries--saag"].itemId)
    expect(ids).toContain(rows["curries--dal"].itemId)

    const result = await saveAssetLabels(
      actor,
      input(photo.id, {
        catalogueVersionId: v1,
        items: [ref(rows["curries--dal"]), ref(rows["curries--saag"])],
      })
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("unavailable_items")
    expect(result.unavailableItemIds).toEqual([rows["curries--saag"].itemId])
    expect(await labelItemCount(photo.id)).toBe(0)

    await admin.client.rpc("set_menu_item_archived", {
      p_item_id: rows["curries--saag"].itemId,
      p_archived: false,
    })
  })

  it("existing labels survive rename, removal, archive and re-activation (labelledAs/state)", async () => {
    const photo = await reserveReady(service, staffC, "image")
    const actor = await as(staffC)
    const saved = await saveAssetLabels(
      actor,
      input(photo.id, {
        catalogueVersionId: v1,
        items: [
          ref(rows["curries--korma"], 1),
          ref(rows["curries--saag"]),
          ref(rows["drinks--lassi"]),
        ],
      })
    )
    expect(saved.ok).toBe(true)

    // v3: Korma renamed (and its Lamb variant), Saag dropped, Lassi moved.
    const base = await readDocument(service, v1)
    const doc = {
      title: "C v3",
      sections: [
        {
          ...base.sections[0],
          name: "House Curries",
          items: base.sections[0].items
            .filter((i) => i.sourceKey !== "curries--saag")
            .map((i) =>
              i.sourceKey === "curries--korma"
                ? {
                    ...i,
                    name: "Royal Korma",
                    variants: i.variants.map((v) =>
                      v.name === "Lamb" ? { ...v, name: "Lamb shoulder" } : v
                    ),
                  }
                : i
            ),
        },
        base.sections[1],
      ],
    }
    const v3 = await publishMenu(admin, venueC, doc, v1)
    await admin.client.rpc("set_menu_item_archived", {
      p_item_id: rows["drinks--lassi"].itemId,
      p_archived: true,
    })

    const summaries = await loadLabelSummaries(actor.db, [photo.id], {
      viewerId: actor.profile.id,
    })
    const items = summaries.get(photo.id)!.items
    const byItem = Object.fromEntries(items.map((i) => [i.itemId, i]))
    expect(byItem[rows["curries--korma"].itemId]).toMatchObject({
      name: "Royal Korma",
      variantName: "Lamb shoulder",
      sectionName: "House Curries",
      labelledAs: "Korma, Lamb",
      state: "current",
    })
    expect(byItem[rows["curries--saag"].itemId]).toMatchObject({
      name: "Saag",
      labelledAs: null,
      state: "not_on_active_menu",
    })
    expect(byItem[rows["drinks--lassi"].itemId]).toMatchObject({
      name: "Lassi",
      state: "archived",
    })

    // A note-only save keeps all three, even against the new catalogue.
    const keep = await saveAssetLabels(
      actor,
      input(photo.id, {
        expectedRevision: 1,
        catalogueVersionId: v3,
        items: items.map((i) => ({ itemId: i.itemId, variantId: i.variantId })),
        note: "still here",
      })
    )
    expect(keep.ok && keep.labels.items).toHaveLength(3)
    expect(await labelItemCount(photo.id)).toBe(3)

    await admin.client.rpc("set_menu_item_archived", {
      p_item_id: rows["drinks--lassi"].itemId,
      p_archived: false,
    })
    v1 = v3
  })
})

describe("admin correction and missing-item suggestions", () => {
  it("lets an admin correct a staff asset; suggestions are visible per role", async () => {
    const photo = await reserveReady(service, staffA, "image")
    const staff = await as(staffA)
    const first = await saveAssetLabels(
      staff,
      input(photo.id, {
        catalogueVersionId: railwayVersion,
        items: [ref(railway["appetisers--momo-veg-chicken"], 0)],
        missingItem: "  Goat curry ",
      })
    )
    expect(first.ok && first.labels.missingItem).toBe("Goat curry")

    // Another staff member sees nothing of it.
    const peer = await as(staffA2)
    expect((await loadLabelSummaries(peer.db, [photo.id])).size).toBe(0)
    const peerSave = await saveAssetLabels(
      peer,
      input(photo.id, { expectedRevision: 1, contentTypes: ["dish"] })
    )
    expect(!peerSave.ok && peerSave.code).toBe("not_found")

    // Admin sees the staff suggestion text and corrects the labels.
    const adminActor = await as(admin)
    const adminView = await getAssetLabelContext(adminActor, [photo.id])
    expect(adminView.ok && adminView.assets[0].labels.missingItem).toBe(
      "Goat curry"
    )
    const corrected = await saveLabelBatch([
      input(photo.id, {
        expectedRevision: 1,
        catalogueVersionId: railwayVersion,
        contentTypes: ["dish"],
        items: [ref(railway["house-special--railway-lamb-flame-sizzler"])],
        missingItem: "Lamb chops",
      }),
    ])
    expect(corrected[0].ok).toBe(true)
    if (!corrected[0].ok) return
    // The admin's own open suggestion is preferred in the admin's view.
    expect(corrected[0].labels.missingItem).toBe("Lamb chops")
    expect(corrected[0].labels.items.map((i) => i.itemId)).toEqual([
      railway["house-special--railway-lamb-flame-sizzler"].itemId,
    ])

    // Staff see the correction, and only their own suggestion text.
    const staffView = await loadLabelSummaries(staff.db, [photo.id], {
      viewerId: staff.profile.id,
    })
    expect(staffView.get(photo.id)).toMatchObject({
      revision: 2,
      contentTypes: ["dish"],
      missingItem: "Goat curry",
    })

    // Withdraw: "" clears the staff member's suggestion.
    const withdrawn = await saveAssetLabels(
      await as(staffA),
      input(photo.id, {
        expectedRevision: 2,
        contentTypes: ["dish"],
        items: [ref(railway["house-special--railway-lamb-flame-sizzler"])],
        missingItem: "",
      })
    )
    expect(withdrawn.ok && withdrawn.labels.missingItem).toBeNull()

    // After deletion nothing is visible through summaries any more.
    await tombstone(photo.id)
    expect((await loadLabelSummaries(session.actor!.db, [photo.id])).size).toBe(
      0
    )
  })
})

describe("Server Functions", () => {
  it("splits mixed-venue batches and authorises every call", async () => {
    const atA = await reserveReady(service, staffA, "image")
    const atB = await reserveReady(service, staffB, "image")
    await as(admin)
    const mixed = await loadLabelEditorContext([atA.id, atB.id])
    expect(mixed.ok).toBe(false)
    if (mixed.ok) return
    expect(mixed.venueGroups).toEqual([[atA.id], [atB.id]])

    const nothing = await loadLabelEditorContext([randomUUID()])
    expect(nothing.ok && nothing.assets).toEqual([])

    session.actor = null
    expect((await loadLabelEditorContext([atA.id])).ok).toBe(false)
    expect((await loadLabelCatalogue(venueA)).ok).toBe(false)
    const denied = await saveLabelBatch([input(atA.id)])
    expect(denied).toEqual([
      expect.objectContaining({
        ok: false,
        assetId: atA.id,
        code: "forbidden",
      }),
    ])

    await as(staffA)
    const tooMany = await saveLabelBatch(
      Array.from({ length: LABEL_LIMITS.maxBatchAssets + 1 }, () =>
        input(randomUUID())
      )
    )
    expect(tooMany.every((r) => !r.ok && r.code === "invalid")).toBe(true)
    expect(await saveLabelBatch([])).toEqual([])
  })

  it("loads summaries for more than 100 ids in chunks", async () => {
    const photo = await reserveReady(service, staffA, "image")
    const actor = await as(staffA)
    await saveAssetLabels(actor, input(photo.id, { contentTypes: ["team"] }))
    const ids = [...Array.from({ length: 150 }, () => randomUUID()), photo.id]
    const map = await loadLabelSummaries(actor.db, ids)
    expect([...map.keys()]).toEqual([photo.id])
    expect(map.get(photo.id)?.contentTypes).toEqual(["team"])
  })
})
