import { spawnSync, execFileSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { isDeepStrictEqual } from "node:util"
import { ESLint } from "eslint"
import ts from "typescript"

const baselinePath = "scripts/readiness/quality-baseline.json"
const record = process.argv.includes("--record")
const root = process.cwd()
const reports = join(root, ".artifacts")
mkdirSync(reports, { recursive: true })
const work = mkdtempSync(join(reports, "quality-"))
const sorted = (o) =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))
const tracked = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" }
)
const files = [
  ...new Set(
    tracked
      .split("\0")
      .filter(
        (file) =>
          /^(app|lib|components|hooks|scripts|tests)\//.test(file) &&
          /\.(?:mjs|mts|tsx?|jsx?)$/.test(file)
      )
  ),
]
const lintFiles = files.filter((file) =>
  /^(app|lib|components|hooks)\//.test(file)
)
const problems = {}
function hit(rule, key, by = 1) {
  problems[rule] ??= {}
  problems[rule][key] = (problems[rule][key] ?? 0) + by
}
function run(bin, args, accepted = [0], env = process.env) {
  const result = spawnSync(join(root, "node_modules", ".bin", bin), args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env,
  })
  if (!accepted.includes(result.status)) {
    throw Error(
      `${bin} failed (${result.status ?? result.signal}): ${result.stderr || result.error || result.stdout}`
    )
  }
  return result.stdout
}
function inspectFile(file, text) {
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(file.split("/").at(-1)))
    hit("filename", file)
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  for (const marker of text.matchAll(
    /(?:^\s*(?:\/\/+|\*|\/\*)\s*)\b(TODO|FIXME)\b(?!\(#\d+\))/gm
  )) {
    hit("unlinkedDebt", `${file}:${marker[1]}`)
  }
  // A shared library must not import the routing/UI layer. Client modules
  // cannot directly import server implementation or privileged clients.
  const client = tree.statements.some(
    (s) =>
      ts.isExpressionStatement(s) &&
      ts.isStringLiteral(s.expression) &&
      s.expression.text === "use client"
  )
  function visit(node) {
    const spec =
      ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
        ? node.moduleSpecifier
        : ts.isCallExpression(node) &&
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
              node.expression.getText(tree) === "require")
          ? node.arguments[0]
          : undefined
    if (spec && ts.isStringLiteralLike(spec)) {
      const from = spec.text
      const target = from.startsWith("@/")
        ? from.slice(2)
        : from.startsWith(".")
          ? new URL(from, new URL(file, "file:///")).pathname.slice(1)
          : ""
      const typeOnly =
        (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) ||
        (ts.isExportDeclaration(node) && node.isTypeOnly)
      if (
        !typeOnly &&
        ((file.startsWith("lib/") && /^(app|components)\//.test(target)) ||
          (client &&
            /^lib\/(?:server\/|supabase\/(?:admin|server|proxy)(?:\.|$))/.test(
              target
            )))
      ) {
        hit("boundary", `${file} -> ${target}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
}

try {
  for (const file of files) {
    let source
    try {
      source = readFileSync(file, "utf8")
    } catch (error) {
      if (error.code === "ENOENT") continue
      throw error
    }
    inspectFile(file, source)
  }
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ["**/*.{ts,tsx}"],
        languageOptions: {
          parser:
            (await import("eslint-config-next/typescript")).default.find(
              (config) => config.languageOptions?.parser
            )?.languageOptions.parser ??
            (await import("eslint-config-next/core-web-vitals")).default.find(
              (config) => config.languageOptions?.parser
            )?.languageOptions.parser,
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        rules: {
          complexity: ["error", 18],
          "max-lines": [
            "error",
            { max: 450, skipBlankLines: true, skipComments: true },
          ],
        },
      },
    ],
  })
  for (const result of await eslint.lintFiles(lintFiles)) {
    for (const item of result.messages) {
      if (item.fatal) throw Error(`${result.filePath}: ${item.message}`)
      if (item.ruleId !== "complexity" && item.ruleId !== "max-lines") continue
      const size =
        item.ruleId === "complexity"
          ? item.message.match(/complexity of (\d+)/)?.[1]
          : item.message.match(/\((\d+)\)/)?.[1]
      hit(
        item.ruleId,
        result.filePath.slice(root.length + 1),
        Number(size ?? 1)
      )
    }
  }
  console.log("Source rules checked")
  // Prettier's --list-different emits file names, not file content.
  for (const file of run(
    "prettier",
    [
      "--cache",
      "--cache-location",
      ".artifacts/prettier-cache",
      "--list-different",
      "**/*.{ts,tsx}",
    ],
    [0, 1]
  )
    .split("\n")
    .filter(Boolean)) {
    hit("format", file)
  }
  console.log("Formatting checked")
  // Knip imports the Playwright config to discover test entry points. Give
  // just this static-analysis subprocess inert loopback settings. Real test
  // commands still resolve and validate their own running fixture stack.
  const knipEnv = { ...process.env }
  delete knipEnv.E2E_SUPABASE_WORKDIR
  const knip = JSON.parse(
    run("knip", ["--reporter", "json", "--no-config-hints"], [0, 1], {
      ...knipEnv,
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "knip-static-fixture",
      SUPABASE_SERVICE_ROLE_KEY: "knip-static-fixture",
      MAILPIT_URL: "http://127.0.0.1:1",
    })
  )
  if (!Array.isArray(knip.issues)) throw Error("Unexpected Knip report")
  for (const { file, owners: _owners, ...issues } of knip.issues) {
    void _owners
    for (const [kind, findings] of Object.entries(issues)) {
      if (!Array.isArray(findings))
        throw Error(`Unexpected Knip issue type: ${kind}`)
      for (const finding of findings) {
        const name = typeof finding === "string" ? finding : finding.name
        hit(`knip:${kind}`, `${file}:${name}`)
      }
    }
  }
  console.log("Knip checked")
  run("jscpd", [
    "app",
    "components",
    "hooks",
    "lib",
    "--format",
    "typescript,tsx",
    "--workers",
    "2",
    "--min-lines",
    "7",
    "--min-tokens",
    "70",
    "--fail-on-empty",
    "--reporters",
    "json",
    "--output",
    work,
  ])
  const total = JSON.parse(
    readFileSync(join(work, "jscpd-report.json"), "utf8")
  ).statistics.total
  if (
    !Number.isFinite(total.percentage) ||
    !Number.isFinite(total.duplicatedLines)
  )
    throw Error("Unexpected jscpd report")
  hit("duplication", "hundredthsOfPercent", Math.round(total.percentage * 100))
  hit("duplication", "duplicatedLines", total.duplicatedLines)
  const actual = sorted(
    Object.fromEntries(
      Object.entries(problems).map(([rule, data]) => [rule, sorted(data)])
    )
  )
  let baseline
  try {
    baseline = JSON.parse(readFileSync(baselinePath, "utf8"))
  } catch (error) {
    if (!record || error.code !== "ENOENT") throw error
  }
  if (baseline) {
    const regressions = []
    for (const [rule, counts] of Object.entries(actual)) {
      for (const [key, value] of Object.entries(counts)) {
        const budget = baseline[rule]?.[key] ?? 0
        if (value > budget)
          regressions.push(`${rule}: ${key} (${value} > ${budget})`)
      }
    }
    if (regressions.length)
      throw Error(`Quality regressions:\n${regressions.join("\n")}`)
    if (!record && !isDeepStrictEqual(actual, baseline)) {
      throw Error(
        "Quality improved. Lock in the lower baseline with pnpm quality --record."
      )
    }
  }
  if (record)
    writeFileSync(baselinePath, JSON.stringify(actual, null, 2) + "\n")
  for (const [rule, counts] of Object.entries(actual)) {
    console.log(
      `${rule}: ${Object.values(counts).reduce((sum, x) => sum + x, 0)}`
    )
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
