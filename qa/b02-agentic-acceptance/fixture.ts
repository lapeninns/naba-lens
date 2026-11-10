// Shared by the B02 agentic acceptance config, seed and tests (README.md).
// DEV FIXTURE data on the coordinator-owned spare6 stack only: every URL is
// checked against loopback and spare6's ports before anything is contacted.
// Nothing here prints or stores a key, a token or a cookie.
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))

/** candidate.json: the one head this harness accepts (run.mjs validates it). */
export type Pin = {
  commit: string
  tree: string
  migrationsDigest: string
  migrationCount: number
  latestMigration: string
}
export function pin(): Pin {
  const p = JSON.parse(readFileSync(join(HERE, "candidate.json"), "utf8")) as Pin
  if (!/^[0-9a-f]{40}$/.test(p.commit)) throw new Error("candidate.json commit must be a full SHA.")
  return p
}

/** spare6 as scripts/ci/stack.mjs names it (block 646). */
export const STACK = {
  name: "spare6",
  project: "nabalens-ws-spare6",
  apiPort: 64621,
  dbPort: 64622,
  appPort: 3646,
} as const

/** The four B02 UI switches run.mjs sets on the build and the app. */
export const SWITCHES = [
  "NABALENS_HOME_LAYOUT",
  "NABALENS_CONTRIBUTION_ENTRY",
  "NABALENS_MY_CONTRIBUTIONS",
  "NABALENS_MANAGER_TRIAGE",
] as const

export type Person = { id: string; email: string; name: string }
export type Venue = { id: string; name: string }

/**
 * One run's world (seed.ts). Personas follow the qualification plan §9:
 * staff-only (SO), staff with a legacy manager grant (SG), a dedicated
 * manager converted from staff (MO, with a staff-era photo), admin (AD),
 * a second venue with its own manager, and a one-account venue whose only
 * account is its manager. Each suite uses its own people, so a failure in
 * one does not cascade into another.
 */
export type World = {
  tag: string
  candidate: string
  stack: string
  appUrl: string
  venueA: Venue
  venueB: Venue
  venueSolo: Venue
  admin: Person
  /** Staff suite: Home, shared entry, the three-photo set. */
  staffSet: Person
  /** Manager suite: SO whose finding and photo wait for triage. */
  staffTriage: Person
  /** SG: staff at venue A holding a legacy manager grant. */
  staffGrant: Person
  /** MO at venue A, converted after a staff-era upload. */
  managerA: Person
  /** MO at venue B (isolation). */
  managerB: Person
  /** MO and the only account at the solo venue. */
  managerSolo: Person
  /** Venue B staff, whose waiting photo A's manager must never see. */
  staffB: Person
  /** Recovery suite. */
  staffRecover: Person
  /** MO at venue B whose grant was revoked after one manager-era upload. */
  managerRevoked: Person
  /** Staff suite: front of house (shared entry, Couldn't establish, change report). */
  staffFoh: Person
  /** Staff suite: bartender (A dish or drink). */
  staffBar: Person
  /** Layout suite, one per viewport so each target has its own state. */
  staffLayout: Record<LayoutTarget, Person>
  /** Active menu items by short name, per venue. */
  items: { A: MenuItems; B: MenuItems; solo: MenuItems }
  /** Seeded rows the tests read back. */
  seeded: {
    /** managerA's photo from its staff era (uploader_role null). */
    staffEraAsset: string
    /** staffTriage's labelled photo waiting for a manager decision at A. */
    waitingPhotoA: string
    /** venue B's waiting photo (must never show at A). */
    waitingPhotoB: string
    /** managerRevoked's manager-era photo from before the revoke. */
    revokedAsset: string
    /** staffSet's ready photo with no labels (Home's labels card). */
    unlabelledAsset: string
  }
  /** Working-list check ids by key: venue A and the solo venue. */
  checks: { A: Record<PilotKey, string>; solo: Record<PilotKey, string> }
  /** Generated JPEG files for uploads, absolute paths in the run directory. */
  media: { set: [string, string, string]; manager: [string, string]; recover: string; bar: string; layout: string }
}

/** The four pilot questions on every working list (supabase/seed/amenity_catalogue.csv). */
export const QUESTION = {
  onsite_parking: "Is there on-site guest parking?",
  step_free_entrance: "Is there a step-free entrance?",
  guest_toilets: "Are there customer toilets?",
  guest_wifi: "Is guest Wi-Fi available?",
} as const
export type PilotKey = keyof typeof QUESTION
export const PILOT_KEYS = Object.keys(QUESTION) as PilotKey[]

