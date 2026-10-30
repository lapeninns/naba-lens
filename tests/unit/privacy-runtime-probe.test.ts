import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import net from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

// Final review F11: the CI privacy step must test the server it starts. With
// the port already taken, `next start` would die with EADDRINUSE and the suite
// would run against whatever answered; the step must fail instead, at once.
describe("scripts/ci/privacy-runtime.mjs readiness", () => {
  it("fails before building or starting anything when the port is taken", async () => {
    const squatter = net.createServer()
    await new Promise<void>((resolve) =>
      squatter.listen(0, "127.0.0.1", () => resolve())
    )
    const { port } = squatter.address() as net.AddressInfo
    const work = mkdtempSync(join(tmpdir(), "nl-privacy-probe-"))
    // A stack no build targets: without the port check the script would build.
    writeFileSync(
      join(work, "status.json"),
      JSON.stringify({ API_URL: "http://127.0.0.1:9" })
    )
    try {
      const started = Date.now()
      // spawnSync blocks this thread, so the squatter answers from the OS
      // backlog only; a connect is all the check needs.
      const run = await new Promise<ReturnType<typeof spawnSync>>((resolve) =>
        setImmediate(() =>
          resolve(
            spawnSync(process.execPath, ["scripts/ci/privacy-runtime.mjs", work], {
              encoding: "utf8",
              env: { ...process.env, E2E_PORT: String(port) },
              timeout: 20_000,
            })
          )
        )
      )
      expect(run.status).toBe(1)
      expect(run.stdout).toContain(`port ${port} is already in use`)
      expect(run.stdout).not.toContain("building against the CI stack")
      expect(Date.now() - started).toBeLessThan(15_000)
    } finally {
      squatter.close()
    }
  })
})
