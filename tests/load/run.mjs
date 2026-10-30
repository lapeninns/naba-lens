// NabaLens load-sanity runner. Drives a production build (`next start`) against
// the isolated load stack the way the staff upload dialog does:
//
//   reserveUpload (Server Action) -> signed PUT or TUS to Storage -> finaliseUpload
//
// Each simulated staff member is one browser tab: up to 2 transfers in parallel
// (MEDIA_LIMITS.maxParallelUploads), and Server Actions dispatched ONE AT A TIME,
// as Next's client does (node_modules/next/dist/docs/01-app/02-guides/
// server-actions.md, "Sequential dispatch on the client"). `--parallel-actions`
// lifts that lock to stress the server harder than a browser can.
// finalise is called once per file, like lib/upload: no retries are added.
//
//   W=$(node tests/load/prepare-stack.mjs); supabase --workdir "$W" start
//   F=$(node tests/load/fixtures.mjs)
//   node tests/load/stack-env.mjs "$W" pnpm build
//   node tests/load/run.mjs --workdir "$W" --fixtures "$F" --scenario all
//
// Options: --staff N (a), --batch mixed|heic (a), --heic N (b), --port, --out,
// --parallel-actions.
//
// Synthetic fixtures and throwaway `.test` accounts only. Never point this at a
// hosted project: stack-env.mjs refuses non-local hosts.
import { execFile, spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { loadavg, tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"

import { createServerClient } from "@supabase/ssr"
import { createClient } from "@supabase/supabase-js"

import { appEnv, stackEnv } from "./stack-env.mjs"

const require = createRequire(import.meta.url)
const tus = require("tus-js-client")
const run = promisify(execFile)

// ---------------------------------------------------------------- arguments
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .split(/\s+--/)
    .map((s) => s.replace(/^--/, "").split(/\s+(.*)/s))
    .filter(([k]) => k)
    .map(([k, v]) => [k, v === undefined || v === "" ? true : v])
)
const WORKDIR = args.workdir
const FIXTURES = args.fixtures
if (!WORKDIR || !FIXTURES) {
  console.error(
    "usage: run.mjs --workdir <dir> --fixtures <dir> [--scenario a|b|c|all]"
  )
  process.exit(2)
}
const SCENARIOS = String(args.scenario ?? "all")
const PORT = Number(args.port ?? 3615)
const BASE = `http://127.0.0.1:${PORT}`
const STAFF = Number(args.staff ?? 10)
const HEIC_CONCURRENT = Number(args.heic ?? 5)
/** Scenario a's batch: "mixed" (default) or "heic" (an all-iPhone batch). */
const BATCH = String(args.batch ?? "mixed")
const PARALLEL_ACTIONS = args["parallel-actions"] === true
const OUT = resolve(
  args.out ?? join("tests/load/results", `run-${Date.now()}.json`)
)
const RUN_ID = randomUUID().slice(0, 6)

const env = stackEnv(WORKDIR)
const service = createClient(env.url, env.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ---------------------------------------------------------------- utilities
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const now = () => performance.now()
const MiB = 1024 * 1024

function pct(values, p) {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]
}
const round = (v) => (v == null ? v : Math.round(v))

class Mutex {
  #tail = Promise.resolve()
  run(fn) {
    const result = this.#tail.then(fn, fn)
    this.#tail = result.then(
      () => {},
      () => {}
    )
    return result
  }
}

// ---------------------------------------------------------------- server
const actionIds = (() => {
  const manifest = JSON.parse(
    readFileSync(".next/server/server-reference-manifest.json", "utf8")
  )
  const ids = {}
  for (const [id, v] of Object.entries(manifest.node)) {
    if (v.filename === "app/staff/actions.ts") ids[v.exportedName] = id
  }
  if (!ids.reserveUpload || !ids.finaliseUpload)
    throw new Error("Build first: staff actions not in the manifest")
  return ids
})()