export type MenuItems = Record<"tandoor" | "curry" | "naan" | "lager", string>
/** Dish names on every fixture menu (seed.ts), by short name. */
export const DISH: Record<keyof MenuItems, string> = {
  tandoor: "Tandoori Chicken",
  curry: "Lamb Curry",
  naan: "Garlic Naan",
  lager: "Kingfisher Lager",
}

export const LAYOUT_TARGETS = ["phone-320", "phone-375", "phone-390", "desktop"] as const
export type LayoutTarget = (typeof LAYOUT_TARGETS)[number]
export const VIEWPORT: Record<LayoutTarget, { width: number; height: number }> = {
  "phone-320": { width: 320, height: 568 },
  "phone-375": { width: 375, height: 667 },
  "phone-390": { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
}

function loopback(raw: string | undefined, port: number, name: string) {
  if (!raw) throw new Error(`${name} is required.`)
  const url = new URL(raw)
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.port !== String(port)) {
    throw new Error(`${name} must be http://127.0.0.1:${port} (spare6).`)
  }
  return url.origin
}

/**
 * The run's target, validated: the loopback app on spare6's app port and
 * spare6's API and database. The config calls this, so every command (list
 * included) refuses any other target before it starts.
 */
export function target() {
  if (process.env.B02_STACK !== STACK.name) throw new Error(`B02_STACK must be ${STACK.name}.`)
  const app = loopback(process.env.APP_URL, STACK.appPort, "APP_URL")
  if (process.env.APP_URL !== app) throw new Error(`APP_URL must be exactly ${app}, with no path.`)
  const api = loopback(process.env.NEXT_PUBLIC_SUPABASE_URL, STACK.apiPort, "NEXT_PUBLIC_SUPABASE_URL")
  const db = new URL(process.env.E2E_DB_URL ?? "missing://")
  if (!["postgresql:", "postgres:"].includes(db.protocol) || db.hostname !== "127.0.0.1" || db.port !== String(STACK.dbPort)) {
    throw new Error(`E2E_DB_URL must be spare6's database (127.0.0.1:${STACK.dbPort}).`)
  }
  return { app, api }
}

export function runDir(): string {
  const dir = process.env.B02_RUN_DIR
  if (!dir) throw new Error("B02_RUN_DIR is required.")
  return dir
}

let cachedWorld: World | null = null
/** The world seed.ts wrote for this run, checked against the pin and target. */
export function world(): World {
  if (cachedWorld) return cachedWorld
  const file = join(runDir(), "world.json")
  if (!existsSync(file)) throw new Error("No world.json: run seed first.")
  const w = JSON.parse(readFileSync(file, "utf8")) as World
  if (w.candidate !== pin().commit || w.stack !== STACK.name) {
    throw new Error("world.json belongs to another candidate or stack.")
  }
  if (w.appUrl !== target().app) throw new Error("world.json was seeded for another app URL.")
  cachedWorld = w
  return w
}

/**
 * Session cookies for a fixture person, the way tests/e2e/helpers/world.ts
 * signedInPage() signs in: a magic-link token hash minted by GoTrue's admin
 * generate_link with the stack's service key, verified by the app's own
 * /auth/confirm/verify (what the emailed link's Continue button posts to).
 * The token and cookies stay in memory. Not the emailed-link UI.
 */
export async function sessionCookies(email: string) {
  const { app, api } = target()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.")
  const generated = await fetch(`${api}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email }),
  })
  if (!generated.ok) throw new Error(`Fixture sign-in link failed with ${generated.status}.`)
  const link = (await generated.json()) as { hashed_token?: string }
  if (!link.hashed_token) throw new Error("Fixture sign-in link had no token.")
  const verified = await fetch(`${app}/auth/confirm/verify`, {
    method: "POST",
    redirect: "manual",
    headers: { origin: app, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token_hash: link.hashed_token, type: "email" }),
  })
  const location = new URL(verified.headers.get("location") ?? "/login", app)
  // Success and failure are both 303: only "/" means a session started.
  if (verified.status !== 303 || location.origin !== app || location.pathname !== "/") {
    throw new Error(`Fixture sign-in was refused (${verified.status} to ${location.pathname}).`)
  }
  const cookies = verified.headers.getSetCookie().map((cookie) => {
    const pair = cookie.split(";", 1)[0]!
    const split = pair.indexOf("=")
    return { name: pair.slice(0, split), value: pair.slice(split + 1), url: app, sameSite: "Lax" as const }
  })
  if (cookies.length === 0) throw new Error("The app set no session cookie.")
  return cookies
}

type App = { clearState(): Promise<void> }
type Cookies = { setCookies(cookies: Awaited<ReturnType<typeof sessionCookies>>): Promise<void> }
/** A fresh browser state (cookies and storage cleared), signed in as `who`. */
export async function signInAs(app: App, browser: Cookies, who: Person) {
  await app.clearState()
  await browser.setCookies(await sessionCookies(who.email))
}

// ---- Read-only database read-back --------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const uuid = (id: string) => {
  if (!UUID.test(id)) throw new Error("not a uuid")
  return `'${id}'::uuid`
}
export const text = (v: string) => `'${v.replace(/'/g, "''")}'`

