// Optional agentic run for a journey (`--agentic`, journeys that declare
// `agentic: { file, config? }`). It uses the `e2e` runner when one is installed
// (node_modules/.bin/e2e, or E2E_BIN pointing at an existing install) and a
// model login or API key is usable. The run is evidence only: a journey `pass`
// always rests on its deterministic Playwright assertions, and a requested
// agentic run that cannot happen turns the journey `unavailable`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const AUTH_FAILURE =
  /(auth|log ?in|sign[- ]?in|credential|api key|subscription|unauthori[sz]ed|401|403|model)/i

export function findE2eBinary(root) {
  const candidates = [process.env.E2E_BIN, join(root, "node_modules/.bin/e2e")]
  return candidates.find((p) => p && existsSync(p)) ?? null
}

/**
 * @param {{journey: object, root: string, env: object, dir: string, secrets: string[],
 *   runLogged: Function, scrub: Function}} options
 * @returns {Promise<{status: "ok" | "unavailable" | "fail", reason: string | null, evidence: object[]}>}
 */
export async function runAgentic({
  journey,
  root,
  env,
  dir,
  secrets,
  runLogged,
  scrub,
}) {
  const bin = findE2eBinary(root)
  if (!bin) {
    return {
      status: "unavailable",
      reason:
        "agentic runner not installed (no node_modules/.bin/e2e and E2E_BIN unset)",
      evidence: [],
    }
  }
  const out = join(dir, ".raw", `${journey.id}.agentic`)
  mkdirSync(out, { recursive: true })
  const args = [
    "run",
    journey.agentic.file,
    ...(journey.agentic.config ? ["--config", journey.agentic.config] : []),
    "--output",
    out,
  ]
  const logRel = join("logs", `${journey.id}.agentic.log`)
  const run = await runLogged(bin, args, {
    cwd: root,
    env,
    logFile: join(dir, ".raw", `${journey.id}.agentic.raw.log`),
    timeoutMs: (journey.timeoutSeconds ?? 600) * 1000,
  })
  writeFileSync(join(dir, logRel), scrub(run.output, secrets))
  const evidence = [
    {
      kind: "log",
      path: logRel,
      description:
        "agentic runner output (model judgements are evidence, not a pass)",
    },
  ]
  const reportFile = join(out, "report.json")
  if (existsSync(reportFile)) {
    const rel = join("logs", `${journey.id}.agentic-report.json`)
    writeFileSync(
      join(dir, rel),
      scrub(readFileSync(reportFile, "utf8"), secrets)
    )
    evidence.push({
      kind: "report",
      path: rel,
      description:
        "agentic runner report (steps and model judgements; artifacts with cookies are not kept)",
    })
  }
  if (run.timedOut) {
    return { status: "unavailable", reason: "agentic run timed out", evidence }
  }
  if (run.code === 0) return { status: "ok", reason: null, evidence }
  if (!existsSync(reportFile) && AUTH_FAILURE.test(run.output)) {
    return {
      status: "unavailable",
      reason: "agentic model credentials absent or rejected",
      evidence,
    }
  }
  const last =
    run.output
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(-1)[0] ?? ""
  return {
    status: "fail",
    reason: `agentic run failed (exit ${run.code}): ${scrub(last, secrets).slice(0, 200)}`,
    evidence,
  }
}
