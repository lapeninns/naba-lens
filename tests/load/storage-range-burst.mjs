// Minimal repro, no Next involved: N simultaneous authenticated Range GETs (whole
// object, as finaliseAsset reads a photo) against the local Storage API, using
// the newest N ready HEIC originals. Reports status and latency per request.
//
//   node tests/load/storage-range-burst.mjs <workdir> [N] [whole|sequence]
import { createClient } from "@supabase/supabase-js"

import { stackEnv } from "./stack-env.mjs"

const [workdir, n = "20", mode = "whole"] = process.argv.slice(2)
const SEQUENCE = mode === "sequence"
const env = stackEnv(workdir)
const svc = createClient(env.url, env.serviceRoleKey, {
  auth: { persistSession: false },
})
const { data: rows, error } = await svc
  .from("media_assets")
  .select("original_path,size_bytes")
  .eq("validated_mime_type", "image/heic")
  .not("size_bytes", "is", null)
  .order("created_at", { ascending: false })
  .limit(Number(n))
if (error) throw error
const headers = {
  apikey: env.serviceRoleKey,
  authorization: `Bearer ${env.serviceRoleKey}`,
}
const t0 = performance.now()
const results = await Promise.all(
  rows.map(async (row) => {
    const start = performance.now()
    try {
      // finaliseAsset's sequence: HEAD (size), a 256 KiB sniff block, then the
      // whole object (lib/server/media/storage.ts mediaRangeSource).
      const url = `${env.url}/storage/v1/object/authenticated/media/${row.original_path}`
      const get = async (range, method = "GET") => {
        const res = await fetch(url, {
          method,
          headers: range ? { ...headers, range } : headers,
          signal: AbortSignal.timeout(30_000),
        })
        return {
          status: res.status,
          bytes: (await res.arrayBuffer()).byteLength,
        }
      }
      if (SEQUENCE) {
        await get(null, "HEAD")
        await get("bytes=0-262143")
      }
      const r = await get(`bytes=0-${row.size_bytes - 1}`)
      return { ...r, ms: Math.round(performance.now() - start) }
    } catch (e) {
      return { status: e.name, ms: Math.round(performance.now() - start) }
    }
  })
)
const ms = results.map((r) => r.ms).sort((a, b) => a - b)
console.log(
  JSON.stringify({
    n: rows.length,
    statuses: results.reduce(
      (a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }),
      {}
    ),
    p50: ms[Math.floor(ms.length / 2)],
    max: ms.at(-1),
    wallMs: Math.round(performance.now() - t0),
  })
)