/** One read-only query on spare6 (default_transaction_read_only), SQL on stdin. */
export function readOnly(sql: string): string {
  target()
  return execFileSync("psql", [process.env.E2E_DB_URL!, "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: sql,
    encoding: "utf8",
    env: { ...process.env, PGOPTIONS: "-c default_transaction_read_only=on" },
  }).trim()
}
export const json = <T>(sql: string): T => JSON.parse(readOnly(sql) || "null") as T

/**
 * A read-only query as `userId` under RLS, the way
 * tests/security/knowledge-fixtures.ts asUser() sets the session
 * (role authenticated and request.jwt.claims, local to one transaction).
 */
export function asUser(userId: string, sql: string): string {
  uuid(userId)
  const claims = JSON.stringify({ sub: userId, role: "authenticated" })
  return readOnly(`begin;
set local role authenticated;
select set_config('request.jwt.claims', '${claims}', true) is null;
${sql}
commit;`)
    .split("\n")
    .filter((line) => line !== "f" && line !== "")
    .join("\n")
}

export type Asset = {
  id: string
  filename: string
  state: string
  role: string | null
  venue: string
  deleted: boolean
}
export type Group = {
  id: string
  createdBy: string
  venue: string
  subjectKind: string
  subjectId: string | null
  members: { asset: string; position: number }[]
}
export type PhotoRow = { item: string; state: string; decidedBy: string | null; author: string }

const ids = (list: string[]) => `array[${list.map(uuid).join(", ")}]::uuid[]`

