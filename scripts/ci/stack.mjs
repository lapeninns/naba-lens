#!/usr/bin/env node
// Named, isolated local Supabase stacks for the tech-debt workstreams
// (docs/workstreams/contracts.md section 1). Local Docker only: every stack
// has its own port block, project id and workdir under /tmp/nabalens-ws/, and
// no command ever touches a container this tool did not start.
//
//   node scripts/ci/stack.mjs up <name> [--from <worktree>]
//   node scripts/ci/stack.mjs down <name>
//   node scripts/ci/stack.mjs reset <name> [--from <worktree>] [--no-fixtures]
//   node scripts/ci/stack.mjs status [<name>] [--json]
//   node scripts/ci/stack.mjs env <name> [--format sh|dotenv|json] [--write [file]]
//
// Run it by absolute path from any worktree; `--from` defaults to the git
// worktree of the current directory and supplies supabase/ (migrations, seed,
// config) and the fixture sources.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// NABALENS_WS_ROOT moves stack workdirs and locks (unit tests only; Docker
// project names and ports do not change).
const ROOT = process.env.NABALENS_WS_ROOT ?? "/tmp/nabalens-ws"
const SELF_DIR = dirname(fileURLToPath(import.meta.url))
const MAX_RUNNING = 3

/** `ws1`/`ws2`/`gate` plus `spare4`..`spare9` on blocks 644..649. */
export function stackSpec(name) {
  const fixed = { ws1: 641, ws2: 642, gate: 643 }
  const spare = /^spare([4-9])$/.exec(name)
  const block = fixed[name] ?? (spare ? 640 + Number(spare[1]) : null)
  if (!block) {
    throw new Error(
      `Unknown stack "${name}". Use ws1, ws2, gate or spare4..spare9.`
    )
  }
  return {
    name,
    block,
    project: `nabalens-ws-${name}`,
    workdir: join(ROOT, name),
    apiPort: block * 100 + 21,
    dbPort: block * 100 + 22,
    mailpitPort: block * 100 + 24,
    appPort: block + 3000,
  }
}

function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith("--")) {
      positional.push(arg)
      continue
    }
    const [key, inline] = arg.slice(2).split("=", 2)
    if (inline !== undefined) flags[key] = inline
    else if (argv[i + 1] && !argv[i + 1].startsWith("--"))
      flags[key] = argv[++i]
    else flags[key] = true
  }
  return { positional, flags }
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", ...opts })
}

function git(cwd, ...args) {
  const r = run("git", ["-C", cwd, ...args])
  return r.status === 0 ? r.stdout.trim() : null
}

function worktreeOf(dir) {
  const top = git(resolve(dir), "rev-parse", "--show-toplevel")
  if (!top) throw new Error(`${resolve(dir)} is not inside a git worktree.`)
  return top
}

function containerNames(spec) {
  const r = run("docker", [
    "ps",
    "--filter",
    `name=_${spec.project}$`,
    "--format",
    "{{.Names}}",
  ])
  if (r.status !== 0) {
    throw new Error(`docker is unavailable: ${(r.stderr || "").trim()}`)
  }
  return r.stdout.split("\n").filter(Boolean)
}

function isRunning(spec) {
  return containerNames(spec).includes(`supabase_db_${spec.project}`)
}

function runningWorkstreamStacks() {
  const r = run("docker", [
    "ps",
    "--filter",
    "name=^supabase_db_nabalens-ws-",
    "--format",
    "{{.Names}}",
  ])
  return r.status === 0
    ? r.stdout
        .split("\n")
        .filter(Boolean)
        .map((n) => n.replace("supabase_db_nabalens-ws-", ""))
    : []
}

// -- lock -------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === "EPERM"
  }
}

// -- termination ------------------------------------------------------------

const exitHooks = new Set()
let terminating = false

async function terminate() {
  // A second signal means the operator will not wait for the cleanup.
  if (terminating) process.exit(130)
  terminating = true
  for (const hook of [...exitHooks].reverse()) {
    try {
      await hook()
    } catch {
      // Cleanup is best effort; keep going so the lock is still released.
    }
  }
  process.exit(130)
}

/**
 * Runs `hook` (it may be async) on SIGINT or SIGTERM, newest first, then exits
 * 130. Returns a function that removes the hook.
 */
export function onTerminate(hook) {
  if (exitHooks.size === 0) {
    process.on("SIGINT", terminate)
    process.on("SIGTERM", terminate)
  }
  exitHooks.add(hook)
  return () => {
    exitHooks.delete(hook)
    if (exitHooks.size === 0) {
      process.off("SIGINT", terminate)
      process.off("SIGTERM", terminate)
    }
  }
}

