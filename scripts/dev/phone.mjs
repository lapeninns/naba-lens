import { execFileSync, spawn } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { networkInterfaces, tmpdir } from "node:os"
import { basename, dirname, isAbsolute, join } from "node:path"
import { fileURLToPath } from "node:url"

import { isPrivateIPv4 } from "../../lib/dev/phone-origin.mjs"

const repo = realpathSync(fileURLToPath(new URL("../..", import.meta.url)))
const temp = realpathSync(tmpdir())
const marker = ".nabalens-phone-stack.json"
const require = createRequire(import.meta.url)

// CLI output (including failures) can contain local credentials. Forward only
// the values Next needs, and only in that child's environment.
function capture(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim()
  } catch {
    return null
  }
}

function supabase(dir, ...args) {
  const output = capture("supabase", ["--workdir", dir, ...args])
  if (output === null) {
    throw new Error(
      `Supabase ${args.join(" ")} failed for ${dir}. Check Docker and the owned stack in your private terminal.`
    )
  }
  return output
}

function requireLocalDocker() {
  const context = capture("docker", ["context", "show"])
  const endpoint =
    context &&
    capture("docker", [
      "context",
      "inspect",
      context,
      "--format",
      "{{.Endpoints.docker.Host}}",
    ])
  const override = process.env.DOCKER_HOST
  if (
    !endpoint?.startsWith("unix:///") ||
    (override && override !== endpoint)
  ) {
    throw new Error("Select a local Docker context using a Unix socket.")
  }
  if (capture("docker", ["info", "--format", "{{.ServerVersion}}"]) === null) {
    throw new Error("Start Docker Desktop and wait for the local daemon.")
  }
}

function lanAddress() {
  const interfaces = networkInterfaces()
  // en0 is usually Wi-Fi on macOS. The fallback covers other interface names.
  const names = [
    "en0",
    ...Object.keys(interfaces).filter((name) => name !== "en0"),
  ]
  for (const name of names) {
    if (/^(utun|tun|tap|docker|veth|bridge)/.test(name)) continue
    const address = interfaces[name]?.find(
      ({ address, internal }) => !internal && isPrivateIPv4(address)
    )?.address
    if (address) return address
  }
  throw new Error(
    "Connect the Mac to Wi-Fi with a private IPv4 address and try again."
  )
}

function configFile(dir) {
  return join(dir, "supabase", "config.toml")
}

function validatePorts(base, appPort) {
  if (
    !Number.isInteger(base) ||
    base % 100 ||
    base < 1100 ||
    base > 65400 ||
    base === 55400 ||
    !Number.isInteger(appPort) ||
    appPort < 1024 ||
    appPort > 65535 ||
    (appPort >= base && appPort < base + 100)
  ) {
    throw new Error(
      "Choose an unused 100-port block outside 554xx and an unused app port outside that block."
    )
  }
}

function writeAuthConfig(config, origin, appPort) {
  return config
    .replace(/^site_url = .*$/m, `site_url = "${origin}"`)
    .replace(
      /^additional_redirect_urls = .*$/m,
      `additional_redirect_urls = ["${origin}/auth/callback", "http://127.0.0.1:${appPort}/auth/callback", "http://localhost:${appPort}/auth/callback"]`
    )
}

function createStack(base, appPort) {
  validatePorts(base, appPort)
  const dir = mkdtempSync(join(temp, "nabalens-phone-"))
  cpSync(join(repo, "supabase"), join(dir, "supabase"), {
    recursive: true,
    filter: (path) => !basename(path).startsWith("."),
  })
  let config = readFileSync(configFile(dir), "utf8")
    .replace(
      /^project_id = .*$/m,
      `project_id = "${basename(dir).toLowerCase()}"`
    )
    .replace(
      /^(\s*(?:\w+_)?port = )554(\d\d)$/gm,
      (_, prefix, suffix) => `${prefix}${base + Number(suffix)}`
    )
  for (const service of ["studio", "realtime", "analytics", "edge_runtime"]) {
    config = config.replace(
      new RegExp(`(\\[${service}\\]\\s*\\n)enabled = \\w+`),
      "$1enabled = false"
    )
  }
  if (/= 554\d\d$/m.test(config))
    throw new Error("The copied config has a shared port.")
  writeFileSync(configFile(dir), config)
  writeFileSync(join(dir, marker), JSON.stringify({ repo, base, appPort }), {
    mode: 0o600,
  })
  return dir
}

