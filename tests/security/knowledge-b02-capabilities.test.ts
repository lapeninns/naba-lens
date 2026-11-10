// Capabilities for the caller (docs/knowledge/b02-design.md R8, §5.2): the
// equivalence matrix. For each account kind (manager account, staff, staff
// holding a manager grant, admin) and a one-account venue, every capability
// my_venue_capabilities reports is true exactly when the matching real write
// succeeds, so the read follows the gates as they change. Real signed-in
// identities through PostgREST; the service role and psql only build fixtures
// and read state back.
import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  anonClient,
  createIdentity,
  createVenue,
  markReady,
  type TestIdentity,
} from "../support/identities"
import {
  grantManager,
  insertAsset,
  insertSubmittedItem,
  itemRevision,
  ok,
  review,
} from "./coverage-fixtures"
import {
  admin,
  call,
  count,
  decide,
  json,
  photo,
  PILOT_KEYS,
  refused,
  service,
  slot,
  submit,
  submitArgs,
  world,
  type World,
} from "./knowledge-fixtures"
import {
  item,
  menu,
  publishMenu,
  readDocument,
  saveOk,
  section,
  type CatalogueRow,
} from "./menus-fixtures"

type Kind = "manager" | "staff" | "staff_with_grant" | "admin"

type Caps = {
  accountKind: Kind
  venueId: string
  canUpload: boolean
  canLabel: boolean
  canSendFindings: boolean
  canConfirmFindings: boolean
  canSelfConfirm: Record<string, boolean>
  canReviewMenuPhotos: boolean
  canDecideOwnMenuPhoto: boolean
  canReviewChecklist: boolean
  canBeAssigned: boolean
}

type Flag = Exclude<keyof Caps, "accountKind" | "venueId" | "canSelfConfirm">

// Matrix §3 as the gates stand today. A gate change updates this table and
// the read together; the equivalence assertions catch one without the other.
// B02-c (owner decisions Q1, Q4): manager accounts upload and label their own
// uploads at their managed venue.
const TODAY: Record<Kind, Record<Flag, boolean>> = {
  manager: {
    canUpload: true,
    canLabel: true,
    canSendFindings: true,
    canConfirmFindings: true,
    canReviewMenuPhotos: true,
    canDecideOwnMenuPhoto: false,
    canReviewChecklist: false,
    canBeAssigned: false,
  },
  staff: {
    canUpload: true,
    canLabel: true,
    canSendFindings: true,
    canConfirmFindings: false,
    canReviewMenuPhotos: false,
    canDecideOwnMenuPhoto: false,
    canReviewChecklist: false,
    canBeAssigned: true,
  },
  staff_with_grant: {
    canUpload: true,
    canLabel: true,
    canSendFindings: true,
    canConfirmFindings: true,
    canReviewMenuPhotos: true,
    canDecideOwnMenuPhoto: true,
    canReviewChecklist: true,
    canBeAssigned: true,
  },
  admin: {
    canUpload: false,
    canLabel: true,
    canSendFindings: true,
    canConfirmFindings: true,
    canReviewMenuPhotos: true,
    canDecideOwnMenuPhoto: true,
    canReviewChecklist: true,
    canBeAssigned: false,
  },
}

const MENU = () =>
  menu("TEST capabilities", [
    section("mains", "Mains", [
      item("mains--tikka", "Tikka"),
      item("mains--dal", "Dal"),
    ]),
  ])

/** A venue prepared for every write the matrix runs. */
type Place = {
  /** Only venue and checks are read (submitArgs, decide). */
  w: World
  version: string
  items: Record<string, CatalogueRow>
  /** Sends the finding the caller is asked to confirm. */
  sender: TestIdentity
  /** Another person's ready photo labelled with a menu item. */
  colleaguePhoto: string
  /** Another person's unlabelled photo (the admin's library labelling). */
  libraryPhoto: string
  /** Another person's checklist photo waiting for review. */
  checklistItem: string
}