/** RSS (KiB) of the server process tree, summed. */
async function treeRssKiB(rootPid) {
  const { stdout } = await run("ps", ["-A", "-o", "pid=,ppid=,rss="])
  const rows = stdout
    .trim()
    .split("\n")
    .map((l) => l.trim().split(/\s+/).map(Number))
  const pids = new Set([rootPid])
  let grew = true
  while (grew) {
    grew = false
    for (const [pid, ppid] of rows)
      if (pids.has(ppid) && !pids.has(pid)) {
        pids.add(pid)
        grew = true
      }
  }
  return rows
    .filter(([pid]) => pids.has(pid))
    .reduce((a, [, , rss]) => a + rss, 0)
}

async function startServer(label) {
  const workerLog = join(
    tmpdir(),
    `nabalens-load-workers-${RUN_ID}-${label}.jsonl`
  )
  const fetchLog = workerLog.replace("-workers-", "-fetch-")
  writeFileSync(workerLog, "")
  writeFileSync(fetchLog, "")
  const child = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "-p",
      String(PORT),
      "-H",
      "127.0.0.1",
    ],
    {
      env: appEnv(env, {
        NODE_ENV: "production",
        NABALENS_WORKER_LOG: workerLog,
        NABALENS_FETCH_LOG: fetchLog,
        NODE_OPTIONS: `--import ${pathToFileURL(resolve("tests/load/server-probe.mjs"))}`,
        NEXT_PUBLIC_SITE_URL: BASE,
      }),
      stdio: ["ignore", "pipe", "pipe"],
    }
  )
  const logs = []
  child.stdout.on("data", (d) => logs.push(String(d)))
  child.stderr.on("data", (d) => logs.push(String(d)))
  for (let i = 0; i < 200; i++) {
    try {
      const r = await fetch(`${BASE}/login`)
      if (r.ok) break
    } catch {}
    await sleep(100)
  }
  const samples = []
  let stop = false
  const sampler = (async () => {
    while (!stop) {
      try {
        samples.push({ t: Date.now(), kib: await treeRssKiB(child.pid) })
      } catch {}
      await sleep(100)
    }
  })()
  return {
    pid: child.pid,
    samples,
    workerLog,
    fetchLog,
    logs,
    mark: () => samples.length,
    async stop() {
      stop = true
      await sampler
      child.kill("SIGTERM")
      await new Promise((r) => child.once("exit", r))
    },
  }
}

function rssStats(samples, from = 0, to = samples.length) {
  const slice = samples.slice(from, to).map((s) => s.kib / 1024)
  return {
    startMiB: round(slice[0]),
    peakMiB: round(Math.max(...slice)),
    endMiB: round(slice.at(-1)),
    samples: slice.length,
  }
}

function workerStats(path, t0, t1) {
  const events = readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((e) => e.t >= t0 && e.t <= t1)
  const spawns = new Map()
  const runs = []
  for (const e of events) {
    if (e.ev === "spawn") spawns.set(e.id, e.t)
    else if (spawns.has(e.id)) runs.push({ start: spawns.get(e.id), end: e.t })
  }
  runs.sort((a, b) => a.start - b.start)
  let maxOverlap = 0
  for (const r of runs)
    maxOverlap = Math.max(
      maxOverlap,
      runs.filter((o) => o.start <= r.start && o.end > r.start).length
    )
  const durations = runs.map((r) => r.end - r.start)
  return {
    workers: runs.length,
    maxConcurrent: maxOverlap,
    decodeMs: {
      p50: round(pct(durations, 50)),
      p95: round(pct(durations, 95)),
      max: round(Math.max(0, ...durations)),
    },
    runs: runs.map((r) => ({ start: r.start - t0, end: r.end - t0 })),
  }
}

