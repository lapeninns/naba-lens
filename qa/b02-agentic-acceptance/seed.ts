// Seeds one disposable B02 acceptance world on spare6 (README.md, "Seed").
// Run only by `run.mjs seed`/`run` inside the stack lock, with the candidate
// checkout's own tsx, so the repository's fixture helpers and dependencies
// are used unchanged: tests/e2e/helpers/world.ts (createVenues,
// createPeople), coverage-world.ts (seedImages, legacyStaffGrant),
// manager-world.ts (convertToManager, labelAsUploader, labelledPhoto),
// menus.ts (ok, activateMenu), amenities-world.ts (readyCheck, checkId) and
// the admin's own session for the menu and working-list RPCs.
//
// Recovery journal: run.mjs creates world.journal.jsonl (an fsynced header
// with this run id and the candidate) before this process starts. Every step
// below appends an fsynced "intent" line naming what it is about to create
// (the tag, planned names and emails) before its first write, then a "done"
// line with the ids it created, so the coordinator can always find what a
// failed or interrupted seed left behind. world.json is written last,
// atomically. Ids, names, emails and media paths only; nothing secret.
import { randomUUID } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import {
  appendJournal,
  DISH,
  journalStep,
  json,
  LAYOUT_TARGETS,
  PILOT_KEYS,
  pin,
  readJournal,
  runDir,
  runId,
  STACK,
  target,
  uuid,
  writeDurable,
  type LayoutTarget,
  type MenuItems,
  type Person,
  type PilotKey,
  type Scope,
  type Venue,
  type World,
} from "./fixture"

if (process.env.B02_VIA_RUNNER !== "1") {
  throw new Error("Run this through `node run.mjs seed` inside the stack lock.")
}
if (process.env.E2E_ISOLATED_STACK !== "1") {
  throw new Error("E2E_ISOLATED_STACK=1 is required (spare6 is isolated).")
}
const { app } = target()
const checkout = process.env.B02_CHECKOUT
if (!checkout) throw new Error("B02_CHECKOUT is required.")
const id = runId()
const dir = runDir()
const candidate = pin()

// One world per run: only run.mjs's header may be in the journal, and no world yet.
if (existsSync(join(dir, "world.json"))) throw new Error("world.json already exists: one world per run.")
const journal = readJournal(dir)
if (
  journal.length !== 1 ||
  journal[0]!.kind !== "header" ||
  journal[0]!.runId !== id ||
  journal[0]!.candidate !== candidate.commit
) {
  throw new Error("The journal is not this run's fresh header: one seed per run.")
}

/** The stack's credential values never reach the journal, whatever a helper's error says. */
const scrub = (message: string) =>
  [process.env.E2E_DB_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY]
    .filter((v): v is string => typeof v === "string" && v.length >= 8)
    .reduce((text, value) => text.split(value).join("[redacted]"), message)

/** Journals `planned` before `run` writes anything (or signs in), and what it created after. */
const step = journalStep(dir, scrub)

const repo = (path: string) => import(pathToFileURL(join(checkout, path)).href)
const worldHelpers = await repo("tests/e2e/helpers/world.ts")
const coverage = await repo("tests/e2e/helpers/coverage-world.ts")
const manager = await repo("tests/e2e/helpers/manager-world.ts")
const menus = await repo("tests/e2e/helpers/menus.ts")
const amenities = await repo("tests/e2e/helpers/amenities-world.ts")
const stack = await repo("tests/e2e/helpers/stack.ts")
const identities = await repo("tests/support/identities.ts")
// sharp is the checkout's dependency (tests/e2e/helpers/media.ts uses it), resolved as the checkout
// itself would resolve it: its entry file moved between releases (0.35 has no lib/index.js).
const sharp = (await import(pathToFileURL(createRequire(join(checkout, "package.json")).resolve("sharp")).href)).default

