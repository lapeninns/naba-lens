// Child of tests/unit/ci-stack-cleanup.test.ts: holds a stack lock while the
// journey runner's runLogged supervises a long-lived child process group.
// usage: node hold-stack-lock.mjs <work dir>   (NABALENS_WS_ROOT points the lock at a temp dir)
import { join } from "node:path"

import { runLogged } from "../../../scripts/ci/journeys/run.mjs"
import { stackSpec, withLock } from "../../../scripts/ci/stack.mjs"

const work = process.argv[2]
await withLock(stackSpec("spare9"), "cleanup test", 5, async () => {
  await runLogged(
    "sh",
    ["-c", `sleep 300 & echo $! > "${work}/sleeper.pid"; wait`],
    { cwd: work, env: process.env, logFile: join(work, "out.log") }
  )
})
