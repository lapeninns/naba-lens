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
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import {
  appendJournal,
  DISH,
  LAYOUT_TARGETS,
  PILOT_KEYS,
  pin,
  readJournal,
  runDir,
  runId,
  STACK,
  target,
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

/** Journals `planned` before `run` writes anything, and what it created after. */
async function step<T>(name: string, planned: unknown, run: () => Promise<T> | T, created: (result: T) => unknown = () => null) {
  appendJournal(dir, { kind: "intent", step: name, planned })
  let result: T
  try {
    result = await run()
  } catch (error) {
    appendJournal(dir, { kind: "failed", step: name, message: scrub(String((error as Error)?.message ?? error)) })
    throw error
  }
  appendJournal(dir, { kind: "done", step: name, created: created(result) })
  return result
}

const repo = (path: string) => import(pathToFileURL(join(checkout, path)).href)
const worldHelpers = await repo("tests/e2e/helpers/world.ts")
const coverage = await repo("tests/e2e/helpers/coverage-world.ts")
const manager = await repo("tests/e2e/helpers/manager-world.ts")
const menus = await repo("tests/e2e/helpers/menus.ts")
const amenities = await repo("tests/e2e/helpers/amenities-world.ts")
const stack = await repo("tests/e2e/helpers/stack.ts")
const identities = await repo("tests/support/identities.ts")
// sharp is the checkout's dependency (tests/e2e/helpers/media.ts uses it).
const sharp = (await repo("node_modules/sharp/lib/index.js")).default

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

type Spec = { label: string; role: "staff" | "admin"; venueId: string | null; jobTitle?: string }
const specs: Spec[] = [
  { label: "B02 Admin", role: "admin", venueId: null },
  { label: "B02 Tandoor Chef", role: "staff", venueId: venueStaff!.id, jobTitle: "Tandoor Chef" },
  { label: "B02 Front of House", role: "staff", venueId: venueA!.id, jobTitle: "Server" },
  { label: "B02 Granted Staff", role: "staff", venueId: venueA!.id, jobTitle: "Supervisor" },
  // Staff first: each is converted to a manager account below.
  { label: "B02 Manager A", role: "staff", venueId: venueA!.id, jobTitle: "General Manager" },
  { label: "B02 Manager B", role: "staff", venueId: venueB!.id, jobTitle: "General Manager" },
  { label: "B02 Manager Solo", role: "staff", venueId: venueSolo!.id, jobTitle: "General Manager" },
  { label: "B02 Staff B", role: "staff", venueId: venueB!.id, jobTitle: "Chef" },
  { label: "B02 Recovery", role: "staff", venueId: venueRecovery!.id, jobTitle: "Bartender" },
  { label: "B02 Manager Revoked", role: "staff", venueId: venueB!.id, jobTitle: "Assistant Manager" },
  { label: "B02 Host", role: "staff", venueId: venueStaff!.id, jobTitle: "Host" },
  { label: "B02 Bartender", role: "staff", venueId: venueStaff!.id, jobTitle: "Bartender" },
  { label: "B02 Recovery Draft", role: "staff", venueId: venueRecovery!.id, jobTitle: "Server" },
  ...LAYOUT_TARGETS.map((t) => ({ label: `B02 Layout ${t}`, role: "staff" as const, venueId: venueLayout!.id, jobTitle: "Server" })),
]
const people = (await step(
  "people",
  // createPeople's own email rule (tests/e2e/helpers/world.ts fixtureEmail).
  specs.map((s) => worldHelpers.fixtureEmail(s.label.toLowerCase().replace(/\s+/g, "-"), tag)),
  () => worldHelpers.createPeople(tag, specs),
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
  ...layoutPeople
] = people as [Person, Person, Person, Person, Person, Person, Person, Person, Person, Person, Person, Person, Person, ...Person[]]
const staffLayout = Object.fromEntries(LAYOUT_TARGETS.map((t, i) => [t, person(layoutPeople[i]!)])) as Record<LayoutTarget, Person>

// Complete profiles, so staff land on Home rather than setup.
const quoted = people.filter((p) => p.id !== admin.id).map((p) => `'${p.id}'::uuid`).join(", ")
await step("profiles", { department: "boh", count: people.length - 1 }, () =>
  stack.psql(`update public.profiles set department = 'boh' where id in (${quoted});`)
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
  staffLayout,
  items,
  scopes: {
    staff: scope(venueStaff!, itemsStaff, checksStaff),
    layout: scope(venueLayout!, itemsLayout, checksLayout),
    recovery: scope(venueRecovery!, itemsRecovery, checksRecovery),
  },
  seeded: { staffEraAsset: staffEraAsset!, waitingPhotoA, waitingPhotoB, revokedAsset: revokedAsset!, unlabelledAsset: unlabelledAsset! },
  layoutTodoCount: LAYOUT_TODO,
  checks: { A: checksA, solo: checksSolo },
  media,
}
writeDurable(dir, "world.json", world)
appendJournal(dir, { kind: "complete", world: "world.json" })
console.log(`b02 seed: world ${tag} for run ${id} at ${join(dir, "world.json")}`)