/** Server-side fetches to the stack, grouped: where finalise time goes. */
function fetchStats(path, t0, t1) {
  const groups = {}
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue
    const e = JSON.parse(line)
    if (e.t < t0 || e.t > t1) continue
    const key = `${e.service} ${e.method}${e.range ? " range" : ""}`
    const g = (groups[key] ??= { ms: [], statuses: {} })
    g.ms.push(e.ms)
    g.statuses[e.status] = (g.statuses[e.status] ?? 0) + 1
  }
  return Object.fromEntries(
    Object.entries(groups).map(([k, g]) => [
      k,
      {
        n: g.ms.length,
        p50: pct(g.ms, 50),
        p95: pct(g.ms, 95),
        max: Math.max(...g.ms),
        statuses: g.statuses,
      },
    ])
  )
}

// ---------------------------------------------------------------- identities
let venueId
async function venue() {
  if (venueId) return venueId
  const { data, error } = await service
    .from("venues")
    .select("id")
    .eq("slug", "dev-fixture-venue-a")
    .single()
  if (error) throw error
  return (venueId = data.id)
}

/** A throwaway staff account, signed in through the magic-link token path. */
async function createStaff(label) {
  const email = `load-${RUN_ID}-${label}@nabalens.test`
  const { data: created, error } = await service.auth.admin.createUser({
    email,
    email_confirm: true,
  })
  if (error) throw error
  const id = created.user.id
  const { error: pErr } = await service.from("profiles").insert({
    id,
    display_name: `LOAD TEST ${label}`,
    role: "staff",
    venue_id: await venue(),
    active: true,
  })
  if (pErr) throw pErr
  const { data: link, error: lErr } = await service.auth.admin.generateLink({
    type: "magiclink",
    email,
  })
  if (lErr) throw lErr
  const jar = new Map()
  const ssr = createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) =>
        list.forEach(({ name, value }) =>
          value ? jar.set(name, value) : jar.delete(name)
        ),
    },
  })
  const { data: session, error: vErr } = await ssr.auth.verifyOtp({
    type: "email",
    token_hash: link.properties.hashed_token,
  })
  if (vErr) throw vErr
  return {
    id,
    label,
    cookie: () => [...jar].map(([n, v]) => `${n}=${v}`).join("; "),
    accessToken: session.session.access_token,
    lock: new Mutex(),
  }
}

// ---------------------------------------------------------------- one upload
const http5xx = []

async function callAction(staff, name, arg) {
  const queued = now()
  return (PARALLEL_ACTIONS ? (fn) => fn() : (fn) => staff.lock.run(fn))(
    async () => {
      const started = now()
      const res = await fetch(`${BASE}/staff`, {
        method: "POST",
        headers: {
          "next-action": actionIds[name],
          "content-type": "text/plain;charset=UTF-8",
          accept: "text/x-component",
          origin: BASE,
          cookie: staff.cookie(),
        },
        body: JSON.stringify([arg]),
      })
      const text = await res.text()
      const ended = now()
      if (res.status >= 500) http5xx.push({ name, status: res.status })
      // Flight rows: `0:{...}` metadata, `1:{...}` the action's return value.
      const row = text.split("\n").find((l) => l.startsWith("1:"))
      let value = null
      try {
        value = row ? JSON.parse(row.slice(2)) : null
      } catch {}
      return {
        status: res.status,
        value,
        raw: value ? undefined : text.slice(0, 300),
        waitMs: started - queued,
        ms: ended - started,
      }
    }
  )
}