export const db = {
  /** Assets `uploaderId` uploaded whose file name starts with `prefix`, oldest first. */
  assets(uploaderId: string, prefix: string): Asset[] {
    return json<Asset[]>(`select coalesce(json_agg(json_build_object(
        'id', id, 'filename', original_filename, 'state', upload_state, 'role', uploader_role,
        'venue', venue_id, 'deleted', deleted_at is not null) order by created_at, id), '[]')
      from public.media_assets where uploader_id = ${uuid(uploaderId)}
        and starts_with(original_filename, ${text(prefix)})`)
  },
  /** Every group holding any of `assetIds`, with all its members. */
  groupsOf(assetIds: string[]): Group[] {
    if (assetIds.length === 0) return []
    return json<Group[]>(`select coalesce(json_agg(json_build_object(
        'id', g.id, 'createdBy', g.created_by, 'venue', g.venue_id,
        'subjectKind', g.subject_kind, 'subjectId', g.subject_id,
        'members', (select json_agg(json_build_object('asset', m.asset_id, 'position', m.position) order by m.position)
                    from public.media_contribution_group_members m where m.group_id = g.id)
      ) order by g.created_at), '[]')
      from public.media_contribution_groups g
      where g.id in (select group_id from public.media_contribution_group_members where asset_id = any(${ids(assetIds)}))`)
  },
  /** Dish names labelled on an asset, sorted. */
  labelItems(assetId: string): string[] {
    return json<string[]>(`select coalesce(json_agg(item_name order by item_name), '[]')
      from public.media_label_items where asset_id = ${uuid(assetId)}`)
  },
  /** The asset's menu-photo review rows (one per item). */
  photoRows(assetId: string): PhotoRow[] {
    return json<PhotoRow[]>(`select coalesce(json_agg(json_build_object(
        'item', item_id, 'state', state, 'decidedBy', decided_by, 'author', author_id) order by item_id), '[]')
      from public.menu_item_photos where asset_id = ${uuid(assetId)}`)
  },
  /** Accepted-photo events (the photo side of target credit) for an author at a venue. */
  acceptedEvents(venueId: string, authorId: string): number {
    return Number(readOnly(`select count(*) from public.menu_item_photo_events
      where venue_id = ${uuid(venueId)} and author_id = ${uuid(authorId)} and action = 'accepted'`))
  },
  /** private.monthly_venue_completion_counts for this London month. */
  credit(venueId: string, staffId: string): { menu: number; checks: number } {
    return json(`select json_build_object('menu', menu_items_completed, 'checks', amenity_checks_completed)
      from private.monthly_venue_completion_counts(${uuid(venueId)}, ${uuid(staffId)},
        date_trunc('month', (now() at time zone 'Europe/London'))::date)`)
  },
  /** Which of `assetIds` `viewerId` may see in Photos (community_readable_assets, as the viewer). */
  communityReadable(viewerId: string, assetIds: string[]): string[] {
    const out = asUser(viewerId, `select coalesce(json_agg(x order by x), '[]') from public.community_readable_assets(${ids(assetIds)}) x;`)
    return JSON.parse(out || "[]") as string[]
  },
  /** Which of `assetIds` `viewerId` can select from media_assets under RLS. */
  rlsVisible(viewerId: string, assetIds: string[]): string[] {
    const out = asUser(viewerId, `select coalesce(json_agg(id order by id), '[]') from public.media_assets where id = any(${ids(assetIds)});`)
    return JSON.parse(out || "[]") as string[]
  },
  /** Every knowledge contribution to a check, oldest first. */
  contributions(checkId: string): { by: string; kind: string; answer: string; outcome: string }[] {
    return json(`select coalesce(json_agg(json_build_object(
        'by', contributed_by, 'kind', kind, 'answer', answer, 'outcome', initial_outcome
      ) order by created_at, id), '[]') from public.knowledge_contributions where check_id = ${uuid(checkId)}`)
  },
  /** Saved account drafts on a check (anyone's). */
  drafts(checkId: string): number {
    return Number(readOnly(`select count(*) from public.knowledge_drafts where check_id = ${uuid(checkId)}`))
  },
  /** The one resolver's row, as tests/security/knowledge-fixtures.ts slot() reads it. */
  slot(venueId: string, key: PilotKey): Record<string, unknown> {
    if (!PILOT_KEYS.includes(key)) throw new Error("not a pilot key")
    return json(`select row_to_json(s) from private.knowledge_slot_state(${uuid(venueId)}, array['${key}']) s`)
  },
  /** amenity_submissions rows: the only rows that can earn check credit. */
  submissions(checkId: string): { answer: string; by: string }[] {
    return json(`select coalesce(json_agg(json_build_object('answer', answer, 'by', submitted_by)
      order by created_at, id), '[]') from public.amenity_submissions where check_id = ${uuid(checkId)}`)
  },
}

// ---- Words the screens build from server data ----------------------------------

/** "Accepted for {item}. {item} now has a photo." (manager review-copy.ts). */
export const acceptedFor = (item: string) => `Accepted for ${item}. ${item} now has a photo.`
/** The one set notice (shell/entry-copy.ts setSaved). */
export const setSaved = (n: number, subject: string) =>
  `${n} ${n === 1 ? "photo" : "photos"} of ${subject} saved. Each is reviewed on its own.`
export const SELF_REVIEW = "This is your photo. Another reviewer decides on it."

// ---- Page geometry (browser.evaluate sources) ----------------------------------
// Each is a function expression, not a call: browser.evaluate wraps the source
// and invokes it itself, with its one JSON argument where it takes one.

/** True when nothing overflows the viewport horizontally. */
export const NO_HORIZONTAL_OVERFLOW = "() => document.documentElement.scrollWidth <= window.innerWidth"

/** The layout viewport the page actually has, in CSS pixels. */
export const VIEWPORT_SIZE = "() => ({ width: window.innerWidth, height: window.innerHeight })"

export type Region = {
  /** Found exactly once by its accessible name. */
  name: string
  top: number
  bottom: number
  /** Inside the viewport's width. */
  fitsWidth: boolean
  /** Wholly between the top and bottom of the viewport. */
  onScreen: boolean
  /** Fixed or sticky chrome (the tab bar, a dock) overlapping it. */
  coveredBy: string[]
  /** Non-inline descendants whose content is wider than their box. */
  clipped: string[]
}

/**
 * Measures the element named exactly `arg.name` by aria-label, or by the
 * text of the heading that labels it (aria-labelledby). With `arg.align`,
 * first scrolls the window, instantly, so its top sits 16px below the
 * viewport's top, then measures. Argument: { name: string, align: boolean }.
 */
