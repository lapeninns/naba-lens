// Shared helpers for the migration-safety test (tests/migrations) and the local
// backup/restore drill (scripts/db/*-local.sh). LOCAL STACKS ONLY: every entry
// point resolves its stack from `supabase --workdir <dir> status` and refuses
// anything that is not 127.0.0.1/localhost or that uses the default 554xx block.
import { execFileSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import sharp from "sharp"

import type { Database } from "../../../lib/db/types"

export type Db = SupabaseClient<Database>

export type StackEnv = {
  workdir: string
  apiUrl: string
  dbUrl: string
  publishableKey: string
  serviceRoleKey: string
}

/** DEV FIXTURE accounts from supabase/seed.sql (no passwords; magic-link only). */
export const FIXTURE = {
  admin: {
    id: "00000000-0000-4000-8000-0000000000a1",
    email: "dev-admin@nabalens.test",
  },
  staffA: {
    id: "00000000-0000-4000-8000-0000000000b1",
    email: "dev-staff-a@nabalens.test",
  },
  staffB: {
    id: "00000000-0000-4000-8000-0000000000b2",
    email: "dev-staff-b@nabalens.test",
  },
} as const

export type FixtureUser = keyof typeof FIXTURE

export function stackEnv(workdir: string): StackEnv {
  const dir = resolve(workdir)
  const raw = execFileSync(
    "supabase",
    ["--workdir", dir, "status", "-o", "json"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }
  )
  const status = JSON.parse(
    raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)
  )
  for (const value of [status.API_URL, status.DB_URL]) {
    const url = new URL(value)
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      throw new Error("Drills run against a local stack only")
    }
    if (url.port.startsWith("554")) {
      throw new Error(
        "Drills require an isolated stack outside the default 554xx block"
      )
    }
  }
  return {
    workdir: dir,
    apiUrl: status.API_URL,
    dbUrl: status.DB_URL,
    publishableKey: status.PUBLISHABLE_KEY ?? status.ANON_KEY,
    serviceRoleKey: status.SERVICE_ROLE_KEY ?? status.SECRET_KEY,
  }
}

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false },
}

export function serviceClient(env: StackEnv): Db {
  return createClient<Database>(env.apiUrl, env.serviceRoleKey, clientOptions)
}

export function anonClient(env: StackEnv): Db {
  return createClient<Database>(env.apiUrl, env.publishableKey, clientOptions)
}

/** Signs in through the real magic-link token path (as the app's /auth/confirm does). */
export async function signIn(env: StackEnv, user: FixtureUser): Promise<Db> {
  const { data, error } = await serviceClient(env).auth.admin.generateLink({
    type: "magiclink",
    email: FIXTURE[user].email,
  })
  if (error) throw error
  const client = anonClient(env)
  const { data: session, error: verifyError } = await client.auth.verifyOtp({
    type: "email",
    token_hash: data.properties.hashed_token,
  })
  if (verifyError) throw verifyError
  if (session.user?.id !== FIXTURE[user].id) {
    throw new Error(`Signed in as the wrong user for ${user}`)
  }
  return client
}

/** Runs SQL as the local `postgres` superuser and returns psql's unaligned output. */
export function psql(env: StackEnv, sql: string): string {
  return execFileSync(
    "psql",
    [env.dbUrl, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql],
    {
      encoding: "utf8",
    }
  ).trim()
}

export function psqlJson<T>(env: StackEnv, sql: string): T {
  const out = psql(
    env,
    `select coalesce(json_agg(t), '[]'::json) from (${sql}) t`
  )
  return JSON.parse(out) as T
}

export const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex")

// ---------------------------------------------------------------------------
// DEV FIXTURE media
// ---------------------------------------------------------------------------

export type ManifestObject = {
  bucket: "media" | "avatars"
  name: string
  contentType: string
  size: number
  sha256: string
}

export type ManifestAsset = {
  id: string
  owner: FixtureUser
  label: string
  state: "ready" | "uploading" | "deleted"
  objects: ManifestObject[]
}

