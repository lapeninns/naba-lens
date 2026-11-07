// Phase `upgrade` (tests/migrations/run.mjs has just run `supabase db reset`):
// 1. the reset applied every repo migration in order to an empty database;
// 2. seed DEV FIXTURE media with real storage objects and record who can read what;
// 3. apply a later, compatible TEST-ONLY migration with `supabase migration up`
//    (no reset) and prove every retained row, object and policy survives, with the
//    same access matrix for live and new sessions and working write paths.
import { copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import {
  accessMatrix,
  coverageCounts,
  expectedRows,
  expectedSha,
  keyGrantFailures,
  psql,
  psqlJson,
  seedFixtureMedia,
  signIn,
  snapshot,
  storedObjectShas,
  type Db,
  type FixtureManifest,
  type FixtureUser,
  type Snapshot,
} from "../../scripts/db/lib/drill"
import {
  env,
  LATER,
  laterTarget,
  repoVersions,
  schemaFingerprint,
  state,
  supabase,
} from "./helpers"

describe("upgrade with retained data", () => {
  let manifest: FixtureManifest
  let before: Snapshot
  let beforeAccess: Awaited<ReturnType<typeof accessMatrix>>
  const sessions: Partial<Record<FixtureUser, Db>> = {}

  afterAll(async () => {
    // The TEST-ONLY migration never stays in the workdir.
    rmSync(laterTarget, { force: true })
    for (const s of Object.values(sessions)) await s?.auth.signOut()
  })

  it("starts from a fresh reset with every repo migration and no media", () => {
    // The `reset` phase also checks the CLI's apply order from its log.
    expect(readFileSync(join(state, "upgrade-reset.log"), "utf8")).toMatch(
      // The CLI's wording changed from "Reset local database" to "Resetting local database".
      /Reset(ting)? local database/
    )
    const fresh = snapshot(env)
    expect(fresh.migrations).toEqual(repoVersions)
    expect(fresh.mediaAssets).toEqual([])
    expect(fresh.objects).toEqual([])
    // Baseline for the `reset` phase's idempotency check.
    writeFileSync(
      join(state, "baseline.json"),
      JSON.stringify(
        { snapshot: fresh, fingerprint: schemaFingerprint() },
        null,
        2
      )
    )
  })

  it("seeds DEV FIXTURE media with real storage objects", async () => {
    manifest = await seedFixtureMedia(env)
    writeFileSync(
      join(state, "fixture-manifest.json"),
      JSON.stringify(manifest, null, 2)
    )
    const objects = [
      ...manifest.assets.flatMap((a) => a.objects),
      manifest.avatar.object,
    ]
    expect(objects).toHaveLength(12)
    expect(manifest.coverage).toMatchObject({
      venue_manager_grants: 1,
      coverage_requirements: 1,
      coverage_requirement_assignees: 1,
      coverage_submissions: 1,
      coverage_submission_items: 1,
      coverage_review_events: 2,
    })
    const stored = psqlJson<{ name: string; size: string }[]>(
      env,
      "select name, metadata->>'size' as size from storage.objects order by name"
    )
    for (const o of objects) {
      expect(stored).toContainEqual({ name: o.name, size: String(o.size) })
    }
  })

  it("enforces the expected access matrix before the upgrade", async () => {
    for (const who of ["admin", "staffA", "staffB", "manager"] as const) {
      sessions[who] = await signIn(env, who)
    }
    beforeAccess = await accessMatrix(env, manifest, sessions)
    const objects = [
      ...manifest.assets.flatMap((a) => a.objects),
      manifest.avatar.object,
    ]
    for (const d of beforeAccess.downloads) {
      expect(d).toEqual({ ...d, sha256: expectedSha() })
    }
    for (const who of [
      "admin",
      "staffA",
      "staffB",
      "manager",
      "anon",
    ] as const) {
      expect(beforeAccess.rows[who]).toEqual(expectedRows(manifest, who))
    }
    // Since the security hardening no end user reads Storage directly (the app's
    // routes sign with the service role after their own checks): all 60 direct
    // downloads by admin, staff, the manager and anon are denied.
    const granted = beforeAccess.downloads.filter((d) => d.sha256 !== null)
    expect(beforeAccess.downloads).toHaveLength(60)
    expect(granted).toHaveLength(0)
    // Not vacuous: the bytes are really there and intact (service role).
    for (const d of await storedObjectShas(env, manifest)) {
      const o = objects.find((x) => x.bucket === d.bucket && x.name === d.name)!
      expect(d.sha256).toBe(o.sha256)
    }
    before = snapshot(env)
  })

  it("applies a later compatible migration without a reset", () => {
    copyFileSync(join(import.meta.dirname, "later", LATER), laterTarget)
    supabase("migration", "up", "--local")
    expect(snapshot(env).migrations).toEqual([
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

  it("keeps every retained row, object and policy unchanged", async () => {
    const after = snapshot(env)
    for (const d of await storedObjectShas(env, manifest)) {
      const o = [
        ...manifest.assets.flatMap((a) => a.objects),
        manifest.avatar.object,
      ].find((x) => x.bucket === d.bucket && x.name === d.name)!
      expect(d.sha256).toBe(o.sha256)
    }
    expect(after.venues).toEqual(before.venues)
    expect(after.profiles).toEqual(before.profiles)
    expect(after.mediaAssets).toEqual(before.mediaAssets)
    expect(after.authUsers).toEqual(before.authUsers)
    expect(after.buckets).toEqual(before.buckets)
    expect(after.objects).toEqual(before.objects)
    expect(after.policies).toEqual(before.policies)
    expect(after.grants).toEqual(before.grants)
    expect(coverageCounts(env)).toEqual(manifest.coverage)
    expect(keyGrantFailures(env)).toEqual([])
    // The new table has RLS on and no anon/authenticated grants.
    expect(after.rls).toContainEqual({
      relname: "test_only_notes",
      relrowsecurity: true,
    })
    expect(after.rls.every((r) => r.relrowsecurity)).toBe(true)
  })

  it("defaults item-photo decisions to staff-label under validated constraints", () => {
    // Schema-level only: this database was reset with every migration on an
    // empty database, so no item-photo row predates 20261107100300 here. The
    // upgrade over real sibling-era rows (seeded at 20261106130000, then the
    // manager migrations applied) is phase `sibling-upgrade`.
    expect(
      psql(
        env,
        "select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum where d.adrelid = 'public.menu_item_photos'::regclass and a.attname = 'basis'"
      )
    ).toBe("'staff_label'::text")
    expect(
      psql(
        env,
        "select count(*) from pg_constraint where conrelid = 'public.menu_item_photos'::regclass and not convalidated"
      )
    ).toBe("0")
    expect(
      psql(
        env,
        "select count(*) from public.menu_item_photos where basis <> 'staff_label' or corrects_item_id is not null"
      )
    ).toBe("0")
  })

  it("serves identical bytes under the same rules, for live and new sessions", async () => {
    expect(await accessMatrix(env, manifest, sessions)).toEqual(beforeAccess)
    expect(await accessMatrix(env, manifest)).toEqual(beforeAccess)
  })

  it("keeps the app's write paths working after the upgrade", async () => {
    const staffA = sessions.staffA!
    const { data, error } = await staffA.rpc("reserve_media_asset", {
      p_media_type: "image",
      p_extension: "jpg",
      p_original_filename: "DEV FIXTURE after upgrade.jpg",
      p_size_bytes: 4,
      p_client_upload_key: "migrations-after-upgrade-key-1",
    })
    expect(error).toBeNull()
    const path = data![0].original_path
    const upload = await staffA.storage
      .from("media")
      .upload(path, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
        contentType: "image/jpeg",
      })
    expect(upload.error).toBeNull()
    // Another staff member still cannot write next to that reserved key.
    const foreign = await sessions
      .staffB!.storage.from("media")
      .upload(path.replace("original.jpg", "original.png"), new Uint8Array([1]))
    expect(foreign.error).not.toBeNull()
    // Labels chosen while uploading are stored for the uploader alone
    // (20261107140000_media_pending_labels).
    const asset = data![0]
    const staged = await staffA.rpc("stage_media_labels", {
      p_asset_id: asset.id,
      p_venue_id: asset.venue_id,
      p_input: {
        assetId: asset.id,
        expectedRevision: 0,
        catalogueVersionId: null,
        contentTypes: ["dish"],
        note: null,
        items: [],
        missingItem: null,
      },
    })
    expect(staged.error).toBeNull()
    expect(staged.data).toBe("pending")
    const own = await staffA
      .from("media_pending_labels")
      .select("status")
      .eq("asset_id", asset.id)
    expect(own.data).toEqual([{ status: "pending" }])
    const peek = await sessions
      .staffB!.from("media_pending_labels")
      .select("status")
      .eq("asset_id", asset.id)
    expect(peek.data).toEqual([])
    // No end-user update grant on media_assets, including the new column.
    const { error: updateError } = await staffA
      .from("media_assets")
      .update({ test_only_caption: "x" } as never)
      .eq("id", data![0].id)
    expect(updateError).not.toBeNull()
  })
})
