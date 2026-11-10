import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { expect, type Locator, type Page } from "@playwright/test"
import sharp from "sharp"

import { formatDateTime } from "../../../components/nabalens/tasks/copy"
import {
  ANSWER_LABEL,
  CORE_CHECK_KEYS,
  evidenceHref,
  UI_TEXT,
  type AmenityRpcName,
  type AmenityRpcs,
  type CheckAnswer,
  type CheckProgress,
  type CheckStatus,
  type EvidenceRule,
  type SubmitAnswer,
} from "../../../lib/amenities/contract"
import { signIn, type Db } from "../../support/identities"
import { legacyStaffGrant, seedImages } from "./coverage-world"
import { convertToManager } from "./manager-world"
import { provisioner, psql } from "./stack"
import { createPeople, createVenues, type Person, type Venue } from "./world"

/**
 * DEV FIXTURE world for the amenity specs, on the isolated stack only: venue A
 * with a manager and two staff; venue B with its own manager and staff, for
 * isolation. managerA and managerB are real venue manager ACCOUNTS (role
 * 'manager'), converted from staff by the admin's own session through
 * convert_account_to_manager (helpers/manager-world), so each holds an
 * effective grant for its venue and works in the /manager workspace.
 * Everyone has a team, so staff Home is past first-run setup. The service
 * client only creates rows and media and reads state for assertions; every
 * amenity action runs as a real user, in the UI or the user's own session.
 */
export type AmenitiesWorld = {
  tag: string
  venueA: Venue
  venueB: Venue
  admin: Person
  managerA: Person
  staffA: Person
  staffA2: Person
  managerB: Person
  staffB: Person
}

export async function provisionAmenitiesWorld(): Promise<AmenitiesWorld> {
  const tag = randomUUID().slice(0, 6)
  const [venueA, venueB] = await createVenues(tag, ["Amen One", "Amen Two"])
  const [admin, managerA, staffA, staffA2, managerB, staffB] = createPeople(
    tag,
    [
      { label: "Amen Admin", role: "admin", venueId: null },
      {
        label: "Amen Manager A",
        role: "staff",
        venueId: venueA.id,
        jobTitle: "General Manager",
      },
      {
        label: "Amen Staff A",
        role: "staff",
        venueId: venueA.id,
        jobTitle: "Bartender",
      },
      {
        label: "Amen Staff A2",
        role: "staff",
        venueId: venueA.id,
        jobTitle: "Server",
      },
      {
        label: "Amen Manager B",
        role: "staff",
        venueId: venueB.id,
        jobTitle: "General Manager",
      },
      {
        label: "Amen Staff B",
        role: "staff",
        venueId: venueB.id,
        jobTitle: "Server",
      },
    ]
  )
  const ids = [managerA, staffA, staffA2, managerB, staffB]
    .map((p) => `'${p.id}'::uuid`)
    .join(", ")
  psql(`update public.profiles set department = 'foh' where id in (${ids});`)

  // grant_venue_manager refuses staff accounts: managers are converted.
  const adminDb = await signIn(provisioner(), admin.email)
  await convertToManager(adminDb, managerA, venueA)
  await convertToManager(adminDb, managerB, venueB)
  return {
    tag,
    venueA,
    venueB,
    admin,
    managerA,
    staffA,
    staffA2,
    managerB,
    staffB,
  }
}

/**
 * Makes `staff` a transitional venue manager: a grant held by a STAFF account,
 * as made before manager accounts existed (helpers/coverage-world). It stays
 * effective for the legacy /staff/manage tools.
 */
export function legacyManagerGrant(
  w: Pick<AmenitiesWorld, "admin">,
  staff: Pick<Person, "id">,
  venue: Pick<Venue, "id">
): Promise<string> {
  return legacyStaffGrant(w.admin, staff, venue)
}

// ---- The shared catalogue, read from the seed CSV ------------------------------

type CatalogueRow = {
  key: string
  question: string
  evidenceRule: EvidenceRule
  isCore: boolean
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let cell = ""
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ",") {
      cells.push(cell)
      cell = ""
    } else cell += c
  }
  cells.push(cell)
  return cells
}

const CATALOGUE: ReadonlyMap<string, CatalogueRow> = new Map(
  readFileSync(
    fileURLToPath(
      new URL("../../../supabase/seed/amenity_catalogue.csv", import.meta.url)
    ),
    "utf8"
  )
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => {
      const [key, , question, rule, , isCore] = parseCsvLine(line)
      return [
        key!,
        {
          key: key!,
          question: question!,
          evidenceRule: rule as EvidenceRule,
          isCore: isCore === "true",
        },
      ] as const
    })
)