async function transfer(staff, reservation, file) {
  if (!reservation.resumable) {
    const res = await fetch(reservation.uploadUrl, {
      method: "PUT",
      headers: { "content-type": file.contentType, "x-upsert": "false" },
      body: file.bytes,
    })
    const text = await res.text()
    if (res.status >= 500)
      http5xx.push({ name: "storage-put", status: res.status })
    if (!res.ok && !/already exists|Duplicate/i.test(text))
      throw new Error(`put_${res.status}`)
    return
  }
  await new Promise((resolveTus, reject) => {
    const upload = new tus.Upload(file.bytes, {
      endpoint: `${env.url}/storage/v1/upload/resumable`,
      chunkSize: 6 * MiB,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      uploadDataDuringCreation: false,
      storeFingerprintForResuming: false,
      headers: {
        authorization: `Bearer ${staff.accessToken}`,
        apikey: env.publishableKey,
        "x-upsert": "false",
      },
      metadata: {
        bucketName: reservation.bucket,
        objectName: reservation.objectKey,
        contentType: file.contentType,
        cacheControl: "3600",
      },
      onSuccess: () => resolveTus(),
      onError: (e) => {
        const status = e?.originalResponse?.getStatus?.()
        if (status >= 500) http5xx.push({ name: "storage-tus", status })
        reject(new Error(`tus_${status ?? "network"}`))
      },
    })
    upload.start()
  })
}

async function uploadOne(staff, file) {
  const key = randomUUID().replaceAll("-", "")
  const r = { file: file.name, kind: file.kind, bytes: file.bytes.byteLength }
  const t0 = now()
  try {
    const reserve = await callAction(staff, "reserveUpload", {
      idempotencyKey: key,
      filename: file.name,
      sizeBytes: file.bytes.byteLength,
      contentType: file.contentType,
      mediaType: file.kind,
      preferResumable: file.kind === "video" || file.bytes.byteLength > 6 * MiB,
    })
    r.reserveMs = reserve.ms
    r.reserveWaitMs = reserve.waitMs
    if (!reserve.value?.ok) {
      r.outcome = "reserve_failed"
      r.error =
        reserve.value?.message ?? `HTTP ${reserve.status} ${reserve.raw}`
      return r
    }
    const reservation = reserve.value.reservation
    const t1 = now()
    await transfer(staff, reservation, file)
    r.transferMs = now() - t1
    r.finaliseAt = Date.now()
    const fin = await callAction(staff, "finaliseUpload", {
      assetId: reservation.assetId,
      idempotencyKey: key,
    })
    r.finaliseMs = fin.ms
    r.finaliseEndAt = Date.now()
    r.finaliseWaitMs = fin.waitMs
    r.finaliseStatus = fin.status
    if (fin.value?.ok && fin.value.result.state === "ready") r.outcome = "ready"
    else {
      r.outcome = fin.value?.ok ? "processing_failed" : "finalise_failed"
      r.error =
        fin.value?.result?.error ??
        fin.value?.message ??
        `HTTP ${fin.status} ${fin.raw}`
    }
  } catch (e) {
    r.outcome = "transfer_failed"
    r.error = e.message
  } finally {
    r.totalMs = now() - t0
  }
  return r
}

async function pool(items, size, fn) {
  const results = []
  let next = 0
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++
        results[i] = await fn(items[i])
      }
    })
  )
  return results
}

// ---------------------------------------------------------------- fixtures
const TYPES = {
  jpg: ["image/jpeg", "image"],
  png: ["image/png", "image"],
  webp: ["image/webp", "image"],
  heic: ["image/heic", "image"],
  mp4: ["video/mp4", "video"],
  mov: ["video/quicktime", "video"],
}
const cache = new Map()
function fixture(name, dir = FIXTURES) {
  const path = join(dir, name)
  if (!cache.has(path)) cache.set(path, readFileSync(path))
  const ext = name.split(".").pop()
  return {
    name,
    bytes: cache.get(path),
    contentType: TYPES[ext][0],
    kind: TYPES[ext][1],
  }
}
const REPO_FIXTURES = resolve("tests/fixtures/media")
/** 10 files: 6 photos (JPEG/PNG/WebP), 2 HEIC, a 19 MiB clip, a small MOV. */
function mixedBatch(offset) {
  const files = [
    fixture("photo-12mp.jpg"),
    fixture("photo-12mp.heic"),
    fixture("photo-8mp.jpg"),
    fixture("clip-20mib.mp4"),
    fixture("photo-2mp.png"),
    fixture("photo-12mp.jpg"),
    fixture("photo-12mp.webp"),
    fixture("photo-12mp.heic"),
    fixture("synthetic.mov", REPO_FIXTURES),
    fixture("photo-12mp.jpg"),
  ]
  return files.map((_, i) => files[(i + offset) % files.length])
}

