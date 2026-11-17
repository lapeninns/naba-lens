import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"

import ts from "typescript"

// Shared by the staff copy guard and the Album guard: what a person can see
// in a source file (string literals, template text and JSX text), parsed with
// TypeScript, so identifiers, route and import paths, type unions and
// comments pass.

/** Route paths, import paths, ids and lower-case keys: code, not copy. */
export function isCode(text: string): boolean {
  const value = text.trim()
  if (value === "") return true
  if (/^[/@.#?&]/.test(value)) return true
  return /^[a-z0-9_\-.:[\]=&?/]+$/.test(value)
}

/** Every piece of text a person could see in this source. */
export function visibleText(
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

export function walk(path: string): string[] {
  return statSync(path).isDirectory()
    ? readdirSync(path).flatMap((name) => walk(join(path, name)))
    : [path]
}