export function catalogue(key: string): CatalogueRow {
  const row = CATALOGUE.get(key)
  if (!row) throw new Error(`No catalogue entry ${key}`)
  return row
}

export const question = (key: string) => catalogue(key).question
export const CORE_QUESTIONS = CORE_CHECK_KEYS.map(question)

// ---- Media fixtures ---------------------------------------------------------

/** One ready photo with real thumb/preview derivatives, owned by `uploader`. */
export async function seedPhoto(
  uploader: Pick<Person, "id">,
  venue: Pick<Venue, "id">,
  label: string,
  options: {
    uploaderRole?: "staff" | "manager"
    purpose?: "general" | "amenity"
  } = {}
): Promise<string> {
  const [id] = await seedImages(uploader, venue, 1, {
    prefix: `DEV-FIXTURE-amenity-${label}`,
    colour: "#4b7bc9",
    uploaderRole: options.uploaderRole,
    purpose: options.purpose,
  })
  return id!
}

const VIDEO_FIXTURE = fileURLToPath(
  new URL("../../fixtures/media/synthetic.mp4", import.meta.url)
)

/**
 * One ready video owned by `uploader`: the repo's synthetic H.264 MP4 stored
 * as the original (video playback streams the original) plus a poster thumb,
 * the same shape the media pipeline leaves behind.
 */
export async function seedVideo(
  uploader: Pick<Person, "id">,
  venue: Pick<Venue, "id">,
  label: string
): Promise<string> {
  const admin = provisioner()
  const id = randomUUID()
  const prefix = `${uploader.id}/${id}`
  const original = readFileSync(VIDEO_FIXTURE)
  const insert = await admin.from("media_assets").insert({
    id,
    uploader_id: uploader.id,
    venue_id: venue.id,
    media_type: "video",
    original_path: `${prefix}/original.mp4`,
    original_filename: `DEV-FIXTURE-amenity-${label}.mp4`,
  })
  if (insert.error) throw insert.error
  const poster = await sharp({
    create: { width: 320, height: 240, channels: 3, background: "#2f6f4e" },
  })
    .webp()
    .toBuffer()
  for (const [path, bytes, contentType] of [
    [`${prefix}/original.mp4`, original, "video/mp4"],
    [`${prefix}/thumb.webp`, poster, "image/webp"],
  ] as const) {
    const up = await admin.storage
      .from("media")
      .upload(path, bytes, { contentType })
    if (up.error) throw up.error
  }
  const processing = await admin
    .from("media_assets")
    .update({
      upload_state: "processing",
      thumbnail_path: `${prefix}/thumb.webp`,
    })
    .eq("id", id)
  if (processing.error) throw processing.error
  const ready = await admin
    .from("media_assets")
    .update({
      upload_state: "ready",
      validated_mime_type: "video/mp4",
      size_bytes: original.byteLength,
      width: 320,
      height: 240,
      duration_seconds: 1,
    })
    .eq("id", id)
  if (ready.error) throw ready.error
  return id
}

// ---- Amenity RPCs as a real user ------------------------------------------------

type RpcError = { code: string; message: string; details?: string | null }

/**
 * Calls an amenity RPC in the caller's own session, typed from the contract
 * (the generated database types gain these functions with the migration).
 */
export async function amenityRpc<K extends AmenityRpcName>(
  db: Db,
  name: K,
  args: AmenityRpcs[K]["args"]
): Promise<{ data: AmenityRpcs[K]["returns"] | null; error: RpcError | null }> {
  const rpc = db.rpc.bind(db) as unknown as (
    fn: string,
    args: unknown
  ) => PromiseLike<{ data: unknown; error: RpcError | null }>
  const { data, error } = await rpc(name, args)
  return { data: data as AmenityRpcs[K]["returns"] | null, error }
}

export async function amenityOk<K extends AmenityRpcName>(
  db: Db,
  name: K,
  args: AmenityRpcs[K]["args"]
): Promise<AmenityRpcs[K]["returns"]> {
  const { data, error } = await amenityRpc(db, name, args)
  if (error) {
    throw new Error(
      `${name}: ${error.message} (${error.code}) ${error.details ?? ""}`
    )
  }
  return data as AmenityRpcs[K]["returns"]
}

/** The RPC refuses with this contract error message (RPC_ERRORS). */
export async function expectRefused<K extends AmenityRpcName>(
  db: Db,
  name: K,
  args: AmenityRpcs[K]["args"],
  message: string
) {
  const { error } = await amenityRpc(db, name, args)
  expect(error?.message, `${name} refused with ${message}`).toBe(message)
}

export const sessionOf = (person: Pick<Person, "email">) =>
  signIn(provisioner(), person.email)

