// Failure reporting for scripts/ci/run-suites.mjs. Hosted CI logs and
// artifacts of this repository are public, so anything printed or uploaded
// from a suite log goes through scrub() first. Full raw logs stay in the
// CI log directory (private on local runners).

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g
// Where a failing test's details start: Vitest's "Failed Tests" section or
// Playwright's numbered failure list.
const START = /Failed Tests \d+|^\s+\d+\) \[/
// Lines that name a failing test or file.
const ID = /\bFAIL\b|×|✘|^\s+\d+\) \[/
const SUMMARY =
  /^\s*(Test Files|Tests)\s|^\s+\d+ (failed|flaky|passed|skipped|did not run|interrupted)\b/

export function scrub(text, secrets = []) {
  let out = text
  for (const value of secrets)
    if (typeof value === "string" && value.length >= 8)
      out = out.split(value).join("[redacted]")
  return out
    .replace(/\b(sb-[\w-]+-auth-token(?:\.\d+)?=)[^;\s"']+/g, "$1[redacted]")
    .replace(/\bbase64-[A-Za-z0-9+/=_-]{20,}/g, "base64-[redacted]")
    .replace(/eyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]+/g, "[redacted-jwt]")
    .replace(/\bsb_(secret|publishable)_[\w-]+/g, "sb_$1_[redacted]")
    .replace(/\b(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s]+@/g, "$1[redacted]@")
    .replace(/\bnlr_([a-z0-9-]{3,40})_[\w-]{20,}/g, "nlr_$1_[redacted]")
    .replace(
      /\b(token_hash|access_token|refresh_token|code)=[^&\s"']+/g,
      "$1=[redacted]"
    )
    .replace(/\b(Bearer\s+)[^\s"']+/gi, "$1[redacted]")
}

/** At most maxLines lines, the summary included. */
export function failureExcerpt(log, { maxLines = 24, secrets = [] } = {}) {
  const lines = scrub(log.replace(ANSI, ""), secrets)
    .split("\n")
    .map((l) => l.trimEnd())
  const start = lines.findIndex((l) => START.test(l))
  const body = (
    start === -1
      ? lines.filter((l) => /\bFAIL\b|×|✘/.test(l))
      : lines.slice(start)
  ).filter((l) => l.trim() && !SUMMARY.test(l))
  const limit = Math.max(1, maxLines)
  const summary = lines
    .filter((l) => SUMMARY.test(l))
    .slice(-Math.min(4, Math.floor(limit / 2)))
  const room = limit - summary.length
  let head = body
  if (body.length > room) {
    // A runner can print the failing test's name on stderr and its details on
    // stdout; the two arrive separately, so the names are kept first.
    const names = [...new Set(lines.filter((l) => ID.test(l)))].slice(
      0,
      Math.max(1, Math.ceil(room / 2))
    )
    const context = body.filter((l) => !ID.test(l))
    const left = room - names.length
    head =
      context.length > left
        ? [
            ...names,
            ...context.slice(0, Math.max(0, left - 1)),
            `… ${context.length - Math.max(0, left - 1)} more lines in the suite log`,
          ]
        : [...names, ...context]
  }
  return [...head, ...summary].slice(0, limit).map((l) => l.slice(0, 240))
}
