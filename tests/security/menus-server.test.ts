// v0.3 catalogue server (packet D): lib/server/menus driven with real signed-in
// identities (the MediaActor the app builds per request). Imports the two DEV
// FIXTURE menus into two test venues through the same path as the admin UI
// (previewMenuImport → createMenuDraft → activateMenuVersion), then checks
// venue separation, role/active checks, re-import review, revision conflicts
// and the lifecycle operations. The service role only arranges fixtures and
// reads persisted state back.
import { createHash, randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"

import { beforeAll, describe, expect, it } from "vitest"

import { applyReviewDecision } from "../../lib/menus/import"
import type { MenuDocument } from "../../lib/menus/types"
import type { MediaActor } from "../../lib/server/media/types"
import {
  activateMenuVersion,
  createDraftFromActive,
  createMenuDraft,
  discardMenuDraft,
  getMenuVersion,
  getVenueMenuOverview,
  listMenuVenues,
  previewMenuImport,
  resolveMenuSuggestion,
  retireMenuVersion,
  saveMenuDraft,
  setMenuItemArchived,
  type ImportPreview,
} from "../../lib/server/menus"
import { actorFor } from "../slice/media-actor"
import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import { reserve, reserveReady, saveOk } from "./menus-fixtures"

const service = serviceClient()
const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/menus/${name}`, import.meta.url), "utf8")
const RAILWAY = fixture("the-railway.food.json")
const PRINCE = fixture("the-prince-of-wales.food.json")
const sha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex")

let railway: string
let prince: string
let adminUser: TestIdentity
let staffUser: TestIdentity
let admin: MediaActor
let staff: MediaActor
let inactiveAdmin: MediaActor
let railwayActive: string
let princeActive: string

const items = (doc: MenuDocument) => doc.sections.flatMap((s) => s.items)
const byKey = (doc: MenuDocument, key: string) =>
  items(doc).find((i) => i.sourceKey === key)

function must<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`Expected ok, got ${JSON.stringify(result)}`)
  return result as Extract<T, { ok: true }>
}

async function previewOk(
  venueId: string,
  fileName: string,
  text: string
): Promise<ImportPreview> {
  const result = must(
    await previewMenuImport(admin, { venueId, fileName, text })
  )
  return result
}

/** previewMenuImport → createMenuDraft (as the import screen does). */
async function importDraft(venueId: string, fileName: string, text: string) {
  const preview = await previewOk(venueId, fileName, text)
  const created = must(
    await createMenuDraft(admin, {
      venueId,
      title: preview.document.title,
      source: preview.source,
      document: preview.document,
      basedOnVersionId: preview.baseVersionId,
    })
  )
  return { preview, versionId: created.versionId }
}

async function revisionOf(versionId: string) {
  return must(await getMenuVersion(admin, versionId)).version.revision
}

async function versionCount() {
  const { count, error } = await service
    .from("menu_versions")
    .select("id", { count: "exact", head: true })
  if (error) throw error
  return count ?? 0
}

beforeAll(async () => {
  railway = (await createVenue(service, "menus-server-railway")).id
  prince = (await createVenue(service, "menus-server-prince")).id
  adminUser = await createIdentity(service, {
    label: "menus-server-admin",
    role: "admin",
  })
  staffUser = await createIdentity(service, {
    label: "menus-server-staff",
    role: "staff",
    venueId: railway,
  })
  const inactive = await createIdentity(service, {
    label: "menus-server-inactive",
    role: "admin",
  })
  admin = await actorFor(adminUser)
  staff = await actorFor(staffUser)
  inactiveAdmin = await actorFor(inactive)
  // Deactivated after its session and profile read: an old session.
  const { error } = await service
    .from("profiles")
    .update({ active: false })
    .eq("id", inactive.id)
  if (error) throw error
  inactiveAdmin = {
    ...inactiveAdmin,
    profile: { ...inactiveAdmin.profile, active: false },
  }
})

describe("import, activate and venue separation", () => {
  it("imports The Railway and The Prince of Wales fixtures into two venues", async () => {
    for (const [venueId, fileName, text] of [
      [railway, "the-railway.food.json", RAILWAY],
      [prince, "the-prince-of-wales.food.json", PRINCE],
    ] as const) {
      const before = await versionCount()
      const preview = await previewOk(venueId, fileName, text)
      // A preview writes nothing.
      expect(await versionCount()).toBe(before)
      const total = items(preview.document).length
      expect(total).toBeGreaterThan(10)
      expect(preview.baseVersionId).toBeNull()
      expect(preview.diff.added).toHaveLength(total)
      expect(preview.diff.uncertain).toHaveLength(0)
      expect(preview.source).toMatchObject({
        kind: "json",
        label: fileName,
        sha256: sha256(text),
      })
      const parsed = JSON.parse(text).source
      expect(preview.source.revision).toBe(parsed.revision)
      expect(preview.source.capturedAt).toBe(
        new Date(parsed.capturedAt).toISOString()
      )
      expect(preview.source.notes).toContain(parsed.notes)

      const { versionId } = await importDraft(venueId, fileName, text)
      const draft = must(await getMenuVersion(admin, versionId)).version
      expect(draft.status).toBe("draft")
      expect(draft.itemCount).toBe(total)
      expect(draft.sectionCount).toBe(preview.document.sections.length)
      expect(draft.needsReviewCount).toBe(0)
      expect(draft.source.sha256).toBe(sha256(text))
      expect(draft.createdByName).toBe("TEST menus-server-admin")
      // Rebuilt in position order with the same keys and variants.
      expect(
        draft.document.sections.map((s) => s.items.map((i) => i.sourceKey))
      ).toEqual(
        preview.document.sections.map((s) => s.items.map((i) => i.sourceKey))
      )
      expect(
        items(draft.document).every((i) =>
          i.variants.every((v) => typeof v.variantId === "string")
        )
      ).toBe(true)

      must(
        await activateMenuVersion(admin, {
          versionId,
          expectedRevision: draft.revision,
        })
      )
      if (venueId === railway) railwayActive = versionId
      else princeActive = versionId
    }

    const list = must(await listMenuVenues(admin)).venues
    const r = list.find((v) => v.venueId === railway)!
    const p = list.find((v) => v.venueId === prince)!
    expect(r.active?.id).toBe(railwayActive)
    expect(p.active?.id).toBe(princeActive)
    expect(r.active?.title).toBe("The Railway food (DEV FIXTURE)")
    expect(r.draftCount).toBe(0)

    const rDoc = must(await getMenuVersion(admin, railwayActive)).version
      .document
    const pDoc = must(await getMenuVersion(admin, princeActive)).version
      .document
    const rIds = new Set(items(rDoc).map((i) => i.itemId))
    // Same dish names at two venues are two different items.
    expect(items(pDoc).some((i) => rIds.has(i.itemId))).toBe(false)
    const { data } = await service
      .from("menu_items")
      .select("venue_id")
      .in("id", [...rIds] as string[])
    expect(new Set(data!.map((d) => d.venue_id))).toEqual(new Set([railway]))
  })

  it("rejects another venue's items in a draft", async () => {
    const rDoc = must(await getMenuVersion(admin, railwayActive)).version
      .document
    const result = await createMenuDraft(admin, {
      venueId: prince,
      title: "TEST cross venue",
      source: {
        kind: "manual",
        label: null,
        sha256: null,
        revision: null,
        capturedAt: null,
        notes: null,
      },
      document: rDoc,
      basedOnVersionId: null,
    })
    expect(result).toMatchObject({ ok: false, status: 400 })
    const cross = await createMenuDraft(admin, {
      venueId: prince,
      title: "TEST cross base",
      source: {
        kind: "manual",
        label: null,
        sha256: null,
        revision: null,
        capturedAt: null,
        notes: null,
      },
      document: { title: "TEST cross base", sections: [] },
      basedOnVersionId: railwayActive,
    })
    expect(cross).toMatchObject({ ok: false, status: 404 })
  })

  it("does not show the active menu's diff against itself", async () => {
    const view = must(await getMenuVersion(admin, railwayActive))
    expect(view.diff).toBeNull()
    expect(view.active).toBeNull()
    expect(view.version.venueName).toContain("menus-server-railway")
  })
})

describe("staff and inactive admins", () => {
  it("are refused by every operation before any database call", async () => {
    for (const actor of [staff, inactiveAdmin]) {
      const results = await Promise.all([
        listMenuVenues(actor),
        getVenueMenuOverview(actor, railway),
        getMenuVersion(actor, railwayActive),
        previewMenuImport(actor, {
          venueId: railway,
          fileName: "x.json",
          text: RAILWAY,
        }),
        createMenuDraft(actor, {
          venueId: railway,
          title: "TEST",
          source: {
            kind: "manual",
            label: null,
            sha256: null,
            revision: null,
            capturedAt: null,
            notes: null,
          },
          document: { title: "TEST", sections: [] },
          basedOnVersionId: null,
        }),
        createDraftFromActive(actor, railway),
        retireMenuVersion(actor, railwayActive),
        discardMenuDraft(actor, railwayActive),
        setMenuItemArchived(actor, { itemId: randomUUID(), archived: true }),
        resolveMenuSuggestion(actor, {
          suggestionId: randomUUID(),
          status: "dismissed",
          itemId: null,
          note: null,
        }),
      ])
      for (const r of results)
        expect(r).toMatchObject({ ok: false, status: 403 })
    }
  })

  it("are refused by the database too when the role check is bypassed", async () => {
    // A forged admin profile over a staff / deactivated session: the RPCs
    // re-read the caller's profile and refuse (42501 → 403).
    for (const actor of [staff, inactiveAdmin]) {
      const forged: MediaActor = {
        ...actor,
        profile: { ...actor.profile, role: "admin", active: true },
      }
      expect(await retireMenuVersion(forged, railwayActive)).toMatchObject({
        ok: false,
        status: 403,
      })
      expect(
        await createMenuDraft(forged, {
          venueId: railway,
          title: "TEST forged",
          source: {
            kind: "manual",
            label: null,
            sha256: null,
            revision: null,
            capturedAt: null,
            notes: null,
          },
          document: { title: "TEST forged", sections: [] },
          basedOnVersionId: null,
        })
      ).toMatchObject({ ok: false, status: 403 })
    }
    const { data } = await service
      .from("menu_versions")
      .select("status")
      .eq("id", railwayActive)
      .single()
    expect(data!.status).toBe("active")
  })
})

describe("re-import review", () => {
  const RENAMED_FROM = "house-special--railway-lamb-flame-sizzler"
  const RENAMED_TO = "house-special--lamb-flame-sizzler-renamed"
  const REMOVED = "appetisers--mixed-platter"
  const CHANGED = "curries--curry--veg"
  let draftId: string
  let draftPreview: ImportPreview

  it("shows changed / removed / added / uncertain and never merges by name", async () => {
    const modified = JSON.parse(RAILWAY)
    for (const s of modified.sections) {
      s.items = s.items.filter((i: { key: string }) => i.key !== REMOVED)
      for (const i of s.items) {
        if (i.key === RENAMED_FROM) i.key = RENAMED_TO
        if (i.key === CHANGED) i.description = "TEST changed description"
      }
    }
    modified.sections
      .find((s: { key: string }) => s.key === "desserts")
      .items.push({ key: "desserts--test-added", name: "TEST Added Pudding" })
    const text = JSON.stringify(modified)

    const { preview, versionId } = await importDraft(
      railway,
      "the-railway.food.v2.json",
      text
    )
    draftId = versionId
    draftPreview = preview
    const base = must(await getMenuVersion(admin, railwayActive)).version
      .document
    const oldItem = byKey(base, RENAMED_FROM)!

    expect(preview.baseVersionId).toBe(railwayActive)
    expect(preview.diff.changed.map((c) => c.sourceKey)).toContain(CHANGED)
    expect(
      preview.diff.changed.find((c) => c.sourceKey === CHANGED)!.fields
    ).toContain("description")
    expect(preview.diff.removed.map((r) => r.sourceKey)).toEqual(
      expect.arrayContaining([REMOVED])
    )
    expect(preview.diff.added.map((a) => a.sourceKey)).toEqual([
      "desserts--test-added",
    ])
    expect(preview.diff.uncertain.map((u) => u.sourceKey)).toEqual([RENAMED_TO])
    // Same name, different key: an uncertain match, not merged.
    const renamed = byKey(preview.document, RENAMED_TO)!
    expect(renamed.itemId).toBeNull()
    expect(renamed.review?.candidates).toEqual([oldItem.itemId])
    // Exact key matches keep their identity.
    expect(byKey(preview.document, CHANGED)!.itemId).toBe(
      byKey(base, CHANGED)!.itemId
    )
    // The review base carries only the candidate items (for variant ids).
    expect(items(preview.reviewBase!).map((i) => i.itemId)).toEqual([
      oldItem.itemId,
    ])

    const draft = must(await getMenuVersion(admin, versionId))
    expect(draft.version.needsReviewCount).toBe(1)
    expect(draft.diff!.uncertain.map((u) => u.sourceKey)).toEqual([RENAMED_TO])
    expect(draft.active).toEqual({
      id: railwayActive,
      title: "The Railway food (DEV FIXTURE)",
    })
  })

  it("blocks activation until the review is resolved, then keeps the item identity", async () => {
    const revision = await revisionOf(draftId)
    expect(
      await activateMenuVersion(admin, {
        versionId: draftId,
        expectedRevision: revision,
      })
    ).toMatchObject({ ok: false, status: 409 })

    const view = must(await getMenuVersion(admin, draftId))
    const oldItem = byKey(
      must(await getMenuVersion(admin, railwayActive)).version.document,
      RENAMED_FROM
    )!
    const resolved = applyReviewDecision(
      view.version.document,
      RENAMED_TO,
      { kind: "same", itemId: oldItem.itemId! },
      view.reviewBase!
    )
    const saved = must(
      await saveMenuDraft(admin, {
        versionId: draftId,
        expectedRevision: revision,
        document: resolved,
      })
    )
    expect(saved.revision).toBe(revision + 1)
    must(
      await activateMenuVersion(admin, {
        versionId: draftId,
        expectedRevision: saved.revision,
      })
    )
    const active = must(await getMenuVersion(admin, draftId)).version
    expect(active.status).toBe("active")
    const kept = byKey(active.document, RENAMED_TO)!
    expect(kept.itemId).toBe(oldItem.itemId)
    // Variant ids carried forward through the review base.
    expect(kept.variants.map((v) => v.variantId)).toEqual(
      oldItem.variants.map((v) => v.variantId)
    )
    void draftPreview

    const overview = must(await getVenueMenuOverview(admin, railway))
    expect(overview.active?.id).toBe(draftId)
    expect(overview.history.map((h) => [h.id, h.status])).toContainEqual([
      railwayActive,
      "retired",
    ])
    railwayActive = draftId
  })
})

describe("drafts: conflicts, validation, discard", () => {
  it("reports a stale revision as a 409 conflict and keeps the saved draft", async () => {
    const { versionId } = must(await createDraftFromActive(admin, railway))
    const view = must(await getMenuVersion(admin, versionId))
    expect(view.version.status).toBe("draft")
    expect(view.diff).toMatchObject({
      added: [],
      changed: [],
      removed: [],
      uncertain: [],
    })
    // The copy keeps every item identity of the active menu.
    const active = must(await getMenuVersion(admin, railwayActive)).version
    expect(items(view.version.document).map((i) => i.itemId)).toEqual(
      items(active.document).map((i) => i.itemId)
    )

    const doc = structuredClone(view.version.document)
    doc.title = "TEST first save"
    must(
      await saveMenuDraft(admin, {
        versionId,
        expectedRevision: view.version.revision,
        document: doc,
      })
    )
    doc.title = "TEST stale save"
    const stale = await saveMenuDraft(admin, {
      versionId,
      expectedRevision: view.version.revision,
      document: doc,
    })
    expect(stale).toMatchObject({ ok: false, status: 409 })
    expect(!stale.ok && stale.message).toContain(
      `revision ${view.version.revision + 1}`
    )
    expect(
      await activateMenuVersion(admin, {
        versionId,
        expectedRevision: view.version.revision,
      })
    ).toMatchObject({ ok: false, status: 409 })
    const after = must(await getMenuVersion(admin, versionId)).version
    expect(after.title).toBe("TEST first save")

    // Invalid documents are refused before the database (400), unchanged.
    const bad = structuredClone(after.document)
    bad.sections[0].items[0].name = " "
    const invalid = await saveMenuDraft(admin, {
      versionId,
      expectedRevision: after.revision,
      document: bad,
    })
    expect(invalid).toMatchObject({ ok: false, status: 400 })
    expect(!invalid.ok && invalid.message).toContain(
      "sections[0].items[0].name"
    )
    const badId = structuredClone(after.document)
    badId.sections[0].items[0].itemId = "not-a-uuid"
    expect(
      await saveMenuDraft(admin, {
        versionId,
        expectedRevision: after.revision,
        document: badId,
      })
    ).toMatchObject({ ok: false, status: 400 })
    expect(await revisionOf(versionId)).toBe(after.revision)

    must(await discardMenuDraft(admin, versionId))
    expect(await discardMenuDraft(admin, versionId)).toMatchObject({
      ok: false,
      status: 409,
    })
    expect(
      await saveMenuDraft(admin, {
        versionId,
        expectedRevision: after.revision,
        document: after.document,
      })
    ).toMatchObject({ ok: false, status: 409 })
    const overview = must(await getVenueMenuOverview(admin, railway))
    expect(overview.drafts.map((d) => d.id)).not.toContain(versionId)
    expect(overview.history.map((h) => [h.id, h.status])).toContainEqual([
      versionId,
      "discarded",
    ])
  })

  it("creates an empty manual draft, which cannot be activated", async () => {
    const created = must(
      await createMenuDraft(admin, {
        venueId: prince,
        title: "TEST empty",
        source: {
          kind: "manual",
          label: null,
          sha256: null,
          revision: null,
          capturedAt: null,
          notes: null,
        },
        document: { title: "TEST empty", sections: [] },
        basedOnVersionId: null,
      })
    )
    const view = must(await getMenuVersion(admin, created.versionId))
    expect(view.version.itemCount).toBe(0)
    expect(view.version.source.kind).toBe("manual")
    expect(
      await activateMenuVersion(admin, {
        versionId: created.versionId,
        expectedRevision: view.version.revision,
      })
    ).toMatchObject({ ok: false, status: 400 })
    must(await discardMenuDraft(admin, created.versionId))
  })

  it("answers 404 for unknown and malformed ids", async () => {
    expect(await getMenuVersion(admin, randomUUID())).toMatchObject({
      status: 404,
    })
    expect(await getMenuVersion(admin, "nope")).toMatchObject({ status: 404 })
    expect(await getVenueMenuOverview(admin, randomUUID())).toMatchObject({
      status: 404,
    })
    expect(await retireMenuVersion(admin, randomUUID())).toMatchObject({
      status: 404,
    })
    expect(
      await setMenuItemArchived(admin, { itemId: randomUUID(), archived: true })
    ).toMatchObject({ status: 404 })
    expect(
      await previewMenuImport(admin, {
        venueId: randomUUID(),
        fileName: "x.json",
        text: RAILWAY,
      })
    ).toMatchObject({ status: 404 })
  })
})

describe("import preview rejections", () => {
  it("returns parser issues and writes nothing", async () => {
    const before = await versionCount()
    const malformed = await previewMenuImport(admin, {
      venueId: railway,
      fileName: "broken.json",
      text: "{ not json",
    })
    expect(malformed).toMatchObject({ ok: false, status: 400 })
    expect("issues" in malformed && malformed.issues.length).toBeGreaterThan(0)
    const pdf = await previewMenuImport(admin, {
      venueId: railway,
      fileName: "menu.pdf",
      text: "%PDF-1.7",
    })
    expect(pdf).toMatchObject({ ok: false, status: 400 })
    expect("issues" in pdf && pdf.issues[0].message).toMatch(/JSON\/CSV/)
    const huge = await previewMenuImport(admin, {
      venueId: railway,
      fileName: "huge.csv",
      text: "section,item\n" + "x".repeat(1024 * 1024),
    })
    expect(huge).toMatchObject({ ok: false, status: 400 })
    const csv = must(
      await previewMenuImport(admin, {
        venueId: prince,
        fileName: "specials.csv",
        text: 'section,item,variants\nSpecials,"TEST Curry, house",Veg|Lamb\n',
      })
    )
    expect(csv.source).toMatchObject({ kind: "csv", label: "specials.csv" })
    expect(csv.document.title).toBe("specials")
    expect(await versionCount()).toBe(before)
  })
})

describe("archive, labels and retire", () => {
  it("archives and unarchives an item; label counts are per item", async () => {
    const active = must(await getMenuVersion(admin, railwayActive)).version
    const target = items(active.document)[0]
    const asset = await reserveReady(service, staffUser)
    await saveOk(staffUser, {
      asset: asset.id,
      revision: 0,
      items: [{ itemId: target.itemId!, variantId: null }],
      catalogue: railwayActive,
    })
    const counted = must(await getMenuVersion(admin, railwayActive)).version
    expect(counted.labelCounts[target.itemId!]).toBe(1)

    must(
      await setMenuItemArchived(admin, {
        itemId: target.itemId!,
        archived: true,
      })
    )
    expect(
      must(await getMenuVersion(admin, railwayActive)).version.archivedItemIds
    ).toContain(target.itemId)
    must(
      await setMenuItemArchived(admin, {
        itemId: target.itemId!,
        archived: false,
      })
    )
    expect(
      must(await getMenuVersion(admin, railwayActive)).version.archivedItemIds
    ).not.toContain(target.itemId)
  })

  it("retires an active menu; retiring again is a conflict", async () => {
    must(await retireMenuVersion(admin, princeActive))
    expect(await retireMenuVersion(admin, princeActive)).toMatchObject({
      ok: false,
      status: 409,
    })
    const overview = must(await getVenueMenuOverview(admin, prince))
    expect(overview.active).toBeNull()
    const retired = overview.history.find((h) => h.id === princeActive)!
    expect(retired.status).toBe("retired")
    expect(retired.retiredAt).not.toBeNull()
    expect(retired.activatedByName).toBe("TEST menus-server-admin")
    expect(
      must(await listMenuVenues(admin)).venues.find((v) => v.venueId === prince)
        ?.active
    ).toBeNull()
  })
})

/** A ready asset of `user` with a thumbnail path (set while processing). */
async function readyWithThumbnail(user: TestIdentity) {
  const asset = await reserve(user)
  const { error: processing } = await service
    .from("media_assets")
    .update({ upload_state: "processing" })
    .eq("id", asset.id)
  if (processing) throw processing
  const { error } = await service
    .from("media_assets")
    .update({
      upload_state: "ready",
      validated_mime_type: "image/jpeg",
      size_bytes: 4,
      width: 1,
      height: 1,
      thumbnail_path: `${user.id}/${asset.id}/thumb.webp`,
    })
    .eq("id", asset.id)
  if (error) throw error
  return asset
}

describe("missing-item suggestions", () => {
  it("lists, resolves and dismisses suggestions", async () => {
    const a1 = await readyWithThumbnail(staffUser)
    const a2 = await reserveReady(service, staffUser)
    const a3 = await readyWithThumbnail(staffUser)
    for (const [asset, missing] of [
      [a1, "TEST Mystery curry"],
      [a2, "TEST Other dish"],
      [a3, "TEST Deleted dish"],
    ] as const)
      await saveOk(staffUser, {
        asset: asset.id,
        revision: 0,
        types: ["dish"],
        missing,
      })
    // A deleted asset never gets a thumbnail route.
    const { error: deleteError } = await staffUser.client.rpc(
      "delete_media_asset",
      { p_asset_id: a3.id }
    )
    expect(deleteError).toBeNull()

    const overview = must(await getVenueMenuOverview(admin, railway))
    const s1 = overview.suggestions.find(
      (s) => s.suggestedName === "TEST Mystery curry"
    )!
    const s2 = overview.suggestions.find(
      (s) => s.suggestedName === "TEST Other dish"
    )!
    expect(s1).toMatchObject({
      status: "open",
      assetId: a1.id,
      createdByName: "TEST menus-server-staff",
    })
    expect(s1.assetThumbnailUrl).toBe(`/api/media/${a1.id}/thumb`)
    // a2 has no thumbnail file.
    expect(s2.assetThumbnailUrl).toBeNull()
    // The suggestion of a deleted asset stays open (database behaviour) but
    // never exposes a thumbnail route.
    const s3 = overview.suggestions.find(
      (s) => s.suggestedName === "TEST Deleted dish"
    )!
    expect(s3).toMatchObject({ status: "open", assetThumbnailUrl: null })
    expect(
      must(await listMenuVenues(admin)).venues.find(
        (v) => v.venueId === railway
      )?.openSuggestionCount
    ).toBe(3)

    // Only items of the suggestion's venue.
    const princeItem = items(
      must(await getMenuVersion(admin, princeActive)).version.document
    )[0]
    expect(
      await resolveMenuSuggestion(admin, {
        suggestionId: s1.id,
        status: "resolved",
        itemId: princeItem.itemId,
        note: null,
      })
    ).toMatchObject({ ok: false, status: 400 })
    expect(
      await resolveMenuSuggestion(admin, {
        suggestionId: s1.id,
        status: "resolved",
        itemId: null,
        note: null,
      })
    ).toMatchObject({ ok: false, status: 400 })

    const railwayItem = items(
      must(await getMenuVersion(admin, railwayActive)).version.document
    )[1]
    must(
      await resolveMenuSuggestion(admin, {
        suggestionId: s1.id,
        status: "resolved",
        itemId: railwayItem.itemId,
        note: "TEST linked",
      })
    )
    must(
      await resolveMenuSuggestion(admin, {
        suggestionId: s2.id,
        status: "dismissed",
        itemId: null,
        note: null,
      })
    )
    expect(
      await resolveMenuSuggestion(admin, {
        suggestionId: s2.id,
        status: "dismissed",
        itemId: null,
        note: null,
      })
    ).toMatchObject({ ok: false, status: 409 })
    must(
      await resolveMenuSuggestion(admin, {
        suggestionId: s3.id,
        status: "dismissed",
        itemId: null,
        note: null,
      })
    )

    const after = must(await getVenueMenuOverview(admin, railway))
    expect(after.suggestions.find((s) => s.id === s1.id)).toMatchObject({
      status: "resolved",
      resolvedItemId: railwayItem.itemId,
      resolvedItemName: railwayItem.name,
      resolutionNote: "TEST linked",
    })
    expect(after.suggestions.find((s) => s.id === s2.id)?.status).toBe(
      "dismissed"
    )
    expect(
      must(await listMenuVenues(admin)).venues.find(
        (v) => v.venueId === railway
      )?.openSuggestionCount
    ).toBe(0)
  })
})
