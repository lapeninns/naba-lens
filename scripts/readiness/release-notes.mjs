import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim()

export function releaseNotes(from, to = "HEAD") {
  const base = git(
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${from}^{commit}`
  )
  const head = git(
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${to}^{commit}`
  )
  git("merge-base", "--is-ancestor", base, head)
  const changes = git(
    "log",
    "--first-parent",
    "--format=%h %s",
    `${base}..${head}`
  )
  return [
    `# Release notes: ${base.slice(0, 8)} to ${head.slice(0, 8)}`,
    "",
    ...(changes
      ? changes.split("\n").map((line) => `- ${line}`)
      : ["No changes."]),
    "",
  ].join("\n")
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const [from, to] = process.argv.slice(2)
  if (!from || process.argv.length > 4)
    throw Error(
      "Usage: pnpm release:notes <previous-commit> [candidate-commit]"
    )
  process.stdout.write(releaseNotes(from, to))
}