/** Enables a venue and assigns `key` (added when not core) to `assignee`. */
export async function readyCheck(
  w: AmenitiesWorld,
  venue: Venue,
  key: string,
  assignee: Person | null
): Promise<string> {
  const admin = await sessionOf(w.admin)
  await amenityOk(admin, "amenity_enable_venue", { p_venue_id: venue.id })
  if (!catalogue(key).isCore) {
    await amenityOk(admin, "amenity_add_checks", {
      p_venue_id: venue.id,
      p_keys: [key],
    })
  }
  const id = checkId(venue, key)
  if (assignee) {
    await amenityOk(admin, "amenity_assign_check", {
      p_check_id: id,
      p_assignee_id: assignee.id,
      p_revision: checkState(id).revision,
    })
  }
  return id
}

/** A submission in `submitter`'s own session, with a fresh idempotency key. */
export function submitArgs(
  checkIdValue: string,
  answer: SubmitAnswer,
  assetIds: string[],
  extra: Partial<AmenityRpcs["amenity_submit_finding"]["args"]> = {}
): AmenityRpcs["amenity_submit_finding"]["args"] {
  return {
    p_check_id: checkIdValue,
    p_revision: checkState(checkIdValue).revision,
    p_idempotency_key: randomUUID(),
    p_answer: answer,
    p_finding: null,
    p_limitations: null,
    p_reason: null,
    p_asset_ids: assetIds,
    p_internal_metadata: null,
    p_redaction_confirmed: false,
    ...extra,
  }
}

// ---- Database state, read for assertions (service, read-only) -------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const uuid = (id: string) => {
  if (!UUID.test(id)) throw new Error(`not a uuid: ${id}`)
  return `'${id}'::uuid`
}
const keyLiteral = (key: string) => {
  if (!/^[a-z_]+$/.test(key)) throw new Error(`not a catalogue key: ${key}`)
  return `'${key}'`
}

export function checkId(venue: Pick<Venue, "id">, key: string): string {
  const id = psql(
    `select id from public.venue_amenity_checks where venue_id = ${uuid(venue.id)} and template_key = ${keyLiteral(key)}`
  )
  expect(id, `${key} check at ${venue.id}`).toMatch(UUID)
  return id
}

export type CheckState = {
  status: CheckStatus
  progress: CheckProgress
  answer: CheckAnswer
  assignee: string | null
  answeredBy: string | null
  recheckReason: string | null
  notes: string | null
  revision: number
  submissions: number
}

export function checkState(id: string): CheckState {
  const row = psql(`
    select json_build_object(
      'status', c.status, 'progress', c.progress, 'answer', c.answer,
      'assignee', c.assignee_user_id, 'answeredBy', c.answered_by,
      'recheckReason', c.recheck_reason, 'notes', c.notes, 'revision', c.revision,
      'submissions', (select count(*) from public.amenity_submissions s where s.check_id = c.id)
    ) from public.venue_amenity_checks c where c.id = ${uuid(id)}`)
  return JSON.parse(row) as CheckState
}

export function checkKeys(venue: Pick<Venue, "id">): string[] {
  return psql(
    `select coalesce(string_agg(template_key, ',' order by template_key), '') from public.venue_amenity_checks where venue_id = ${uuid(venue.id)}`
  )
    .split(",")
    .filter(Boolean)
}

export function eventKinds(id: string): string[] {
  return psql(
    `select coalesce(string_agg(kind::text, ',' order by created_at, id), '') from public.amenity_check_events where check_id = ${uuid(id)}`
  )
    .split(",")
    .filter(Boolean)
}

export function currentSubmission(id: string) {
  const row = psql(`
    select json_build_object(
      'id', s.id, 'answer', s.answer, 'reason', s.reason,
      'submittedBy', s.submitted_by, 'metadata', s.internal_metadata,
      'assets', (select coalesce(json_agg(a.asset_id order by a.asset_id), '[]'::json)
                 from public.amenity_submission_assets a where a.submission_id = s.id)
    ) from public.venue_amenity_checks c
    join public.amenity_submissions s on s.id = c.current_submission_id
    where c.id = ${uuid(id)}`)
  return JSON.parse(row) as {
    id: string
    answer: SubmitAnswer
    reason: string | null
    submittedBy: string
    metadata: Record<string, unknown> | null
    assets: string[]
  }
}

/** Rows a venue has in every Coverage table amenities must never write. */
export function coverageFootprint(venue: Pick<Venue, "id">) {
  const v = uuid(venue.id)
  const row = psql(`
    select json_build_object(
      'requirements', (select count(*) from public.coverage_requirements where venue_id = ${v}),
      'assignees', (select count(*) from public.coverage_requirement_assignees a join public.coverage_requirements r on r.id = a.requirement_id where r.venue_id = ${v}),
      'submissions', (select count(*) from public.coverage_submissions where venue_id = ${v}),
      'items', (select count(*) from public.coverage_submission_items i join public.coverage_requirements r on r.id = i.requirement_id where r.venue_id = ${v}),
      'targets', (select count(*) from public.monthly_targets where venue_id = ${v}),
      'facts', (select count(*) from public.venue_amenity_facts where venue_id = ${v})
    )`)
  return JSON.parse(row) as Record<string, number>
}

