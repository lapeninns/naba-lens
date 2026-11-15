import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

import ts from "typescript"
import { describe, expect, it } from "vitest"

/**
 * Staff copy guard (v0.5 rules 21 to 23; docs/plans/goals-not-tasks.md G-5).
 *
 * Food and drink work is a shared goal, not homework: staff screens for it
 * never say task, due or overdue, and a reviewer's request is "Needs another
 * photo", never "better photo". The scanner follows the scope guard's pattern
 * (tests/unit/scope-guard.test.ts), but reads only what a person can see:
 * string literals, template text and JSX text, parsed with TypeScript, so
 * identifiers (`getMyTasks`), route paths (`/staff/tasks`), import paths,
 * type unions and comments pass.
 *
 * Service, venue-specific and amenity work keeps tasks, due dates and Overdue
 * (rule 28). Those screens are on an explicit allow-list, each with a reason.
 */

const root = fileURLToPath(new URL("../../", import.meta.url))

/** The staff modules for food and drink work, by screen. */
const SCOPE: { screen: string; paths: string[] }[] = [
  {
    screen: "Home",
    paths: [
      "app/staff/tasks/page.tsx",
      "app/staff/tasks/loading.tsx",
      "app/staff/tasks/error.tsx",
      "components/nabalens/home",
      "components/nabalens/tasks",
    ],
  },
  { screen: "/staff/menu", paths: ["app/staff/menu"] },
  { screen: "Your month", paths: ["app/staff/tasks/month"] },
  { screen: "Welcome", paths: ["app/staff/tasks/welcome"] },
  {
    screen: "Me",
    paths: [
      "app/staff/page.tsx",
      "app/staff/staff-portfolio.tsx",
      "app/staff/needs-attention.tsx",
    ],
  },
  { screen: "menu-photos", paths: ["components/nabalens/menu-photos"] },
]

/**
 * Non-menu work (rule 28): amenity, service and venue task screens inside the
 * scanned folders. They keep their task words, due dates and Overdue.
 */
const ALLOWED_FILES: { file: string; reason: string }[] = [
  {
    file: "components/nabalens/tasks/all-tasks.tsx",
    reason: "the non-menu jobs list (decisions 8 and 10)",
  },
  {
    file: "components/nabalens/tasks/assignment-list.tsx",
    reason: "assigned service, venue-specific and amenity tasks",
  },
  {
    file: "components/nabalens/tasks/task-summary.tsx",
    reason: "the service and venue task page header, with its due date",
  },
  {
    file: "components/nabalens/tasks/submit-photos-panel.tsx",
    reason: "sending photos to a service or venue task",
  },
  {
    file: "components/nabalens/tasks/photo-picker.tsx",
    reason:
      "the send picker; its task words name a photo on a service or venue task",
  },
  {
    file: "components/nabalens/tasks/status-badges.tsx",
    reason: "the Overdue chip and due line, kept for non-menu work (rule 28)",
  },
]

/**
 * Single strings in scanned files that describe non-menu work. Each is
 * matched by its exact text, so a reworded string must be checked again.
 */
const ALLOWED_TEXT: { file: string; text: string; reason: string }[] = [
  {
    file: "components/nabalens/tasks/copy.ts",
    text: "Task",
    reason: "kind label fallback for a requirement of an unknown kind",
  },
  ...[
    "Videos don't count toward photo tasks.",
    "Already sent for this task.",
    "Already counting toward another task.",
    "You can't send photos to this task any more. It may have been reassigned.",
    "This task is no longer available.",
    "This task changed (it may be closed or already updated). Reload to see the latest.",
  ].map((text) => ({
    file: "components/nabalens/tasks/copy.ts",
    text,
    reason: "send errors on service and venue task screens (rule 28)",
  })),
]

/**
 * Pending: files that other phase 1 steps are rewriting (G-1 to G-4). This
 * list only shrinks. Once a file is clean, the test below fails until its
 * entry is removed, so the guard then holds for it. Do not add to it.
 */
const PENDING: { file: string; owner: string }[] = [
  { file: "app/staff/tasks/loading.tsx", owner: "G-1 (Home skeleton)" },
  { file: "app/staff/tasks/error.tsx", owner: "G-1 (Home error)" },
  {
    file: "components/nabalens/tasks/home-overview.tsx",
    owner: "G-1 (goal-led Home)",
  },
  {
    file: "components/nabalens/tasks/todo-list.tsx",
    owner: "G-1 (To do goes for menu work)",
  },
  {
    file: "components/nabalens/tasks/next-actions.tsx",
    owner: "G-1 / G-3 (retake note on Home)",
  },
  {
    file: "components/nabalens/tasks/needs-another-photo-list.tsx",
    owner: "G-3 (one retake note block)",
  },
  { file: "app/staff/staff-portfolio.tsx", owner: "G-3 (retake note on Me)" },
  {
    file: "components/nabalens/tasks/submission-list.tsx",
    owner: "G-2 (my_month_photos replaces the month list)",
  },
]

/** Whole words only: "Overdue", "Due 30 Nov", "tasks", "better photo". */
const BANNED = /\b(tasks?|due|overdue|better photos?)\b/i

