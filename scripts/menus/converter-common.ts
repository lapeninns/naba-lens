import { readFileSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import path from "node:path"
import { parseMenuJson } from "../../lib/menus/import/index"
export type RawItem = {
  name: string
  description?: string
  price?: string
  labels?: string[]
  badge?: string | { text: string }
  note?: string
  options?: { label: string; price: string }[]
  [key: string]: unknown
}
export type ConvertedItem = {
  key: string
  name: string
  description: string | null
  aliases: string[]
  variants: string[]
  meta: Record<string, string | string[]>
}
export function readInput(input: string) {
  if (path.extname(input).toLowerCase() !== ".json")
    throw Error("Only JSON snapshot files are supported")
  const text = readFileSync(input, "utf8")
  if (text.includes("\0")) throw Error("Binary input is unsupported")
  return {
    raw: JSON.parse(text),
    hash: createHash("sha256").update(text).digest("hex"),
  }
}
export const git = (repo: string, ...args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim()
export function provenance(
  input: string,
  hash: string,
  revision: string,
  capturedAt: string,
  menuUpdated: string
) {
  const marker = "LapenInns Project/"
  const label = input.includes(marker) ? input.split(marker).at(-1)! : input
  return {
    label,
    revision,
    capturedAt,
    notes: `DEV FIXTURE converted ${new Date().toISOString().slice(0, 10)} from ${label} sha256 ${hash}; menuUpdated ${menuUpdated}; not proof the venue currently serves these items; prices/labels are source metadata`,
  }
}
export function emit(output: string, doc: unknown, warnings: string[]) {
  const text = JSON.stringify(doc, null, 2) + "\n"
  const result = parseMenuJson(text)
  if (!result.ok) throw Error(JSON.stringify(result.issues))
  writeFileSync(output, text)
  console.log(
    JSON.stringify(
      {
        output,
        sections: result.document.sections.length,
        items: result.document.sections.reduce((n, s) => n + s.items.length, 0),
        warnings,
      },
      null,
      2
    )
  )
}
// Split only a balanced outer suffix. Nested parentheses remain inside labels.
export function convertItem(
  raw: RawItem,
  key: string,
  warnings: string[]
): ConvertedItem {
  const meta: ConvertedItem["meta"] = {}
  for (const k of ["price", "labels", "note"] as const) {
    const v = raw[k]
    if (v !== undefined) meta[k] = v
  }
  if (raw.badge)
    meta.badge = typeof raw.badge === "string" ? raw.badge : raw.badge.text
  const item: ConvertedItem = {
    key,
    name: raw.name,
    description: raw.description ?? null,
    aliases: [],
    variants: [],
    meta,
  }
  if (raw.options?.length) {
    item.variants = raw.options.map((o) => o.label)
    meta.variantPrices = raw.options.map((o) => o.price)
    return item
  }
  if (!raw.name.includes("/")) return item
  const prices = (raw.price ?? "").split("/").map((s) => s.trim())
  let stem = "",
    labels: string[] = []
  const start = raw.name.indexOf("(")
  if (start >= 0 && raw.name.endsWith(")")) {
    stem = raw.name.slice(0, start).trim()
    const inner = raw.name.slice(start + 1, -1)
    let depth = 0,
      label = ""
    for (const c of inner) {
      if (c === "(") depth++
      if (c === ")") depth--
      if (c === "/" && depth === 0) {
        labels.push(label.trim())
        label = ""
      } else label += c
    }
    labels.push(label.trim())
    if (depth !== 0) labels = []
  } else {
    const m = raw.name.match(
      /^(.*?)\b(Veg|Chicken|Paneer|Lamb|Prawn|Meat)\s*\//i
    )
    if (m) {
      stem = m[1].trim()
      labels = raw.name
        .slice(m[1].length)
        .split("/")
        .map((s) => s.trim())
    }
  }
  if (
    labels.length > 1 &&
    labels.every(Boolean) &&
    labels.length === prices.length &&
    prices.every(Boolean)
  ) {
    item.name = stem || raw.name
    item.variants = labels
    meta.variantPrices = prices
  } else
    warnings.push(
      `${key}: ambiguous variant labels/prices retained as one item (${raw.name})`
    )
  return item
}