function ownedStack(input) {
  if (!isAbsolute(input) || !existsSync(input)) {
    throw new Error(
      "Use the absolute temporary workdir printed by dev:phone --setup."
    )
  }
  const dir = realpathSync(input)
  if (
    dirname(dir) !== temp ||
    !/^nabalens-phone-[a-z\d]{6}$/i.test(basename(dir))
  ) {
    throw new Error("Use the temporary workdir printed by dev:phone --setup.")
  }
  if (!existsSync(join(dir, marker)))
    throw new Error("This is not an owned phone stack.")
  const identity = JSON.parse(readFileSync(join(dir, marker), "utf8"))
  const { base, appPort } = identity
  validatePorts(base, appPort)
  const project = basename(dir).toLowerCase()
  const file = configFile(dir)
  if (realpathSync(file) !== file)
    throw new Error("The owned stack config must be inside its workdir.")
  const config = readFileSync(file, "utf8")
  const rootConfig = config.split(/^\[/m, 1)[0]
  const api = /^\[api\]\n([^\[]*)/m.exec(config)?.[1]
  const db = /^\[db\]\n([^\[]*)/m.exec(config)?.[1]
  if (
    identity.repo !== repo ||
    !rootConfig.includes(`\nproject_id = "${project}"\n`) ||
    !api?.includes(`\nport = ${base + 21}\n`) ||
    !db?.includes(`\nport = ${base + 22}\n`) ||
    /^(?:\w+_)?port = 554\d\d$/m.test(config)
  ) {
    throw new Error(
      "The workdir, project ID and database port must match the owned phone stack."
    )
  }
  return { dir, project, file, config, base, appPort }
}

function databaseRunning({ project, base }) {
  const name = `supabase_db_${project}`
  const binding = capture("docker", ["port", name, "5432/tcp"])
  if (binding === null) {
    const running = capture("docker", [
      "inspect",
      "--format",
      "{{.State.Running}}",
      name,
    ])
    if (running === "true")
      throw new Error("The owned database has no local port binding.")
    return false
  }
  if (
    !binding ||
    !binding.split("\n").every((line) => line.endsWith(`:${base + 22}`))
  ) {
    throw new Error("The running database port does not match the owned stack.")
  }
  return true
}

function launch({ dir, config, file, base, appPort, ...identity }) {
  const host = lanAddress()
  const origin = `http://${host}:${appPort}`
  const updated = writeAuthConfig(config, origin, appPort)
  const running = databaseRunning({ ...identity, base })
  if (updated !== config) {
    if (running) supabase(dir, "stop")
    writeFileSync(file, updated)
  }
  if (!running || updated !== config) {
    console.log(
      "Starting the owned Supabase stack (the first start may pull images)."
    )
    supabase(dir, "start")
  }

  const status = JSON.parse(supabase(dir, "status", "-o", "json"))
  const apiPort = base + 21
  if (
    !["127.0.0.1", "localhost"].some(
      (host) => status.API_URL === `http://${host}:${apiPort}`
    )
  ) {
    throw new Error("Supabase did not report the owned local API URL.")
  }
  const publishable = status.PUBLISHABLE_KEY ?? status.ANON_KEY
  const serviceRole = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY
  if (!publishable || !serviceRole)
    throw new Error("Could not load the owned stack's local keys.")

  console.log(
    `\nPhone URL   ${origin}\nFixtures    ${origin}/dev/sign-in\nMailpit     http://127.0.0.1:${base + 24}\nWorkdir     ${dir}\n`
  )
  const child = spawn(
    process.execPath,
    [
      require.resolve("next/dist/bin/next"),
      "dev",
      "--hostname",
      "0.0.0.0",
      "--port",
      String(appPort),
    ],
    {
      cwd: repo,
      stdio: "inherit",
      env: {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: `http://${host}:${apiPort}`,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishable,
        SUPABASE_SERVICE_ROLE_KEY: serviceRole,
        NEXT_PUBLIC_SITE_URL: origin,
        NABALENS_PHONE_HOST: host,
        NEXT_PUBLIC_NABALENS_STAFF_ALBUM_POSTS: "1",
        MEDIA_ARCHIVE_MODE: "disabled",
      },
    }
  )
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal))
  }
  child.on("error", () => {
    console.error(
      "Could not start Next. Run pnpm install --frozen-lockfile in the repo."
    )
    process.exitCode = 1
  })
  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1)
  })
}

try {
  const args = process.argv.slice(2)
  const [command, value, port] = args
  if (command === "--setup" && args.length <= 3) {
    requireLocalDocker()
    const dir = createStack(Number(value ?? 61400), Number(port ?? 3479))
    console.log(`Created owned workdir ${dir}`)
    launch(ownedStack(dir))
  } else if (command === "--reset" && args.length === 2) {
    const stack = ownedStack(value)
    requireLocalDocker()
    if (!databaseRunning(stack))
      throw new Error(
        "Start this owned stack with dev:phone before resetting it."
      )
    supabase(stack.dir, "db", "reset", "--local")
    console.log(`Reset ${stack.project} and re-seeded the local fixtures.`)
  } else if (args.length === 1 && !command.startsWith("-")) {
    const stack = ownedStack(command)
    requireLocalDocker()
    launch(stack)
  } else {
    throw new Error(
      "Use pnpm dev:phone --setup [port-block] [app-port], pnpm dev:phone <workdir>, or pnpm dev:reset <workdir>."
    )
  }
} catch (error) {
  // Do not surface parser input, CLI output or environment values in errors.
  console.error(
    error instanceof SyntaxError
      ? "Could not read owned stack metadata."
      : error.message
  )
  process.exitCode = 1
}
