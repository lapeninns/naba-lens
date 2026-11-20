import { existsSync, readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"

const text = readFileSync("AGENTS.md", "utf8")
const pkg = JSON.parse(readFileSync("package.json", "utf8"))
const errors = []
for (const match of text.matchAll(/`pnpm\s+(?:run\s+)?([\w:-]+)/g)) {
  if (!(match[1] in pkg.scripts) && !["exec", "install"].includes(match[1]))
    errors.push(`Unknown pnpm command: ${match[1]}`)
}
for (const match of text.matchAll(
  /\]\(([^)\s]+)\)|`((?:[\w.-]+\/)+[\w./-]+\.(?:md|mjs|tsx?|css))`/g
)) {
  const target = match[1] ?? match[2]
  if (/^https?:\/\//.test(target)) {
    new URL(target)
    continue
  }
  if (!existsSync(resolve(target.split("#")[0] || "AGENTS.md")))
    errors.push(`Missing target: ${target}`)
}

const flags = JSON.parse(readFileSync("scripts/readiness/flags.json", "utf8"))
const sources = ["app", "components", "lib", "scripts"].flatMap((root) =>
  readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((path) => /\.(?:ts|tsx|mjs)$/.test(path))
    .map((path) => `${root}/${path}`)
)
for (const [name, { definition, accessor, owner }] of Object.entries(flags)) {
  if (
    !owner ||
    !existsSync(definition) ||
    !readFileSync(definition, "utf8").includes(`process.env.${name}`)
  )
    errors.push(`Invalid flag definition: ${name}`)
  if (
    ![...sources, "next.config.ts"].some(
      (file) =>
        file !== definition &&
        new RegExp(`\\b${accessor}\\b`).test(readFileSync(file, "utf8"))
    )
  )
    errors.push(`Unused flag: ${name}`)
}
const workspace = readFileSync("pnpm-workspace.yaml", "utf8")
if (!/^minimumReleaseAge:\s+1440$/m.test(workspace))
  errors.push("Keep the one-day minimum package release age")
if (errors.length) throw Error(errors.join("\n"))
console.log(
  `AGENTS.md local targets, pnpm scripts, release age and ${Object.keys(flags).length} registered flags verified`
)
