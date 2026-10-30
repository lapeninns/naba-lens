#!/usr/bin/env node
// Scans what Next ships to browsers for server secrets and server-only code.
//
//   pnpm build && node scripts/ci/scan-bundle.mjs [--dir .next] [--json]
//
// Scanned: every file under <dir>/static (client chunks, CSS, media) and the
// prerendered artefacts a browser can receive (<dir>/server/app/**/*.html, .rsc,
// .body, .meta, segment .rsc), plus public/. Server chunks are NOT scanned:
// secrets there are expected.
//
// Findings (exit 1):
//   - secret names: SUPABASE_SERVICE_ROLE*, SERVICE_ROLE_KEY, SUPABASE_SECRET_KEY,
//     CLEANUP_SECRET, and the "service_role" JWT role;
//   - secret shapes: Supabase secret keys (sb_secret_…), private-key PEM blocks,
//     postgres URLs with a password, and any JWT whose payload role is not "anon"
//     (the anon key is public by design);
//   - secret values: the current values of SUPABASE_SERVICE_ROLE_KEY,
//     SUPABASE_SECRET_KEY and CLEANUP_SECRET when set in the environment;
//   - server-only code: lib/server/**, lib/supabase/admin and scripts/lib module
//     paths, and the exported names of those modules (except names that a
//     "use server" file also exports, which are public action references).
// Exit 2: the build directory is missing. Values are never printed in full.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i === -1 ? null : (args[i + 1] ?? null)
}
const root = resolve(flag("--root") ?? ".")
const buildDir = resolve(root, flag("--dir") ?? ".next")
const asJson = args.includes("--json")

if (!existsSync(join(buildDir, "static"))) {
  console.error(
    `scan-bundle: ${relative(root, buildDir) || buildDir}/static not found. Run \`pnpm build\` first.`
  )
  process.exit(2)
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else if (entry.isFile()) out.push(path)
  }
  return out
}

const PRERENDERED = /\.(html|rsc|body|meta)$/
const files = [
  ...walk(join(buildDir, "static")),
  ...walk(join(buildDir, "server", "app")).filter((f) => PRERENDERED.test(f)),
  ...walk(join(root, "public")),
]

// Exported names of server-only modules, minus public Server Function names.
function exportedNames(paths) {
  const names = new Set()
  for (const file of paths) {
    const source = readFileSync(file, "utf8")
    for (const m of source.matchAll(
      /export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/g
    )) {
      names.add(m[1])
    }
  }
  return names
}
const sourceFiles = (dir) =>
  walk(join(root, dir)).filter((f) => /\.(ts|tsx|mjs|js)$/.test(f))
const serverOnlySources = [
  ...sourceFiles("lib/server"),
  ...sourceFiles("scripts/lib"),
  ...["lib/supabase/admin.ts"]
    .map((f) => join(root, f))
    .filter((f) => existsSync(f)),
]
const publicActionNames = exportedNames(
  sourceFiles("app").filter((f) =>
    /^\s*["']use server["']/.test(readFileSync(f, "utf8"))
  )
)
// Short or generic names (fail, notFound, isUuid) would match minified code.
const serverOnlyNames = [...exportedNames(serverOnlySources)].filter(
  (name) => name.length >= 10 && !publicActionNames.has(name)
)

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const rules = [
  {
    id: "secret-name",
    re: /SUPABASE_SERVICE_ROLE\w*|SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|CLEANUP_SECRET/g,
  },
  { id: "service-role-claim", re: /\bservice_role\b/g },
  { id: "supabase-secret-key", re: /\bsb_secret_[A-Za-z0-9_-]{8,}/g },
  { id: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  {
    id: "postgres-url-password",
    re: /postgres(?:ql)?:\/\/[^\s:"'/@]+:[^\s@"']+@/g,
  },
  {
    id: "server-module-path",
    re: /\blib\/server\/|\blib\/supabase\/admin\b|\bscripts\/lib\//g,
  },
  {
    id: "jwt",
    re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    // The anon (publishable) JWT is public by design; anything else is not.
    accept: (token) => {
      try {
        const payload = JSON.parse(
          Buffer.from(token.split(".")[1], "base64url").toString("utf8")
        )
        return payload.role === "anon"
      } catch {
        return false
      }
    },
  },
]
if (serverOnlyNames.length > 0) {
  rules.push({
    id: "server-only-export",
    re: new RegExp(`\\b(?:${serverOnlyNames.map(escape).join("|")})\\b`, "g"),
  })
}
for (const name of [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
  "CLEANUP_SECRET",
]) {
  const value = process.env[name]
  // Short values would only produce noise; real secrets are long.
  if (value && value.length >= 16) {
    rules.push({
      id: `secret-value:${name}`,
      re: new RegExp(escape(value), "g"),
    })
  }
}

const PLAIN_RULES = new Set([
  "secret-name",
  "service-role-claim",
  "server-module-path",
  "server-only-export",
])
const redact = (s) => (s.length <= 12 ? s : `${s.slice(0, 10)}…(${s.length})`)

const findings = []
let bytesScanned = 0
for (const file of files) {
  const size = statSync(file).size
  bytesScanned += size
  // Binary assets (fonts, images) are scanned as latin1 so ASCII secrets still match.
  const text = readFileSync(file).toString("latin1")
  for (const rule of rules) {
    rule.re.lastIndex = 0
    for (const m of text.matchAll(rule.re)) {
      if (rule.accept?.(m[0])) continue
      findings.push({
        rule: rule.id,
        file: relative(root, file),
        offset: m.index,
        // Names and paths are not secret; values and shapes are redacted.
        match: PLAIN_RULES.has(rule.id) ? m[0] : redact(m[0]),
      })
    }
  }
}

if (asJson) {
  console.log(
    JSON.stringify(
      {
        files: files.length,
        bytesScanned,
        rules: rules.map((r) => r.id),
        findings,
      },
      null,
      2
    )
  )
} else {
  console.log(
    `scan-bundle: ${files.length} files, ${(bytesScanned / 1024).toFixed(0)} KiB, ${rules.length} rules (${serverOnlyNames.length} server-only export names).`
  )
  for (const f of findings) {
    console.log(`  FINDING ${f.rule} ${f.file}@${f.offset}: ${f.match}`)
  }
  console.log(
    findings.length === 0
      ? "scan-bundle: no findings."
      : `scan-bundle: ${findings.length} finding(s).`
  )
}
process.exit(findings.length === 0 ? 0 : 1)
