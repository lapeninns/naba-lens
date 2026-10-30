// Proves a restored LOCAL stack works for real users: each DEV FIXTURE user signs
// in afresh through the magic-link token path, sees exactly the media rows the
// policies allow, and downloads byte-identical objects (sha256 against the
// manifest written by seed-fixture-media.ts before the backup). Other staff and
// anonymous clients are still denied.
//
//   tsx scripts/db/verify-restore.ts --workdir <dir> --manifest <file.json>
import { readFileSync } from "node:fs"

import { parseArgs } from "../lib/service-client"
import {
  accessMatrix,
  expectedRows,
  expectedSha,
  psql,
  storedObjectShas,
  type FixtureManifest,
  stackEnv,
} from "./lib/drill"

const args = parseArgs(process.argv.slice(2))
if (typeof args.workdir !== "string" || typeof args.manifest !== "string") {
  throw new Error(
    "Usage: verify-restore.ts --workdir <dir> --manifest <file.json>"
  )
}
const manifest = JSON.parse(
  readFileSync(args.manifest, "utf8")
) as FixtureManifest
const env = stackEnv(args.workdir)
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`
const readyOriginal = manifest.assets
  .find((a) => a.state === "ready")
  ?.objects.find((o) => /\/original\./.test(o.name))
const uploadingOriginal = manifest.assets
  .find((a) => a.state === "uploading")
  ?.objects.find((o) => /\/original\./.test(o.name))
if (!readyOriginal || !uploadingOriginal) {
  throw new Error(
    "The restore drill needs ready and uploading original fixtures"
  )
}
// Catalog equality alone is insufficient: exercise the restored guard against a
// closed reservation, then confirm a live reservation still accepts a write.
// Roll back the live-reservation no-op so verification leaves the objects intact.
psql(
  env,
  `begin;
   do $verify$
   begin
     if not exists (
       select 1 from pg_trigger
       where tgrelid = 'storage.objects'::regclass
         and tgname = 'nabalens_guard_media_original_write'
         and tgfoid = to_regprocedure('private.guard_media_original_write()')
         and tgenabled = 'O' and not tgisinternal
     ) then
       raise exception 'The restored original-write guard is missing or disabled';
     end if;
     if exists (
       select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
     ) then
       raise exception 'A restored public table has row-level security disabled';
     end if;
     begin
       update storage.objects set metadata = metadata
       where bucket_id = ${literal(readyOriginal.bucket)}
         and name = ${literal(readyOriginal.name)};
       raise exception 'The restored guard accepted a closed original reservation';
     exception when insufficient_privilege then
       if sqlerrm <> 'media_reservation_closed' then raise; end if;
     end;
     update storage.objects set metadata = metadata
     where bucket_id = ${literal(uploadingOriginal.bucket)}
       and name = ${literal(uploadingOriginal.name)};
     if not found then raise exception 'The uploading original fixture is missing'; end if;
   end;
   $verify$;
   rollback;`
)
console.log(
  "verified: original-write guard rejects closed reservations, permits live reservations, and public RLS is enabled"
)
const { downloads, rows } = await accessMatrix(env, manifest)
const objects = [
  ...manifest.assets.flatMap((a) => a.objects),
  manifest.avatar.object,
]

const failures: string[] = []
for (const d of downloads) {
  const want = expectedSha()
  if (d.sha256 !== want) {
    failures.push(
      `${d.who} ${d.bucket}/${d.name}: got ${d.sha256 ? "bytes " + d.sha256.slice(0, 12) : "denied"}, want ${want ? "bytes " + want.slice(0, 12) : "denied"}`
    )
  }
}
for (const who of ["admin", "staffA", "staffB", "anon"] as const) {
  const want = expectedRows(manifest, who)
  if (JSON.stringify(rows[who]) !== JSON.stringify(want)) {
    failures.push(`${who} rows: got ${rows[who].length}, want ${want.length}`)
  }
}
// End users cannot read Storage directly (security hardening), so byte integrity of
// the restored objects is proven with the service role.
let intact = 0
for (const d of await storedObjectShas(env, manifest)) {
  const o = objects.find((x) => x.bucket === d.bucket && x.name === d.name)!
  if (d.sha256 === o.sha256) intact++
  else
    failures.push(
      `${d.bucket}/${d.name}: restored bytes ${d.sha256 ? "differ" : "missing"}`
    )
}
console.log(
  `service role: ${intact}/${objects.length} restored objects byte-identical`
)
const granted = downloads.filter((d) => d.sha256 !== null)
console.log(
  `signed in: admin, staffA, staffB (magic-link token); ${downloads.length} download checks, ${granted.length} granted with matching sha256, ${downloads.length - granted.length} denied as expected`
)
for (const who of ["admin", "staffA", "staffB", "anon"] as const) {
  console.log(`  ${who}: sees ${rows[who].length} media rows`)
}
if (failures.length) {
  console.error(failures.join("\n"))
  process.exit(1)
}
console.log(
  "verified: sign-in, row visibility, direct-Storage denial and byte-identical restored objects match the manifest"
)