function summarise(results) {
  const fin = results.filter((r) => r.finaliseMs != null)
  const byKind = (pred) => fin.filter(pred).map((r) => r.finaliseMs)
  const lat = (values) => ({
    n: values.length,
    p50: round(pct(values, 50)),
    p95: round(pct(values, 95)),
    max: round(values.length ? Math.max(...values) : null),
  })
  const outcomes = {}
  for (const r of results) outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1
  const errors = {}
  for (const r of results.filter((r) => r.error))
    errors[r.error] = (errors[r.error] ?? 0) + 1
  return {
    files: results.length,
    ready: outcomes.ready ?? 0,
    successRate: (outcomes.ready ?? 0) / results.length,
    outcomes,
    errors,
    finaliseMs: {
      all: lat(fin.map((r) => r.finaliseMs)),
      heic: lat(byKind((r) => r.file.endsWith(".heic"))),
      otherImage: lat(
        byKind((r) => r.kind === "image" && !r.file.endsWith(".heic"))
      ),
      video: lat(byKind((r) => r.kind === "video")),
    },
    finaliseActionQueueMs: lat(fin.map((r) => r.finaliseWaitMs)),
    reserveMs: lat(
      results.filter((r) => r.reserveMs != null).map((r) => r.reserveMs)
    ),
    transferMs: lat(
      results.filter((r) => r.transferMs != null).map((r) => r.transferMs)
    ),
    fileTotalMs: lat(results.map((r) => r.totalMs)),
  }
}

// ---------------------------------------------------------------- scenarios
async function withServer(label, body) {
  const server = await startServer(label)
  try {
    // Warm the route and the media modules with one small JPEG upload.
    const warm = await createStaff(`${label}-warm`)
    const w = await uploadOne(warm, fixture("photo-8mp.jpg"))
    if (w.outcome !== "ready") throw new Error(`warm-up failed: ${w.error}`)
    await sleep(500)
    const idle = server.samples.at(-1)?.kib / 1024
    const from = server.mark()
    const t0 = Date.now()
    http5xx.length = 0
    const load = [loadavg()[0]]
    const result = await body(server)
    load.push(loadavg()[0])
    const t1 = Date.now()
    await sleep(300)
    return {
      ...result,
      wallMs: t1 - t0,
      serverRss: {
        idleAfterWarmMiB: round(idle),
        ...rssStats(server.samples, from),
      },
      heicWorkers: workerStats(server.workerLog, t0, t1 + 300),
      serverFetches: fetchStats(server.fetchLog, t0, t1 + 300),
      http5xx: [...http5xx],
      hostLoadAvg1m: load.map((l) => Math.round(l * 10) / 10),
      serverLogTail: server.logs
        .join("")
        .split("\n")
        .filter(Boolean)
        .slice(-15),
    }
  } finally {
    await server.stop()
  }
}

async function scenarioA() {
  return withServer("a", async () => {
    const staff = await Promise.all(
      Array.from({ length: STAFF }, (_, i) => createStaff(`a${i}`))
    )
    const batches = await Promise.all(
      staff.map((s, i) =>
        pool(
          BATCH === "heic"
            ? Array.from({ length: 10 }, () => fixture("photo-12mp.heic"))
            : mixedBatch(i),
          2,
          (f) => uploadOne(s, f)
        )
      )
    )
    const results = batches.flat()
    return {
      scenario: `a: ${STAFF} staff x 10-file ${BATCH} batch, 2 parallel per client`,
      summary: summarise(results),
      results,
    }
  })
}

