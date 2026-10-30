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
  expectedRows,
  expectedSha,
  psql,
  psqlJson,
  seedFixtureMedia,
  signIn,
  snapshot,
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
      /Reset local database/
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
    const stored = psqlJson<{ name: string; size: string }[]>(
      env,
      "select name, metadata->>'size' as size from storage.objects order by name"
    )
    for (const o of objects) {
      expect(stored).toContainEqual({ name: o.name, size: String(o.size) })
    }
  })

  it("enforces the expected access matrix before the upgrade", async () => {
    for (const who of ["admin", "staffA", "staffB"] as const) {
      sessions[who] = await signIn(env, who)
    }
    beforeAccess = await accessMatrix(env, manifest, sessions)
    const objects = [
      ...manifest.assets.flatMap((a) => a.objects),
      manifest.avatar.object,
    ]
    for (const d of beforeAccess.downloads) {
      const o = objects.find((x) => x.bucket === d.bucket && x.name === d.name)!
      expect(d).toEqual({ ...d, sha256: expectedSha(manifest, d.who, o) })
    }
    for (const who of ["admin", "staffA", "staffB", "anon"] as const) {
      expect(beforeAccess.rows[who]).toEqual(expectedRows(manifest, who))
    }
    // Not vacuous: owners and admin really download bytes, others are really denied.
    const granted = beforeAccess.downloads.filter((d) => d.sha256 !== null)
    expect(granted.length).toBe(16)
    expect(beforeAccess.downloads.length - granted.length).toBe(32)
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

  it("keeps every retained row, object and policy unchanged", () => {
    const after = snapshot(env)
    expect(after.venues).toEqual(before.venues)
    expect(after.profiles).toEqual(before.profiles)
    expect(after.mediaAssets).toEqual(before.mediaAssets)
    expect(after.authUsers).toEqual(before.authUsers)
    expect(after.buckets).toEqual(before.buckets)
    expect(after.objects).toEqual(before.objects)
    expect(after.policies).toEqual(before.policies)
    expect(after.grants).toEqual(before.grants)
    // The new table has RLS on and no anon/authenticated grants.
    expect(after.rls).toContainEqual({
      relname: "test_only_notes",
      relrowsecurity: true,
    })
    expect(
      after.rls.every((r) => (r as { relrowsecurity: boolean }).relrowsecurity)
    ).toBe(true)
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
    // No end-user update grant on media_assets, including the new column.
    const { error: updateError } = await staffA
      .from("media_assets")
      .update({ test_only_caption: "x" } as never)
      .eq("id", data![0].id)
    expect(updateError).not.toBeNull()
  })
})