const person = (p: Person): Person => ({ id: p.id, email: p.email, name: p.name })
const venue = (v: Venue): Venue => ({ id: v.id, name: v.name })

/** Ready, unlabelled photos each layout persona owns: its labels card, a two-digit To do. */
const LAYOUT_TODO = 12

// ---- Venues and people (no write happens before the first intent line) -------

const tag: string = worldHelpers.uniqueTag()
appendJournal(dir, { kind: "tag", tag })

const VENUES = ["B02 One", "B02 Two", "B02 Solo", "B02 Staff", "B02 Layout", "B02 Recovery"]
const [venueA, venueB, venueSolo, venueStaff, venueLayout, venueRecovery] = (await step(
  "venues",
  VENUES.map((label) => `DEV FIXTURE ${label} ${tag}`),
  () => worldHelpers.createVenues(tag, VENUES),
  (vs: Venue[]) => vs.map(venue)
)) as Venue[]

// Every job title is distinct, and each staff account has a supported
// department (profiles_department_check: 'boh' or 'foh'): kitchen personas
// are back of house, front-of-house, bar and manager personas front of house.
type Department = "boh" | "foh"
type Spec = { label: string; role: "staff" | "admin"; venueId: string | null; jobTitle?: string; department?: Department }
const LAYOUT_TITLES: Record<LayoutTarget, string> = { "phone-320": "Food Runner", "phone-375": "Head Waiter", "phone-390": "Barback", desktop: "Sommelier" }
const specs: Spec[] = [
  { label: "B02 Admin", role: "admin", venueId: null },
  { label: "B02 Tandoor Chef", role: "staff", venueId: venueStaff!.id, jobTitle: "Tandoor Chef", department: "boh" },
  { label: "B02 Front of House", role: "staff", venueId: venueA!.id, jobTitle: "Server", department: "foh" },
  { label: "B02 Granted Staff", role: "staff", venueId: venueA!.id, jobTitle: "Shift Supervisor", department: "foh" },
  // Staff first: each is converted to a manager account below.
  { label: "B02 Manager A", role: "staff", venueId: venueA!.id, jobTitle: "General Manager", department: "foh" },
  { label: "B02 Manager B", role: "staff", venueId: venueB!.id, jobTitle: "Venue Manager", department: "foh" },
  { label: "B02 Manager Solo", role: "staff", venueId: venueSolo!.id, jobTitle: "Operations Manager", department: "foh" },
  { label: "B02 Staff B", role: "staff", venueId: venueB!.id, jobTitle: "Line Chef", department: "boh" },
  { label: "B02 Recovery", role: "staff", venueId: venueRecovery!.id, jobTitle: "Cocktail Bartender", department: "foh" },
  { label: "B02 Manager Revoked", role: "staff", venueId: venueB!.id, jobTitle: "Assistant Manager", department: "foh" },
  { label: "B02 Host", role: "staff", venueId: venueStaff!.id, jobTitle: "Host", department: "foh" },
  { label: "B02 Bartender", role: "staff", venueId: venueStaff!.id, jobTitle: "Bartender", department: "foh" },
  { label: "B02 Recovery Draft", role: "staff", venueId: venueRecovery!.id, jobTitle: "Waiter", department: "foh" },
  { label: "B02 Curry Chef", role: "staff", venueId: venueStaff!.id, jobTitle: "Curry Chef", department: "boh" },
  ...LAYOUT_TARGETS.map((t) => ({ label: `B02 Layout ${t}`, role: "staff" as const, venueId: venueLayout!.id, jobTitle: LAYOUT_TITLES[t], department: "foh" as const })),
]
if (new Set(specs.flatMap((s) => (s.jobTitle ? [s.jobTitle] : []))).size !== specs.length - 1) throw new Error("Fixture job titles must be distinct.")
const people = (await step(
  "people",
  // createPeople's own email rule (tests/e2e/helpers/world.ts fixtureEmail).
  specs.map((s) => worldHelpers.fixtureEmail(s.label.toLowerCase().replace(/\s+/g, "-"), tag)),
  () => worldHelpers.createPeople(tag, specs.map(({ department: _, ...s }) => s)),
  (ps: Person[]) => ps.map((p) => ({ id: p.id, email: p.email }))
)) as Person[]
const [
  admin,
  staffSet,
  staffTriage,
  staffGrant,
  managerA,
  managerB,
  managerSolo,
  staffB,
  staffRecover,
  managerRevoked,
  staffFoh,
  staffBar,
  recoveryDraft,
  staffReplacement,
  ...layoutPeople
] = people as [Person, Person, Person, Person, Person, Person, Person, Person, Person, Person, Person, Person, Person, Person, ...Person[]]
const staffLayout = Object.fromEntries(LAYOUT_TARGETS.map((t, i) => [t, person(layoutPeople[i]!)])) as Record<LayoutTarget, Person>

