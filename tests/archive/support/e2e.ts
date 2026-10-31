import { spawn, type ChildProcess } from "node:child_process"
import {
  mkdirSync,
  readFileSync,
  existsSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createServer, type Server } from "node:http"
import { join, resolve } from "node:path"

const ROOT = process.cwd()

/** Local-only credential for the status route; never a real secret. */
export const E2E_MONITOR_SECRET = "e2e".repeat(14)

export const E2E = {
  sinkPort: Number(process.env.ARCHIVE_E2E_SINK_PORT ?? 3651),
  appPort: Number(process.env.ARCHIVE_E2E_APP_PORT ?? 3644),
  alertsDir:
    process.env.ARCHIVE_E2E_ALERTS_DIR ??
    "/tmp/nabalens-ws/alerts-verification",
  evidenceDir: resolve(ROOT, ".artifacts/archive-verification"),
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type Sink = {
  url: string
  alertsFile: string
  undeliveredFile: string
  stop(): Promise<void>
  alerts(): { receivedAt: string; alert: Record<string, unknown> }[]
  undelivered(): { reason: string; alert: Record<string, unknown> }[]
}

const readJsonl = (file: string) =>
  existsSync(file)
    ? readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : []

/** The real stub sink process, bound to loopback in the verification directory. */
export async function startSink(): Promise<Sink> {
  mkdirSync(E2E.alertsDir, { recursive: true })
  let child: ChildProcess | null = spawn(
    process.execPath,
    [
      "scripts/monitoring/stub-alert-sink.mjs",
      "--port",
      String(E2E.sinkPort),
      "--dir",
      E2E.alertsDir,
    ],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }
  )
  const exited = new Promise<void>((done) => child?.once("exit", () => done()))
  for (let i = 0; ; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${E2E.sinkPort}/health`)
      if (response.ok) break
    } catch {
      // not listening yet
    }
    if (i > 50) throw new Error("stub sink did not start")
    await sleep(100)
  }
  const alertsFile = join(E2E.alertsDir, "alerts.jsonl")
  const undeliveredFile = join(E2E.alertsDir, "undelivered.jsonl")
  return {
    url: `http://127.0.0.1:${E2E.sinkPort}/alerts`,
    alertsFile,
    undeliveredFile,
    alerts: () => readJsonl(alertsFile),
    undelivered: () => readJsonl(undeliveredFile),
    async stop() {
      if (!child) return
      child.kill("SIGTERM")
      await exited
      child = null
    },
  }
}

/** Remove the dedup state and sink files so a scenario starts from nothing. */
export function resetAlertFiles() {
  mkdirSync(E2E.alertsDir, { recursive: true })
  for (const name of [
    "alerts.jsonl",
    "undelivered.jsonl",
    "checker-state.local.json",
  ])
    rmSync(join(E2E.alertsDir, name), { force: true })
}

/**
 * Serve the real status route handler on loopback, translating Node requests
 * into Fetch `Request`s as Next.js would.
 */
export async function serveRoute(
  handler: (request: Request) => Response | Promise<Response>
): Promise<{ origin: string; server: Server; close(): Promise<void> }> {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${E2E.appPort}`)
      if (url.pathname !== "/api/internal/media-archive/status") {
        res.writeHead(404).end()
        return
      }
      const headers = new Headers()
      for (const [key, value] of Object.entries(req.headers))
        if (typeof value === "string") headers.set(key, value)
      const response = await handler(
        new Request(url, { method: req.method, headers })
      )
      const body = Buffer.from(await response.arrayBuffer())
      res.writeHead(response.status, Object.fromEntries(response.headers))
      res.end(body)
    } catch {
      res.writeHead(500).end()
    }
  })
  await new Promise<void>((done, reject) => {
    server.once("error", reject)
    server.listen(E2E.appPort, "127.0.0.1", done)
  })
  return {
    origin: `http://127.0.0.1:${E2E.appPort}`,
    server,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections?.()
        server.close(() => done())
      }),
  }
}

export type CheckerRun = {
  code: number | null
  stdout: string
  stderr: string
}

/** The real checker CLI as a child process; only the monitor secret is in its environment. */
export function runChecker(
  options: {
    origin?: string
    sink?: string
    secret?: string | null
    extraArgs?: string[]
  } = {}
): Promise<CheckerRun> {
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
  } as unknown as NodeJS.ProcessEnv
  if (options.secret !== null)
    env.MEDIA_ARCHIVE_MONITOR_SECRET = options.secret ?? E2E_MONITOR_SECRET
  // Async on purpose: the status route is served by this same process.
  return new Promise((done, reject) => {
    const child = spawn(
      process.execPath,
      [
        "scripts/monitoring/check-archive.mjs",
        "--local",
        "--origin",
        options.origin ?? `http://127.0.0.1:${E2E.appPort}`,
        "--sink",
        options.sink ?? `http://127.0.0.1:${E2E.sinkPort}/alerts`,
        "--alerts-dir",
        E2E.alertsDir,
        ...(options.extraArgs ?? []),
      ],
      { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] }
    )
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => (stdout += chunk))
    child.stderr.on("data", (chunk) => (stderr += chunk))
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000)
    child.once("error", reject)
    child.once("exit", (code) => {
      clearTimeout(timer)
      done({ code, stdout, stderr })
    })
  })
}

/** Evidence under .artifacts/archive-verification/ (gitignored). */
export function writeEvidence(name: string, data: unknown) {
  mkdirSync(E2E.evidenceDir, { recursive: true })
  writeFileSync(
    join(E2E.evidenceDir, `${name}.json`),
    `${JSON.stringify(data, null, 2)}\n`
  )
}
