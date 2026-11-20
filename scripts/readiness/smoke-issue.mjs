import { execFileSync } from "node:child_process"

const repo = "lapeninns/naba-lens"
const title = "Production smoke check failed for Naba-Lens"
const [result] = process.argv.slice(2)
if (process.argv.length !== 3 || !["passed", "failed"].includes(result)) {
  throw Error("Usage: pnpm smoke:issue passed|failed")
}
if (result === "failed") {
  const gh = (args) => execFileSync("gh", args, { encoding: "utf8" }).trim()
  const account = gh(["api", "user", "--jq", ".login"])
  if (account !== "lapeninns")
    throw Error("Use the approved lapeninns GitHub account")
  const issues = JSON.parse(
    gh([
      "issue",
      "list",
      "-R",
      repo,
      "--state",
      "open",
      "--label",
      "area:infra",
      "--search",
      `"${title}" in:title`,
      "--json",
      "number,title",
    ])
  )
  const existing = issues.find((issue) => issue.title === title)
  const message = `The scheduled Naba-Lens smoke reported failure at ${new Date().toISOString()}. Check the private lci notification and the incident runbook. This issue does not include URLs, HTTP bodies, or diagnostic logs.`
  const args = existing
    ? [
        "issue",
        "comment",
        String(existing.number),
        "-R",
        repo,
        "--body",
        message,
      ]
    : [
        "issue",
        "create",
        "-R",
        repo,
        "--title",
        title,
        "--label",
        "bug",
        "--label",
        "P1",
        "--label",
        "area:infra",
        "--body",
        message,
      ]
  console.log(gh(args))
}
