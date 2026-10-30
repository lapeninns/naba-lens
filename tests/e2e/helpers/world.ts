import { randomUUID } from "node:crypto"

import type { Browser, BrowserContextOptions, Page } from "@playwright/test"

import { provisioner } from "./stack"

/**
 * DEV FIXTURE world for one spec, on the isolated stack only: two test venues,
 * Admin A, Admin B (the "different admin"), Staff A and Staff B at venue 1 and
 * Staff C at venue 2. Every name and email is unique per call, so specs share
 * no state. The service client only creates these rows; it never answers an
 * authorisation question.
 */
export type Person = {
  id: string
  email: string
  name: string
  role: "staff" | "admin"
}
export type Venue = { id: string; name: string }
export type World = {
  tag: string
  venue1: Venue
  venue2: Venue
  adminA: Person
  adminB: Person
  staffA: Person
  staffB: Person
  staffC: Person
}

export function uniqueTag() {
  return randomUUID().slice(0, 6)
}

export function fixtureEmail(label: string, tag: string) {
  return `e2e-${label}-${tag}@nabalens.test`
}

async function venue(label: string, tag: string): Promise<Venue> {
  const { data, error } = await provisioner()
    .from("venues")
    .insert({
      name: `DEV FIXTURE ${label} ${tag}`,
      slug: `dev-fixture-${label.toLowerCase().replace(/\s+/g, "-")}-${tag}`,
      active: true,
    })
    .select("id, name")
    .single()
  if (error) throw error
  return data
}

export async function person(
  label: string,
  tag: string,
  role: "staff" | "admin",
  venueId: string | null,
  jobTitle: string | null = null
): Promise<Person> {
  const admin = provisioner()
  const email = fixtureEmail(label.toLowerCase().replace(/\s+/g, "-"), tag)
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  })
  if (error) throw new Error(`createUser ${email}: ${error.message}`)
  const name = `DEV FIXTURE ${label} ${tag}`
  const { error: profileError } = await admin.from("profiles").insert({
    id: data.user.id,
    display_name: name,
    job_title: jobTitle,
    role,
    venue_id: venueId,
    active: true,
  })
  if (profileError) throw profileError
  return { id: data.user.id, email, name, role }
}

export async function provisionWorld(): Promise<World> {
  const tag = uniqueTag()
  const [venue1, venue2] = await Promise.all([
    venue("Venue One", tag),
    venue("Venue Two", tag),
  ])
  // Sequential: the local auth server is the bottleneck under load.
  const adminA = await person("Admin A", tag, "admin", null)
  const adminB = await person("Admin B", tag, "admin", null)
  const staffA = await person("Staff A", tag, "staff", venue1.id, "Chef")
  const staffB = await person("Staff B", tag, "staff", venue1.id, "Bartender")
  const staffC = await person("Staff C", tag, "staff", venue2.id, "Server")
  return { tag, venue1, venue2, adminA, adminB, staffA, staffB, staffC }
}

/**
 * A browser context signed in as `who`. The magic-link token is minted by the
 * provisioner (fixture setup), but the session is the user's own: the browser
 * verifies it through the app's /auth/confirm route like an emailed link.
 * No retries: a 5xx from the auth server fails the test with its status.
 */
export async function signedInPage(
  browser: Browser,
  who: Pick<Person, "email">,
  options: BrowserContextOptions = {}
): Promise<Page> {
  const { data, error } = await provisioner().auth.admin.generateLink({
    type: "magiclink",
    email: who.email,
  })
  if (error) {
    throw new Error(
      `generateLink for ${who.email} failed: ${error.status} ${error.message}`
    )
  }
  const context = await browser.newContext(options)
  const page = await context.newPage()
  await page.goto(
    `/auth/confirm?token_hash=${data.properties.hashed_token}&type=email`
  )
  return page
}

/** Ready rows without stored bytes, for pagination/filter checks only. */
export async function seedReadyAssets(
  uploaderId: string,
  venueId: string,
  count: number,
  kind: "image" | "video",
  prefix: string
) {
  const admin = provisioner()
  const rows = Array.from({ length: count }, (_, i) => {
    const id = randomUUID()
    const ext = kind === "image" ? "jpg" : "mp4"
    return {
      id,
      uploader_id: uploaderId,
      venue_id: venueId,
      original_path: `${uploaderId}/${id}/original.${ext}`,
      original_filename: `${prefix}-${String(i + 1).padStart(2, "0")}.${ext}`,
      media_type: kind,
    }
  })
  const ids = rows.map((r) => r.id)
  const insert = await admin.from("media_assets").insert(rows)
  if (insert.error) throw insert.error
  const processing = await admin
    .from("media_assets")
    .update({ upload_state: "processing" })
    .in("id", ids)
  if (processing.error) throw processing.error
  const ready = await admin
    .from("media_assets")
    .update({
      upload_state: "ready",
      validated_mime_type: kind === "image" ? "image/jpeg" : "video/mp4",
      size_bytes: 1024,
      width: 640,
      height: 480,
    })
    .in("id", ids)
  if (ready.error) throw ready.error
  return ids
}
