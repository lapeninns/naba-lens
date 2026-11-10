// Seeds one disposable B02 acceptance world on spare6 (README.md, "Seed").
// Run by `run.mjs seed`/`run` inside the stack lock, with the candidate
// checkout's own tsx, so the repository's fixture helpers and dependencies
// are used unchanged: tests/e2e/helpers/world.ts (createVenues,
// createPeople), coverage-world.ts (seedImages, legacyStaffGrant),
// manager-world.ts (convertToManager, labelAsUploader), menus.ts (ok,
// activateMenu), amenities-world.ts (readyCheck, checkId) and the admin's own
// session for the menu and working-list RPCs. Writes ids, names, emails and
// generated media paths only; nothing secret is written or printed.
import { mkdirSync, writeFileSync } from "node:fs"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import {
  DISH,
  LAYOUT_TARGETS,
  PILOT_KEYS,
  pin,
  runDir,
  STACK,
  target,
  type LayoutTarget,
  type MenuItems,
  type Person,
  type PilotKey,
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
const dir = runDir()
mkdirSync(dir, { recursive: true, mode: 0o700 })
for (const name of ["world.json", "world.partial.json"]) {
  if (existsSync(join(dir, name))) throw new Error(`${name} already exists: one world per run directory.`)
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

const write = (name: string, value: unknown) =>
  writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + "\n", { mode: 0o600 })
const person = (p: Person): Person => ({ id: p.id, email: p.email, name: p.name })
const venue = (v: Venue): Venue => ({ id: v.id, name: v.name })

// ---- Venues and people -------------------------------------------------------

const tag: string = worldHelpers.uniqueTag()
const [venueA, venueB, venueSolo] = (await worldHelpers.createVenues(tag, [
  "B02 One",
  "B02 Two",
  "B02 Solo",
])) as Venue[]
const layoutSpecs = LAYOUT_TARGETS.map((t) => ({
  label: `B02 Layout ${t}`,
  role: "staff",
  venueId: venueA!.id,
  jobTitle: "Server",
}))
const people = worldHelpers.createPeople(tag, [
  { label: "B02 Admin", role: "admin", venueId: null },
  { label: "B02 Tandoor Chef", role: "staff", venueId: venueA!.id, jobTitle: "Tandoor Chef" },
  { label: "B02 Front of House", role: "staff", venueId: venueA!.id, jobTitle: "Server" },
  { label: "B02 Granted Staff", role: "staff", venueId: venueA!.id, jobTitle: "Supervisor" },
  // Staff first: each is converted to a manager account below.
  { label: "B02 Manager A", role: "staff", venueId: venueA!.id, jobTitle: "General Manager" },
  { label: "B02 Manager B", role: "staff", venueId: venueB!.id, jobTitle: "General Manager" },
  { label: "B02 Manager Solo", role: "staff", venueId: venueSolo!.id, jobTitle: "General Manager" },
  { label: "B02 Staff B", role: "staff", venueId: venueB!.id, jobTitle: "Chef" },
  { label: "B02 Recovery", role: "staff", venueId: venueA!.id, jobTitle: "Bartender" },
  { label: "B02 Manager Revoked", role: "staff", venueId: venueB!.id, jobTitle: "Assistant Manager" },
  { label: "B02 Host", role: "staff", venueId: venueA!.id, jobTitle: "Host" },
  { label: "B02 Bartender", role: "staff", venueId: venueA!.id, jobTitle: "Bartender" },
  ...layoutSpecs,
]) as Person[]
const [admin, staffSet, staffTriage, staffGrant, managerA, managerB, managerSolo, staffB, staffRecover, managerRevoked, staffFoh, staffBar, ...layoutPeople] =
  people as [Person, Person, Person, Person, Person, Person, Person, Person, Person, Person, Person, Person, ...Person[]]
const staffLayout = Object.fromEntries(
  LAYOUT_TARGETS.map((t, i) => [t, person(layoutPeople[i]!)])
) as Record<LayoutTarget, Person>

// Written before anything else can fail, so the coordinator always finds the
// world's tag, venues and accounts.
const partial = {
  tag,
  candidate: pin().commit,
  stack: STACK.name,
  appUrl: app,
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
  managerRevoked: person(managerRevoked),
  staffFoh: person(staffFoh),
  staffBar: person(staffBar),
  staffLayout,
}
write("world.partial.json", partial)

// Complete profiles, so staff land on Home rather than setup.
const quoted = people.filter((p) => p.id !== admin.id).map((p) => `'${p.id}'::uuid`).join(", ")
stack.psql(`update public.profiles set department = 'boh' where id in (${quoted});`)

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
  await menus.activateMenu(adminDb, versionId)
  const items = {} as MenuItems
  for (const s of SECTIONS) for (const d of s.dishes) items[d] = manager.activeItemId(v.id, sourceKey(s.slug, d))
  return items
}
const items = { A: await activeMenu(venueA!), B: await activeMenu(venueB!), solo: await activeMenu(venueSolo!) }

// ---- Staff-era media, then manager accounts ------------------------------------

