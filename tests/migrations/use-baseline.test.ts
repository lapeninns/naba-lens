// Phase `use-baseline` (tests/migrations/run.mjs has just run
// `supabase db reset --local --version <newest migration before B05-m1> --no-seed`):
// 1. seed media rows in every state with that schema;
// 2. `supabase migration up` applies B05-m1 and everything after it;
// 3. every pre-existing row reads use_baseline 'legacy_unknown', no row was
//    updated (count and updated_at hash unchanged), no grant exists, a new
//    row reads 'none', and the credit function is byte-identical
//    (contracts/b05-design.md §2.6, §2.9 migration drill).
import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { psql, psqlJson } from "../../scripts/db/lib/drill"
import { env, repoVersions, supabase, USE_BASELINE_FIRST } from "./helpers"

const VENUE = "00000000-0000-4000-8000-00000000b501"
const STAFF = "00000000-0000-4000-8000-00000000b5b1"
const STATES = [
  "uploading",
  "processing",
  "ready",
  "failed",
  "deleted",
] as const

const fingerprint = () =>
  psql(
    env,
    `select count(*) || ':' || coalesce(md5(string_agg(a.id::text || ':' || a.updated_at::text || ':' || a.upload_state::text || ':' || coalesce(a.deleted_at::text, ''), ',' order by a.id)), '')
     from public.media_assets a`
  )

describe("B05-m1 over existing media (use baseline)", () => {
  const base = repoVersions.filter((v) => v < USE_BASELINE_FIRST)
  let before = ""
  const ids: string[] = []

  it("starts from the schema before B05-m1 with no media", () => {
    expect(
      psqlJson<{ version: string }[]>(
        env,
        "select version from supabase_migrations.schema_migrations order by version"
      ).map((r) => r.version)
    ).toEqual(base)
    expect(repoVersions).toContain(USE_BASELINE_FIRST)
    expect(
      psql(
        env,
        "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'media_assets' and column_name = 'use_baseline'"
      )
    ).toBe("0")
  })

  it("seeds media in every state with the old schema", () => {
    const rows = STATES.map((state) => {
      const id = randomUUID()
      ids.push(id)
      return { id, state }
    })
    psql(
      env,
      `insert into public.venues (id, name, slug) values ('${VENUE}', 'DEV FIXTURE B05 venue', 'dev-fixture-b05-venue');
       insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
         raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
         email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
       values ('00000000-0000-0000-0000-000000000000', '${STAFF}', 'authenticated', 'authenticated', 'dev-b05-staff@nabalens.test', '', now(),
         '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', '', '', '', '');
       insert into public.profiles (id, display_name, role, venue_id) values ('${STAFF}', 'DEV FIXTURE B05 staff', 'staff', '${VENUE}');
       ${rows
         .map(
           ({
             id,
           }) => `insert into public.media_assets (id, uploader_id, venue_id, original_path, original_filename, media_type, size_bytes, client_upload_key)
             values ('${id}', '${STAFF}', '${VENUE}', '${STAFF}/${id}/original.jpg', 'DEV.jpg', 'image', 4, '${randomUUID()}');`
         )
         .join("\n")}
       ${rows
         .filter(({ state }) => state !== "uploading")
         .map(
           ({ id }) =>
             `update public.media_assets set upload_state = 'processing' where id = '${id}';`
         )
         .join("\n")}
       ${rows
         .filter(({ state }) => state === "ready" || state === "deleted")
         .map(
           ({ id }) =>
             `update public.media_assets set upload_state = 'ready', validated_mime_type = 'image/jpeg', size_bytes = 4, width = 1, height = 1 where id = '${id}';`
         )
         .join("\n")}
       update public.media_assets set upload_state = 'failed' where id = '${rows[3]!.id}';
       update public.media_assets set deleted_at = now() where id = '${rows[4]!.id}';`
    )
    before = fingerprint()
    expect(before.startsWith("5:")).toBe(true)
  })

  it("applies B05-m1 and later with migration up, touching no media row", () => {
    supabase("migration", "up", "--local")
    expect(
      psqlJson<{ version: string }[]>(
        env,
        "select version from supabase_migrations.schema_migrations order by version"
      ).map((r) => r.version)
    ).toEqual(repoVersions)
    expect(fingerprint()).toBe(before)
    expect(
      psqlJson<{ use_baseline: string; n: number }[]>(
        env,
        "select use_baseline, count(*)::int as n from public.media_assets group by 1 order by 1"
      )
    ).toEqual([{ use_baseline: "legacy_unknown", n: 5 }])
    expect(psql(env, "select count(*) from public.media_use_grants")).toBe("0")
    expect(
      psql(
        env,
        "select md5(pg_get_functiondef('private.monthly_venue_completion_counts(uuid,uuid,date)'::regprocedure))"
      )
    ).toBe("595b567b933705e692d2f801d750b3fb")
  })

  it("marks a later row none and keeps the restore check green", () => {
    const id = randomUUID()
    psql(
      env,
      `insert into public.media_assets (id, uploader_id, venue_id, original_path, original_filename, media_type, size_bytes, client_upload_key)
       values ('${id}', '${STAFF}', '${VENUE}', '${STAFF}/${id}/original.jpg', 'DEV.jpg', 'image', 4, '${randomUUID()}')`
    )
    expect(
      psql(
        env,
        `select use_baseline from public.media_assets where id = '${id}'`
      )
    ).toBe("none")
    expect(
      psql(
        env,
        `select count(*) from public.media_assets a, private.media_use_settings s
         where a.created_at < s.cutover_at and a.use_baseline <> 'legacy_unknown'`
      )
    ).toBe("0")
    for (const old of ids)
      expect(
        psql(
          env,
          `select use_baseline from public.media_assets where id = '${old}'`
        )
      ).toBe("legacy_unknown")
  })
})
