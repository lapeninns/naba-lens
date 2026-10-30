// Seeds DEV FIXTURE media (real storage objects) into an isolated LOCAL stack
// that already holds supabase/seed.sql, and writes the fixture manifest used by
// verify-restore.ts. Never run against staging or production.
//
//   tsx scripts/db/seed-fixture-media.ts --workdir <dir> --out <file.json>
import { writeFileSync } from "node:fs"

import { parseArgs } from "../lib/service-client"
import { seedFixtureMedia, stackEnv } from "./lib/drill"

const args = parseArgs(process.argv.slice(2))
if (typeof args.workdir !== "string" || typeof args.out !== "string") {
  throw new Error("Usage: seed-fixture-media.ts --workdir <dir> --out <file.json>")
}
const manifest = await seedFixtureMedia(stackEnv(args.workdir))
writeFileSync(args.out, JSON.stringify(manifest, null, 2) + "\n")
console.log(
  `seeded ${manifest.assets.length} DEV FIXTURE assets and 1 avatar (${
    manifest.assets.flatMap((a) => a.objects).length + 1
  } objects)`
)