const groupAlive = (pid) => {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    return error.code === "EPERM"
  }
}

/** Stops the process group a detached child leads and resolves once no member is left. */
export async function terminateGroup(pid, graceMs = 5000) {
  for (const [signal, waitMs] of [
    ["SIGTERM", graceMs],
    ["SIGKILL", 5000],
  ]) {
    try {
      process.kill(-pid, signal)
    } catch {
      return
    }
    const deadline = Date.now() + waitMs
    while (groupAlive(pid) && Date.now() < deadline) await sleep(50)
    if (!groupAlive(pid)) return
  }
}

/** `onWait(owner)` is called once when another command already holds the lock. */
export async function withLock(spec, what, timeoutSeconds, fn, onWait) {
  mkdirSync(ROOT, { recursive: true })
  const dir = join(ROOT, `${spec.name}.lock`)
  const deadline = Date.now() + timeoutSeconds * 1000
  let waiting = false
  for (;;) {
    try {
      mkdirSync(dir)
      break
    } catch (error) {
      if (error.code !== "EEXIST") throw error
      let owner = null
      try {
        owner = JSON.parse(readFileSync(join(dir, "owner.json"), "utf8"))
      } catch {
        // The owner file may not exist yet; treat as live until it ages out.
      }
      if (owner && !pidAlive(owner.pid)) {
        rmSync(dir, { recursive: true, force: true })
        continue
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Stack ${spec.name} is locked by ${owner ? `${owner.what} (pid ${owner.pid}, since ${owner.since})` : "another command"}. ` +
            `Wait for it or raise --lock-timeout.`
        )
      }
      if (!waiting) {
        waiting = true
        onWait?.(owner)
      }
      await sleep(1000)
    }
  }
  writeFileSync(
    join(dir, "owner.json"),
    JSON.stringify({ pid: process.pid, what, since: new Date().toISOString() })
  )
  const release = () => rmSync(dir, { recursive: true, force: true })
  // Registered before anything `fn` starts, so it runs last: children are
  // stopped first, then the lock is released.
  const unhook = onTerminate(release)
  try {
    return await fn()
  } finally {
    unhook()
    release()
  }
}

// -- workdir ----------------------------------------------------------------

const section = (text, name, key, value) =>
  text.replace(
    new RegExp(`(^\\[${name}\\]\\n(?:[^\\[].*\\n)*?)${key} = true`, "m"),
    `$1${key} = ${value}`
  )

function syncInPlace(src, dst) {
  mkdirSync(dst, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.name === ".temp" || entry.name === ".branches") continue
    const from = join(src, entry.name)
    const to = join(dst, entry.name)
    if (entry.isDirectory()) syncInPlace(from, to)
    else writeFileSync(to, readFileSync(from))
  }
}

/** Copies `<from>/supabase` into the workdir and remaps it onto the stack's block. */
export function prepareWorkdir(spec, from) {
  const source = join(from, "supabase")
  if (!existsSync(join(source, "config.toml"))) {
    throw new Error(`${source}/config.toml not found.`)
  }
  const target = join(spec.workdir, "supabase")
  mkdirSync(spec.workdir, { recursive: true })
  // Only the migrations and seed trees are rebuilt: the stack's containers
  // bind-mount single files (the email templates) by inode, and replacing those
  // files leaves Kong serving deleted ones (the templates then 404).
  for (const dir of ["migrations", "seed"]) {
    rmSync(join(target, dir), { recursive: true, force: true })
  }
  syncInPlace(source, target)
  const site = `http://127.0.0.1:${spec.appPort}`
  let config = readFileSync(join(target, "config.toml"), "utf8")
    .replace(/^project_id = ".*"$/m, `project_id = "${spec.project}"`)
    .replace(
      /^(\s*(?:\w+_)?port = )554(\d\d)$/gm,
      (_, prefix, offset) => `${prefix}${spec.block}${offset}`
    )
    .replace(/^site_url = ".*"$/m, `site_url = "${site}"`)
    .replace(
      /^additional_redirect_urls = .*$/m,
      `additional_redirect_urls = ["${site}/auth/callback", "${site}/auth/confirm"]`
    )
    // Every browser context shares one client IP and journeys sign in far more
    // often than a person would: only this throwaway stack's limits move.
    .replace(/^sign_in_sign_ups = \d+$/m, "sign_in_sign_ups = 300")
    .replace(/^token_verifications = \d+$/m, "token_verifications = 300")
    .replace(/^email_sent = \d+$/m, "email_sent = 100")
  for (const name of ["realtime", "studio", "analytics", "edge_runtime"]) {
    config = section(config, name, "enabled", "false")
  }
  if (/= 554\d\d$/m.test(config)) {
    throw new Error("A 554xx port was left in the isolated config.")
  }
  for (const name of ["realtime", "studio"]) {
    if (!new RegExp(`^\\[${name}\\]\\nenabled = false`, "m").test(config)) {
      throw new Error(`Could not disable [${name}].`)
    }
  }
  writeFileSync(join(target, "config.toml"), config)
  return join(target, "migrations")
}

function migrationFiles(dir) {
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => /^\d+_.+\.sql$/.test(f))
        .sort()
    : []
}

export function migrationsDigest(dir) {
  const hash = createHash("sha256")
  for (const file of migrationFiles(dir)) {
    hash.update(file + "\0")
    hash.update(
      createHash("sha256")
        .update(readFileSync(join(dir, file)))
        .digest()
    )
  }
  return hash.digest("hex")
}

function supabase(spec, args, logFile) {
  const fd = logFile ? openSync(logFile, "a") : null
  try {
    return run("supabase", ["--workdir", spec.workdir, ...args], {
      stdio: fd === null ? ["ignore", "pipe", "pipe"] : ["ignore", fd, fd],
      env: { ...process.env, SUPABASE_INTERNAL_NO_UPDATE_CHECK: "1" },
    })
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

function logPath(spec, label) {
  const dir = join(spec.workdir, "logs")
  mkdirSync(dir, { recursive: true })
  return join(
    dir,
    `${label}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`
  )
}

function tail(file, lines = 25) {
  try {
    return readFileSync(file, "utf8").split("\n").slice(-lines).join("\n")
  } catch {
    return ""
  }
}

function runSupabase(spec, args, label) {
  const log = logPath(spec, label)
  const r = supabase(spec, args, log)
  if (r.status !== 0) {
    throw new Error(
      `supabase ${args.join(" ")} failed for ${spec.name} (log: ${log})\n${tail(log)}`
    )
  }
  return log
}

/** Writes the stack's connection details (with keys) to <workdir>/status.json, mode 600. */
function writeStatusFile(spec) {
  const r = supabase(spec, ["status", "-o", "json"])
  if (r.status !== 0) {
    throw new Error(
      `supabase status failed for ${spec.name}: ${r.stderr.trim()}`
    )
  }
  const raw = r.stdout
  const status = JSON.parse(
    raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)
  )
  if (new URL(status.API_URL).port !== String(spec.apiPort)) {
    throw new Error(
      `Stack ${spec.name} reports API ${status.API_URL}, expected port ${spec.apiPort}.`
    )
  }
  const file = join(spec.workdir, "status.json")
  writeFileSync(file, JSON.stringify(status, null, 2) + "\n", { mode: 0o600 })
  chmodSync(file, 0o600)
  return status
}

function readStatusFile(spec) {
  const file = join(spec.workdir, "status.json")
  if (!existsSync(file)) {
    throw new Error(
      `Stack ${spec.name} has no status file: it is stopped. Ask Harness to run \`up ${spec.name}\`.`
    )
  }
  return JSON.parse(readFileSync(file, "utf8"))
}

function dbQuery(spec, sql) {
  const r = run("docker", [
    "exec",
    `supabase_db_${spec.project}`,
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-Atc",
    sql,
  ])
  return r.status === 0 ? r.stdout.trim() : null
}

function appliedMigrations(spec) {
  const out = dbQuery(
    spec,
    "select version from supabase_migrations.schema_migrations order by version"
  )
  return out === null ? null : out.split("\n").filter(Boolean)
}

function revisionRecord(spec) {
  try {
    return JSON.parse(readFileSync(join(spec.workdir, "revision.json"), "utf8"))
  } catch {
    return null
  }
}

// -- fixtures ---------------------------------------------------------------

function loadFixtures(spec, from) {
  const script = join(SELF_DIR, "fixtures.ts")
  if (!existsSync(script)) return null
  const status = readStatusFile(spec)
  const r = run(
    "pnpm",
    ["exec", "tsx", script, "--stack", spec.name, "--fixtures-root", from],
    {
      cwd: join(SELF_DIR, "../.."),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
          status.PUBLISHABLE_KEY ?? status.ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY ?? status.SECRET_KEY,
        SUPABASE_DB_CONTAINER: `supabase_db_${spec.project}`,
        NABALENS_STACK: spec.name,
      },
    }
  )
  if (r.status !== 0) {
    throw new Error(
      `Fixture load failed for ${spec.name}:\n${(r.stdout + r.stderr).trim().split("\n").slice(-25).join("\n")}`
    )
  }
  return r.stdout.trim().split("\n").slice(-1)[0]
}

// -- commands ---------------------------------------------------------------

function fromDir(flags) {
  return worktreeOf(typeof flags.from === "string" ? flags.from : process.cwd())
}

/** The manifest of the world a reset loaded; stale as soon as the next reset begins. */
export function clearFixtureManifest(spec) {
  rmSync(join(spec.workdir, "fixtures.json"), { force: true })
}

async function applyReset(spec, from, flags) {
  clearFixtureManifest(spec)
  const migrations = prepareWorkdir(spec, from)
  runSupabase(spec, ["db", "reset", "--local"], "reset")
  writeStatusFile(spec)
  let fixtures = null
  if (!flags["no-fixtures"]) fixtures = loadFixtures(spec, from)
  const record = {
    from,
    commit: git(from, "rev-parse", "HEAD"),
    branch: git(from, "rev-parse", "--abbrev-ref", "HEAD"),
    dirty: (git(from, "status", "--porcelain") ?? "").length > 0,
    migrationsDigest: migrationsDigest(migrations),
    migrationFiles: migrationFiles(migrations),
    fixtures: fixtures ?? "none",
    resetAt: new Date().toISOString(),
  }
  writeFileSync(
    join(spec.workdir, "revision.json"),
    JSON.stringify(record, null, 2) + "\n"
  )
  return record
}

async function cmdUp(spec, flags) {
  const from = fromDir(flags)
  await withLock(spec, "up", Number(flags["lock-timeout"] ?? 300), async () => {
    if (isRunning(spec)) {
      if (!existsSync(join(spec.workdir, "status.json"))) writeStatusFile(spec)
      console.log(`${spec.name}: already running`)
      return
    }
    const others = runningWorkstreamStacks().filter((n) => n !== spec.name)
    if (others.length >= MAX_RUNNING) {
      throw new Error(
        `${others.length} workstream stacks already run (${others.join(", ")}); the limit is ${MAX_RUNNING}.`
      )
    }
    prepareWorkdir(spec, from)
    runSupabase(spec, ["start"], "start")
    writeStatusFile(spec)
    await applyReset(spec, from, flags)
    console.log(`${spec.name}: started and reset from ${from}`)
  })
  cmdStatus([spec.name], {})
}

async function cmdDown(spec, flags) {
  await withLock(
    spec,
    "down",
    Number(flags["lock-timeout"] ?? 300),
    async () => {
      if (isRunning(spec)) {
        runSupabase(spec, ["stop", "--no-backup"], "stop")
      }
      rmSync(join(spec.workdir, "status.json"), { force: true })
      rmSync(join(spec.workdir, "env.sh"), { force: true })
      rmSync(join(spec.workdir, "revision.json"), { force: true })
      console.log(`${spec.name}: stopped`)
    }
  )
}

async function cmdReset(spec, flags) {
  const from = fromDir(flags)
  await withLock(
    spec,
    `reset from ${from}`,
    Number(flags["lock-timeout"] ?? 600),
    async () => {
      if (!isRunning(spec)) {
        throw new Error(
          `Stack ${spec.name} is stopped. Ask Harness to run \`up ${spec.name}\`.`
        )
      }
      const record = await applyReset(spec, from, flags)
      console.log(
        `${spec.name}: reset from ${from} (${record.commit?.slice(0, 7)}${record.dirty ? " dirty" : ""}), ${record.migrationFiles.length} migrations, fixtures: ${record.fixtures}`
      )
    }
  )
}

export function statusOf(spec) {
  const running = isRunning(spec)
  const applied = running ? appliedMigrations(spec) : null
  const revision = running ? revisionRecord(spec) : null
  return {
    name: spec.name,
    state: running ? "running" : "stopped",
    project: spec.project,
    workdir: spec.workdir,
    ports: {
      api: spec.apiPort,
      db: spec.dbPort,
      mailpit: spec.mailpitPort,
      app: spec.appPort,
    },
    migrations: applied
      ? {
          applied: applied.length,
          latest: applied.at(-1) ?? null,
          matchesRecordedFiles: revision
            ? JSON.stringify(applied) ===
              JSON.stringify(
                revision.migrationFiles.map((f) => f.split("_")[0])
              )
            : null,
        }
      : null,
    lastReset: revision
      ? {
          from: revision.from,
          commit: revision.commit,
          branch: revision.branch,
          dirty: revision.dirty,
          migrationsDigest: revision.migrationsDigest,
          fixtures: revision.fixtures,
          at: revision.resetAt,
        }
      : null,
  }
}

function cmdStatus(names, flags) {
  const specs = (names.length ? names : ["ws1", "ws2", "gate"]).map(stackSpec)
  const all = specs.map(statusOf)
  if (flags.json) {
    console.log(JSON.stringify(names.length === 1 ? all[0] : all, null, 2))
    return
  }
  for (const s of all) {
    console.log(`${s.name}: ${s.state}`)
    console.log(
      `  ports: api ${s.ports.api}, db ${s.ports.db}, mailpit ${s.ports.mailpit}, app ${s.ports.app}`
    )
    if (s.migrations) {
      console.log(
        `  migrations: ${s.migrations.applied} applied, latest ${s.migrations.latest}, matches last reset: ${s.migrations.matchesRecordedFiles}`
      )
    }
    if (s.lastReset) {
      console.log(
        `  last reset: ${s.lastReset.branch}@${s.lastReset.commit?.slice(0, 7)}${s.lastReset.dirty ? " (dirty)" : ""} from ${s.lastReset.from}`
      )
      console.log(
        `  migrations digest: ${s.lastReset.migrationsDigest.slice(0, 16)}, fixtures: ${s.lastReset.fixtures}, at ${s.lastReset.at}`
      )
    }
  }
}

export function stackEnv(spec) {
  const status = readStatusFile(spec)
  return {
    NABALENS_STACK: spec.name,
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      status.PUBLISHABLE_KEY ?? status.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY ?? status.SECRET_KEY,
    SUPABASE_DB_URL: status.DB_URL,
    E2E_DB_URL: status.DB_URL,
    SUPABASE_JWT_SECRET: status.JWT_SECRET,
    MAILPIT_URL: status.MAILPIT_URL ?? status.INBUCKET_URL,
    E2E_SUPABASE_WORKDIR: spec.workdir,
    E2E_PORT: String(spec.appPort),
    VISUAL_PORT: String(spec.appPort),
    NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${spec.appPort}`,
  }
}

function cmdEnv(spec, flags) {
  const env = stackEnv(spec)
  const format = flags.format ?? "sh"
  const quote = (v) => `'${String(v).replace(/'/g, "'\\''")}'`
  const text =
    format === "json"
      ? JSON.stringify(env, null, 2) + "\n"
      : format === "dotenv"
        ? Object.entries(env)
            .map(([k, v]) => `${k}=${v}`)
            .join("\n") + "\n"
        : Object.entries(env)
            .map(([k, v]) => `export ${k}=${quote(v)}`)
            .join("\n") + "\n"
  if (flags.write) {
    const file = resolve(
      typeof flags.write === "string"
        ? flags.write
        : join(spec.workdir, format === "json" ? "env.json" : "env.sh")
    )
    writeFileSync(file, text, { mode: 0o600 })
    chmodSync(file, 0o600)
    console.log(file)
  } else {
    process.stdout.write(text)
  }
}

const USAGE = `usage: stack.mjs <up|down|reset|status|env> <name> [options]
names: ws1 ws2 gate spare4..spare9
  up      <name> [--from <worktree>]            Harness only
  down    <name>                                Harness only
  reset   <name> [--from <worktree>] [--no-fixtures] [--lock-timeout <s>]
  status  [<name>] [--json]
  env     <name> [--format sh|dotenv|json] [--write [file]]`

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2))
  const [command, name] = positional
  if (!command || flags.help) {
    console.log(USAGE)
    process.exit(command ? 0 : 2)
  }
  if (command === "status") return cmdStatus(name ? [name] : [], flags)
  if (!name) throw new Error(`${command} needs a stack name.\n${USAGE}`)
  const spec = stackSpec(name)
  if (command === "up") return cmdUp(spec, flags)
  if (command === "down") return cmdDown(spec, flags)
  if (command === "reset") return cmdReset(spec, flags)
  if (command === "env") return cmdEnv(spec, flags)
  throw new Error(`Unknown command ${command}.\n${USAGE}`)
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`stack: ${error.message}`)
    process.exit(1)
  })
}