// Complete profiles, so staff land on Home rather than setup.
const byDepartment = (d: Department) => people.filter((_, i) => specs[i]!.department === d).map((p) => p.id)
const departments = { boh: byDepartment("boh"), foh: byDepartment("foh") }
if (departments.boh.length + departments.foh.length !== people.length - 1) throw new Error("Every staff persona needs a department.")
const quoted = (ids: string[]) => ids.map((id) => `'${id}'::uuid`).join(", ")
await step("profiles", departments, () =>
  stack.psql(
    `update public.profiles set department = 'boh' where id in (${quoted(departments.boh)});
     update public.profiles set department = 'foh' where id in (${quoted(departments.foh)});`
  )
)

// ---- Menus (as the admin) ----------------------------------------------------

const adminDb = await identities.signIn(stack.provisioner(), admin.email)
const SECTIONS: { slug: string; name: string; kind: "food" | "drinks"; dishes: (keyof MenuItems)[] }[] = [
  { slug: "tandoor", name: "Tandoor", kind: "food", dishes: ["tandoor"] },
  { slug: "curries", name: "Curries", kind: "food", dishes: ["curry"] },
  { slug: "breads", name: "Breads", kind: "food", dishes: ["naan"] },
  { slug: "drinks", name: "Drinks", kind: "drinks", dishes: ["lager"] },
]
const sourceKey = (section: string, dish: keyof MenuItems) => `${section}--${dish}`
async function activeMenu(v: Venue): Promise<MenuItems> {
  const title = `DEV FIXTURE B02 menu ${tag} ${v.name}`
  return step(
    `menu ${v.name}`,
    { venue: v.id, title },
    async () => {
      const versionId = (await menus.ok(
        adminDb.rpc("create_menu_draft", {
          p_venue_id: v.id,
          p_title: title,
          p_source: {
            kind: "json",
            label: "DEV FIXTURE menu.json",
            sha256: "c".repeat(64),
            revision: null,
            capturedAt: "2026-11-10T10:00:00Z",
            notes: null,
          },
          p_document: {
            title,
            sections: SECTIONS.map((s) => ({
              slug: s.slug,
              name: s.name,
              kind: s.kind,
              items: s.dishes.map((d) => ({
                itemId: null,
                sourceKey: sourceKey(s.slug, d),
                name: DISH[d],
                description: null,
                aliases: [],
                sourceMeta: {},
                variants: [],
                review: null,
              })),
            })),
          },
        })
      )) as string
      appendJournal(dir, { kind: "progress", step: `menu ${v.name}`, draft: versionId })
      await menus.activateMenu(adminDb, versionId)
      const items = {} as MenuItems
      for (const s of SECTIONS) for (const d of s.dishes) items[d] = manager.activeItemId(v.id, sourceKey(s.slug, d))
      return items
    },
    (items) => items
  )
}
const items = { A: await activeMenu(venueA!), B: await activeMenu(venueB!), solo: await activeMenu(venueSolo!) }
const itemsStaff = await activeMenu(venueStaff!)
const itemsLayout = await activeMenu(venueLayout!)
const itemsRecovery = await activeMenu(venueRecovery!)

