// Journey runner core: runs the selected journeys against a named workstream
// stack and writes <results-dir>/journeys/<id>.json, summary.json and summary.md.
// A journey that cannot run is `unavailable` with a reason, never a pass.
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { basename, dirname, join, resolve } from "node:path"

import { createServer } from "node:net"

import {
  migrationsDigest,
  onTerminate,
  stackEnv,
  stackSpec,
  statusOf,
  terminateGroup,
  withLock,
} from "../stack.mjs"
import { runAgentic } from "./agentic.mjs"
import { outcomeFromReport } from "./outcome.mjs"
import {
  SECRET_PATTERNS,
  SUMMARY_SCHEMA,
  RESULT_SCHEMA,
  validateRunDir,
} from "./validate.mjs"

const require = createRequire(import.meta.url)

const git = (root, ...args) => {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" })
  return r.status === 0 ? r.stdout.trim() : null
}

export function revisionOf(root) {
  return {
    commit: git(root, "rev-parse", "HEAD") ?? "0".repeat(40),
    branch: git(root, "rev-parse", "--abbrev-ref", "HEAD") ?? "unknown",
    dirty: (git(root, "status", "--porcelain") ?? "").length > 0,
  }
}

function treeFingerprint(root) {
  const hash = createHash("sha256")
  hash.update(git(root, "rev-parse", "HEAD") ?? "")
  hash.update(git(root, "diff", "HEAD") ?? "")
  for (const file of (git(root, "ls-files", "-o", "--exclude-standard") ?? "")
    .split("\n")
    .filter(Boolean)) {
    hash.update(file)
    try {
      hash.update(readFileSync(join(root, file)))
    } catch {
      // A file that vanished mid-scan does not change the build.
    }
  }
  return hash.digest("hex")
}