// Manager A's own photo while still staff: uploader_role stays null (a
// pre-B02-c reservation), the approved legacy treatment after conversion.
const [staffEraAsset] = (await coverage.seedImages(managerA, venueA, 1, {
  prefix: `DEV-FIXTURE-b02-staff-era-${tag}`,
  colour: "#6b4bc9",
})) as string[]
await manager.labelAsUploader(managerA, venueA!.id, staffEraAsset!, [items.A.naan])

await manager.convertToManager(adminDb, managerA, venueA)
await manager.convertToManager(adminDb, managerB, venueB)
await manager.convertToManager(adminDb, managerSolo, venueSolo)
await coverage.legacyStaffGrant(admin, staffGrant, venueA)

// A manager account whose grant has ended, with one manager-era upload of
// its own from before the revoke (B02-c: it keeps reading its own uploads,
// and can't upload, label or finish any more).
const revokedGrant = (await manager.convertToManager(adminDb, managerRevoked, venueB)) as string
const [revokedAsset] = (await coverage.seedImages(managerRevoked, venueB, 1, {
  prefix: `DEV-FIXTURE-b02-revoked-${tag}`,
  colour: "#999999",
  uploaderRole: "manager",
})) as string[]
await menus.ok(
  adminDb.rpc("revoke_venue_manager", { p_grant_id: revokedGrant, p_reason: `DEV FIXTURE B02 lost grant ${tag}` })
)

// ---- Waiting review work -------------------------------------------------------

// A colleague's labelled photo waiting for review at A, and one at B that A's
// manager must never see.
const waitingPhotoA = (await manager.labelledPhoto(staffTriage, venueA, [items.A.curry], {
  prefix: `DEV-FIXTURE-b02-waiting-a-${tag}`,
  colour: "#c94b4b",
})) as string
const waitingPhotoB = (await manager.labelledPhoto(staffB, venueB, [items.B.curry], {
  prefix: `DEV-FIXTURE-b02-waiting-b-${tag}`,
  colour: "#4bc98a",
})) as string

// Staff Home's "photos need labels" card: one ready, unlabelled photo of
// the tandoor chef's (B02 Home §3.1 item 5).
const [unlabelledAsset] = (await coverage.seedImages(staffSet, venueA, 1, {
  prefix: `DEV-FIXTURE-b02-unlabelled-${tag}`,
  colour: "#4b7bc9",
  uploaderRole: "staff",
})) as string[]

// ---- Working lists (as the admin) ----------------------------------------------

const minimal = { admin } // readyCheck reads only w.admin
async function workingList(v: Venue) {
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
}
const checksA = await workingList(venueA!)
const checksSolo = await workingList(venueSolo!)
// One check assigned to the tandoor chef: an assigned, unanswered check is a
// To do card (§3.1 item 6), after the labels card (item 5).
await amenities.readyCheck(minimal, venueA, "guest_toilets", staffSet)

// ---- Generated media for uploads ----------------------------------------------

// Distinct small JPEGs (sharp, the checkout's dependency), in the private
// run directory. Tests hand them to setInputFiles by absolute path.
const mediaDir = join(dir, "media")
mkdirSync(mediaDir, { recursive: true, mode: 0o700 })
async function jpeg(name: string, rgb: [number, number, number]) {
  const bytes = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } })
    .composite([{ input: Buffer.from(`<svg width="800" height="600"><text x="40" y="560" font-size="40" fill="#fff">DEV FIXTURE ${name}</text></svg>`) }])
    .jpeg({ quality: 80 })
    .toBuffer()
  const path = join(mediaDir, name)
  writeFileSync(path, bytes, { mode: 0o600 })
  return path
}
const media: World["media"] = {
  set: [
    await jpeg(`b02-tandoor-1-${tag}.jpg`, [180, 70, 40]),
    await jpeg(`b02-tandoor-2-${tag}.jpg`, [170, 90, 50]),
    await jpeg(`b02-tandoor-3-${tag}.jpg`, [160, 110, 60]),
  ],
  manager: [await jpeg(`b02-manager-1-${tag}.jpg`, [60, 90, 170]), await jpeg(`b02-manager-2-${tag}.jpg`, [70, 100, 180])],
  recover: await jpeg(`b02-recover-${tag}.jpg`, [90, 160, 80]),
  bar: await jpeg(`b02-bar-${tag}.jpg`, [200, 160, 40]),
  layout: await jpeg(`b02-layout-${tag}.jpg`, [140, 140, 60]),
}

const world: World = {
  ...partial,
  items,
  seeded: { staffEraAsset: staffEraAsset!, waitingPhotoA, waitingPhotoB, revokedAsset: revokedAsset!, unlabelledAsset: unlabelledAsset! },
  media,
  checks: { A: checksA, solo: checksSolo },
}
write("world.json", world)
console.log(JSON.stringify({ seeded: true, tag, venueA: venueA!.id, venueB: venueB!.id, venueSolo: venueSolo!.id, world: join(dir, "world.json") }, null, 2))
