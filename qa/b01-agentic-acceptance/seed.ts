// Seeds one disposable B01 acceptance world on spare6 (README.md, "Seed").
// Run by `run.mjs seed` (inside the stack lock) with the candidate checkout's
// own tsx, so the repository's fixture helpers and dependencies are used
// unchanged: tests/e2e/helpers/amenities-world.ts provisionAmenitiesWorld()
// (two DEV FIXTURE venues, a converted manager account and staff at each,
// unique tag), readyCheck() and checkId(), and the admin's own session for
// knowledge_set_working_list. Writes ids, names and emails only; the reader
// credential goes to its own mode-600 file and is never printed.
import { createHash, randomBytes } from "node:crypto"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import {
  CANDIDATE,
  PILOT_KEYS,
  STACK,
  runDir,
  target,
  type PilotKey,
  type World,
} from "./fixture"

if (process.env.B01_VIA_RUNNER !== "1") {
  throw new Error("Run this through `node run.mjs seed` inside the stack lock.")
}
if (process.env.E2E_ISOLATED_STACK !== "1") {
  throw new Error("E2E_ISOLATED_STACK=1 is required (spare6 is isolated).")
}
const { app } = target()
const checkout = process.env.B01_CHECKOUT
if (!checkout) throw new Error("B01_CHECKOUT is required.")
const dir = runDir()
mkdirSync(dir, { recursive: true, mode: 0o700 })
for (const name of ["world.json", "world.partial.json"]) {
  if (existsSync(join(dir, name))) {
    throw new Error(`${name} already exists: one world per run directory.`)
  }
}

const repo = (path: string) => import(pathToFileURL(join(checkout, path)).href)
const amenities = await repo("tests/e2e/helpers/amenities-world.ts")
const stack = await repo("tests/e2e/helpers/stack.ts")

const write = (name: string, value: unknown) =>
  writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
  })

const w = await amenities.provisionAmenitiesWorld()
const person = (p: { id: string; email: string; name: string }) => ({
  id: p.id,
  email: p.email,
  name: p.name,
})
// Written before anything else can fail, so cleanup always finds the world.
const partial = {
  tag: w.tag,
  candidate: CANDIDATE,
  stack: STACK.name,
  appUrl: app,
  venueA: { id: w.venueA.id, name: w.venueA.name },
  venueB: { id: w.venueB.id, name: w.venueB.name },
  admin: person(w.admin),
  managerA: person(w.managerA),
  staffA: person(w.staffA),
  staffA2: person(w.staffA2),
  managerB: person(w.managerB),
  staffB: person(w.staffB),
}
write("world.partial.json", partial)

// Amenities on, then the four pilot keys on each venue's working list.
const admin = await amenities.sessionOf(w.admin)
for (const venue of [w.venueA, w.venueB]) {
  await amenities.readyCheck(w, venue, "onsite_parking", null)
  const { data, error } = await admin.rpc("knowledge_set_working_list", {
    p_venue_id: venue.id,
    p_keys: [...PILOT_KEYS],
    p_enabled: true,
    p_reason: `DEV FIXTURE B01 acceptance ${w.tag}`,
  })
  if (error) throw new Error(`knowledge_set_working_list: ${error.message}`)
  if (data !== PILOT_KEYS.length) {
    throw new Error(`Expected ${PILOT_KEYS.length} slots enabled, got ${data}.`)
  }
}
const checksOf = (venue: { id: string }) =>
  Object.fromEntries(
    PILOT_KEYS.map((key) => [key, amenities.checkId(venue, key) as string])
  ) as Record<PilotKey, string>

// Venue A gets a completion target for this London month, as
// tests/security/knowledge-credit.test.ts enrolled() does, so the screens
// report credit (scored / not scored) rather than nothing.
const period = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
})
  .format(new Date())
  .slice(0, 7)
if (!/^[0-9a-f-]{36}$/.test(w.venueA.id) || !/^\d{4}-\d{2}$/.test(period)) {
  throw new Error("Unexpected venue id or period.")
}
stack.psql(`insert into private.venue_monthly_completion_targets(venue_id, starts_on, target_count)
  values ('${w.venueA.id}', '${period}-01', 5)`)

// A reader consumer for this world only, in the registry shape of
// app/api/knowledge/_reader/credentials.ts (sha256 hex digest, as
// credentialDigest()). The app reads it from KNOWLEDGE_READER_CONSUMERS.
const consumerId = `b01-acc-${w.tag}`
const credential = `nlr_${consumerId}_${randomBytes(32).toString("base64url")}`
const registry = [
  {
    id: consumerId,
    credentials: [
      {
        sha256: createHash("sha256").update(credential).digest("hex"),
        expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
      },
    ],
    venues: [w.venueA.id, w.venueB.id],
    audiences: ["internal"],
    purposes: ["pilot_verification"],
    questions: "all",
    schemaMajors: [1],
  },
]
write("reader-consumers.json", registry)
writeFileSync(join(dir, "reader-credential"), credential + "\n", { mode: 0o600 })

const world: World = {
  ...partial,
  targetPeriod: period,
  checks: { A: checksOf(w.venueA), B: checksOf(w.venueB) },
  reader: { consumerId },
}
write("world.json", world)
console.log(
  JSON.stringify(
    {
      seeded: true,
      tag: w.tag,
      venueA: world.venueA.id,
      venueB: world.venueB.id,
      world: join(dir, "world.json"),
      readerRegistry: join(dir, "reader-consumers.json"),
    },
    null,
    2
  )
)
