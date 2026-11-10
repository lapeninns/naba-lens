// Shared by the B01 agentic acceptance config and tests (see README.md).
// DEV FIXTURE data on the coordinator-owned spare6 stack only: every URL is
// checked against loopback and spare6's ports before anything is contacted.
// Nothing here prints or stores a key, a token or a cookie.
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

/** The exact B01 candidate this harness accepts. */
export const CANDIDATE = "a41cc6b41562be4ff3717102d1dd0c35a117d2eb"

/** spare6 as scripts/ci/stack.mjs names it (block 646). */
export const STACK = {
  name: "spare6",
  project: "nabalens-ws-spare6",
  apiPort: 64621,
  dbPort: 64622,
  appPort: 3646,
} as const

/** The four pilot questions (supabase/seed/amenity_catalogue.csv). */
export const QUESTION = {
  onsite_parking: "Is there on-site guest parking?",
  step_free_entrance: "Is there a step-free entrance?",
  guest_toilets: "Are there customer toilets?",
  guest_wifi: "Is guest Wi-Fi available?",
} as const
export type PilotKey = keyof typeof QUESTION
export const PILOT_KEYS = Object.keys(QUESTION) as PilotKey[]

export type Person = { id: string; email: string; name: string }
export type Venue = { id: string; name: string }
export type World = {
  tag: string
  candidate: string
  stack: string
  appUrl: string
  /** "YYYY-MM": the London month venue A's completion target covers. */
  targetPeriod: string
  venueA: Venue
  venueB: Venue
  admin: Person
  managerA: Person
  staffA: Person
  staffA2: Person
  managerB: Person
  staffB: Person
  checks: { A: Record<PilotKey, string>; B: Record<PilotKey, string> }
  reader: { consumerId: string }
}

function loopback(raw: string | undefined, port: number, name: string) {
  if (!raw) throw new Error(`${name} is required.`)
  const url = new URL(raw)
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== String(port)
  ) {
    throw new Error(`${name} must be http://127.0.0.1:${port} (spare6).`)
  }
  return url.origin
}

/** The app's port: spare6's 3646 unless the coordinator chose another. */
export function appPort(): number {
  const raw = process.env.B01_APP_PORT ?? String(STACK.appPort)
  if (!/^\d{4,5}$/.test(raw)) throw new Error("B01_APP_PORT must be a port.")
  return Number(raw)
}

/**
 * The run's target, validated: the loopback app on its expected port and
 * spare6's API and database. The config calls this, so every command (list
 * included) refuses any other target before it starts.
 */
export function target() {
  if (process.env.B01_STACK !== STACK.name) {
    throw new Error(`B01_STACK must be ${STACK.name}.`)
  }
  const app = loopback(process.env.APP_URL, appPort(), "APP_URL")
  if (process.env.APP_URL !== app) {
    throw new Error(`APP_URL must be exactly ${app}, with no path.`)
  }
  const api = loopback(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    STACK.apiPort,
    "NEXT_PUBLIC_SUPABASE_URL"
  )
  const db = new URL(process.env.E2E_DB_URL ?? "missing://")
  if (db.hostname !== "127.0.0.1" || db.port !== String(STACK.dbPort)) {
    throw new Error(`E2E_DB_URL must be spare6's database (port ${STACK.dbPort}).`)
  }
  return { app, api }
}

export function runDir(): string {
  const dir = process.env.B01_RUN_DIR
  if (!dir) throw new Error("B01_RUN_DIR is required.")
  return dir
}

let cachedWorld: World | null = null
/** The world seed.ts wrote for this run, checked against the target. */
export function world(): World {
  if (cachedWorld) return cachedWorld
  const file = join(runDir(), "world.json")
  if (!existsSync(file)) throw new Error("No world.json: run seed first.")
  const w = JSON.parse(readFileSync(file, "utf8")) as World
  if (w.candidate !== CANDIDATE || w.stack !== STACK.name) {
    throw new Error("world.json belongs to another candidate or stack.")
  }
  if (w.appUrl !== target().app) {
    throw new Error("world.json was seeded for another app URL.")
  }
  cachedWorld = w
  return w
}

/** The reader credential seed.ts wrote (mode 600), or null when absent. */
export function readerCredential(): string | null {
  const dir = process.env.B01_RUN_DIR
  if (!dir) return null
  const file = join(dir, "reader-credential")
  return existsSync(file) ? readFileSync(file, "utf8").trim() : null
}

