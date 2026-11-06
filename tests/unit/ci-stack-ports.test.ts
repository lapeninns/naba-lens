import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import net from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { reserveAvailablePortBlock } from "../../scripts/ci/prepare-stack.mjs"

async function listen(host = "0.0.0.0", port = 0) {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen({ port, host, ipv6Only: host === "::" }, resolve)
  })
  return server
}

const portOf = (server: net.Server) =>
  (server.address() as net.AddressInfo).port
const close = (server: net.Server) =>
  new Promise<void>((resolve) => server.close(() => resolve()))

async function unusedPort() {
  const server = await listen()
  const port = portOf(server)
  await close(server)
  return port
}

describe("CI stack port blocks", () => {
  it("gives every local browser lane distinct stack and auth app ports", () => {
    const root = mkdtempSync(join(tmpdir(), "nabalens-lanes-"))
    const used = new Set<number>()
    try {
      for (const lane of [1, 2, 3, 4]) {
        const work = join(root, `lane-${lane}`)
        execFileSync(process.execPath, ["scripts/ci/prepare-stack.mjs", work], {
          env: { ...process.env, CI_FIXTURE_LANE: String(lane) },
        })
        const config = readFileSync(join(work, "supabase/config.toml"), "utf8")
        const appPort = Number(readFileSync(join(work, "e2e-port"), "utf8"))
        const stackPorts = [...config.matchAll(/^\s*(?:\w+_)?port = (\d+)$/gm)]
          .map((match) => Number(match[1]))
          .filter((port) => port >= 58000 && port < 64000)
        expect(stackPorts.length).toBeGreaterThan(1)
        expect(config).toContain(`project_id = "lane-${lane}"`)
        expect(config).toContain(`site_url = "http://127.0.0.1:${appPort}"`)
        expect(config).toContain(`"http://127.0.0.1:${appPort}/auth/confirm"`)
        expect(appPort).toBeGreaterThanOrEqual(58000)
        expect(appPort).toBeLessThan(64000)
        for (const port of [appPort, ...new Set(stackPorts)]) {
          expect(used.has(port)).toBe(false)
          used.add(port)
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("skips repeated wildcard conflicts, reserves the whole free block and releases it", async () => {
    const occupied = await listen()
    const another = await listen()
    const free = await unusedPort()
    try {
      const reservation = await reserveAvailablePortBlock([0], {
        baseCandidates: [portOf(occupied), portOf(another), free],
      })
      try {
        expect(reservation.base).toBe(free)
        await expect(listen("0.0.0.0", free)).rejects.toMatchObject({
          code: "EADDRINUSE",
        })
      } finally {
        await reservation.release()
      }
      const availableAgain = await listen("0.0.0.0", free)
      await close(availableAgain)
    } finally {
      await close(occupied)
      await close(another)
    }
  })

  it("releases earlier ports when a later port in a candidate block is busy", async () => {
    const occupied = await listen()
    const busyPort = portOf(occupied)
    const first = await unusedPort()
    const offset = busyPort - first
    try {
      await expect(
        reserveAvailablePortBlock([0, offset], { baseCandidates: [first] })
      ).rejects.toThrow("checked 1 blocks")
      const availableAgain = await listen("0.0.0.0", first)
      await close(availableAgain)
    } finally {
      await close(occupied)
    }
  })

  it("rejects an IPv6-only wildcard conflict even when IPv4 is available", async () => {
    let occupied: net.Server
    try {
      occupied = await listen("::")
    } catch (error) {
      // A host without IPv6 cannot have the corresponding Docker listener.
      expect(["EAFNOSUPPORT", "EADDRNOTAVAIL", "EPROTONOSUPPORT"]).toContain(
        (error as NodeJS.ErrnoException).code
      )
      return
    }
    try {
      const busyPort = portOf(occupied)
      const ipv4 = await listen("0.0.0.0", busyPort)
      await close(ipv4)
      await expect(
        reserveAvailablePortBlock([0], { baseCandidates: [busyPort] })
      ).rejects.toThrow("checked 1 blocks")
    } finally {
      await close(occupied)
    }
  })

  it("fails safely with no candidates or invalid ports", async () => {
    await expect(
      reserveAvailablePortBlock([0], { baseCandidates: [] })
    ).rejects.toThrow("checked 0 blocks")
    await expect(
      reserveAvailablePortBlock([1], { baseCandidates: [65535] })
    ).rejects.toThrow("Invalid CI port block")
    await expect(reserveAvailablePortBlock([])).rejects.toThrow(
      "No CI stack ports found"
    )
  })
})