export function scrub(text, extraSecrets = []) {
  let out = String(text)
  for (const secret of extraSecrets)
    if (secret) out = out.split(secret).join("[redacted]")
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(
      new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`),
      "[redacted]"
    )
  }
  return out
}

function playwrightVersion() {
  try {
    return require("@playwright/test/package.json").version
  } catch {
    return "unknown"
  }
}

function browserProblem(projects) {
  const { chromium, firefox, webkit } = require("@playwright/test")
  const engines = { chromium, firefox, webkit, "mobile-chromium": chromium }
  for (const project of projects) {
    let path = ""
    try {
      path = engines[project].executablePath()
    } catch (error) {
      return `${project} browser is unavailable: ${String(error.message).split("\n")[0]}`
    }
    if (!path || !existsSync(path)) {
      const engine = project === "mobile-chromium" ? "chromium" : project
      return `${engine} browser is not installed (run: pnpm exec playwright install ${engine})`
    }
  }
  return null
}

function portFree(port) {
  return new Promise((resolvePort) => {
    const server = createServer()
    server.once("error", () => resolvePort(false))
    server.listen(port, "127.0.0.1", () =>
      server.close(() => resolvePort(true))
    )
  })
}

function toolMissing(tool) {
  return spawnSync(tool, ["--version"], { stdio: "ignore" }).status === null
}

/** Reasons the whole run cannot start; each selected journey becomes unavailable with it. */
function stackProblem(root, spec, flags) {
  let status
  try {
    status = statusOf(spec)
  } catch (error) {
    return {
      reason: `cannot inspect stack ${spec.name}: ${error.message}`,
      migrations: "unknown",
    }
  }
  const latest = status.migrations?.latest ?? "unknown"
  const digest = status.lastReset?.migrationsDigest?.slice(0, 8)
  const migrations = digest ? `${latest}:${digest}` : latest
  if (status.state !== "running") {
    return {
      reason: `stack ${spec.name} is stopped (Harness starts it with: node scripts/ci/stack.mjs up ${spec.name})`,
      migrations,
    }
  }
  if (!existsSync(join(spec.workdir, "fixtures.json"))) {
    return {
      reason: `stack ${spec.name} has no fixture world loaded (reset it: node scripts/ci/stack.mjs reset ${spec.name} --from <worktree>)`,
      migrations,
    }
  }
  const mine = migrationsDigest(join(root, "supabase/migrations"))
  if (
    !flags.ignoreMigrationDrift &&
    status.lastReset &&
    status.lastReset.migrationsDigest !== mine
  ) {
    return {
      reason: `stack ${spec.name} was reset with different migrations than this worktree (${status.lastReset.branch}@${status.lastReset.commit?.slice(0, 7)}); reset it from this worktree or pass --ignore-migration-drift`,
      migrations,
    }
  }
  return { reason: null, migrations }
}

export function runLogged(cmd, args, { cwd, env, logFile, timeoutMs }) {
  return new Promise((resolveRun) => {
    const chunks = []
    const child = spawn(cmd, args, {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    // The child leads its own process group, so a signal to this process does
    // not reach it: stop the whole group before the stack lock is released.
    const untrack = child.pid
      ? onTerminate(() => terminateGroup(child.pid))
      : () => {}
    let timedOut = false
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true
          try {
            process.kill(-child.pid, "SIGKILL")
          } catch {
            // Already gone.
          }
        }, timeoutMs)
      : null
    child.stdout.on("data", (d) => chunks.push(d))
    child.stderr.on("data", (d) => chunks.push(d))
    child.on("close", (code) => {
      untrack()
      if (timer) clearTimeout(timer)
      // Anything the child left behind (the Next server) goes with it.
      try {
        process.kill(-child.pid, "SIGKILL")
      } catch {
        // Nothing left.
      }
      const output = Buffer.concat(chunks).toString("utf8")
      writeFileSync(logFile, output)
      resolveRun({ code, timedOut, output })
    })
    child.on("error", (error) => {
      untrack()
      if (timer) clearTimeout(timer)
      resolveRun({ code: null, timedOut: false, output: String(error.message) })
    })
  })
}

async function ensureBuild(root, spec, env, rawDir, flags) {
  const stamp = join(root, ".next/journey-build.json")
  const fingerprint = {
    stack: spec.name,
    apiPort: spec.apiPort,
    site: env.NEXT_PUBLIC_SITE_URL,
    tree: treeFingerprint(root),
  }
  if (flags.skipBuild && existsSync(stamp)) {
    const previous = JSON.parse(readFileSync(stamp, "utf8"))
    if (JSON.stringify(previous) === JSON.stringify(fingerprint))
      return { ok: true, reused: true }
  }
  const logFile = join(rawDir, "build.log")
  const result = await runLogged("pnpm", ["exec", "next", "build"], {
    cwd: root,
    env: { ...env, NEXT_TELEMETRY_DISABLED: "1" },
    logFile,
    timeoutMs: 15 * 60_000,
  })
  if (result.code !== 0)
    return {
      ok: false,
      logFile,
      tail: result.output.trim().split("\n").slice(-6).join(" | "),
    }
  mkdirSync(join(root, ".next"), { recursive: true })
  writeFileSync(stamp, JSON.stringify(fingerprint))
  return { ok: true, reused: false, logFile }
}

function copyEvidence({ attachments, id, resultsDir, secrets }) {
  const evidence = []
  const seen = new Set()
  attachments.forEach((a, index) => {
    if (!a.body && !existsSync(a.path)) return
    const isImage = a.contentType === "image/png"
    const isText = a.contentType === "text/plain"
    if (!isImage && !isText) return
    const name = `${String(index + 1).padStart(2, "0")}-${basename(a.name || "attachment").replace(/[^A-Za-z0-9._-]/g, "_")}`
    if (isImage) {
      const rel = join(
        "shots",
        id,
        name.endsWith(".png") ? name : `${name}.png`
      )
      mkdirSync(join(resultsDir, "shots", id), { recursive: true })
      if (a.body)
        writeFileSync(join(resultsDir, rel), Buffer.from(a.body, "base64"))
      else copyFileSync(a.path, join(resultsDir, rel))
      if (!seen.has(rel))
        evidence.push({
          kind: "screenshot",
          path: rel,
          description: `Playwright attachment "${a.name}"`,
        })
      seen.add(rel)
    } else {
      const rel = join("logs", `${id}.${name.replace(/\.txt$/, "")}.txt`)
      writeFileSync(
        join(resultsDir, rel),
        scrub(
          a.body
            ? Buffer.from(a.body, "base64").toString("utf8")
            : readFileSync(a.path, "utf8"),
          secrets
        )
      )
      evidence.push({
        kind: "log",
        path: rel,
        description: `Playwright attachment "${a.name}"`,
      })
    }
  })
  return evidence
}

function formatSummaryMarkdown(summary) {
  const lines = [
    `# Journey run ${summary.runId}`,
    "",
    `- Commit: \`${summary.revision.commit}\` on \`${summary.revision.branch}\`${summary.revision.dirty ? " (dirty tree)" : ""}`,
    `- Stack: \`${summary.stack.name}\` (API port ${summary.stack.apiPort}, migrations ${summary.stack.migrations})`,
    `- Started ${summary.startedAt}, finished ${summary.finishedAt}`,
    `- Totals: ${summary.totals.pass} pass, ${summary.totals.fail} fail, ${summary.totals.unavailable} unavailable`,
    `- Exit code: ${summary.exitCode}${summary.allowUnavailable ? " (unavailable allowed)" : ""}`,
    "",
    "| Journey | Result | Reason | Evidence |",
    "| --- | --- | --- | --- |",
  ]
  for (const j of summary.journeys) {
    const reason = (j.reason ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ")
    lines.push(
      `| \`${j.journey}\` | ${j.result.toUpperCase()} | ${reason} | ${j.evidence.map((e) => `\`${e}\``).join("<br>")} |`
    )
  }
  const unavailable = summary.journeys.filter((j) => j.result === "unavailable")
  if (unavailable.length) {
    lines.push("", "Unavailable journeys did not run and are not passes.")
  }
  return lines.join("\n") + "\n"
}

/**
 * Claims a run directory nobody has written to. An explicit --run-id or
 * --results-dir that already holds files is refused (collected evidence is
 * never overwritten or mixed with a new run); the generated default id gets a
 * numeric suffix instead, since its timestamp has only second resolution.
 * @param {{root: string, runId?: string, resultsDir?: string, defaultId: string}} options
 * @returns {{id: string, dir: string}}
 */
export function allocateRunDir({ root, runId, resultsDir, defaultId }) {
  const claim = (dir) => {
    mkdirSync(dirname(dir), { recursive: true })
    try {
      mkdirSync(dir)
    } catch (error) {
      if (error.code !== "EEXIST") throw error
      if (readdirSync(dir).length > 0) return false
    }
    return true
  }
  if (resultsDir !== undefined || runId !== undefined) {
    const dir = resolve(root, resultsDir ?? join(".artifacts/journeys", runId))
    if (!claim(dir)) {
      throw Object.assign(
        new Error(
          `Run directory ${dir} already exists and is not empty. Journey evidence is never overwritten: pick another --run-id or --results-dir, or move that directory away.`
        ),
        { code: "RUN_DIR_EXISTS" }
      )
    }
    return { id: runId ?? basename(dir), dir }
  }
  for (let attempt = 1; ; attempt++) {
    const id = attempt === 1 ? defaultId : `${defaultId}-${attempt}`
    const dir = resolve(root, join(".artifacts/journeys", id))
    if (claim(dir)) return { id, dir }
  }
}

/**
 * @param {{root: string, journeys: object[], stack: string, flags: object, runId?: string, resultsDir?: string}} options
 * @returns {Promise<{summary: object, resultsDir: string, exitCode: number}>}
 */
export async function runJourneys({
  root,
  journeys,
  stack,
  flags = {},
  runId,
  resultsDir,
}) {
  const spec = stackSpec(stack)
  const revision = revisionOf(root)
  const { id, dir } = allocateRunDir({
    root,
    runId,
    resultsDir,
    defaultId: `${new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d+Z$/, "Z")}-${revision.commit.slice(0, 7)}`,
  })
  const rawDir = join(dir, ".raw")
  for (const sub of ["journeys", "logs", "shots", ".raw"])
    mkdirSync(join(dir, sub), { recursive: true })
  const runStartedAt = new Date().toISOString()
  const version = playwrightVersion()
  const results = []

  const base = (journey, startedAt, migrations) => ({
    schema: RESULT_SCHEMA,
    journey: journey.id,
    title: journey.title,
    revision,
    stack: { name: spec.name, apiPort: spec.apiPort, migrations },
    runner: { kind: "playwright", version },
    startedAt,
    scenarios: journey.scenarios,
  })
  const finish = (journey, partial) => {
    const result = {
      ...partial,
      finishedAt: new Date().toISOString(),
      ...(journey.historical
        ? {
            historical: {
              ...journey.historical,
              reproducedOnHead:
                partial.result === "fail"
                  ? true
                  : partial.result === "pass"
                    ? false
                    : null,
            },
          }
        : {}),
    }
    writeFileSync(
      join(dir, "journeys", `${journey.id}.json`),
      JSON.stringify(result, null, 2) + "\n"
    )
    results.push(result)
    return result
  }
  const unavailable = (journey, reason, migrations, evidence = []) => {
    const startedAt = new Date().toISOString()
    return finish(journey, {
      ...base(journey, startedAt, migrations),
      result: "unavailable",
      reason,
      evidence,
    })
  }

  // Prerequisites shared by every journey of the run.
  let shared = stackProblem(root, spec, flags)
  let env = null
  let buildEvidence = []
  if (!shared.reason) {
    try {
      env = {
        ...process.env,
        ...stackEnv(spec),
        E2E_STACK_RESOLVED: "1",
        E2E_ISOLATED_STACK: "1",
        ...(flags.appPort
          ? {
              E2E_PORT: String(flags.appPort),
              VISUAL_PORT: String(flags.appPort),
              NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${flags.appPort}`,
            }
          : {}),
      }
    } catch (error) {
      shared = { ...shared, reason: error.message }
    }
  }
  const secrets = env
    ? [
        env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        env.SUPABASE_SERVICE_ROLE_KEY,
        env.SUPABASE_JWT_SECRET,
      ]
    : []
  if (!shared.reason) {
    const missing = browserProblem([
      ...new Set(journeys.flatMap((j) => j.projects)),
    ])
    if (missing) shared = { ...shared, reason: missing }
  }
  if (!shared.reason) {
    const build = await ensureBuild(root, spec, env, rawDir, flags)
    if (!build.ok) {
      shared = {
        ...shared,
        reason: `production build failed for stack ${spec.name}: ${build.tail}`,
      }
      const rel = "logs/build.log"
      writeFileSync(
        join(dir, rel),
        scrub(readFileSync(build.logFile, "utf8"), secrets)
      )
      buildEvidence = [
        { kind: "log", path: rel, description: "next build output" },
      ]
    }
  }

  // Journeys sign in as the shared fixture people, whose magic-link inbox and
  // token are per address, so runs on one stack take turns (as do resets).
  // Builds happen before this point and still overlap.
  const runAll = async () => {
    if (!shared.reason) {
      const again = stackProblem(root, spec, flags)
      if (again.reason) shared = again
      else if (!(await portFree(Number(env.E2E_PORT))))
        shared = {
          ...shared,
          reason: `app port ${env.E2E_PORT} is already in use (pass --app-port <free port>)`,
        }
    }
    for (const journey of journeys) {
      if (shared.reason) {
        unavailable(journey, shared.reason, shared.migrations, buildEvidence)
        continue
      }
      if (journey.needs.includes("psql") && toolMissing("psql")) {
        unavailable(
          journey,
          "psql is not on PATH (this journey provisions fixtures with host psql)",
          shared.migrations
        )
        continue
      }
      const startedAt = new Date().toISOString()
      const outputDir = join(rawDir, journey.id)
      rmSync(outputDir, { recursive: true, force: true })
      mkdirSync(outputDir, { recursive: true })
      const rawJson = join(rawDir, `${journey.id}.json`)
      rmSync(rawJson, { force: true })
      const args = [
        "exec",
        "playwright",
        "test",
        "--config",
        "scripts/ci/journeys.playwright.config.ts",
        journey.spec,
        ...(journey.grep ? ["--grep", journey.grep] : []),
        ...journey.projects.flatMap((p) => ["--project", p]),
      ]
      const logRel = join("logs", `${journey.id}.log`)
      const timeoutMs = (journey.timeoutSeconds ?? 600) * 1000
      const run = await runLogged("pnpm", args, {
        cwd: root,
        env: {
          ...env,
          JOURNEY_RAW_JSON: rawJson,
          JOURNEY_OUTPUT_DIR: outputDir,
          NEXT_TELEMETRY_DISABLED: "1",
        },
        logFile: join(rawDir, `${journey.id}.raw.log`),
        timeoutMs,
      })
      writeFileSync(join(dir, logRel), scrub(run.output, secrets))
      const evidence = [
        {
          kind: "log",
          path: logRel,
          description: "Playwright runner output (list reporter)",
        },
      ]

      let outcome
      if (existsSync(rawJson)) {
        outcome = outcomeFromReport(JSON.parse(readFileSync(rawJson, "utf8")))
      } else if (run.timedOut) {
        const started = /^\s*(✓|✘|-|\d+\))/m.test(run.output)
        outcome = {
          result: started ? "fail" : "unavailable",
          reason: started
            ? `timed out after ${timeoutMs / 1000}s with some assertions already run (see log)`
            : `timed out after ${timeoutMs / 1000}s before the first assertion`,
          checks: undefined,
          attachments: [],
        }
      } else {
        const line =
          run.output
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .slice(-1)[0] ?? ""
        outcome = {
          result: "unavailable",
          reason: `Playwright produced no report (exit ${run.code}): ${scrub(line, secrets).slice(0, 200)}`,
          checks: undefined,
          attachments: [],
        }
      }
      evidence.push(
        ...copyEvidence({
          attachments: outcome.attachments,
          id: journey.id,
          resultsDir: dir,
          secrets,
        })
      )
      if (journey.agentic && flags.agentic && outcome.result !== "fail") {
        const agentic = await runAgentic({
          journey,
          root,
          env,
          dir,
          secrets,
          runLogged,
          scrub,
        })
        evidence.push(...agentic.evidence)
        if (agentic.status === "unavailable" && outcome.result === "pass") {
          outcome = {
            ...outcome,
            result: "unavailable",
            reason: `deterministic checks passed (${outcome.checks.passed}) but the requested agentic run is unavailable: ${agentic.reason}`,
          }
        } else if (agentic.status === "fail" && outcome.result === "pass") {
          outcome = { ...outcome, result: "fail", reason: agentic.reason }
        }
      } else if (journey.agentic && flags.agentic) {
        evidence.push({
          kind: "note",
          path: "summary.md",
          description:
            "agentic run skipped because the deterministic checks already failed",
        })
      }
      finish(journey, {
        ...base(journey, startedAt, shared.migrations),
        result: outcome.result,
        reason: outcome.reason,
        ...(outcome.checks ? { checks: outcome.checks } : {}),
        evidence,
      })
    }
  }

  if (shared.reason || flags.noStackLock) await runAll()
  else {
    let started = false
    try {
      await withLock(
        spec,
        `journeys ${journeys.map((j) => j.id).join(",")} from ${root}`,
        flags.lockTimeout ?? 1800,
        () => {
          started = true
          return runAll()
        },
        (owner) =>
          console.error(
            `Waiting for stack ${spec.name}: ${owner ? `${owner.what} (pid ${owner.pid})` : "another command"} holds it.`
          )
      )
    } catch (error) {
      if (started) throw error
      shared = { ...shared, reason: error.message }
      await runAll()
    }
  }

  const totals = { pass: 0, fail: 0, unavailable: 0 }
  for (const r of results) totals[r.result]++
  const exitCode =
    totals.fail > 0
      ? 1
      : totals.unavailable > 0 && !flags.allowUnavailable
        ? 3
        : 0
  const summary = {
    schema: SUMMARY_SCHEMA,
    runId: id,
    revision,
    stack: {
      name: spec.name,
      apiPort: spec.apiPort,
      migrations: shared.migrations,
    },
    startedAt: runStartedAt,
    finishedAt: new Date().toISOString(),
    allowUnavailable: Boolean(flags.allowUnavailable),
    totals,
    exitCode,
    journeys: results.map((r) => ({
      journey: r.journey,
      result: r.result,
      reason: r.reason,
      historical: r.historical,
      file: `journeys/${r.journey}.json`,
      evidence: r.evidence.map((e) => e.path),
    })),
  }
  writeFileSync(
    join(dir, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n"
  )
  writeFileSync(join(dir, "summary.md"), formatSummaryMarkdown(summary))
  rmSync(rawDir, { recursive: true, force: true })

  // A run whose own output breaks the format is itself a failure.
  const { errors } = validateRunDir(dir)
  if (errors.length) {
    throw new Error(
      `journey harness produced invalid output in ${dir}:\n${errors.join("\n")}`
    )
  }
  return { summary, resultsDir: dir, exitCode }
}
