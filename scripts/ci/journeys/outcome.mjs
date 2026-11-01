// Maps a Playwright JSON report to a journey outcome. A pass needs at least one
// test that ran and held; skipped, flaky, interrupted or missing tests never
// count towards a pass.

const stripAnsi = (text) => String(text ?? "").replace(/\u001b\[[0-9;]*m/g, "")
const firstLine = (text) =>
  stripAnsi(text)
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean) ?? ""

function collectTests(suite, out = [], titles = []) {
  const path = suite.title && !suite.file ? [...titles, suite.title] : titles
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      out.push({ title: [...path, spec.title].join(" > "), test })
    }
  }
  for (const child of suite.suites ?? []) collectTests(child, out, path)
  return out
}

export function outcomeFromReport(report) {
  const tests = (report.suites ?? []).flatMap((suite) => collectTests(suite))
  const attachments = []
  const checks = { passed: 0, failed: 0, skipped: 0 }
  const failures = []
  const skips = []
  for (const { title, test } of tests) {
    const label = test.projectName ? `${title} [${test.projectName}]` : title
    const results = test.results ?? []
    for (const r of results) {
      for (const a of r.attachments ?? []) {
        if (a.path || a.body)
          attachments.push({
            name: a.name,
            contentType: a.contentType,
            path: a.path,
            body: a.body,
          })
      }
    }
    if (test.status === "expected") checks.passed++
    else if (test.status === "skipped") {
      checks.skipped++
      skips.push(label)
    } else {
      checks.failed++
      const last = results.at(-1)
      const message = firstLine(
        last?.error?.message ?? last?.errors?.[0]?.message
      )
      const how =
        test.status === "flaky"
          ? "passed only after a retry"
          : message || last?.status || test.status
      failures.push(`${label}: ${how}`)
    }
  }
  const global = (report.errors ?? [])
    .map((e) => firstLine(e.message))
    .filter(Boolean)

  if (checks.failed > 0) {
    return {
      result: "fail",
      reason:
        `${checks.failed} of ${tests.length} test(s) failed. First: ${failures[0]}`.slice(
          0,
          600
        ),
      checks,
      attachments,
    }
  }
  if (tests.length === 0) {
    return {
      result: "unavailable",
      reason: global.length
        ? `Playwright reported: ${global[0]}`
        : "no tests matched the journey's spec and grep",
      checks,
      attachments,
    }
  }
  if (checks.skipped > 0) {
    return {
      result: "unavailable",
      reason: `${checks.skipped} of ${tests.length} test(s) skipped (${skips[0]}), so not every assertion ran`,
      checks,
      attachments,
    }
  }
  if (global.length) {
    return {
      result: "fail",
      reason: `Playwright reported: ${global[0]}`,
      checks,
      attachments,
    }
  }
  return { result: "pass", reason: null, checks, attachments }
}