// ---- Staff-era media, then manager accounts ------------------------------------

// Manager A's own photo while still staff: uploader_role stays null (a
// pre-B02-c reservation), the approved legacy treatment after conversion.
const staffEraPrefix = `DEV-FIXTURE-b02-staff-era-${tag}`
const [staffEraAsset] = (await step(
  "staff-era asset",
  { uploader: managerA.id, venue: venueA!.id, prefix: staffEraPrefix },
  () => coverage.seedImages(managerA, venueA, 1, { prefix: staffEraPrefix, colour: "#6b4bc9" }),
  (ids: string[]) => ids
)) as string[]
await step("staff-era label", { asset: staffEraAsset, item: items.A.naan }, () =>
  manager.labelAsUploader(managerA, venueA!.id, staffEraAsset!, [items.A.naan])
)

for (const [who, at] of [
  [managerA, venueA],
  [managerB, venueB],
  [managerSolo, venueSolo],
] as [Person, Venue][]) {
  await step(`manager ${who.id}`, { person: who.id, venue: at.id }, () => manager.convertToManager(adminDb, who, at), (grant) => ({ grant }))
}
await step("legacy staff grant", { staff: staffGrant.id, venue: venueA!.id }, () => coverage.legacyStaffGrant(admin, staffGrant, venueA), (grant) => ({ grant }))

// A manager account whose grant has ended, with one manager-era upload of
// its own from before the revoke (B02-c: it keeps reading its own uploads,
// and can't upload, label or finish any more).
const revokedGrant = (await step(
  "revoked manager",
  { person: managerRevoked.id, venue: venueB!.id },
  () => manager.convertToManager(adminDb, managerRevoked, venueB),
  (grant) => ({ grant })
)) as string
const revokedPrefix = `DEV-FIXTURE-b02-revoked-${tag}`
const [revokedAsset] = (await step(
  "revoked asset",
  { uploader: managerRevoked.id, prefix: revokedPrefix },
  () => coverage.seedImages(managerRevoked, venueB, 1, { prefix: revokedPrefix, colour: "#999999", uploaderRole: "manager" }),
  (ids: string[]) => ids
)) as string[]
await step("revoke", { grant: revokedGrant }, () =>
  menus.ok(adminDb.rpc("revoke_venue_manager", { p_grant_id: revokedGrant, p_reason: `DEV FIXTURE B02 lost grant ${tag}` }))
)

// ---- Waiting review work (manager suite) ----------------------------------------

// A colleague's labelled photo waiting for review at A, and one at B that A's
// manager must never see.
const waitingAPrefix = `DEV-FIXTURE-b02-waiting-a-${tag}`
const waitingPhotoA = (await step(
  "waiting photo A",
  { uploader: staffTriage.id, prefix: waitingAPrefix },
  () => manager.labelledPhoto(staffTriage, venueA, [items.A.curry], { prefix: waitingAPrefix, colour: "#c94b4b" }),
  (asset) => ({ asset })
)) as string
const waitingBPrefix = `DEV-FIXTURE-b02-waiting-b-${tag}`
const waitingPhotoB = (await step(
  "waiting photo B",
  { uploader: staffB.id, prefix: waitingBPrefix },
  () => manager.labelledPhoto(staffB, venueB, [items.B.curry], { prefix: waitingBPrefix, colour: "#4bc98a" }),
  (asset) => ({ asset })
)) as string

// ---- Staff and layout Home state ------------------------------------------------

// Staff Home's labels card: one ready, unlabelled photo of the tandoor chef's.
const unlabelledPrefix = `DEV-FIXTURE-b02-unlabelled-${tag}`
const [unlabelledAsset] = (await step(
  "unlabelled asset",
  { uploader: staffSet.id, venue: venueStaff!.id, prefix: unlabelledPrefix },
  () => coverage.seedImages(staffSet, venueStaff, 1, { prefix: unlabelledPrefix, colour: "#4b7bc9", uploaderRole: "staff" }),
  (ids: string[]) => ids
)) as string[]

