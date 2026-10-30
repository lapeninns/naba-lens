// Preloaded into `next start` (NODE_OPTIONS=--require) by the load runner. It
// observes, without changing lib/media or the app:
//  - worker_threads.Worker start/exit (HEIC decodes), to NABALENS_WORKER_LOG;
//  - each outgoing fetch to the Supabase stack: service (storage, rest, auth),
//    method, whether it is a Range read, status and duration, to
//    NABALENS_FETCH_LOG. No URLs beyond the service name, no headers, no bodies.
const { appendFileSync } = require("node:fs")
const { syncBuiltinESMExports } = require("node:module")
const wt = require("node:worker_threads")

const workerLog = process.env.NABALENS_WORKER_LOG
if (workerLog && wt.isMainThread) {
  const Original = wt.Worker
  wt.Worker = class ProbedWorker extends Original {
    constructor(...args) {
      const start = Date.now()
      super(...args)
      const id = this.threadId
      appendFileSync(
        workerLog,
        JSON.stringify({ ev: "spawn", id, t: start }) + "\n"
      )
      this.once("exit", (code) =>
        appendFileSync(
          workerLog,
          JSON.stringify({ ev: "exit", id, t: Date.now(), code }) + "\n"
        )
      )
    }
  }
  syncBuiltinESMExports()
}

const fetchLog = process.env.NABALENS_FETCH_LOG
const stack = process.env.NEXT_PUBLIC_SUPABASE_URL
if (fetchLog && stack && wt.isMainThread) {
  const original = globalThis.fetch
  globalThis.fetch = async function probedFetch(input, init) {
    const url = String(input instanceof Request ? input.url : input)
    if (!url.startsWith(stack)) return original(input, init)
    const service = url.slice(stack.length).split("/")[1] ?? "?"
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    )
    const entry = {
      service,
      method: init?.method ?? (input instanceof Request ? input.method : "GET"),
      range: headers.has("range"),
      t: Date.now(),
    }
    try {
      const res = await original(input, init)
      entry.status = res.status
      return res
    } catch (e) {
      entry.status = e?.name ?? "error"
      throw e
    } finally {
      // Time to response headers; Range bodies are small or bounded.
      entry.ms = Date.now() - entry.t
      appendFileSync(fetchLog, JSON.stringify(entry) + "\n")
    }
  }
}
