import net from "node:net"

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