// Each layout persona: LAYOUT_TODO ready unlabelled photos, so its To do badge
// is a deterministic two-digit number (World.layoutTodoCount).
for (const t of LAYOUT_TARGETS) {
  const who = staffLayout[t]
  const prefix = `DEV-FIXTURE-b02-layout-${t}-${tag}`
  await step(
    `layout labels ${t}`,
    { uploader: who.id, venue: venueLayout!.id, prefix, count: LAYOUT_TODO },
    () => coverage.seedImages(who, venueLayout, LAYOUT_TODO, { prefix, colour: "#8a8a4b", uploaderRole: "staff" }),
    (ids: string[]) => ids
  )
}

// ---- Working lists (as the admin) ----------------------------------------------

const minimal = { admin } // readyCheck reads only w.admin
async function workingList(v: Venue) {
  return step(
    `working list ${v.name}`,
    { venue: v.id, keys: PILOT_KEYS },
    async () => {
      await amenities.readyCheck(minimal, v, "onsite_parking", null)
      const { data, error } = await adminDb.rpc("knowledge_set_working_list", {
        p_venue_id: v.id,
        p_keys: [...PILOT_KEYS],
        p_enabled: true,
        p_reason: `DEV FIXTURE B02 acceptance ${tag}`,
      })
      if (error) throw new Error(`knowledge_set_working_list: ${error.message}`)
      if (data !== PILOT_KEYS.length) throw new Error(`Expected ${PILOT_KEYS.length} slots enabled, got ${data}.`)
      return Object.fromEntries(PILOT_KEYS.map((k) => [k, amenities.checkId(v, k) as string])) as Record<PilotKey, string>
    },
    (checks) => checks
  )
}
const checksA = await workingList(venueA!)
const checksSolo = await workingList(venueSolo!)
const checksStaff = await workingList(venueStaff!)
const checksLayout = await workingList(venueLayout!)
const checksRecovery = await workingList(venueRecovery!)
// One check assigned to the tandoor chef: an assigned, unanswered check is a
// To do card, after the labels card.
await step("assign toilets", { check: checksStaff.guest_toilets, assignee: staffSet.id }, () =>
  amenities.readyCheck(minimal, venueStaff, "guest_toilets", staffSet)
)

// ---- staffReplacement's open request for another photo ----------------------------

