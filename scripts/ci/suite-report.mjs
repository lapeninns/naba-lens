// Failure reporting for scripts/ci/run-suites.mjs. Hosted CI logs and
// artifacts of this repository are public, so anything printed or uploaded
// from a suite log goes through scrub() first. Full raw logs stay in the
// CI log directory (private on local runners).

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g
// Where a failing test's details start: Vitest's "Failed Tests" section or
// Playwright's numbered failure list.
const START = /Failed Tests \d+|^\s+\d+\) \[/
const SUMMARY =
  /^\s*(Test Files|Tests)\s|^\s+\d+ (failed|flaky|passed|skipped|did not run|interrupted)\b/

export function scrub(text, secrets = []) {
  let out = text
  for (const value of secrets)
    if (typeof value === "string" && value.length >= 8)
      out = out.split(value).join("[redacted]")
  return out
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
  const summary = lines.filter((l) => SUMMARY.test(l)).slice(-4)
  const room = Math.max(maxLines - summary.length, 4)
  const head =
    body.length > room
      ? [
          ...body.slice(0, room - 1),
          `… ${body.length - room + 1} more lines in the suite log`,
        ]
      : body
  return [...head, ...summary].map((l) => l.slice(0, 240))
}