export type FixtureManifest = {
  assets: ManifestAsset[]
  avatar: { owner: FixtureUser; object: ManifestObject }
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

function check<T extends { error: unknown }>(result: T, what: string): T {
  if (result.error) throw new Error(`${what}: ${JSON.stringify(result.error)}`)
  return result
}

async function uploadAsOwner(
  client: Db,
  path: string,
  bytes: Uint8Array,
  contentType: string
) {
  check(
    await client.storage
      .from("media")
      .upload(path, bytes, { contentType, upsert: false }),
    `owner upload ${path}`
  )
}

async function uploadAsService(
  admin: Db,
  bucket: "media" | "avatars",
  path: string,
  bytes: Uint8Array,
  contentType: string
) {
  check(
    await admin.storage
      .from(bucket)
      .upload(path, bytes, { contentType, upsert: false }),
    `service upload ${bucket}/${path}`
  )
}

const objectOf = (
  bucket: "media" | "avatars",
  name: string,
  bytes: Uint8Array,
  contentType: string
): ManifestObject => ({
  bucket,
  name,
  contentType,
  size: bytes.byteLength,
  sha256: sha256(bytes),
})

/**
 * Seeds DEV FIXTURE media for the seed.sql fixture users with real objects:
 * reservations through `reserve_media_asset` as the staff user, originals uploaded
 * by that user through the reserved-key storage policy, and processing (derivatives,
 * ready state) and avatars written with the service role, as the app does.
 *
 *   staffA: ready photo (original + preview + thumb), ready video, a tombstoned photo
 *   staffB: ready photo, an `uploading` reservation with its original uploaded
 *   staffA: avatar
 */
export async function seedFixtureMedia(
  env: StackEnv
): Promise<FixtureManifest> {
  const admin = serviceClient(env)
  const staffA = await signIn(env, "staffA")
  const staffB = await signIn(env, "staffB")
  const assets: ManifestAsset[] = []
  let seed = 0

  async function reserve(
    client: Db,
    type: "image" | "video",
    ext: string,
    filename: string
  ) {
    const { data } = check(
      await client.rpc("reserve_media_asset", {
        p_media_type: type,
        p_extension: ext,
        p_original_filename: filename,
        p_client_upload_key: `drill-${randomUUID()}`,
      }),
      "reserve_media_asset"
    )
    const row = data![0]
    return { id: row.id, originalPath: row.original_path }
  }

  async function photo(
    owner: FixtureUser,
    client: Db,
    label: string,
    finish: "ready" | "uploading"
  ) {
    const original = await syntheticJpeg(++seed)
    const { id, originalPath } = await reserve(
      client,
      "image",
      "jpg",
      `DEV FIXTURE ${label}.jpg`
    )
    await uploadAsOwner(client, originalPath, original, "image/jpeg")
    const objects = [objectOf("media", originalPath, original, "image/jpeg")]
    if (finish === "ready") {
      const preview = await sharp(original).resize(48).webp().toBuffer()
      const thumb = await sharp(original).resize(24).webp().toBuffer()
      const prefix = originalPath.replace(/original\.jpg$/, "")
      check(
        await admin
          .from("media_assets")
          .update({ upload_state: "processing" })
          .eq("id", id),
        "processing"
      )
      await uploadAsService(
        admin,
        "media",
        `${prefix}preview.webp`,
        preview,
        "image/webp"
      )
      await uploadAsService(
        admin,
        "media",
        `${prefix}thumb.webp`,
        thumb,
        "image/webp"
      )
      check(
        await admin
          .from("media_assets")
          .update({
            upload_state: "ready",
            validated_mime_type: "image/jpeg",
            size_bytes: original.byteLength,
            width: 96,
            height: 64,
            preview_path: `${prefix}preview.webp`,
            thumbnail_path: `${prefix}thumb.webp`,
          })
          .eq("id", id),
        "ready"
      )
      objects.push(
        objectOf("media", `${prefix}preview.webp`, preview, "image/webp"),
        objectOf("media", `${prefix}thumb.webp`, thumb, "image/webp")
      )
    }
    const asset: ManifestAsset = { id, owner, label, state: finish, objects }
    assets.push(asset)
    return asset
  }

  await photo("staffA", staffA, "Staff A photo", "ready")

  const video = readFileSync(resolve("tests/fixtures/media/synthetic.mp4"))
  const v = await reserve(
    staffA,
    "video",
    "mp4",
    "DEV FIXTURE Staff A clip.mp4"
  )
  await uploadAsOwner(staffA, v.originalPath, video, "video/mp4")
  check(
    await admin
      .from("media_assets")
      .update({ upload_state: "processing" })
      .eq("id", v.id),
    "processing"
  )
  check(
    await admin
      .from("media_assets")
      .update({
        upload_state: "ready",
        validated_mime_type: "video/mp4",
        size_bytes: video.byteLength,
        width: 320,
        height: 240,
        duration_seconds: 0.2,
      })
      .eq("id", v.id),
    "ready video"
  )
  assets.push({
    id: v.id,
    owner: "staffA",
    label: "Staff A clip",
    state: "ready",
    objects: [objectOf("media", v.originalPath, video, "video/mp4")],
  })

  const removed = await photo(
    "staffA",
    staffA,
    "Staff A removed photo",
    "ready"
  )
  check(
    await staffA.rpc("delete_media_asset", { p_asset_id: removed.id }),
    "delete_media_asset"
  )
  removed.state = "deleted"

  await photo("staffB", staffB, "Staff B photo", "ready")
  await photo("staffB", staffB, "Staff B unfinished photo", "uploading")

  const avatarBytes = await sharp(await syntheticJpeg(99))
    .resize(32)
    .webp()
    .toBuffer()
  const avatarPath = `${FIXTURE.staffA.id}/${randomUUID()}.webp`
  await uploadAsService(admin, "avatars", avatarPath, avatarBytes, "image/webp")
  check(
    await admin
      .from("profiles")
      .update({ avatar_path: avatarPath })
      .eq("id", FIXTURE.staffA.id),
    "avatar_path"
  )

  await staffA.auth.signOut()
  await staffB.auth.signOut()
  return {
    assets,
    avatar: {
      owner: "staffA",
      object: objectOf("avatars", avatarPath, avatarBytes, "image/webp"),
    },
  }
}

// ---------------------------------------------------------------------------
// Access matrix: who can see which rows and download which objects
// ---------------------------------------------------------------------------

export type AccessResult = {
  who: FixtureUser | "anon"
  bucket: string
  name: string
  /** sha256 of the downloaded bytes, or null when access was denied. */
  sha256: string | null
}

export type RowVisibility = Record<FixtureUser | "anon", string[]>

async function tryDownload(
  client: Db,
  bucket: string,
  name: string
): Promise<string | null> {
  const { data, error } = await client.storage.from(bucket).download(name)
  if (error || !data) return null
  return sha256(new Uint8Array(await data.arrayBuffer()))
}

/**
 * Signs in each fixture user afresh and records, for every manifest object, what
 * each identity (and an anonymous client) can download, plus which media_assets
 * rows each identity can select. Pass `clients` to reuse existing sessions.
 */
export async function accessMatrix(
  env: StackEnv,
  manifest: FixtureManifest,
  clients?: Partial<Record<FixtureUser, Db>>
): Promise<{ downloads: AccessResult[]; rows: RowVisibility }> {
  const ids: Record<FixtureUser | "anon", Db> = {
    admin: clients?.admin ?? (await signIn(env, "admin")),
    staffA: clients?.staffA ?? (await signIn(env, "staffA")),
    staffB: clients?.staffB ?? (await signIn(env, "staffB")),
    anon: anonClient(env),
  }
  const objects = [
    ...manifest.assets.flatMap((a) => a.objects),
    manifest.avatar.object,
  ]
  const downloads: AccessResult[] = []
  for (const [who, client] of Object.entries(ids) as [
    FixtureUser | "anon",
    Db,
  ][]) {
    for (const o of objects) {
      downloads.push({
        who,
        bucket: o.bucket,
        name: o.name,
        sha256: await tryDownload(client, o.bucket, o.name),
      })
    }
  }
  const rows = {} as RowVisibility
  for (const [who, client] of Object.entries(ids) as [
    FixtureUser | "anon",
    Db,
  ][]) {
    const { data, error } = await client
      .from("media_assets")
      .select("id")
      .order("id")
    rows[who] = error ? [] : (data ?? []).map((r) => r.id)
  }
  return { downloads, rows }
}

/**
 * The access rules the migrations promise (spec §5, storage migration):
 * owners read their own *ready* media, admins read every ready object,
 * deleted and unfinished assets are unreadable, other staff and anon get nothing;
 * avatars are readable by their owner and admins.
 */
export function expectedSha(
  manifest: FixtureManifest,
  who: FixtureUser | "anon",
  o: ManifestObject
): string | null {
  if (who === "anon") return null
  if (o.bucket === "avatars") {
    return who === "admin" || who === manifest.avatar.owner ? o.sha256 : null
  }
  const asset = manifest.assets.find((a) =>
    a.objects.some((x) => x.name === o.name)
  )!
  if (asset.state !== "ready") return null
  return who === "admin" || who === asset.owner ? o.sha256 : null
}

export function expectedRows(
  manifest: FixtureManifest,
  who: FixtureUser | "anon"
): string[] {
  if (who === "anon") return []
  return manifest.assets
    .filter((a) =>
      who === "admin"
        ? a.state === "ready"
        : a.owner === who && a.state !== "deleted"
    )
    .map((a) => a.id)
    .sort()
}

// ---------------------------------------------------------------------------
// Snapshots for before/after comparisons
// ---------------------------------------------------------------------------

/** Stable snapshot of retained data, storage metadata and security config. */
export function snapshot(env: StackEnv) {
  return {
    migrations: psqlJson<{ version: string }[]>(
      env,
      "select version from supabase_migrations.schema_migrations order by version"
    ).map((r) => r.version),
    venues: psqlJson(
      env,
      "select id, name, slug, active, created_at from public.venues order by id"
    ),
    profiles: psqlJson(
      env,
      "select id, display_name, avatar_path, job_title, role, venue_id, active, created_at, updated_at from public.profiles order by id"
    ),
    // Explicit columns so an additive migration does not change the snapshot.
    mediaAssets: psqlJson(
      env,
      `select id, uploader_id, venue_id, original_path, preview_path, thumbnail_path,
        original_filename, media_type, validated_mime_type, size_bytes, width, height,
        duration_seconds, upload_state, client_upload_key, created_at, updated_at, deleted_at
       from public.media_assets order by id`
    ),
    authUsers: psqlJson(
      env,
      "select id, email, email_confirmed_at is not null as confirmed, raw_app_meta_data from auth.users order by id"
    ),
    buckets: psqlJson(
      env,
      "select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id"
    ),
    objects: psqlJson(
      env,
      `select bucket_id, name, metadata->>'size' as size, metadata->>'mimetype' as mimetype
       from storage.objects order by bucket_id, name`
    ),
    policies: psqlJson(
      env,
      `select schemaname, tablename, policyname, permissive, roles::text[] as roles, cmd, qual, with_check
       from pg_policies where schemaname in ('public', 'storage') order by 1, 2, 3`
    ),
    rls: psqlJson(
      env,
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' order by 1`
    ),
    grants: psqlJson(
      env,
      `select table_name, grantee, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and grantee in ('anon', 'authenticated') order by 1, 2, 3`
    ),
  }
}

export type Snapshot = ReturnType<typeof snapshot>