// The path of the candidate's tests/e2e/home-todo.spec.ts ("an old request
// for another photo stays in To do"): a venue-specific coverage requirement,
// assigned to staffReplacement alone, one submitted photo and a reviewer's
// needs_another_photo decision. The reviewer is the admin (can_manage_venue
// at any venue), so no staff persona at scopes.staff gains a grant, and an
// assignment counts only for its assignee, so staffSet, staffFoh and staffBar
// keep their To do. The submitted photo is amenity evidence (never labelled),
// so the replacement card is staffReplacement's only To do.
const replacementPrefix = `DEV-FIXTURE-b02-replacement-${tag}`
const replacementTitle = `DEV FIXTURE B02 replacement shelf ${tag}`
const replacementReason = `DEV FIXTURE B02: the shelf photo is out of focus (${tag})`
const requestKey = (what: string) => `b02-${what}-${tag}-${randomUUID()}`
const [replacementAsset] = (await step(
  "replacement photo",
  { uploader: staffReplacement.id, venue: venueStaff!.id, prefix: replacementPrefix, purpose: "amenity" },
  () => coverage.seedImages(staffReplacement, venueStaff, 1, { prefix: replacementPrefix, colour: "#b5651d", uploaderRole: "staff", purpose: "amenity" }),
  (ids: string[]) => ids
)) as string[]
const requirementId = (await step(
  "replacement requirement",
  { venue: venueStaff!.id, title: replacementTitle, by: admin.id },
  async () => {
    const rows = (await menus.ok(
      adminDb.rpc("save_coverage_requirement", {
        p_venue_id: venueStaff!.id,
        p_requirement_id: null,
        p_expected_revision: null,
        p_kind: "venue_specific",
        p_title: replacementTitle,
        p_guidance: "DEV FIXTURE: bottles facing out.",
        p_photo_target: 2,
        p_due_on: null,
        p_client_request_key: requestKey("requirement"),
      })
    )) as { requirement_id: string }[]
    if (rows.length !== 1 || !rows[0]!.requirement_id) throw new Error("save_coverage_requirement returned no requirement.")
    return rows[0]!.requirement_id
  },
  (id) => ({ requirement: id })
)) as string
await step("replacement assignee", { requirement: requirementId, staff: [staffReplacement.id] }, () =>
  menus.ok(adminDb.rpc("set_coverage_requirement_assignees", { p_requirement_id: requirementId, p_staff_ids: [staffReplacement.id] }))
)
// The replacement identity's real sign-in begins inside the journalled step,
// after its intent (with the actor's id, never a credential) is on disk.
const submitted = (await step(
  "replacement submission",
  { requirement: requirementId, asset: replacementAsset, by: staffReplacement.id },
  async () => {
    const replacementDb = await identities.signIn(stack.provisioner(), staffReplacement.email)
    const items = (await menus.ok(
      replacementDb.rpc("submit_coverage_photos", {
        p_asset_ids: [replacementAsset],
        p_requirement_id: requirementId,
        p_client_request_key: requestKey("submit"),
      })
    )) as { item_id: string; revision: number }[]
    if (items.length !== 1 || !items[0]!.item_id) throw new Error(`submit_coverage_photos returned ${items.length} items, expected 1.`)
    return items[0]!
  },
  (item) => ({ item: item.item_id, revision: item.revision })
)) as { item_id: string; revision: number }
await step("replacement review", { item: submitted.item_id, decision: "needs_another_photo", reason: replacementReason, by: admin.id }, () =>
  menus.ok(
    adminDb.rpc("review_coverage_item", {
      p_item_id: submitted.item_id,
      p_expected_revision: submitted.revision,
      p_decision: "needs_another_photo",
      p_reason: replacementReason,
      p_client_request_key: requestKey("review"),
    })
  )
)
// Read back (read-only) the decided item exactly as it now is: still open (no
// later item replaces it), its reason and the revision the review moved it to.
const replacement = (await step(
  "replacement read-back",
  { requirement: requirementId, item: submitted.item_id },
  () => {
    const rows = json<{ itemId: string; revision: number; reason: string; title: string }[]>(`select coalesce(json_agg(json_build_object(
        'itemId', i.id, 'revision', i.revision, 'reason', i.decision_reason, 'title', r.title) order by i.decided_at desc), '[]')
      from public.coverage_submission_items i
      join public.coverage_requirements r on r.id = i.requirement_id
      where i.requirement_id = ${uuid(requirementId)} and i.author_id = ${uuid(staffReplacement.id)}
        and i.state = 'needs_another_photo' and i.archived_at is null
        and not exists (select 1 from public.coverage_submission_items n where n.replaces_item_id = i.id)`)
    const [row] = rows
    if (rows.length !== 1 || row!.itemId !== submitted.item_id || row!.reason !== replacementReason || row!.title !== replacementTitle) {
      throw new Error("The replacement request did not read back as the one open request seeded.")
    }
    if (!Number.isInteger(row!.revision) || row!.revision <= submitted.revision) throw new Error("The reviewed item's revision did not advance.")
    return { requirementId, itemId: row!.itemId, title: row!.title, reason: row!.reason, revision: row!.revision }
  },
  (r) => r
)) as World["seeded"]["replacement"]

// ---- Generated media for uploads (local files only) ------------------------------

