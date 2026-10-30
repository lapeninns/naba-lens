// Phase `reset` (tests/migrations/run.mjs has just run `supabase db reset` on a
// database that the `upgrade` phase had seeded and upgraded): the reset must
// reproduce the first reset exactly. Same migrations, schema, policies, grants,
// buckets and seed; no fixture media and no TEST-ONLY objects left behind.
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { psql, snapshot, type Snapshot } from "../../scripts/db/lib/drill"
import { env, ids, repoMigrations, repoVersions, schemaFingerprint, state } from "./helpers"

describe("supabase db reset is idempotent", () => {
  const baseline = JSON.parse(readFileSync(join(state, "baseline.json"), "utf8")) as {
    snapshot: Snapshot
    fingerprint: string
  }
  const now = snapshot(env)

  it("applies the same migrations in the same order", () => {
    const log = readFileSync(join(state, "reset-reset.log"), "utf8")
    const applied = [...log.matchAll(/Applying migration (\S+\.sql)/g)].map((m) => m[1])
    expect(applied).toEqual(repoMigrations)
    expect(now.migrations).toEqual(repoVersions)
    expect(now.migrations).toEqual(baseline.snapshot.migrations)
  })

  it("produces the same schema, policies, grants and buckets", () => {
    expect(schemaFingerprint()).toBe(baseline.fingerprint)
    expect(now.policies).toEqual(baseline.snapshot.policies)
    expect(now.grants).toEqual(baseline.snapshot.grants)
    expect(now.rls).toEqual(baseline.snapshot.rls)
    expect(now.buckets).toEqual(baseline.snapshot.buckets)
    expect(psql(env, "select to_regclass('public.test_only_notes') is null")).toBe("t")
  })

  it("loads the same seed and nothing else", () => {
    const strip = (rows: unknown[]) =>
      rows.map((r) => {
        const { created_at: _c, updated_at: _u, ...rest } = r as Record<string, unknown>
        void _c
        void _u
        return rest
      })
    expect(strip(now.venues)).toEqual(strip(baseline.snapshot.venues))
    expect(strip(now.profiles)).toEqual(strip(baseline.snapshot.profiles))
    expect(ids(now.authUsers)).toEqual(ids(baseline.snapshot.authUsers))
    expect(now.mediaAssets).toEqual([])
    expect(now.objects).toEqual([])
  })
})
