import { cpSync, readFileSync, writeFileSync } from "node:fs"
import { join, basename, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import net from "node:net"

const PORT_BLOCK_COUNT = 60
const LOCAL_LANE_COUNT = 4
const APP_PORT_OFFSET = 1
const IPV6_UNAVAILABLE = new Set([
  "EAFNOSUPPORT",
  "EADDRNOTAVAIL",
  "EPROTONOSUPPORT",
])

function candidates(lane) {
  const count = lane ? PORT_BLOCK_COUNT / LOCAL_LANE_COUNT : PORT_BLOCK_COUNT
  const start = lane ? (lane - 1) * count : 0
  const first = Math.floor(Math.random() * count)
  return Array.from(
    { length: count },
    (_, index) => 58000 + (start + ((first + index) % count)) * 100
  )
}

function listen(port, host) {
  return new Promise((accept, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(
      { port, host, exclusive: true, ipv6Only: host === "::" },
      () => {
        server.removeListener("error", reject)
        accept(server)
      }
    )
  })
}

function close(servers) {
  return Promise.all(
    servers.map((server) => new Promise((done) => server.close(() => done())))
  )
}

/**
 * Reserve the entire block on Docker's wildcard addresses, not just loopback.
 * Docker Desktop can own *:port while a 127.0.0.1 bind still succeeds on macOS.
 * Keep every socket until the prepared config is written. Docker startup still
 * fails closed if another process claims a port after these sockets close.
 */
export async function reserveAvailablePortBlock(
  offsets,
  { baseCandidates = candidates() } = {}
) {
  const uniqueOffsets = [...new Set(offsets)]
  if (uniqueOffsets.length === 0) throw new Error("No CI stack ports found")

  for (const base of baseCandidates) {
    const ports = uniqueOffsets.map((offset) => base + offset)
    if (
      ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65535)
    ) {
      throw new Error("Invalid CI port block")
    }
    const servers = []
    try {
      for (const port of ports) {
        servers.push(await listen(port, "0.0.0.0"))
        try {
          servers.push(await listen(port, "::"))
        } catch (error) {
          if (!IPV6_UNAVAILABLE.has(error.code)) throw error
        }
      }
      return { base, release: () => close(servers) }
    } catch (error) {
      await close(servers)
      if (error.code !== "EADDRINUSE") throw error
    }
  }
  throw new Error(
    `No unused CI port block is available (checked ${baseCandidates.length} blocks)`
  )
}

export async function prepareStack(work) {
  if (!work) throw new Error("A CI work directory is required")
  cpSync("supabase", join(work, "supabase"), {
    recursive: true,
    filter: (path) => !/[/\\]\.(temp|branches)([/\\]|$)/.test(path),
  })
  const path = join(work, "supabase/config.toml")
  let config = readFileSync(path, "utf8")
  const offsets = [...config.matchAll(/^\s*(?:\w+_)?port = (554\d\d)$/gm)].map(
    (match) => Number(match[1]) - 55400
  )
  const lane = process.env.CI_FIXTURE_LANE
  if (lane && !/^[1-4]$/.test(lane)) throw new Error("Invalid CI fixture lane")
  if (lane) offsets.push(APP_PORT_OFFSET)
  const reservation = await reserveAvailablePortBlock(offsets, {
    baseCandidates: candidates(lane ? Number(lane) : undefined),
  })
  try {
    config = config
      .replace(
        /^project_id = .*$/m,
        `project_id = "${basename(work)
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, "-")}"`
      )
      .replace(
        /^(\s*(?:\w+_)?port = )554(\d\d)$/gm,
        (_, prefix, offset) => `${prefix}${reservation.base + Number(offset)}`
      )
    // Auth links point at the e2e server; only the owned stack's per-IP
    // fixture limits are raised. Invite-only signup remains unchanged.
    const appPort = lane
      ? reservation.base + APP_PORT_OFFSET
      : Number(process.env.E2E_PORT ?? 3457)
    const site = `http://127.0.0.1:${appPort}`
    config = config
      .replace(/^site_url = ".*"$/m, `site_url = "${site}"`)
      .replace(
        /^additional_redirect_urls = .*$/m,
        `additional_redirect_urls = ["${site}/auth/callback", "${site}/auth/confirm"]`
      )
      .replace(/^sign_in_sign_ups = \d+$/m, "sign_in_sign_ups = 300")
      .replace(/^token_verifications = \d+$/m, "token_verifications = 300")
      // The privacy runtime sends real fixture emails after the e2e run.
      .replace(/^email_sent = \d+$/m, "email_sent = 100")
    for (const section of ["studio", "realtime", "analytics", "edge_runtime"]) {
      config = config.replace(
        new RegExp(`(\\[${section}\\]\\s*\\n)enabled = true`),
        "$1enabled = false"
      )
    }
    writeFileSync(path, config)
    writeFileSync(join(work, "e2e-port"), `${appPort}\n`)
  } finally {
    await reservation.release()
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await prepareStack(process.argv[2])
}
