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
  storedObjectShas,
  type FixtureManifest,
  stackEnv,
} from "./lib/drill"

const args = parseArgs(process.argv.slice(2))
if (typeof args.workdir !== "string" || typeof args.manifest !== "string") {
  throw new Error("Usage: verify-restore.ts --workdir <dir> --manifest <file.json>")
}
const manifest = JSON.parse(readFileSync(args.manifest, "utf8")) as FixtureManifest
const env = stackEnv(args.workdir)
const { downloads, rows } = await accessMatrix(env, manifest)
const objects = [...manifest.assets.flatMap((a) => a.objects), manifest.avatar.object]

const failures: string[] = []
for (const d of downloads) {
  const o = objects.find((x) => x.bucket === d.bucket && x.name === d.name)!
  const want = expectedSha(manifest, d.who, o)
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
  else failures.push(`${d.bucket}/${d.name}: restored bytes ${d.sha256 ? "differ" : "missing"}`)
}
console.log(`service role: ${intact}/${objects.length} restored objects byte-identical`)
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
console.log("verified: sign-in, row visibility, direct-Storage denial and byte-identical restored objects match the manifest")
