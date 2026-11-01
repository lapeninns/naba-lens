// Delivery of thumbnails and previews: the /api/media/<id>/thumb and /preview
// routes (authorise, sign, 302), the signed Storage URL they point at, and the video
// stream route, with their cache headers. A small bounded set of real objects is
// uploaded to the spare6 media bucket for PERF assets and removed afterwards.
//
//   source /tmp/nabalens-ws/spare6/env.sh   # app must be running on :3646
//   node --conditions=react-server --import tsx tests/perf/delivery-bench.mjs --volume expected
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { loadavg, tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { createClient } from "@supabase/supabase-js"

import { makeActor, signIn } from "./actors.mjs"
import { gitHead, psql, query, requireSpare6, summarise } from "./lib.mjs"
import { pickTargets } from "./targets.mjs"

const argv = process.argv.slice(2)
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 ? argv[i + 1] : d
}
const VOLUME = arg("volume", "unlabelled")
const ASSETS = Number(arg("assets", 40))
const BASE = "http://127.0.0.1:3646"
const OUT = resolve(arg("out", "docs/perf/raw"), VOLUME)
const env = requireSpare6()
const t = pickTargets(env.dbUrl)
const media = await import(pathToFileURL(resolve("lib/media/index.ts")).href)
const access = await import(pathToFileURL(resolve("lib/server/media/access.ts")).href)