// Distinct small JPEGs (sharp, the checkout's dependency) and the candidate's
// own small H.264 MP4, in the private run directory. Tests hand them to
// setInputFiles by absolute path.
const mediaDir = join(dir, "media")
mkdirSync(mediaDir, { recursive: true, mode: 0o700 })
async function jpeg(name: string, rgb: [number, number, number]) {
  const bytes = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } })
    .composite([{ input: Buffer.from(`<svg width="800" height="600"><text x="40" y="560" font-size="40" fill="#fff">DEV FIXTURE ${name}</text></svg>`) }])
    .jpeg({ quality: 80 })
    .toBuffer()
  const path = join(mediaDir, name)
  writeFileSync(path, bytes, { mode: 0o600, flag: "wx" })
  return path
}
const managerVideo = join(mediaDir, `b02-manager-video-${tag}.mp4`)
const media: World["media"] = await step(
  "media files",
  { dir: mediaDir },
  async () => {
    copyFileSync(join(checkout, "tests", "fixtures", "media", "synthetic.mp4"), managerVideo)
    return {
      set: [
        await jpeg(`b02-tandoor-1-${tag}.jpg`, [180, 70, 40]),
        await jpeg(`b02-tandoor-2-${tag}.jpg`, [170, 90, 50]),
        await jpeg(`b02-tandoor-3-${tag}.jpg`, [160, 110, 60]),
      ],
      manager: [await jpeg(`b02-manager-1-${tag}.jpg`, [60, 90, 170]), await jpeg(`b02-manager-2-${tag}.jpg`, [70, 100, 180])],
      managerVideo,
      recover: await jpeg(`b02-recover-${tag}.jpg`, [90, 160, 80]),
      bar: await jpeg(`b02-bar-${tag}.jpg`, [200, 160, 40]),
      layout: await jpeg(`b02-layout-${tag}.jpg`, [140, 140, 60]),
      replacement: await jpeg(`b02-replacement-${tag}.jpg`, [120, 80, 30]),
    } as World["media"]
  },
  (m) => m
)

const scope = (v: Venue, its: MenuItems, checks: Record<PilotKey, string>): Scope => ({ venue: venue(v), items: its, checks })
const world: World = {
  runId: id,
  tag,
  candidate: candidate.commit,
  tree: candidate.tree,
  migrationsDigest: candidate.migrationsDigest,
  stack: STACK.name,
  appUrl: app,
  complete: true,
  venueA: venue(venueA!),
  venueB: venue(venueB!),
  venueSolo: venue(venueSolo!),
  admin: person(admin),
  staffSet: person(staffSet),
  staffTriage: person(staffTriage),
  staffGrant: person(staffGrant),
  managerA: person(managerA),
  managerB: person(managerB),
  managerSolo: person(managerSolo),
  staffB: person(staffB),
  staffRecover: person(staffRecover),
  recoveryDraft: person(recoveryDraft),
  managerRevoked: person(managerRevoked),
  staffFoh: person(staffFoh),
  staffBar: person(staffBar),
  staffReplacement: person(staffReplacement),
  staffLayout,
  items,
  scopes: {
    staff: scope(venueStaff!, itemsStaff, checksStaff),
    layout: scope(venueLayout!, itemsLayout, checksLayout),
    recovery: scope(venueRecovery!, itemsRecovery, checksRecovery),
  },
  seeded: { staffEraAsset: staffEraAsset!, waitingPhotoA, waitingPhotoB, revokedAsset: revokedAsset!, unlabelledAsset: unlabelledAsset!, replacement },
  layoutTodoCount: LAYOUT_TODO,
  checks: { A: checksA, solo: checksSolo },
  media,
}
writeDurable(dir, "world.json", world)
appendJournal(dir, { kind: "complete", world: "world.json" })
console.log(`b02 seed: world ${tag} for run ${id} at ${join(dir, "world.json")}`)
