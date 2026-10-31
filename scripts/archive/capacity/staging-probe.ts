// Measures real R2 read latency and throughput on a STAGING or probe bucket,
// to replace the model's assumed speed profile (docs/archive-capacity.md,
// "Measure on staging"). A human runs this with credentials they provision.
// Agents in this workstream never run it: they have no credentials.
//
//   CAPACITY_PROBE_R2_ACCOUNT_ID=... CAPACITY_PROBE_BUCKET=nabalens-capacity-probe \
//   CAPACITY_PROBE_R2_ACCESS_KEY_ID=... CAPACITY_PROBE_R2_SECRET_ACCESS_KEY=... \
//     pnpm exec tsx scripts/archive/capacity/staging-probe.ts seed
//     pnpm exec tsx scripts/archive/capacity/staging-probe.ts read [--seconds 30] [--concurrency 1,4,8]
//
// The variables deliberately differ from MEDIA_ARCHIVE_R2_*, and the bucket name
// must say staging, probe or capacity, so production credentials are not picked
// up by accident. It writes and reads only under the `capacity-probe/` prefix.
import { createHash } from "node:crypto"

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"

import { MIB } from "./model"

const PREFIX = "capacity-probe/"
// One object per size class used by the model: photos, a mid video, the 200 MiB cap.
const OBJECTS = [
  ...Array.from({ length: 12 }, (_, i) => ({
    key: `${PREFIX}photo-${i}`,
    bytes: 5.5 * 1e6,
  })),
  ...Array.from({ length: 3 }, (_, i) => ({
    key: `${PREFIX}video-${i}`,
    bytes: 80 * 1e6,
  })),
  { key: `${PREFIX}cap-0`, bytes: 200 * MIB },
]

function config() {
  const env = process.env
  const accountId = env.CAPACITY_PROBE_R2_ACCOUNT_ID ?? ""
  const bucket = env.CAPACITY_PROBE_BUCKET ?? ""
  const accessKeyId = env.CAPACITY_PROBE_R2_ACCESS_KEY_ID ?? ""
  const secretAccessKey = env.CAPACITY_PROBE_R2_SECRET_ACCESS_KEY ?? ""
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey)
    throw new Error(
      "set the four CAPACITY_PROBE_* variables (see the header of this file)"
    )
  if (!/(staging|probe|capacity)/.test(bucket))
    throw new Error(
      "refusing: the bucket name must contain staging, probe or capacity"
    )
  if (bucket === env.MEDIA_ARCHIVE_R2_BUCKET)
    throw new Error("refusing: this is the production archive bucket")
  return { accountId, bucket, accessKeyId, secretAccessKey }
}

function client(c: ReturnType<typeof config>) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${c.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: c.accessKeyId,
      secretAccessKey: c.secretAccessKey,
    },
    maxAttempts: 2,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  })
}

async function seed() {
  const c = config()
  const s3 = client(c)
  const chunk = Buffer.alloc(1024 * 1024)
  for (const { key, bytes } of OBJECTS) {
    // Random content, so no layer between here and R2 can compress it.
    const body = Buffer.alloc(Math.ceil(bytes))
    for (let i = 0; i < body.length; i += chunk.length) {
      for (let j = 0; j < chunk.length; j += 4096)
        chunk.writeUInt32LE((Math.random() * 2 ** 32) >>> 0, j)
      chunk.copy(body, i, 0, Math.min(chunk.length, body.length - i))
    }
    await s3
      .send(
        new PutObjectCommand({
          Bucket: c.bucket,
          Key: key,
          Body: body,
          ContentLength: body.length,
          IfNoneMatch: "*",
        })
      )
      .catch((error: { $metadata?: { httpStatusCode?: number } }) => {
        if (error.$metadata?.httpStatusCode !== 412) throw error
      })
    console.log(`seeded ${key} (${(body.length / 1e6).toFixed(1)} MB)`)
  }
}

type Sample = { ttfbMs: number; ms: number; bytes: number }

async function readOnce(
  s3: S3Client,
  bucket: string,
  key: string
): Promise<Sample> {
  const start = performance.now()
  const response = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  )
  const ttfbMs = performance.now() - start
  const hash = createHash("sha256")
  let bytes = 0
  for await (const piece of response.Body as AsyncIterable<Uint8Array>) {
    bytes += piece.byteLength
    hash.update(piece)
  }
  hash.digest("hex")
  return { ttfbMs, ms: performance.now() - start, bytes }
}

const quantile = (xs: number[], q: number) =>
  [...xs].sort((a, b) => a - b)[
    Math.min(xs.length - 1, Math.floor(q * xs.length))
  ]

async function read(seconds: number, levels: number[]) {
  const c = config()
  const s3 = client(c)
  const rows: string[] = []
  for (const concurrency of levels) {
    const samples: Sample[] = []
    const stopAt = performance.now() + seconds * 1000
    const began = performance.now()
    let next = 0
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (performance.now() < stopAt) {
          const { key } = OBJECTS[next++ % OBJECTS.length]
          samples.push(await readOnce(s3, c.bucket, key))
        }
      })
    )
    const wall = (performance.now() - began) / 1000
    const totalBytes = samples.reduce((sum, s) => sum + s.bytes, 0)
    // Per-stream rate from large bodies only; small ones are dominated by latency.
    const large = samples.filter((s) => s.bytes >= 50e6)
    const streamMBps = large.length
      ? large.reduce(
          (sum, s) => sum + s.bytes / 1e6 / ((s.ms - s.ttfbMs) / 1000),
          0
        ) / large.length
      : NaN
    rows.push(
      [
        `c=${concurrency}`,
        `${samples.length} reads`,
        `TTFB p50 ${quantile(
          samples.map((s) => s.ttfbMs),
          0.5
        ).toFixed(0)} ms, p95 ${quantile(
          samples.map((s) => s.ttfbMs),
          0.95
        ).toFixed(0)} ms`,
        `aggregate ${(totalBytes / 1e6 / wall).toFixed(0)} MB/s`,
        `per large stream ${streamMBps.toFixed(0)} MB/s`,
      ].join(" | ")
    )
    console.log(rows[rows.length - 1])
  }
  console.log(
    "\nUse the p50 TTFB, the per-stream rate at c=1 and the aggregate at the highest concurrency as\n" +
      "  pnpm exec tsx scripts/archive/capacity/report.ts --section crossing --measured ttfb=<ms>,stream=<MB/s>,cap=<MB/s>,db=<ms>"
  )
}

const [mode, ...rest] = process.argv.slice(2)
const flag = (name: string, fallback: string) => {
  const i = rest.indexOf(name)
  return i >= 0 ? rest[i + 1] : fallback
}
if (mode === "seed") await seed()
else if (mode === "read")
  await read(
    Number(flag("--seconds", "30")),
    flag("--concurrency", "1,4,8").split(",").map(Number)
  )
else {
  console.error(
    "usage: staging-probe.ts seed | read [--seconds 30] [--concurrency 1,4,8]"
  )
  process.exit(2)
}