// ---- UI ------------------------------------------------------------------

/**
 * A check in a venue's Amenities list, by its guest question. Pages show the
 * catalogue question as the check's link text.
 */
export function checkItem(scope: Page | Locator, key: string): Locator {
  return scope.getByRole("listitem").filter({ hasText: question(key) })
}

/**
 * A person as the check page's Assignee select lists them: display name, then
 * job title in brackets (components/nabalens/amenities/manage/check-detail.tsx).
 */
export function assigneeOption(person: Pick<Person, "id" | "name">): string {
  const jobTitle = psql(
    `select coalesce(job_title, '') from public.profiles where id = ${uuid(person.id)}`
  )
  return jobTitle ? `${person.name} (${jobTitle})` : person.name
}

/**
 * The evidence picker's checkbox for one asset
 * (components/nabalens/amenities/capture/evidence-picker.tsx). Its accessible
 * name is "Photo added 7 Nov 2026, 10:00", not an id: a photo is found by its
 * tile's thumbnail route, which carries the asset id; a video tile has no
 * thumbnail, so it is found by that name, from the asset's own upload time.
 */
function evidenceCheckbox(page: Page, assetId: string): Locator {
  const row = psql(
    `select json_build_object('kind', media_type, 'createdAt', (extract(epoch from created_at) * 1000)::bigint) from public.media_assets where id = ${uuid(assetId)}`
  )
  const asset = JSON.parse(row) as {
    kind: "image" | "video"
    createdAt: number
  }
  if (asset.kind === "image") {
    return page
      .getByRole("listitem")
      .filter({
        has: page.locator(`img[src^="${evidenceHref(assetId, "thumb")}"]`),
      })
      .getByRole("checkbox")
  }
  const added = formatDateTime(new Date(asset.createdAt).toISOString())
  return page.getByRole("checkbox", {
    name: `Video added ${added}`,
    exact: true,
  })
}

/**
 * The capture form (staff task page, or a manager/admin "Capture myself"
 * page; /manager and /staff/manage share the screen), components/nabalens/amenities/capture/capture-form.tsx. Choices are
 * radios named by ANSWER_LABEL. "What you found" and "Limitations" are
 * optional, so their labels end in " (optional)"; Reason shows only for No and
 * Not applicable, and the Wi-Fi test fields only for a Wi-Fi Yes.
 */
export function captureForm(page: Page) {
  const evidence = (assetId: string) => evidenceCheckbox(page, assetId)
  return {
    answer: (answer: SubmitAnswer) =>
      page
        .getByRole("radio", { name: ANSWER_LABEL[answer], exact: true })
        .check(),
    attach: (assetId: string) => evidence(assetId).check(),
    detach: (assetId: string) => evidence(assetId).uncheck(),
    evidence,
    finding: page.getByLabel(/^What you found/),
    limitations: page.getByLabel(/^Limitations/),
    reason: page.getByLabel("Reason", { exact: true }),
    redaction: page.getByRole("checkbox", { name: UI_TEXT.redactionConfirm }),
    wifi: {
      testSpot: page.getByLabel("Where you tested", { exact: true }),
      testedOn: page.getByLabel("Test date", { exact: true }),
      download: page.getByLabel("Download (Mbps)", { exact: true }),
      upload: page.getByLabel("Upload (Mbps)", { exact: true }),
    },
    submit: page.getByRole("button", { name: UI_TEXT.submit }),
  }
}

/** Submits and waits for the check to become Complete. */
export async function submitAndComplete(page: Page, id: string) {
  await captureForm(page).submit.click()
  await expect.poll(() => checkState(id).progress).toBe("complete")
}

/**
 * The form refuses this submission: either Submit stays disabled, or the
 * attempt is answered with an alert or an invalid field. Either way nothing
 * is recorded.
 */
export async function expectSubmitRefused(page: Page, id: string) {
  const before = checkState(id)
  const submit = captureForm(page).submit
  if (await submit.isEnabled()) {
    await submit.click()
    await expect(
      page.getByRole("alert").or(page.locator('[aria-invalid="true"]')).first()
    ).toBeVisible()
  }
  const after = checkState(id)
  expect(after.submissions, "no submission recorded").toBe(before.submissions)
  expect(after.progress).toBe(before.progress)
}

/** Today in London as YYYY-MM-DD (Wi-Fi test date). */
export function londonToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}
