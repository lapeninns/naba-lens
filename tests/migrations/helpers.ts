import { execFileSync } from "node:child_process"
import { readdirSync } from "node:fs"
import { join } from "node:path"

import { psql, stackEnv, type StackEnv } from "../../scripts/db/lib/drill"

export const workdir = process.env.NABALENS_DRILL_WORKDIR!
export const state = process.env.NABALENS_DRILL_STATE!
if (!workdir || !state) {
  throw new Error("Run through tests/migrations/run.mjs <workdir> <phase>")
}
export const env: StackEnv = stackEnv(workdir)

export const LATER = "20261101090000_test_only_additive.sql"
export const laterTarget = join(workdir, "supabase", "migrations", LATER)

export const repoMigrations = readdirSync("supabase/migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort()
export const repoVersions = repoMigrations.map((f) => f.split("_")[0])

export function supabase(...args: string[]): string {
  return execFileSync("supabase", ["--workdir", workdir, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 420_000,
  })
}

/** Hash of app-owned schema objects plus storage policies, for drift checks. */
export function schemaFingerprint(): string {
  return psql(
    env,
    `select md5(string_agg(def, E'\\n' order by def)) from (
       select format('%s.%s(%s) %s', n.nspname, p.proname,
         pg_get_function_identity_arguments(p.oid), md5(pg_get_functiondef(p.oid))) as def
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private')
       union all
       select format('%s.%s.%s %s %s', table_schema, table_name, column_name, data_type,
         coalesce(column_default, ''))
       from information_schema.columns where table_schema in ('public', 'private')
       union all
       select format('%s %s', conrelid::regclass, pg_get_constraintdef(oid)) from pg_constraint
       where connamespace = 'public'::regnamespace
       union all
       select indexdef from pg_indexes where schemaname = 'public'
       union all
       select format('%s.%s %s %s %s %s', schemaname, tablename, policyname, cmd, qual, with_check)
       from pg_policies where schemaname in ('public', 'storage')
       union all
       select format('trigger %s %s %s', tgrelid::regclass, tgname, tgfoid::regproc) from pg_trigger
       where not tgisinternal and tgrelid in (select oid from pg_class
         where relnamespace = 'public'::regnamespace)
       union all
       select format('grant %s %s %s', table_name, grantee, privilege_type)
       from information_schema.role_table_grants
       where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
     ) d`
  )
}

export const ids = (rows: unknown[]) => rows.map((r) => (r as { id: string }).id)
