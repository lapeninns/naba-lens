import { randomUUID } from "node:crypto"

import sharp from "sharp"

import { provisioner, psql } from "./stack"
import { createPeople, createVenues, type Person, type Venue } from "./world"

/**
 * DEV FIXTURE world for the coverage specs, on the isolated stack only. Unlike
 * provisionWorld, every staff member except the joiner has a team (FOH/BOH), so
 * profile setup is complete; the joiner has none and must show "Needs setup".
 * Manager grants and targets are made by the specs through the real admin and
 * manager flows, never here.
 */
export type CoverageWorld = {
  tag: string
  venue1: Venue
  venue2: Venue
  admin: Person
  manager: Person
  staffA: Person
  staffB: Person
  joiner: Person
  staffC: Person
}

type Department = "foh" | "boh"

function setDepartments(entries: [Person, Department | null][]) {
  const values = entries
    .map(([p, d]) => `('${p.id}'::uuid, ${d ? `'${d}'` : "null"}::text)`)
    .join(", ")
  psql(`
    update public.profiles p set department = v.department
    from (values ${values}) as v (id, department)
    where p.id = v.id;
  `)
}

export async function provisionCoverageWorld(): Promise<CoverageWorld> {
  const tag = randomUUID().slice(0, 6)
  const [venue1, venue2] = await createVenues(tag, ["Cover One", "Cover Two"])
  const [admin, manager, staffA, staffB, joiner, staffC] = createPeople(tag, [
    { label: "Cover Admin", role: "admin", venueId: null },
    {
      label: "Cover Manager",
      role: "staff",
      venueId: venue1.id,
      jobTitle: "General Manager",
    },
    {
      label: "Cover Staff A",
      role: "staff",
      venueId: venue1.id,
      jobTitle: "Chef",
    },
    {
      label: "Cover Staff B",
      role: "staff",
      venueId: venue1.id,
      jobTitle: "Bartender",
    },
    { label: "Cover Joiner", role: "staff", venueId: venue1.id },
    {
      label: "Cover Staff C",
      role: "staff",
      venueId: venue2.id,
      jobTitle: "Server",
    },
  ])
  setDepartments([
    [manager, "foh"],
    [staffA, "boh"],
    [staffB, "foh"],
    [joiner, null],
    [staffC, "foh"],
  ])
  return { tag, venue1, venue2, admin, manager, staffA, staffB, joiner, staffC }
}

/**
 * A venue manager grant held by a STAFF account, as made before venue manager
 * accounts existed. Under the transitional rule it stays in effect for the
 * legacy /staff/manage tools; grant_venue_manager now refuses staff accounts,
 * so the service role writes the rows it used to write (fixture setup only).
 * The /manager workspace uses real manager accounts (helpers/manager-world).
 */
export async function legacyStaffGrant(
  admin: Pick<Person, "id">,
  staff: Pick<Person, "id">,
  venue: Pick<Venue, "id">
): Promise<string> {
  const service = provisioner()
  const { data, error } = await service
    .from("venue_manager_grants")
    .insert({
      staff_id: staff.id,
      venue_id: venue.id,
      granted_by: admin.id,
      grant_reason: "DEV FIXTURE legacy staff grant",
    })
    .select("id")
    .single()
  if (error) throw error
  const audit = await service.from("coverage_audit_events").insert({
    venue_id: venue.id,
    entity: "manager_grant",
    entity_id: data.id,
    actor_id: admin.id,
    actor_role: "admin",
    action: "granted",
    reason: "DEV FIXTURE legacy staff grant",
    after: { staffId: staff.id },
  })
  if (audit.error) throw audit.error
  return data.id
}

const DERIVATIVE_CACHE = new Map<string, Buffer>()

async function derivative(colour: string) {
  let bytes = DERIVATIVE_CACHE.get(colour)
  if (!bytes) {
    bytes = await sharp({
      create: { width: 320, height: 240, channels: 3, background: colour },
    })
      .webp()
      .toBuffer()
    DERIVATIVE_CACHE.set(colour, bytes)
  }
  return bytes
}

/**
 * Images with real thumb/preview derivatives in Storage (the original is never
 * stored: coverage never serves originals). `state: "processing"` keeps the
 * derivative keys but never finishes, so a denial is about readiness rather
 * than a missing file. `uploadedAt` moves the asset's immutable upload time for
 * month-boundary cases; the guard trigger is bypassed for this fixture write
 * only.
 */
export async function seedImages(
  uploader: Pick<Person, "id">,
  venue: Pick<Venue, "id">,
  count: number,
  options: {
    prefix?: string
    uploadedAt?: string
    colour?: string
    state?: "ready" | "processing"
  } = {}
): Promise<string[]> {
  const admin = provisioner()
  const bytes = await derivative(options.colour ?? "#c98a4b")
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    const id = randomUUID()
    const prefix = `${uploader.id}/${id}`
    const insert = await admin.from("media_assets").insert({
      id,
      uploader_id: uploader.id,
      venue_id: venue.id,
      media_type: "image",
      original_path: `${prefix}/original.jpg`,
      original_filename: `${options.prefix ?? "DEV-FIXTURE-coverage"}-${String(i + 1).padStart(2, "0")}.jpg`,
    })
    if (insert.error) throw insert.error
    for (const kind of ["thumb", "preview"]) {
      const up = await admin.storage
        .from("media")
        .upload(`${prefix}/${kind}.webp`, bytes, { contentType: "image/webp" })
      if (up.error) throw up.error
    }
    const processing = await admin
      .from("media_assets")
      .update({
        upload_state: "processing",
        thumbnail_path: `${prefix}/thumb.webp`,
        preview_path: `${prefix}/preview.webp`,
      })
      .eq("id", id)
    if (processing.error) throw processing.error
    if (options.state !== "processing") {
      const ready = await admin
        .from("media_assets")
        .update({
          upload_state: "ready",
          validated_mime_type: "image/jpeg",
          size_bytes: 2048,
          width: 320,
          height: 240,
        })
        .eq("id", id)
      if (ready.error) throw ready.error
    }
    ids.push(id)
  }
  if (options.uploadedAt) setUploadedAt(ids, options.uploadedAt)
  return ids
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

/** Moves the immutable upload time of fixture assets (fixture setup only). */
export function setUploadedAt(assetIds: string[], instant: string) {
  if (!assetIds.every((id) => UUID.test(id))) throw new Error("not a uuid")
  if (!INSTANT.test(instant)) throw new Error("instant must be UTC ISO")
  psql(`
    begin;
    set local session_replication_role = replica;
    update public.media_assets set created_at = '${instant}'::timestamptz
    where id in (${assetIds.map((id) => `'${id}'`).join(", ")});
    commit;
  `)
}

/**
 * The UTC instant of a Europe/London wall-clock time. Computed with Intl, so a
 * BST date and a GMT date resolve to different offsets.
 */
export function londonInstant(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
): string {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second)
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(guess))
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value)
  const asLondon = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  )
  return new Date(guess - (asLondon - guess))
    .toISOString()
    .replace(".000Z", "Z")
}