/**
 * Session cookies for a fixture person, the way tests/e2e/helpers/world.ts
 * signedInPage() signs in: a magic-link token hash minted by the provisioner
 * (GoTrue's admin generate_link), verified by the app's own
 * /auth/confirm/verify, which is what the emailed link's Continue button
 * posts to. The token and cookies stay in memory.
 */
export async function sessionCookies(email: string) {
  const { app, api } = target()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.")
  const generated = await fetch(`${api}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email }),
  })
  if (!generated.ok) {
    throw new Error(`Fixture sign-in link failed with ${generated.status}.`)
  }
  const link = (await generated.json()) as { hashed_token?: string }
  if (!link.hashed_token) throw new Error("Fixture sign-in link had no token.")
  const verified = await fetch(`${app}/auth/confirm/verify`, {
    method: "POST",
    redirect: "manual",
    headers: {
      origin: app,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ token_hash: link.hashed_token, type: "email" }),
  })
  const location = new URL(verified.headers.get("location") ?? "/login", app)
  // Success and failure are both 303: only "/" means a session started.
  if (
    verified.status !== 303 ||
    location.origin !== app ||
    location.pathname !== "/"
  ) {
    throw new Error(
      `Fixture sign-in was refused (${verified.status} to ${location.pathname}).`
    )
  }
  const cookies = verified.headers.getSetCookie().map((cookie) => {
    const pair = cookie.split(";", 1)[0]!
    const split = pair.indexOf("=")
    return {
      name: pair.slice(0, split),
      value: pair.slice(split + 1),
      url: app,
      sameSite: "Lax" as const,
    }
  })
  if (cookies.length === 0) throw new Error("The app set no session cookie.")
  return cookies
}

// ---- Read-only database read-back --------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const uuid = (id: string) => {
  if (!UUID.test(id)) throw new Error("not a uuid")
  return `'${id}'::uuid`
}

/** One read-only query on spare6 (default_transaction_read_only). */
function readOnly(sql: string): string {
  target()
  return execFileSync(
    "psql",
    [process.env.E2E_DB_URL!, "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql],
    {
      encoding: "utf8",
      env: { ...process.env, PGOPTIONS: "-c default_transaction_read_only=on" },
    }
  ).trim()
}

export type Contribution = {
  by: string
  kind: string
  answer: string
  outcome: string
}

export const db = {
  /** Every contribution to a check, oldest first. */
  contributions(checkId: string): Contribution[] {
    return JSON.parse(
      readOnly(`select coalesce(json_agg(json_build_object(
          'by', contributed_by, 'kind', kind, 'answer', answer, 'outcome', initial_outcome
        ) order by created_at, id), '[]') from public.knowledge_contributions
        where check_id = ${uuid(checkId)}`)
    ) as Contribution[]
  },
  /** Saved drafts on a check (anyone's). */
  drafts(checkId: string): number {
    return Number(
      readOnly(
        `select count(*) from public.knowledge_drafts where check_id = ${uuid(checkId)}`
      )
    )
  },
  /** amenity_submissions rows: the only rows that can earn target credit. */
  submissions(checkId: string): { answer: string; by: string }[] {
    return JSON.parse(
      readOnly(`select coalesce(json_agg(json_build_object(
          'answer', answer, 'by', submitted_by) order by created_at, id), '[]')
        from public.amenity_submissions where check_id = ${uuid(checkId)}`)
    ) as { answer: string; by: string }[]
  },
  /** The one resolver's row, as tests/security/knowledge-fixtures.ts slot() reads it. */
  slot(venueId: string, key: PilotKey): Record<string, unknown> {
    if (!PILOT_KEYS.includes(key)) throw new Error("not a pilot key")
    return JSON.parse(
      readOnly(
        `select row_to_json(s) from private.knowledge_slot_state(${uuid(venueId)}, array['${key}']) s`
      )
    ) as Record<string, unknown>
  },
}

// ---- Words the screens build from server data ----------------------------------

/** "3 Nov 2026", as components/nabalens/knowledge/copy.ts longDate(). */
export function longDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(new Date(iso))
}

/** "2026-11" -> "November", as copy.ts periodMonth(). */
export function periodMonth(period: string): string {
  const [y, m] = period.split("-").map(Number)
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    timeZone: "Europe/London",
  }).format(new Date(Date.UTC(y!, m! - 1, 15)))
}

/** True when nothing overflows the viewport horizontally. */
export const NO_HORIZONTAL_OVERFLOW =
  "(() => document.documentElement.scrollWidth <= window.innerWidth)()"
