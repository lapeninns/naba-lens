import { randomUUID } from "node:crypto"

import type { Browser, BrowserContextOptions, Page } from "@playwright/test"

import { provisioner, psql } from "./stack"

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

const quote = (v: string | null) =>
  v === null ? "null" : `'${v.replace(/'/g, "''")}'`

type PersonSpec = {
  label: string
  role: "staff" | "admin"
  venueId: string | null
  jobTitle?: string | null
}

/**
 * Creates auth users, identities and profiles in ONE SQL statement, in the same
 * shape as supabase/seed.sql. Provisioning deliberately bypasses the auth API:
 * under machine load GoTrue's admin endpoint hits its 10 s request deadline
 * (504), and fixture setup is not what these tests assert. Sign-in and
 * invitation still go through the real auth server.
 */
export function createPeople(tag: string, specs: PersonSpec[]): Person[] {
  const people = specs.map((spec) => ({
    id: randomUUID(),
    email: fixtureEmail(spec.label.toLowerCase().replace(/\s+/g, "-"), tag),
    name: `DEV FIXTURE ${spec.label} ${tag}`,
    role: spec.role,
    venueId: spec.venueId,
    jobTitle: spec.jobTitle ?? null,
  }))
  const values = people
    .map((p) => `(${quote(p.id)}::uuid, ${quote(p.email)})`)
    .join(", ")
  const profiles = people
    .map(
      (p) =>
        `(${quote(p.id)}::uuid, ${quote(p.name)}, ${quote(p.jobTitle)}, ${quote(p.role)}::public.app_role, ${p.venueId ? `${quote(p.venueId)}::uuid` : "null"}, true)`
    )
    .join(", ")
  psql(`
    with fixture_users (id, email) as (values ${values}),
    users as (
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change,
        email_change_token_current, phone_change, phone_change_token, reauthentication_token
      )
      select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
        email, '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        now(), now(), '', '', '', '', '', '', '', ''
      from fixture_users
      returning id, email
    ),
    identities as (
      insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
      select gen_random_uuid(), u.id, u.id::text, 'email',
        jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
        now(), now(), now()
      from users u
      returning user_id
    )
    insert into public.profiles (id, display_name, job_title, role, venue_id, active)
    select v.* from (values ${profiles}) as v (id, display_name, job_title, role, venue_id, active)
    where v.id in (select user_id from identities);
  `)
  return people.map(({ id, email, name, role }) => ({ id, email, name, role }))
}

export async function createVenues(tag: string, labels: string[]) {
  const { data, error } = await provisioner()
    .from("venues")
    .insert(
      labels.map((label) => ({
        name: `DEV FIXTURE ${label} ${tag}`,
        slug: `dev-fixture-${label.toLowerCase().replace(/\s+/g, "-")}-${tag}`,
        active: true,
      }))
    )
    .select("id, name, slug")
  if (error) throw error
  return labels.map(
    (label) =>
      data.find((v) => v.name === `DEV FIXTURE ${label} ${tag}`)! as Venue & {
        slug: string
      }
  )
}

export async function provisionWorld(): Promise<World> {
  const tag = uniqueTag()
  const [venue1, venue2] = await createVenues(tag, ["Venue One", "Venue Two"])
  const [adminA, adminB, staffA, staffB, staffC] = createPeople(tag, [
    { label: "Admin A", role: "admin", venueId: null },
    { label: "Admin B", role: "admin", venueId: null },
    { label: "Staff A", role: "staff", venueId: venue1.id, jobTitle: "Chef" },
    {
      label: "Staff B",
      role: "staff",
      venueId: venue1.id,
      jobTitle: "Bartender",
    },
    { label: "Staff C", role: "staff", venueId: venue2.id, jobTitle: "Server" },
  ])
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
