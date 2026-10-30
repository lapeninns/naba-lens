// Migration safety on an isolated local stack (see tests/migrations/run.mjs).
//
// 1. Reset to an empty database and apply every migration in order.
// 2. Seed DEV FIXTURE media with real storage objects and record who can read what.
// 3. Apply a later, compatible TEST-ONLY migration with `supabase migration up`
//    (no reset) and prove every retained row, object and policy survives, with the
//    same access matrix and live sessions still working.
// 4. `supabase db reset` twice gives the same schema, the same seed and no drift.
// 5. `supabase db lint` reports no schema errors.
import { execFileSync } from "node:child_process"
import { copyFileSync, existsSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  accessMatrix,
  expectedRows,
  expectedSha,
  FIXTURE,
  psql,
  psqlJson,
  seedFixtureMedia,
  signIn,
  snapshot,
  stackEnv,
  type Db,
  type FixtureManifest,
  type FixtureUser,
  type Snapshot,
  type StackEnv,
} from "../../scripts/db/lib/drill"

const workdir = process.env.NABALENS_DRILL_WORKDIR
if (!workdir) throw new Error("Run through tests/migrations/run.mjs <workdir>")

const LATER = "20261101090000_test_only_additive.sql"
const laterSource = join(import.meta.dirname, "later", LATER)
const laterTarget = join(workdir, "supabase", "migrations", LATER)
const repoMigrations = readdirSync("supabase/migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort()

function supabase(...args: string[]): string {
  return execFileSync("supabase", ["--workdir", workdir!, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 420_000,
  })
}

/** Schema of the app-owned schemas plus storage policies, for drift checks. */
function schemaFingerprint(env: StackEnv): string {
  return psql(
    env,
    `select md5(string_agg(def, E'\\n' order by def)) from (
       select format('%s.%s(%s) %s', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), md5(pg_get_functiondef(p.oid))) as def
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private')
       union all
       select format('%s.%s.%s %s %s', table_schema, table_name, column_name, data_type, coalesce(column_default, ''))
       from information_schema.columns where table_schema in ('public', 'private')
       union all
       select format('%s %s', conrelid::regclass, pg_get_constraintdef(oid)) from pg_constraint
       where connamespace in ('public'::regnamespace)
       union all
       select indexdef from pg_indexes where schemaname = 'public'
       union all
       select format('%s %s %s %s', tablename, policyname, qual, with_check) from pg_policies
       where schemaname in ('public', 'storage')
       union all
       select format('trigger %s %s', tgrelid::regclass, tgname) from pg_trigger
       where not tgisinternal and tgrelid::regclass::text not like 'storage.%' and tgrelid::regclass::text not like 'auth.%'
     ) d`
  )
}

describe("migrations on an isolated stack", () => {
  let env: StackEnv
  let manifest: FixtureManifest
  let before: Snapshot
  let beforeAccess: Awaited<ReturnType<typeof accessMatrix>>
  const sessions: Partial<Record<FixtureUser, Db>> = {}

  beforeAll(() => {
    rmSync(laterTarget, { force: true })
    env = stackEnv(workdir)
  })

  afterAll(() => {
    // The TEST-ONLY migration must never stay in a workdir that is reused later.
    rmSync(laterTarget, { force: true })
  })

  it("applies every repo migration in order to an empty database", () => {
    const out = supabase("db", "reset", "--local")
    const applied = [...out.matchAll(/Applying migration (\S+\.sql)/g)].map(
      (m) => m[1]
    )
    expect(applied).toEqual(repoMigrations)
    expect(snapshot(env).migrations).toEqual(
      repoMigrations.map((f) => f.split("_")[0])
    )
  })

  it("seeds DEV FIXTURE media with real storage objects", async () => {
    manifest = await seedFixtureMedia(env)
    const objects = [
      ...manifest.assets.flatMap((a) => a.objects),
      manifest.avatar.object,
    ]
    expect(objects.length).toBe(11)
    const stored = psqlJson<{ name: string; size: string }[]>(
      env,
      "select name, metadata->>'size' as size from storage.objects order by name"
    )
    for (const o of objects) {
      expect(stored).toContainEqual({ name: o.name, size: String(o.size) })
    }
  })

  it("enforces the expected access matrix before the upgrade", async () => {
    for (const who of ["admin", "staffA", "staffB"] as const)
      sessions[who] = await signIn(env, who)
    beforeAccess = await accessMatrix(env, manifest, sessions)
    for (const d of beforeAccess.downloads) {
      const o = [
        ...manifest.assets.flatMap((a) => a.objects),
        manifest.avatar.object,
      ].find((x) => x.name === d.name)!
      expect({ ...d, sha256: d.sha256 }).toEqual({
        ...d,
        sha256: expectedSha(manifest, d.who, o),
      })
    }
    for (const who of ["admin", "staffA", "staffB", "anon"] as const) {
      expect(beforeAccess.rows[who]).toEqual(expectedRows(manifest, who))
    }
    // Sanity: the matrix is not vacuous.
    expect(
      beforeAccess.downloads.filter((d) => d.sha256 !== null).length
    ).toBeGreaterThanOrEqual(10)
    before = snapshot(env)
  })

  it("applies a later compatible migration without a reset", () => {
    copyFileSync(laterSource, laterTarget)
    const out = supabase("migration", "up", "--local")
    expect(out + "").not.toMatch(/error/i)
    const after = snapshot(env)
    expect(after.migrations).toEqual([
      ...before.migrations,
      LATER.split("_")[0],
    ])
    expect(
      psql(
        env,
        "select count(*) from information_schema.columns where table_name = 'media_assets' and column_name = 'test_only_caption'"
      )
    ).toBe("1")
  })

  it("keeps every retained row, object and policy unchanged", () => {
    const after = snapshot(env)
    expect(after.venues).toEqual(before.venues)
    expect(after.profiles).toEqual(before.profiles)
    expect(after.mediaAssets).toEqual(before.mediaAssets)
    expect(after.authUsers).toEqual(before.authUsers)
    expect(after.buckets).toEqual(before.buckets)
    expect(after.objects).toEqual(before.objects)
    expect(after.policies).toEqual(before.policies)
    // The new table has RLS on and no anon/authenticated grants.
    expect(after.rls).toEqual(
      [
        ...before.rls,
        { relname: "test_only_notes", relrowsecurity: true },
      ].sort((a, b) => a.relname.localeCompare(b.relname))
    )
    expect(after.grants).toEqual(before.grants)
    expect(after.rls.every((r) => r.relrowsecurity)).toBe(true)
  })

  it("serves identical bytes with the same access rules, for live and new sessions", async () => {
    const live = await accessMatrix(env, manifest, sessions)
    expect(live).toEqual(beforeAccess)
    const fresh = await accessMatrix(env, manifest)
    expect(fresh).toEqual(beforeAccess)
  })

  it("keeps the app's write paths working after the upgrade", async () => {
    const staffA = sessions.staffA!
    const { data, error } = await staffA.rpc("reserve_media_asset", {
      p_media_type: "image",
      p_extension: "jpg",
      p_original_filename: "DEV FIXTURE after upgrade.jpg",
    })
    expect(error).toBeNull()
    const upload = await staffA.storage
      .from("media")
      .upload(
        data![0].original_path,
        new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
        {
          contentType: "image/jpeg",
        }
      )
    expect(upload.error).toBeNull()
    // Another staff member still cannot write to that reserved key.
    const foreign = await sessions
      .staffB!.storage.from("media")
      .upload(
        data![0].original_path.replace("original.jpg", "original.png"),
        new Uint8Array([1])
      )
    expect(foreign.error).not.toBeNull()
    // A staff member cannot touch the new column directly (no update grant).
    const { error: updateError } = await staffA
      .from("media_assets")
      .update({ test_only_caption: "x" } as never)
      .eq("id", data![0].id)
    expect(updateError).not.toBeNull()
    for (const s of Object.values(sessions)) await s?.auth.signOut()
  })

  it("resets idempotently: same migrations, schema and seed every time, and no drift", () => {
    rmSync(laterTarget, { force: true })
    supabase("db", "reset", "--local")
    const first = snapshot(env)
    const firstSchema = schemaFingerprint(env)
    supabase("db", "reset", "--local")
    const second = snapshot(env)
    const secondSchema = schemaFingerprint(env)

    expect(second.migrations).toEqual(
      repoMigrations.map((f) => f.split("_")[0])
    )
    expect(secondSchema).toBe(firstSchema)
    // Seed rows are fixed IDs; auth.users and profiles carry now() timestamps.
    expect(
      second.venues.map((v) => ({ ...(v as object), created_at: 0 }))
    ).toEqual(first.venues.map((v) => ({ ...(v as object), created_at: 0 })))
    const ids = (rows: unknown[]) => rows.map((r) => (r as { id: string }).id)
    expect(ids(second.profiles)).toEqual(ids(first.profiles))
    expect(ids(second.authUsers)).toEqual(ids(first.authUsers))
    expect(second.mediaAssets).toEqual([])
    expect(second.policies).toEqual(first.policies)
    expect(second.buckets).toEqual(first.buckets)
    expect(ids(second.profiles)).toContain(FIXTURE.staffA.id)
    // The TEST-ONLY objects are gone after the reset.
    expect(
      psql(env, "select to_regclass('public.test_only_notes') is null")
    ).toBe("t")

    // No drift between the migrations and the reset database.
    const diff = supabase("db", "diff", "--local", "--schema", "public,private")
    expect(diff).not.toMatch(/create|alter|drop/i)
  })

  it("passes supabase db lint", () => {
    const out = supabase(
      "db",
      "lint",
      "--local",
      "--schema",
      "public,private",
      "--level",
      "warning",
      "--fail-on",
      "warning"
    )
    expect(out).toMatch(/No schema errors found/i)
    expect(existsSync(laterTarget)).toBe(false)
  })
})