async function scenarioB() {
  return withServer("b", async () => {
    const heic = fixture("photo-12mp.heic")
    // Baseline: one HEIC finalise on an idle server.
    const solo = await uploadOne(await createStaff("b-solo"), heic)
    await sleep(500)
    // N tabs each upload one HEIC, then all finalise at the same instant.
    const staff = await Promise.all(
      Array.from({ length: HEIC_CONCURRENT }, (_, i) => createStaff(`b${i}`))
    )
    // Setup only, 4 at a time: the burst below is what is measured, and 20
    // simultaneous signs exhaust the local Storage DB pool (544 DatabaseTimeout).
    const prepared = await pool(staff, 4, async (s) => {
      const key = randomUUID().replaceAll("-", "")
      const reserve = await callAction(s, "reserveUpload", {
        idempotencyKey: key,
        filename: heic.name,
        sizeBytes: heic.bytes.byteLength,
        contentType: heic.contentType,
        mediaType: "image",
        preferResumable: false,
      })
      if (!reserve.value?.ok)
        throw new Error(`reserve: ${reserve.value?.message}`)
      await transfer(s, reserve.value.reservation, heic)
      return { s, key, assetId: reserve.value.reservation.assetId }
    })
    const t0 = Date.now()
    const results = await Promise.all(
      prepared.map(async ({ s, key, assetId }) => {
        const fin = await callAction(s, "finaliseUpload", {
          assetId,
          idempotencyKey: key,
        })
        return {
          file: heic.name,
          kind: "image",
          finaliseMs: fin.ms,
          finaliseWaitMs: fin.waitMs,
          totalMs: fin.ms,
          finaliseStatus: fin.status,
          outcome:
            fin.value?.ok && fin.value.result.state === "ready"
              ? "ready"
              : fin.value?.ok
                ? "processing_failed"
                : "finalise_failed",
          error: fin.value?.ok ? fin.value.result.error : fin.value?.message,
        }
      })
    )
    const soloMs = solo.finaliseMs
    return {
      scenario: `b: ${HEIC_CONCURRENT} simultaneous 12 MP HEIC finalises`,
      soloFinaliseMs: round(soloMs),
      summary: summarise(results),
      queueWaitMs: results
        .map((r) => round(r.finaliseMs - soloMs))
        .sort((a, b) => a - b),
      burstStartedAt: t0,
      results,
    }
  })
}

async function scenarioC() {
  return withServer("c", async (server) => {
    const video = fixture("video-200mib.mp4")
    const s = await createStaff("c")
    const result = await uploadOne(s, video)
    return {
      scenario: `c: one ${(video.bytes.byteLength / MiB).toFixed(1)} MiB video upload + finalise`,
      summary: summarise([result]),
      // RSS while only the finalise ran (the TUS transfer never touches Next).
      finaliseRss: rssStats(
        server.samples.filter(
          (x) =>
            x.t >= result.finaliseAt - 200 && x.t <= result.finaliseEndAt + 200
        )
      ),
      results: [result],
    }
  })
}

// Finalise-only RSS window for (c) needs the finalise timestamps; the full RSS
// window above already covers the TUS transfer (which never touches Next).

const report = {
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  host: {
    platform: `${process.platform} ${process.arch}`,
    node: process.version,
    note: "Local macOS numbers on a shared dev Mac, not deployed proof.",
  },
  serverActionDispatch: PARALLEL_ACTIONS
    ? "parallel (stress)"
    : "one at a time per client (browser)",
  scenarios: {},
}
mkdirSync(resolve(OUT, ".."), { recursive: true })
for (const [key, fn] of [
  ["a", scenarioA],
  ["b", scenarioB],
  ["c", scenarioC],
]) {
  if (SCENARIOS !== "all" && !SCENARIOS.split(",").includes(key)) continue
  console.error(`scenario ${key} ...`)
  report.scenarios[key] = await fn()
  const { results: _r, serverLogTail: _l, ...brief } = report.scenarios[key]
  void _r
  void _l
  console.error(JSON.stringify(brief, null, 1))
  writeFileSync(OUT, JSON.stringify(report, null, 1))
}
console.log(OUT)