/** Route paths, import paths, ids and lower-case keys: code, not copy. */
function isCode(text: string): boolean {
  const value = text.trim()
  if (value === "") return true
  if (/^[/@.#?&]/.test(value)) return true
  return /^[a-z0-9_\-.:[\]=&?/]+$/.test(value)
}

type Hit = { file: string; line: number; text: string }

/** Every piece of text a person could see in this source. */
function visibleText(
  fileName: string,
  source: string
): { line: number; text: string }[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const out: { line: number; text: string }[] = []
  const add = (node: ts.Node, text: string) => {
    if (isCode(text)) return
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file))
    out.push({ line: line + 1, text: text.replace(/\s+/g, " ").trim() })
  }
  const skip = (node: ts.Node): boolean => {
    const parent = node.parent
    if (!parent) return false
    // import "x", export … from "x", import("x"), require("x")
    if (
      ts.isImportDeclaration(parent) ||
      ts.isExportDeclaration(parent) ||
      ts.isExternalModuleReference(parent) ||
      ts.isLiteralTypeNode(parent)
    )
      return true
    if (
      ts.isCallExpression(parent) &&
      (parent.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(parent.expression) &&
          parent.expression.text === "require"))
    )
      return true
    // { "due_on": … } and obj["due"]: keys, not copy.
    if (
      (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) &&
      parent.name === node
    )
      return true
    if (ts.isElementAccessExpression(parent)) return true
    return false
  }
  const visit = (node: ts.Node) => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      !skip(node)
    )
      add(node, node.text)
    else if (ts.isTemplateExpression(node)) {
      // Holes become a space so "Due ${day}" still reads as "Due".
      add(
        node,
        [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(
          " "
        )
      )
    } else if (ts.isJsxText(node)) add(node, node.text)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return out
}

function walk(path: string): string[] {
  return statSync(path).isDirectory()
    ? readdirSync(path).flatMap((name) => walk(join(path, name)))
    : [path]
}

function scopedFiles(): string[] {
  const files = SCOPE.flatMap((s) => s.paths)
    .flatMap((p) => walk(join(root, p)))
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => relative(root, f).split(sep).join("/"))
  return [...new Set(files)].sort()
}

function hitsIn(file: string): Hit[] {
  return visibleText(file, readFileSync(join(root, file), "utf8"))
    .filter(({ text }) => BANNED.test(text))
    .map(({ line, text }) => ({ file, line, text }))
}

function allowedText(hit: Hit): boolean {
  return ALLOWED_TEXT.some((a) => a.file === hit.file && a.text === hit.text)
}

describe("staff copy guard", () => {
  const files = scopedFiles()
  const allowedFiles = new Set(ALLOWED_FILES.map((a) => a.file))
  const pending = new Set(PENDING.map((p) => p.file))

  it("scans every named staff module", () => {
    for (const { screen, paths } of SCOPE) {
      for (const path of paths) {
        expect(existsSync(join(root, path)), `${screen}: ${path}`).toBe(true)
      }
    }
    expect(files).toEqual(
      expect.arrayContaining([
        "app/staff/menu/page.tsx",
        "app/staff/tasks/month/page.tsx",
        "app/staff/tasks/welcome/page.tsx",
        "app/staff/page.tsx",
        "components/nabalens/menu-photos/copy.ts",
        "components/nabalens/tasks/copy.ts",
        "components/nabalens/tasks/first-run.tsx",
      ])
    )
  })

  it("finds no task, due, overdue or better photo in staff copy for food and drink work", () => {
    const found = files
      .filter((f) => !allowedFiles.has(f) && !pending.has(f))
      .flatMap(hitsIn)
      .filter((hit) => !allowedText(hit))
      .map((h) => `${h.file}:${h.line} ${JSON.stringify(h.text)}`)
    expect(found).toEqual([])
  })

  it("keeps the allow-list to files and strings that exist", () => {
    const missingFiles = ALLOWED_FILES.filter((a) => !files.includes(a.file))
    expect(missingFiles.map((a) => a.file)).toEqual([])
    const stale = ALLOWED_TEXT.filter(
      (a) => !hitsIn(a.file).some((h) => h.text === a.text)
    )
    expect(stale.map((a) => `${a.file}: ${a.text}`)).toEqual([])
  })

  it("only shrinks the pending list: a clean or deleted file must leave it", () => {
    const clean = PENDING.filter(
      (p) =>
        !files.includes(p.file) ||
        hitsIn(p.file).filter((h) => !allowedText(h)).length === 0
    )
    expect(
      clean.map((p) => `${p.file} is clean now; remove it from PENDING`)
    ).toEqual([])
    // A file is never both pending and allowed.
    expect(PENDING.filter((p) => allowedFiles.has(p.file))).toEqual([])
  })

  it("reads copy, not code (a guard never seen to fail proves nothing)", () => {
    const words = (source: string, name = "probe.tsx") =>
      visibleText(name, source)
        .map((t) => t.text)
        .filter((t) => BANNED.test(t))
    expect(words(`const a = <p>Overdue</p>`)).toEqual(["Overdue"])
    expect(words("const d = `Due ${day}`")).toEqual(["Due"])
    expect(words(`const s = "Better photo requested"`)).toEqual([
      "Better photo requested",
    ])
    expect(words(`const t = { title: "Your tasks" }`)).toEqual(["Your tasks"])
    expect(words(`<Chip label="Due soon" />`)).toEqual(["Due soon"])
    // Code: none of these is shown to anyone.
    expect(
      words(
        [
          `import { getMyTasks } from "@/lib/server/coverage/tasks"`,
          `const href = "/staff/tasks/all"`,
          "const back = `${TASKS_PATH}/month`",
          `type Tone = "overdue" | "due"`,
          `const state = "overdue"`,
          `const row = { "due_on": 1 }`,
          `x["due"]`,
          `// Overdue tasks are fine in a comment`,
          `/* Better photo */`,
          `const lazy = import("./tasks")`,
        ].join("\n")
      )
    ).toEqual([])
    // Words that only contain the banned ones pass.
    expect(words(`const s = "Taskbar residue subdued"`)).toEqual([])
  })
})