async function prepare(
  w: World,
  colleague: TestIdentity,
  sender: TestIdentity
): Promise<Place> {
  const version = await publishMenu(await admin(), w.venue, MENU())
  const items = (await readDocument(service, version)).byKey
  const colleaguePhoto = await photo(colleague.id, w.venue)
  await saveOk(colleague, {
    asset: colleaguePhoto,
    revision: 0,
    types: ["dish"],
    items: [{ itemId: items["mains--tikka"]!.itemId, variantId: null }],
    catalogue: version,
  })
  const checklistItem = await insertSubmittedItem(service, {
    asset: await insertAsset(service, {
      uploader: colleague.id,
      venue: w.venue,
    }),
    venue: w.venue,
    author: colleague.id,
    submittedAt: new Date().toISOString(),
  })
  return {
    w,
    version,
    items,
    sender,
    colleaguePhoto,
    libraryPhoto: await photo(colleague.id, w.venue),
    checklistItem,
  }
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

async function reviewMenuPhoto(
  who: TestIdentity,
  asset: string,
  row: CatalogueRow
) {
  return call(who, "review_menu_item_photo", {
    p_asset_id: asset,
    p_item_id: row.itemId,
    p_variant_id: null,
    p_decision: "accepted",
    p_expected_revision: await head(row.itemId),
    p_make_primary: false,
  })
}

async function attempt(
  result: PromiseLike<{ error: { message: string } | null }>
) {
  const { error } = await result
  return { ok: error === null, message: error?.message ?? null }
}

/** Reads the caller's capabilities, then runs the real write for each. */
async function matrix(p: Place, who: TestIdentity, kind: Kind) {
  const caps = await json<Caps>(
    who,
    "my_venue_capabilities",
    kind === "admin" ? { p_venue_id: p.w.venue } : {}
  )
  expect(caps.accountKind).toBe(kind)
  expect(caps.venueId).toBe(p.w.venue)
  expect(Object.keys(caps.canSelfConfirm).sort()).toEqual(
    [...PILOT_KEYS].sort()
  )
  const wrote = {} as Record<Flag, boolean>

  const upload = await call(who, "reserve_media_asset", {
    p_media_type: "image",
    p_extension: "jpg",
    p_original_filename: "TEST capability.jpg",
    p_size_bytes: 4,
    p_client_upload_key: randomUUID(),
    p_purpose: "general",
  })
  wrote.canUpload = upload.error === null
  if (upload.error) expect(upload.error.message).toBe("not_active_staff")

  // Staff label their own uploads; a manager account its own manager-era
  // upload (the one it just reserved); an admin any library photo.
  let ownUpload: string
  if (kind === "admin") ownUpload = p.libraryPhoto
  else if (kind === "manager" && upload.error === null) {
    ownUpload = (upload.data as { id: string }[])[0]!.id
    await markReady(service, ownUpload, "image/jpeg")
  } else ownUpload = await photo(who.id, p.w.venue)
  const label = await attempt(
    call(who, "save_media_labels", {
      p_asset_id: ownUpload,
      p_expected_revision: 0,
      p_content_types: ["venue"],
      p_note: null,
      p_items: [],
    })
  )
  wrote.canLabel = label.ok
  if (!label.ok) expect(label.message).toBe("not_active_user")

  wrote.canSendFindings = (
    await attempt(
      call(
        who,
        "knowledge_submit",
        submitArgs(p.w, "guest_toilets", { answer: "unknown" })
      )
    )
  ).ok

  const selfConfirm = await attempt(
    call(
      who,
      "knowledge_submit",
      submitArgs(p.w, "step_free_entrance", { answer: "no", confirmOwn: true })
    )
  )
  expect(selfConfirm.ok, selfConfirm.message ?? "").toBe(
    caps.canSelfConfirm.step_free_entrance
  )
  if (selfConfirm.ok) {
    expect(slot(p.w.venue, "step_free_entrance")).toMatchObject({
      confirmation_state: "confirmed",
      confirmation_self: true,
    })
  }

  const pending = await submit(p.sender, p.w, "step_free_entrance", {
    answer: "no",
  })
  expect(pending.outcome).toBe("awaiting_confirmation")
  wrote.canConfirmFindings = (
    await attempt(
      decide(
        who,
        p.w,
        "step_free_entrance",
        { type: "contribution", id: pending.contributionId },
        "confirm"
      )
    )
  ).ok

  wrote.canReviewMenuPhotos = (
    await attempt(
      reviewMenuPhoto(who, p.colleaguePhoto, p.items["mains--tikka"]!)
    )
  ).ok

  // A manager account cannot label, so its own photo stays unlabelled: the
  // self-review refusal comes before the label test.
  const own = await photo(who.id, p.w.venue)
  if (kind !== "manager") {
    await saveOk(who, {
      asset: own,
      revision: 0,
      types: ["dish"],
      items: [{ itemId: p.items["mains--dal"]!.itemId, variantId: null }],
      catalogue: p.version,
    })
  }
  const decideOwn = await attempt(
    reviewMenuPhoto(who, own, p.items["mains--dal"]!)
  )
  wrote.canDecideOwnMenuPhoto = decideOwn.ok
  if (kind === "manager") {
    expect(decideOwn.message).toBe("self_review_not_allowed")
  }

  const { revision } = await itemRevision(service, p.checklistItem)
  const checklist = await attempt(
    review(who, p.checklistItem, revision, "accepted")
  )
  wrote.canReviewChecklist = checklist.ok
  if (kind === "manager") expect(checklist.message).toBe("not_venue_manager")

  const check = p.w.checks.onsite_parking!
  const assign = await attempt(
    call(await admin(), "amenity_assign_check", {
      p_check_id: check,
      p_assignee_id: who.id,
      p_revision: count(
        `select revision from public.venue_amenity_checks where id = '${check}'`
      ),
    })
  )
  wrote.canBeAssigned = assign.ok
  if (!assign.ok) expect(assign.message).toBe("staff_not_eligible")

  for (const flag of Object.keys(TODAY[kind]) as Flag[]) {
    expect(caps[flag], flag).toBe(wrote[flag])
  }
  expect(caps).toMatchObject(TODAY[kind])
  for (const key of PILOT_KEYS) {
    expect(caps.canSelfConfirm[key], key).toBe(
      kind !== "staff" && TODAY[kind].canConfirmFindings
    )
  }
}

/**
 * A venue whose only accounts are one manager account and the admin. The
 * colleague whose photos the manager reviews uploaded them here and has since
 * moved to another venue (a moved colleague's photos stay reviewable).
 */
async function oneAccountVenue(label: string) {
  const a = await admin()
  const v = await createVenue(service, label)
  const elsewhere = await createVenue(service, `${label}-elsewhere`)
  const [manager, colleague] = await Promise.all([
    createIdentity(service, {
      label: `${label}-mgr`,
      role: "manager",
      venueId: v.id,
    }),
    createIdentity(service, {
      label: `${label}-moved`,
      role: "staff",
      venueId: v.id,
    }),
  ])
  await grantManager(a, manager.id, v.id)
  await ok(a.client.rpc("amenity_enable_venue", { p_venue_id: v.id }))
  const { data, error } = await service
    .from("venue_amenity_checks")
    .select("id, template_key")
    .eq("venue_id", v.id)
  if (error) throw error
  await json(a, "knowledge_set_working_list", {
    p_venue_id: v.id,
    p_keys: [...PILOT_KEYS],
    p_enabled: true,
    p_reason: "TEST pilot",
  })
  const w = {
    venue: v.id,
    checks: Object.fromEntries(data.map((c) => [c.template_key, c.id])),
  } as World
  const place = await prepare(w, colleague, a)
  await ok(
    service
      .from("profiles")
      .update({ venue_id: elsewhere.id })
      .eq("id", colleague.id)
  )
  expect(
    count(
      `select count(*) from public.profiles where venue_id = '${v.id}' and active`
    )
  ).toBe(1)
  return { place, manager }
}

describe("capabilities equal the real writes", () => {
  it("manager account (MO)", async () => {
    const w = await world("kn-b02-caps-mo")
    await matrix(await prepare(w, w.staffB, w.staffB), w.manager, "manager")
  })

  it("staff (SO)", async () => {
    const w = await world("kn-b02-caps-so")
    await matrix(await prepare(w, w.staffB, w.staffB), w.staffA, "staff")
  })

  it("staff holding a manager grant (SG)", async () => {
    const w = await world("kn-b02-caps-sg")
    await matrix(
      await prepare(w, w.staffB, w.staffB),
      w.staffManager,
      "staff_with_grant"
    )
  })

  it("admin (AD)", async () => {
    const w = await world("kn-b02-caps-ad")
    await matrix(await prepare(w, w.staffB, w.staffB), w.admin, "admin")
  })

  it("one-account venue (one manager account plus the admin)", async () => {
    const { place, manager } = await oneAccountVenue("kn-b02-caps-one")
    await matrix(place, manager, "manager")
  })
})

describe("which venue", () => {
  it("makes an admin name a venue, keeps everyone else to their own, and refuses anonymous callers", async () => {
    const w = await world("kn-b02-caps-venue")
    const elsewhere = await createVenue(service, "kn-b02-caps-venue-other")
    await refused(
      w.admin,
      "my_venue_capabilities",
      {},
      "venue_required",
      "22023"
    )
    for (const [name, who] of [
      ["manager account", w.manager],
      ["staff holding a manager grant", w.staffManager],
      ["staff", w.staffA],
    ] as const) {
      const { error } = await call(who, "my_venue_capabilities", {
        p_venue_id: elsewhere.id,
      })
      expect(error, name).toMatchObject({
        message: "wrong_venue",
        code: "42501",
      })
      const own = await json<Caps>(who, "my_venue_capabilities", {
        p_venue_id: w.venue,
      })
      expect(own.venueId, name).toBe(w.venue)
    }
    const anon = await call(
      { client: anonClient() },
      "my_venue_capabilities",
      {}
    )
    expect(anon.error).not.toBeNull()
    expect(anon.data).toBeNull()
  })
})