export const REGION_GEOMETRY = `(arg) => {
  const label = (el) => {
    const by = el.getAttribute('aria-labelledby')
    if (by) return by.split(/\\s+/).map((id) => (document.getElementById(id)?.textContent ?? '').trim()).join(' ')
    return (el.getAttribute('aria-label') ?? '').trim()
  }
  const found = Array.from(document.querySelectorAll('[aria-label],[aria-labelledby]')).filter((el) => label(el) === arg.name)
  if (found.length !== 1) throw new Error(found.length + ' elements are named "' + arg.name + '".')
  const el = found[0]
  if (arg.align) {
    const top = el.getBoundingClientRect().top
    window.scrollTo({ top: window.scrollY + top - 16, behavior: 'instant' })
  }
  const vw = document.documentElement.clientWidth
  const vh = window.innerHeight
  const describe = (n) => n.tagName.toLowerCase() + (n.getAttribute('data-slot') ? '[data-slot=' + n.getAttribute('data-slot') + ']' : '')
  const sized = (r) => r.width > 1 && r.height > 1
  const r = el.getBoundingClientRect()
  const chrome = Array.from(document.querySelectorAll('body *')).filter((c) => {
    const s = getComputedStyle(c)
    return (s.position === 'fixed' || s.position === 'sticky') && s.display !== 'none' && s.visibility !== 'hidden'
  })
  const coveredBy = chrome.filter((c) => {
    if (c.contains(el) || el.contains(c)) return false
    const b = c.getBoundingClientRect()
    return sized(b) && b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top
  }).map(describe)
  const clipped = [el, ...Array.from(el.querySelectorAll('*'))].filter((c) => {
    if (!(c instanceof HTMLElement) || getComputedStyle(c).display === 'inline') return false
    return sized(c.getBoundingClientRect()) && c.scrollWidth > c.clientWidth + 1
  }).map(describe)
  return {
    name: arg.name,
    top: r.top,
    bottom: r.bottom,
    fitsWidth: r.left >= -0.5 && r.right <= vw + 0.5,
    onScreen: r.top >= 0 && r.bottom <= vh,
    coveredBy,
    clipped,
  }
}`

export type ControlInView = {
  /** Inside a position: sticky or fixed ancestor (a dock or the tab bar). */
  docked: boolean
  /** The control's whole box is inside the viewport. */
  inViewport: boolean
  /** What its centre and edge midpoints hit: "self", or the first thing covering it. */
  topmost: string
  /** Its box, for the touch-target check. */
  width: number
  height: number
}

/**
 * Where the one button whose trimmed text is exactly `arg` is, without
 * scrolling. Argument: the button's text.
 */
export const CONTROL_IN_VIEW = `(name) => {
  const found = Array.from(document.querySelectorAll('button')).filter((b) => (b.textContent ?? '').trim() === name)
  if (found.length !== 1) throw new Error(found.length + ' buttons read "' + name + '".')
  const button = found[0]
  let docked = false
  for (let el = button.parentElement; el; el = el.parentElement) {
    const p = getComputedStyle(el).position
    if (p === 'sticky' || p === 'fixed') { docked = true; break }
  }
  const r = button.getBoundingClientRect()
  const inViewport = r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 &&
    r.bottom <= window.innerHeight && r.right <= document.documentElement.clientWidth
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2
  const points = [[cx, cy], [cx, r.top + 2], [cx, r.bottom - 2], [r.left + 2, cy], [r.right - 2, cy]]
  let topmost = inViewport ? 'self' : 'nothing'
  for (const [x, y] of inViewport ? points : []) {
    const hit = document.elementFromPoint(x, y)
    if (hit && button.contains(hit)) continue
    topmost = !hit ? 'nothing' :
      hit.tagName.toLowerCase() + (hit.closest('[data-slot]') ? ' in [data-slot=' + hit.closest('[data-slot]').getAttribute('data-slot') + ']' : '')
    break
  }
  return { docked, inViewport, topmost, width: r.width, height: r.height }
}`

/**
 * The focused element after keyboard navigation: its tag, accessible text and
 * whether a visible focus indicator (outline or box-shadow ring) is drawn.
 */
export const FOCUSED = `() => {
  const el = document.activeElement
  if (!el || el === document.body) return { tag: 'body', name: '', ring: false }
  const s = getComputedStyle(el)
  const ring = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none')
  const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\\s+/g, ' ')
  return { tag: el.tagName.toLowerCase(), name, ring: Boolean(ring) }
}`
export type Focused = { tag: string; name: string; ring: boolean }
