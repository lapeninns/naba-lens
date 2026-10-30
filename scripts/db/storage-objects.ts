// Copies Storage objects out of, or back into, a LOCAL stack through the Storage
// API with the service role. Used by scripts/db/backup-local.sh and
// restore-local.sh; database dumps do not contain object bytes.
//
//   tsx scripts/db/storage-objects.ts export --workdir <dir> --out <backup>/storage
//   tsx scripts/db/storage-objects.ts import --workdir <dir> --from <backup>/storage
//   tsx scripts/db/storage-objects.ts verify --workdir <dir> --from <backup>/storage
//
// export: every object in storage.objects -> <out>/objects/<bucket>/<name> plus
//         <out>/manifest.json (bucket, name, content type, size, sha256).
// import: uploads each manifest object to the same bucket and key (no upsert), so
//         the restored key set and bytes match exactly. Buckets must already exist
//         (they are rows in the database dump).
// verify: downloads every manifest object from the stack and compares sha256, and
//         checks storage.objects holds exactly the manifest's keys.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { parseArgs } from "../lib/service-client"
import { psqlJson, serviceClient, sha256, stackEnv } from "./lib/drill"

type Entry = {
  bucket: string
  name: string
  contentType: string
  cacheControl: string | null
  size: number
  sha256: string
}

const [command, ...rest] = process.argv.slice(2)
const args = parseArgs(rest)
if (typeof args.workdir !== "string")
  throw new Error("--workdir <dir> is required")
const env = stackEnv(args.workdir)
const admin = serviceClient(env)

type Stored = { bucket: string; name: string; mimetype: string | null; cache: string | null }

function storedObjects(): Stored[] {
  return psqlJson<Stored[]>(
    env,
    `select bucket_id as bucket, name, metadata->>'mimetype' as mimetype,
       metadata->>'cacheControl' as cache
     from storage.objects order by bucket_id, name`
  )
}

async function download(bucket: string, name: string): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from(bucket).download(name)
  if (error || !data)
    throw new Error(`download ${bucket}/${name}: ${error?.message}`)
  return new Uint8Array(await data.arrayBuffer())
}

const safe = (name: string) => {
  if (
    name.split("/").some((part) => part === ".." || part === "" || part === ".")
  ) {
    throw new Error(`Refusing unsafe object key: ${name}`)
  }
  return name
}

if (command === "export") {
  if (typeof args.out !== "string") throw new Error("--out <dir> is required")
  const entries: Entry[] = []
  for (const o of storedObjects()) {
    const bytes = await download(o.bucket, o.name)
    const file = join(args.out, "objects", safe(o.bucket), safe(o.name))
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, bytes)
    entries.push({
      bucket: o.bucket,
      name: o.name,
      contentType: o.mimetype ?? "application/octet-stream",
      cacheControl: o.cache,
      size: bytes.byteLength,
      sha256: sha256(bytes),
    })
  }
  writeFileSync(
    join(args.out, "manifest.json"),
    JSON.stringify(entries, null, 2) + "\n"
  )
  console.log(`exported ${entries.length} objects`)
} else if (command === "import" || command === "verify") {
  if (typeof args.from !== "string") throw new Error("--from <dir> is required")
  const entries = JSON.parse(
    readFileSync(join(args.from, "manifest.json"), "utf8")
  ) as Entry[]
  if (command === "import") {
    for (const e of entries) {
      const bytes = readFileSync(
        join(args.from, "objects", safe(e.bucket), safe(e.name))
      )
      if (sha256(bytes) !== e.sha256)
        throw new Error(`Backup file corrupt: ${e.bucket}/${e.name}`)
      const { error } = await admin.storage
        .from(e.bucket)
        .upload(e.name, bytes, {
          contentType: e.contentType,
          cacheControl: e.cacheControl ?? undefined,
          upsert: false,
        })
      if (error)
        throw new Error(`upload ${e.bucket}/${e.name}: ${error.message}`)
    }
    console.log(`imported ${entries.length} objects`)
  }
  const stored = storedObjects().map((o) => `${o.bucket}/${o.name}`)
  const expected = entries.map((e) => `${e.bucket}/${e.name}`).sort()
  if (JSON.stringify([...stored].sort()) !== JSON.stringify(expected)) {
    throw new Error(
      `storage.objects differs from the manifest (${stored.length} stored, ${expected.length} expected)`
    )
  }
  for (const e of entries) {
    if (sha256(await download(e.bucket, e.name)) !== e.sha256) {
      throw new Error(`Bytes differ after restore: ${e.bucket}/${e.name}`)
    }
  }
  console.log(`verified ${entries.length} objects: keys and sha256 match`)
} else {
  throw new Error(
    "Usage: storage-objects.ts export|import|verify --workdir <dir> ..."
  )
}
