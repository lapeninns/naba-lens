// Loads the deterministic journey fixture world (tests/support/journey-world.ts)
// into a freshly reset workstream stack: two venues, an admin, staff A/B/C and
// an inactive staff member, an active menu per venue converted from
// tests/fixtures/menus, and ready photos and a video as real stored objects.
// Called by stack.mjs after `db reset`; LOCAL STACKS ONLY.
//
//   tsx scripts/ci/fixtures.ts --stack <name> --fixtures-root <worktree>
//
// Reads the stack's connection from the environment (set by stack.mjs) and
// writes a key-free manifest to <workdir>/fixtures.json.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import sharp from "sharp"

import type { Database, Json } from "../../lib/db/types"
import { parseMenuFile, sha256Hex } from "../../lib/menus/import"
import {
  JOURNEY_MEDIA,
  JOURNEY_MENUS,
  JOURNEY_PEOPLE,
  JOURNEY_VENUES,
  type JourneyPerson,
} from "../../tests/support/journey-world"
import { parseArgs } from "../lib/service-client"

type Db = SupabaseClient<Database>

const args = parseArgs(process.argv.slice(2))
const stackName = typeof args.stack === "string" ? args.stack : ""
const fixturesRoot = resolve(
  typeof args["fixtures-root"] === "string" ? args["fixtures-root"] : "."
)
const harnessRoot = resolve(import.meta.dirname, "../..")
const container = process.env.SUPABASE_DB_CONTAINER ?? ""
const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ""
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""

if (
  !/^[a-z0-9]+$/.test(stackName) ||
  !container.startsWith("supabase_db_nabalens-ws-")
) {
  throw new Error(
    "fixtures.ts runs only through stack.mjs against a nabalens-ws-* stack."
  )
}
if (
  !/^http:\/\/127\.0\.0\.1:64\d{3}$/.test(apiUrl) ||
  !publishableKey ||
  !serviceKey
) {
  throw new Error("Stack connection missing or not a 64xxx loopback API.")
}

const quote = (v: string | null) =>
  v === null ? "null" : `'${v.replace(/'/g, "''")}'`

