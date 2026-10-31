import { spawn } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, describe, expect, it } from "vitest"

import { clearFixtureManifest, stackSpec } from "../../scripts/ci/stack.mjs"

const holder = fileURLToPath(
  new URL("./support/hold-stack-lock.mjs", import.meta.url)
)
const temp: string[] = []
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "nabalens-cleanup-"))
  temp.push(dir)
  return dir
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

afterEach(() => {
  for (const dir of temp.splice(0)) {
    const pidFile = join(dir, "sleeper.pid")
    if (existsSync(pidFile)) {
      try {
        process.kill(Number(readFileSync(pidFile, "utf8")), "SIGKILL")
      } catch {
        // Already stopped.
      }
    }
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("stack cleanup", () => {
  it("stops the child process group on SIGTERM before the lock is released", async () => {
    const work = scratch()
    const wsRoot = join(work, "ws")
    const lock = join(wsRoot, "spare9.lock")
    const child = spawn(process.execPath, [holder, work], {
      env: { ...process.env, NABALENS_WS_ROOT: wsRoot },
      stdio: "ignore",
    })
    const exited = new Promise<number | null>((resolve) =>
      child.once("exit", (code) => resolve(code))
    )
    const pidFile = join(work, "sleeper.pid")
    for (let i = 0; i < 200 && !existsSync(pidFile); i++) await sleep(50)
    const sleeper = Number(readFileSync(pidFile, "utf8"))
    expect(alive(sleeper)).toBe(true)
    expect(existsSync(lock)).toBe(true)

    child.kill("SIGTERM")
    expect(await exited).toBe(130)
    // Checked the instant the runner is gone: nothing may still use the stack.
    expect(alive(sleeper)).toBe(false)
    expect(existsSync(lock)).toBe(false)
  }, 30_000)

  it("clears the fixture manifest so a reset never leaves a stale one", () => {
    const work = scratch()
    const spec = { ...stackSpec("spare9"), workdir: work }
    mkdirSync(work, { recursive: true })
    writeFileSync(join(work, "fixtures.json"), "{}")
    clearFixtureManifest(spec)
    expect(existsSync(join(work, "fixtures.json"))).toBe(false)
    expect(() => clearFixtureManifest(spec)).not.toThrow()
  })
})
