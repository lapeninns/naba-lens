import { spawnSync } from "node:child_process"

const [target] = process.argv.slice(2)
if (
  process.argv.length !== 3 ||
  !/^http:\/\/127\.0\.0\.1:[1-9]\d{3,4}$/.test(target ?? "")
) {
  throw Error(
    "Use the isolated CI Next.js loopback origin: pnpm scan:dast http://127.0.0.1:<port>"
  )
}
const loopback = new URL(target)
// Docker Desktop's Linux VM has a separate localhost. Its fixed host alias
// reaches the Mac's loopback listener without publishing the fixture port.
const desktop = process.platform === "darwin"
if (desktop) loopback.hostname = "host.docker.internal"
// Baseline is passive only. Supplying no credentials, active scan options,
// external target, AJAX spider or arbitrary command flags is intentional.
const run = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "--network",
    desktop ? "bridge" : "host",
    "ghcr.io/zaproxy/zaproxy:2.17.0",
    "zap-baseline.py",
    "-t",
    loopback.origin,
    "-m",
    "1",
    "-T",
    "3",
    "-I",
  ],
  { stdio: "inherit", timeout: 235_000 }
)
if (run.error) throw run.error
process.exitCode = run.status ?? 1