function sql(statement: string): string {
  const r = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-X",
      "-q",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: statement, encoding: "utf8" }
  )
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr.trim()}`)
  return r.stdout.trim()
}

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false },
}
const service = createClient<Database>(apiUrl, serviceKey, clientOptions)

async function signIn(person: JourneyPerson): Promise<Db> {
  const { data, error } = await service.auth.admin.generateLink({
    type: "magiclink",
    email: person.email,
  })
  if (error) throw new Error(`generateLink ${person.email}: ${error.message}`)
  const client = createClient<Database>(apiUrl, publishableKey, clientOptions)
  const verified = await client.auth.verifyOtp({
    type: "email",
    token_hash: data.properties.hashed_token,
  })
  if (verified.error) throw new Error(`verifyOtp: ${verified.error.message}`)
  if (verified.data.user?.id !== person.id) {
    throw new Error(`Signed in as the wrong user for ${person.email}`)
  }
  return client
}

function check<T extends { error: unknown }>(result: T, what: string): T {
  if (result.error) throw new Error(`${what}: ${JSON.stringify(result.error)}`)
  return result
}

function loadPeopleAndVenues() {
  const venues = Object.values(JOURNEY_VENUES)
    .map(
      (v) => `(${quote(v.id)}::uuid, ${quote(v.name)}, ${quote(v.slug)}, true)`
    )
    .join(", ")
  const people = Object.values(JOURNEY_PEOPLE) as JourneyPerson[]
  const users = people
    .map((p) => `(${quote(p.id)}::uuid, ${quote(p.email)})`)
    .join(", ")
  const profiles = people
    .map(
      (p) =>
        `(${quote(p.id)}::uuid, ${quote(p.name)}, ${quote(p.jobTitle)}, ${quote(p.role)}::public.app_role, ${p.venue ? `${quote(JOURNEY_VENUES[p.venue].id)}::uuid` : "null"}, ${p.active})`
    )
    .join(", ")
  // Same shape as supabase/seed.sql: the auth API is bypassed for provisioning
  // only; sign-in still goes through the real auth server.
  sql(`
    insert into public.venues (id, name, slug, active) values ${venues};
    with fixture_users (id, email) as (values ${users}),
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
    )
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    select gen_random_uuid(), u.id, u.id::text, 'email',
      jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
      now(), now(), now()
    from users u;
    insert into public.profiles (id, display_name, job_title, role, venue_id, active)
    values ${profiles};
  `)
}

/** Reads a menu fixture from the requested worktree, else from this checkout. */
function menuFixture(file: string): string {
  for (const root of [fixturesRoot, harnessRoot]) {
    const path = join(root, "tests/fixtures/menus", file)
    if (existsSync(path)) return readFileSync(path, "utf8")
  }
  throw new Error(`Menu fixture ${file} not found in ${fixturesRoot}`)
}

async function loadMenus() {
  const admin = await signIn(JOURNEY_PEOPLE.admin)
  const loaded: { venue: string; file: string; versionId: string }[] = []
  for (const menu of Object.values(JOURNEY_MENUS)) {
    const text = menuFixture(menu.file)
    const parsed = parseMenuFile({ fileName: menu.file, text })
    if (!parsed.ok) {
      throw new Error(
        `${menu.file}: ${parsed.issues.map((i) => i.message).join("; ")}`
      )
    }
    const source = {
      kind: menu.file.endsWith(".csv") ? "csv" : "json",
      label: menu.file,
      sha256: await sha256Hex(text),
      revision: parsed.source?.revision ?? null,
      capturedAt: parsed.source?.capturedAt ?? null,
      notes: "Journey fixture world (DEV FIXTURE, not a live menu)",
    }
    const created = check(
      await admin.rpc("create_menu_draft", {
        p_venue_id: JOURNEY_VENUES[menu.venue].id,
        p_title: parsed.document.title,
        p_source: source as unknown as Json,
        p_document: parsed.document as unknown as Json,
      }),
      `create_menu_draft ${menu.file}`
    )
    const versionId = created.data as unknown as string
    check(
      await admin.rpc("activate_menu_version", {
        p_version_id: versionId,
        p_expected_revision: 1,
      }),
      `activate_menu_version ${menu.file}`
    )
    loaded.push({ venue: menu.venue, file: menu.file, versionId })
  }
  await admin.auth.signOut()
  return loaded
}

async function syntheticJpeg(seed: number): Promise<Buffer> {
  const width = 96
  const height = 64
  const raw = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3
      raw[i] = (x * 3 + seed * 40) % 256
      raw[i + 1] = (y * 4 + seed * 17) % 256
      raw[i + 2] = (x + y + seed * 90) % 256
    }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 90 })
    .toBuffer()
}

function mediaBytes(file: string): Buffer {
  for (const root of [fixturesRoot, harnessRoot]) {
    const path = join(root, "tests/fixtures/media", file)
    if (existsSync(path)) return readFileSync(path)
  }
  throw new Error(`Media fixture ${file} not found in ${fixturesRoot}`)
}

async function loadMedia() {
  const clients = new Map<string, Db>()
  const manifest: { key: string; id: string; kind: string; sha256: string }[] =
    []
  let seed = 0
  for (const item of JOURNEY_MEDIA) {
    const person = JOURNEY_PEOPLE[item.owner]
    let client = clients.get(item.owner)
    if (!client) {
      client = await signIn(person)
      clients.set(item.owner, client)
    }
    const photo = item.kind === "image"
    const original = photo
      ? await syntheticJpeg(++seed)
      : mediaBytes("synthetic.mp4")
    const contentType = photo ? "image/jpeg" : "video/mp4"
    const reserved = check(
      await client.rpc("reserve_media_asset", {
        p_media_type: item.kind,
        p_extension: photo ? "jpg" : "mp4",
        p_original_filename: `JOURNEY ${item.key}.${photo ? "jpg" : "mp4"}`,
        p_size_bytes: original.byteLength,
        p_client_upload_key: `journey-${item.key}`,
      }),
      `reserve ${item.key}`
    ).data?.[0]
    if (!reserved) throw new Error(`reserve ${item.key}: no row`)
    check(
      await client.storage
        .from("media")
        .upload(reserved.original_path, original, {
          contentType,
          upsert: false,
        }),
      `upload ${item.key}`
    )
    check(
      await service
        .from("media_assets")
        .update({ upload_state: "processing" })
        .eq("id", reserved.id),
      `processing ${item.key}`
    )
    const ready: Database["public"]["Tables"]["media_assets"]["Update"] = {
      upload_state: "ready",
      validated_mime_type: contentType,
      size_bytes: original.byteLength,
      width: photo ? 96 : 320,
      height: photo ? 64 : 240,
    }
    if (photo) {
      const prefix = reserved.original_path.replace(/original\.jpg$/, "")
      const preview = await sharp(original).resize(48).webp().toBuffer()
      const thumb = await sharp(original).resize(24).webp().toBuffer()
      for (const [name, bytes] of [
        ["preview.webp", preview],
        ["thumb.webp", thumb],
      ] as const) {
        check(
          await service.storage
            .from("media")
            .upload(`${prefix}${name}`, bytes, {
              contentType: "image/webp",
              upsert: false,
            }),
          `derivative ${item.key}/${name}`
        )
      }
      ready.preview_path = `${prefix}preview.webp`
      ready.thumbnail_path = `${prefix}thumb.webp`
    } else {
      ready.duration_seconds = 0.2
    }
    check(
      await service.from("media_assets").update(ready).eq("id", reserved.id),
      `ready ${item.key}`
    )
    manifest.push({
      key: item.key,
      id: reserved.id,
      kind: item.kind,
      sha256: createHash("sha256").update(original).digest("hex"),
    })
  }
  for (const client of clients.values()) await client.auth.signOut()
  return manifest
}

const already = sql(
  `select count(*) from public.venues where slug in (${Object.values(
    JOURNEY_VENUES
  )
    .map((v) => quote(v.slug))
    .join(", ")})`
)
if (already !== "0") {
  console.log(`fixtures: journey world already present on ${stackName}`)
} else {
  loadPeopleAndVenues()
  const menus = await loadMenus()
  const media = await loadMedia()
  const workdir =
    process.env.E2E_SUPABASE_WORKDIR ?? `/tmp/nabalens-ws/${stackName}`
  writeFileSync(
    join(workdir, "fixtures.json"),
    JSON.stringify(
      { stack: stackName, loadedAt: new Date().toISOString(), menus, media },
      null,
      2
    ) + "\n"
  )
  console.log(
    `journey-world: ${Object.keys(JOURNEY_PEOPLE).length} people, ${Object.keys(JOURNEY_VENUES).length} venues, ${menus.length} active menus, ${media.length} media assets`
  )
}
