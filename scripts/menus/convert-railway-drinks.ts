import path from "node:path"
import { slugify } from "../../lib/menus/import/index"
import { emit, git, provenance, readInput } from "./converter-common"
import type { RawItem, ConvertedItem } from "./converter-common"
type Section = {
  title: string
  measure?: string
  items?: RawItem[]
  subsections?: Section[]
}
type Drinks = { pages: { columns?: { panels: { sections: Section[] }[] }[] }[] }
const [input, output] = process.argv.slice(2)
if (!input || !output)
  throw Error("Usage: convert-railway-drinks.ts input.json output.json")
const { raw, hash } = readInput(input)
const drinks = raw as Drinks
const warnings: string[] = []
const sections: {
  key: string
  name: string
  kind: string
  items: ConvertedItem[]
}[] = []
function visit(s: Section, parent = "") {
  const key = [parent, slugify(s.title)].filter(Boolean).join("-")
  const items = (s.items ?? []).map((i) => {
    const meta: ConvertedItem["meta"] = {}
    for (const k of [
      "price",
      "price2",
      "price3",
      "tier",
      "note",
      "detail",
      "pairsWith",
      "tags",
    ]) {
      const v = i[k]
      if (
        typeof v === "string" ||
        (Array.isArray(v) && v.every((x) => typeof x === "string"))
      )
        meta[k === "tags" ? "labels" : k] = v as string | string[]
      else if (v !== undefined)
        warnings.push(`${key}/${i.name}: unsupported metadata ${k}`)
    }
    if (i.badge)
      meta.badge = typeof i.badge === "string" ? i.badge : i.badge.text
    if (s.measure) meta.measure = s.measure
    const prices = [i.price, i.price2, i.price3].filter(
      (v): v is string => typeof v === "string"
    )
    const labels = (s.measure ?? "").split("/").map((x) => x.trim())
    const variants =
      prices.length > 1 && labels.length === prices.length ? labels : []
    if (prices.length > 1 && !variants.length)
      warnings.push(`${key}/${i.name}: measures/prices do not align`)
    if (variants.length) meta.variantPrices = prices
    return {
      key: `${key}--${slugify(i.name)}`,
      name: i.name,
      description: null,
      aliases: [],
      variants,
      meta,
    }
  })
  if (items.length) sections.push({ key, name: s.title, kind: "drinks", items })
  for (const sub of s.subsections ?? []) visit(sub, key)
}
for (const page of drinks.pages)
  for (const col of page.columns ?? [])
    for (const panel of col.panels)
      for (const section of panel.sections) visit(section)
const repo = path.resolve(path.dirname(input), ".."),
  file = path.relative(repo, input)
const revision = git(repo, "log", "-1", "--format=%H", "--", file)
const capturedAt = git(repo, "show", "-s", "--format=%cI", revision)
emit(
  output,
  {
    format: "nabalens-menu@1",
    title: "The Railway drinks (DEV FIXTURE)",
    source: provenance(
      input,
      hash,
      revision,
      capturedAt,
      capturedAt.slice(0, 10)
    ),
    sections,
  },
  warnings
)