const service = createClient(env.apiUrl, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const bucket = service.storage.from("media")
const uploaded = []
const TMP = join(tmpdir(), "nabalens-perf-delivery")
mkdirSync(TMP, { recursive: true })

try {
  // Derivatives made by the real pipeline from a smooth synthetic image.
  const src = new Uint8Array(readFileSync(resolve("tests/fixtures/media/synthetic-12mp.png")))
  const derived = await media.processImage(src)
  const sizes = { thumbBytes: derived.thumb.byteLength, previewBytes: derived.preview.byteLength }

  const assets = query(
    env.dbUrl,
    `select id, uploader_id, thumbnail_path, preview_path from public.media_assets
     where uploader_id = '${t.staffHeavy.id}' and upload_state = 'ready' and deleted_at is null and thumbnail_path is not null
     order by created_at desc, id desc limit ${ASSETS}`
  ).map(([id, uploader, thumb, preview]) => ({ id, uploader, thumb, preview }))
  for (const a of assets) {
    for (const [path, body] of [[a.thumb, derived.thumb], [a.preview, derived.preview]]) {
      const { error } = await bucket.upload(path, body, { contentType: "image/webp", cacheControl: "60", upsert: true })
      if (error) throw new Error(`upload ${error.message}`)
      uploaded.push(path)
    }
  }

  const adminSession = await signIn(env, t.admin.email)
  const staffSession = await signIn(env, t.staffHeavy.email)

  const get = async (url, cookie, headers = {}) => {
    const t0 = performance.now()
    const res = await fetch(url, { redirect: "manual", headers: { ...(cookie ? { cookie } : {}), ...headers } })
    const ttfb = performance.now() - t0
    const buf = Buffer.from(await res.arrayBuffer())
    return { status: res.status, ttfb, total: performance.now() - t0, bytes: buf.length, headers: res.headers }
  }
  const pick = (h, names) => Object.fromEntries(names.map((n) => [n, h.get(n)]))

  const out = { routes: [], concurrency: [], inProcess: null, stream: null }
  for (const [label, which] of [["thumbnail", "thumb"], ["preview", "preview"]]) {
    for (const [who, session] of [["admin", adminSession], ["staff (owner)", staffSession]]) {
      const route = [], storage = []
      let sample
      for (let round = 0; round < 4; round++) {
        for (const a of assets) {
          const r = await get(`${BASE}/api/media/${a.id}/${which}`, session.cookie)
          if (round > 0) route.push(r.ttfb)
          if (r.status !== 302) throw new Error(`${which} ${who} answered ${r.status}`)
          const loc = r.headers.get("location")
          const s = await get(loc)
          if (round > 0) storage.push(s.total)
          sample ??= { route: pick(r.headers, ["cache-control", "x-content-type-options", "referrer-policy"]), storage: { status: s.status, bytes: s.bytes, ...pick(s.headers, ["cache-control", "content-type", "etag", "last-modified", "accept-ranges", "content-length"]) }, location: loc.replace(/token=[^&]+/, "token=<redacted>").replace(/^https?:\/\/[^/]+/, "") }
        }
      }
      out.routes.push({ name: `${label} route, ${who}`, objects: assets.length, routeMs: summarise(route), signedStorageMs: summarise(storage), headers: sample })
      console.error(`${label} ${who}: route p50 ${summarise(route).p50} p95 ${summarise(route).p95} ms; storage GET p50 ${summarise(storage).p50} ms`)
    }
  }

  // One gallery page: 24 thumbnails, 6 connections, redirect followed (as a browser does).
  for (const [who, session] of [["admin", adminSession], ["staff (owner)", staffSession]]) {
    const walls = []
    for (let rep = 0; rep < 10; rep++) {
      const queue = assets.slice(0, 24)
      const t0 = performance.now()
      await Promise.all(
        Array.from({ length: 6 }, async () => {
          for (let a = queue.shift(); a; a = queue.shift()) {
            const r = await get(`${BASE}/api/media/${a.id}/thumb`, session.cookie)
            await get(r.headers.get("location"))
          }
        })
      )
      walls.push(performance.now() - t0)
    }
    out.concurrency.push({ name: `24 thumbnails of one gallery page, 6 parallel, ${who}`, wallMs: summarise(walls.slice(1)) })
    console.error(`24 thumbs ${who}: p50 ${summarise(walls.slice(1)).p50} ms`)
  }

  // Decomposition of one authorisation: the RLS asset read and the sign call.
  {
    const { actor, log } = makeActor(env, adminSession, t.admin)
    const read = [], sign = [], total = []
    for (let i = 0; i < 25; i++) {
      const a = assets[i % assets.length]
      log.reset()
      const t0 = performance.now()
      const r = await access.signDerivative(actor, a.id, "thumbnail")
      const wall = performance.now() - t0
      if (!r.ok) throw new Error("signDerivative failed")
      if (i >= 3) {
        total.push(wall)
        read.push(log.entries.find((e) => e.path.startsWith("media_assets"))?.ms)
        sign.push(log.entries.find((e) => e.path.includes("object/sign"))?.ms)
      }
    }
    out.inProcess = { signDerivativeMs: summarise(total), assetReadMs: summarise(read.filter(Boolean)), signCallMs: summarise(sign.filter(Boolean)) }
  }

  // Video stream: Range reads of a 20 MiB original through /stream.
  {
    const [vid] = query(
      env.dbUrl,
      `select id, original_path from public.media_assets where uploader_id = '${t.staffHeavy.id}' and media_type = 'video' and upload_state = 'ready' and deleted_at is null limit 1`
    )
    if (vid) {
      const clip = join(TMP, "clip.mp4")
      if (!existsSync(clip)) execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=30:d=8,noise=alls=30:allf=t", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-b:v", "20M", "-maxrate", "20M", "-bufsize", "20M", clip, "-loglevel", "error"])
      const body = readFileSync(clip)
      // The storage write guard only accepts an original while the reservation is
      // `uploading`, so reopen it for the upload and close it again.
      const setState = (state) => psql(env.dbUrl, ["-c", `begin; set local session_replication_role = replica; update public.media_assets set upload_state = '${state}' where id = '${vid[0]}'; commit;`])
      setState("uploading")
      const { error } = await bucket.upload(vid[1], body, { contentType: "video/mp4", upsert: true })
      setState("ready")
      if (error) throw new Error(error.message)
      uploaded.push(vid[1])
      const ranges = [["bytes=0-1048575", "first 1 MiB"], ["bytes=10485760-11534335", "seek to 10 MiB"], ["bytes=0-", "open-ended from 0 (first byte only counted)"]]
      out.stream = { bytes: body.length, ranges: [] }
      for (const [range, label] of ranges) {
        const ttfb = [], total = []
        let sample
        for (let i = 0; i < 13; i++) {
          const t0 = performance.now()
          const res = await fetch(`${BASE}/api/media/${vid[0]}/stream`, { headers: { cookie: adminSession.cookie, range } })
          const first = performance.now() - t0
          const reader = res.body.getReader()
          let got = 0
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            got += value.length
            if (range === "bytes=0-" && got >= 1024 * 1024) { await reader.cancel(); break }
          }
          if (i >= 3) { ttfb.push(first); total.push(performance.now() - t0) }
          sample ??= { status: res.status, ...pick(res.headers, ["cache-control", "content-type", "content-range", "accept-ranges", "content-length", "etag"]) }
        }
        out.stream.ranges.push({ label, range, ttfbMs: summarise(ttfb), completeMs: summarise(total), response: sample })
        console.error(`stream ${label}: ttfb p50 ${summarise(ttfb).p50} ms`)
      }
    }
  }

  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, "delivery.json"), JSON.stringify({ volume: VOLUME, at: new Date().toISOString(), revision: gitHead(), loadAverage: loadavg(), derivative: sizes, ...out }, null, 2))
  console.error(`wrote ${join(OUT, "delivery.json")}`)
} finally {
  if (uploaded.length) await bucket.remove(uploaded)
  rmSync(TMP, { recursive: true, force: true })
}
