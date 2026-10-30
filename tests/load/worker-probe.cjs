// Preloaded into `next start` (NODE_OPTIONS=--require) by the load runner. It
// wraps worker_threads.Worker to log when each HEIC worker starts and exits, so
// queue wait and decode time can be measured without changing lib/media. The
// log path comes from NABALENS_WORKER_LOG; nothing else is recorded.
const { appendFileSync } = require("node:fs")
const { syncBuiltinESMExports } = require("node:module")
const wt = require("node:worker_threads")

const log = process.env.NABALENS_WORKER_LOG
if (log && wt.isMainThread) {
  const Original = wt.Worker
  wt.Worker = class ProbedWorker extends Original {
    constructor(...args) {
      const start = Date.now()
      super(...args)
      const id = this.threadId
      appendFileSync(log, JSON.stringify({ ev: "spawn", id, t: start }) + "\n")
      this.once("exit", (code) =>
        appendFileSync(
          log,
          JSON.stringify({ ev: "exit", id, t: Date.now(), code }) + "\n"
        )
      )
    }
  }
  syncBuiltinESMExports()
}
