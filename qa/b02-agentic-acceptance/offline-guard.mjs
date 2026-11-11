// Offline test guard: imported first by run.test.mjs and budget.test.mjs, and preloaded into every node
// child those tests spawn (NODE_OPTIONS=--import). Any filesystem call on the live spare6 lane
// (/tmp/nabalens-ws or /private/tmp/nabalens-ws) throws ELIVELANE and is recorded, so an offline test
// can never read, create or remove a real lock, receipt, blocker or workdir file.
import fs from "node:fs"
import { syncBuiltinESMExports } from "node:module"

export const LIVE_LANE = /^(?:\/private)?\/tmp\/nabalens-ws(?:\/|$)/
const touches = []
const names = ["accessSync", "existsSync", "lstatSync", "statSync", "readFileSync", "readdirSync", "realpathSync", "openSync", "mkdirSync", "mkdtempSync", "writeFileSync", "appendFileSync", "rmSync", "rmdirSync", "unlinkSync", "renameSync", "copyFileSync", "symlinkSync", "chmodSync", "opendirSync"]
const pathOf = (p) => (typeof p === "string" ? p : p instanceof URL ? p.pathname : Buffer.isBuffer(p) ? p.toString() : null)
for (const name of names) {
  const original = fs[name]
  if (typeof original !== "function") continue
  const guarded = function (...args) {
    for (const arg of args.slice(0, 2)) {
      const p = pathOf(arg)
      if (p !== null && LIVE_LANE.test(p)) {
        touches.push(`${name} ${p}`)
        throw Object.assign(new Error(`offline test touched the live lane: ${name} ${p}`), { code: "ELIVELANE" })
      }
    }
    return original.apply(this, args)
  }
  if (original.native) guarded.native = guarded
  fs[name] = guarded
}
for (const name of ["access", "lstat", "stat", "readFile", "readdir", "open", "mkdir", "writeFile", "rm", "unlink", "rename", "opendir"]) {
  const original = fs.promises[name]
  fs.promises[name] = async function (p, ...rest) {
    const s = pathOf(p)
    if (s !== null && LIVE_LANE.test(s)) {
      touches.push(`promises.${name} ${s}`)
      throw Object.assign(new Error(`offline test touched the live lane: ${name} ${s}`), { code: "ELIVELANE" })
    }
    return original.call(this, p, ...rest)
  }
}
syncBuiltinESMExports()

/** Every live-lane access attempted so far in this process (each was refused). */
export const liveLaneTouches = () => [...touches]
/** Forget the accesses a test made on purpose to prove the guard is armed. */
export const forgetLiveLaneTouches = (count) => touches.splice(touches.length - count, count)
export const GUARD_IMPORT = `--import=${new URL(import.meta.url).href}`
