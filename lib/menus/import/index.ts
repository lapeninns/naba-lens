import { MENU_IMPORT_LIMITS as L, SOURCE_KEY_PATTERN } from "../types"
import type {
  ImportFormat,
  ImportIssue,
  MenuDocument,
  MenuDocItem,
  MenuSource,
} from "../types"
export type ParseResult =
  | {
      ok: true
      document: MenuDocument
      issues: ImportIssue[]
      source?: MenuSource
    }
  | { ok: false; issues: ImportIssue[] }
export const normaliseName = (s: string) =>
  s
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80)
    .replace(/-$/, "")
}
export function makeSourceKey(sectionSlug: string, itemName: string): string {
  return `${sectionSlug}--${slugify(itemName)}`
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v)
const bytes = (s: string) => new TextEncoder().encode(s).length
const issue = (
  path: string,
  message: string,
  severity: "error" | "warning" = "error"
): ImportIssue => ({ path, message, severity })
function safety(text: string): ImportIssue[] {
  return [
    ...(bytes(text) > L.maxBytes
      ? [issue("file", "Text exceeds the 1 MiB UTF-8 limit")]
      : []),
    ...(text.includes("\0")
      ? [issue("file", "Binary input (NUL bytes) is not supported")]
      : []),
  ]
}
const metaValid = (v: unknown) =>
  v === null ||
  typeof v === "string" ||
  typeof v === "boolean" ||
  (typeof v === "number" && Number.isFinite(v)) ||
  (Array.isArray(v) && v.every((x) => typeof x === "string"))
export function validateMenuDocument(document: MenuDocument): ImportIssue[] {
  const issues: ImportIssue[] = []
  const add = (p: string, m: string) => issues.push(issue(p, m))
  const str = (v: unknown, p: string, max: number, empty = false) => {
    if (typeof v !== "string" || (!empty && !v.trim()) || [...v].length > max)
      add(p, `Expected ${empty ? "0" : "1"}..${max} characters`)
  }
  if (!object(document)) return [issue("document", "Expected an object")]
  str(document.title, "title", L.titleMax)
  if (!Array.isArray(document.sections))
    return [...issues, issue("sections", "Expected an array")]
  if (document.sections.length > L.maxSections)
    add("sections", "Too many sections")
  const slugs = new Map<string, string>(),
    keys = new Map<string, string>(),
    ids = new Map<string, string>()
  let total = 0
  document.sections.forEach((s, si) => {
    const p = `sections[${si}]`
    if (!object(s)) {
      add(p, "Expected an object")
      return
    }
    str(s.name, p + ".name", L.sectionNameMax)
    if (
      typeof s.slug !== "string" ||
      s.slug.length > 80 ||
      !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.slug)
    )
      add(p + ".slug", "Invalid section slug")
    if (slugs.has(s.slug))
      add(p + ".slug", `Duplicate section key; first at ${slugs.get(s.slug)}`)
    slugs.set(s.slug, p)
    if (!["food", "drinks", "other"].includes(s.kind))
      add(p + ".kind", "Invalid section kind")
    if (!Array.isArray(s.items)) {
      add(p + ".items", "Expected an array")
      return
    }
    total += s.items.length
    s.items.forEach((i, ii) => {
      const q = `${p}.items[${ii}]`
      if (!object(i)) {
        add(q, "Expected an object")
        return
      }
      str(i.name, q + ".name", L.nameMax)
      if (
        typeof i.sourceKey !== "string" ||
        !SOURCE_KEY_PATTERN.test(i.sourceKey)
      )
        add(q + ".sourceKey", "Invalid source key")
      if (keys.has(i.sourceKey))
        add(
          q + ".sourceKey",
          `Duplicate source key; first at ${keys.get(i.sourceKey)}`
        )
      keys.set(i.sourceKey, q)
      if (i.itemId !== null) {
        if (typeof i.itemId !== "string" || !i.itemId.trim())
          add(q + ".itemId", "Invalid itemId")
        if (ids.has(i.itemId))
          add(q + ".itemId", `Duplicate itemId; first at ${ids.get(i.itemId)}`)
        ids.set(i.itemId, q)
      }
      if (i.description !== null)
        str(i.description, q + ".description", L.descriptionMax, true)
      if (!Array.isArray(i.aliases) || i.aliases.length > L.maxAliases)
        add(q + ".aliases", "Invalid aliases or too many aliases")
      if (Array.isArray(i.aliases))
        i.aliases.forEach((a, n) => str(a, `${q}.aliases[${n}]`, L.aliasMax))
      if (
        !object(i.sourceMeta) ||
        !Object.values(i.sourceMeta).every(metaValid)
      )
        add(q + ".sourceMeta", "Invalid metadata values")
      try {
        if (bytes(JSON.stringify(i.sourceMeta)) > L.sourceMetaMaxBytes)
          add(q + ".sourceMeta", "Metadata exceeds serialised byte limit")
      } catch {
        add(q + ".sourceMeta", "Metadata is not serialisable")
      }
      if (i.review !== null)
        add(q + ".review", "Item needs review before activation")
      if (
        !Array.isArray(i.variants) ||
        i.variants.length > L.maxVariantsPerItem
      )
        add(q + ".variants", "Invalid variants or too many variants")
      const names = new Set<string>(),
        vids = new Set<string>()
      if (Array.isArray(i.variants))
        i.variants.forEach((v, n) => {
          const r = `${q}.variants[${n}]`
          if (!object(v)) {
            add(r, "Expected an object")
            return
          }
          str(v.name, r + ".name", L.variantNameMax)
          const k =
            typeof v.name === "string"
              ? normaliseName(v.name).toLowerCase()
              : ""
          if (names.has(k)) add(r, "Duplicate variant name")
          names.add(k)
          if (v.variantId !== null) {
            if (typeof v.variantId !== "string" || !v.variantId.trim())
              add(r, "Invalid variantId")
            if (vids.has(v.variantId)) add(r, "Duplicate variantId within item")
            vids.add(v.variantId)
          }
        })
    })
  })
  if (total > L.maxItems) add("sections", "Too many items")
  return issues
}
export function parseMenuJson(text: string): ParseResult {
  const issues = safety(text)
  if (issues.length) return { ok: false, issues }
  let raw: unknown
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ""))
  } catch {
    return { ok: false, issues: [issue("file", "Invalid JSON")] }
  }
  if (!object(raw))
    return { ok: false, issues: [issue("file", "Expected a JSON object")] }
  if (raw.format !== "nabalens-menu@1")
    issues.push(issue("format", "Expected format nabalens-menu@1"))
  const unknown = (o: Record<string, unknown>, allowed: string[], p: string) =>
    Object.keys(o)
      .filter((k) => !allowed.includes(k))
      .forEach((k) =>
        issues.push(
          issue(p ? `${p}.${k}` : k, "Unknown field ignored", "warning")
        )
      )
  unknown(raw, ["format", "title", "source", "sections"], "")
  const clean = (v: unknown, p: string, optional = false): string => {
    if (typeof v !== "string") {
      if (!optional || v != null) issues.push(issue(p, "Expected a string"))
      return ""
    }
    return normaliseName(v)
  }
  const document: MenuDocument = {
    title: clean(raw.title, "title"),
    sections: [],
  }
  if (!Array.isArray(raw.sections))
    issues.push(issue("sections", "Expected an array"))
  else
    raw.sections.forEach((s, si) => {
      const p = `sections[${si}]`
      if (!object(s)) {
        issues.push(issue(p, "Expected an object"))
        return
      }
      unknown(s, ["key", "name", "kind", "items"], p)
      const name = clean(s.name, p + ".name")
      const slug =
        s.key === undefined ? slugify(name) : clean(s.key, p + ".key")
      const section: MenuDocument["sections"][number] = {
        slug,
        name,
        kind: (s.kind ?? "food") as "food",
        items: [],
      }
      if (!Array.isArray(s.items))
        issues.push(issue(p + ".items", "Expected an array"))
      else
        s.items.forEach((i, ii) => {
          const q = `${p}.items[${ii}]`
          if (!object(i)) {
            issues.push(issue(q, "Expected an object"))
            return
          }
          unknown(
            i,
            ["key", "name", "description", "aliases", "variants", "meta"],
            q
          )
          const name = clean(i.name, q + ".name")
          const aliases: string[] = []
          if (i.aliases !== undefined && !Array.isArray(i.aliases))
            issues.push(issue(q + ".aliases", "Expected an array"))
          else
            (i.aliases as unknown[] | undefined)?.forEach((a, n) =>
              aliases.push(clean(a, `${q}.aliases[${n}]`))
            )
          const variants: MenuDocItem["variants"] = []
          if (i.variants !== undefined && !Array.isArray(i.variants))
            issues.push(issue(q + ".variants", "Expected an array"))
          else
            (i.variants as unknown[] | undefined)?.forEach((v, n) =>
              variants.push({
                variantId: null,
                name: clean(object(v) ? v.name : v, `${q}.variants[${n}]`),
              })
            )
          section.items.push({
            itemId: null,
            sourceKey:
              i.key === undefined
                ? makeSourceKey(slug, name)
                : clean(i.key, q + ".key"),
            name,
            description:
              i.description == null
                ? null
                : clean(i.description, q + ".description"),
            aliases,
            variants,
            sourceMeta: (i.meta === undefined
              ? {}
              : i.meta) as MenuDocItem["sourceMeta"],
            review: null,
          })
        })
      document.sections.push(section)
    })
  issues.push(...validateMenuDocument(document))
  document.sections = document.sections.filter((s, si) => {
    if (s.items.length) return true
    issues.push(issue(`sections[${si}]`, "Empty section dropped", "warning"))
    return false
  })
  let source: MenuSource | undefined
  if (raw.source !== undefined) {
    if (!object(raw.source)) issues.push(issue("source", "Expected an object"))
    else {
      const s = raw.source
      source = {
        kind: "json",
        label: null,
        sha256: null,
        revision: null,
        capturedAt: null,
        notes: null,
      }
      for (const k of ["label", "revision", "capturedAt", "notes"] as const) {
        if (s[k] != null && typeof s[k] !== "string")
          issues.push(issue(`source.${k}`, "Expected a string"))
        else source[k] = (s[k] as string | null) ?? null
      }
      if (source.capturedAt && !Number.isFinite(Date.parse(source.capturedAt)))
        issues.push(issue("source.capturedAt", "Expected an ISO timestamp"))
    }
  }
  return issues.some((i) => i.severity === "error")
    ? { ok: false, issues }
    : { ok: true, document, issues, ...(source ? { source } : {}) }
}
/** RFC 4180 state machine. Row paths count logical records, header = row 1. */
export function parseMenuCsv(text: string): ParseResult {
  const errors = safety(text)
  if (errors.length) return { ok: false, issues: errors }
  const rows: string[][] = []
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false
  text = text.replace(/^\uFEFF/, "")
  const fail = (m: string): ParseResult => ({
    ok: false,
    issues: [issue(`row ${rows.length + 1}`, m)],
  })
  for (let n = 0; n < text.length; n++) {
    const c = text[n]
    if (quoted) {
      if (c === '"') {
        if (text[n + 1] === '"') {
          cell += '"'
          n++
        } else {
          quoted = false
          closed = true
        }
      } else cell += c
      continue
    }
    if (c === '"') {
      if (cell || closed) return fail("Unexpected quote")
      quoted = true
    } else if (c === "," || c === "\r" || c === "\n") {
      row.push(cell)
      cell = ""
      closed = false
      if (c !== ",") {
        rows.push(row)
        row = []
        if (c === "\r" && text[n + 1] === "\n") n++
      }
    } else {
      if (closed) return fail("Unexpected character after closing quote")
      cell += c
    }
  }
  if (quoted) return fail("Unclosed quoted field")
  if (cell || row.length || closed) {
    row.push(cell)
    rows.push(row)
  }
  if (!rows.length) return fail("Header required")
  const headers = rows.shift()!.map((h) => h.trim().toLowerCase())
  if (!headers.includes("section") || !headers.includes("item"))
    return {
      ok: false,
      issues: [issue("row 1", "Required headers: section, item")],
    }
  if (new Set(headers).size !== headers.length)
    return { ok: false, issues: [issue("row 1", "Duplicate headers")] }
  const sections: {
    key: string
    name: string
    kind: string
    items: unknown[]
  }[] = []
  const locations: number[][] = []
  const csvIssues: ImportIssue[] = []
  rows.forEach((cells, n) => {
    if (cells.every((c) => !c.trim())) return
    if (cells.length !== headers.length) {
      csvIssues.push(issue(`row ${n + 2}`, "Field count differs from header"))
      return
    }
    const r = Object.fromEntries(headers.map((h, i) => [h, cells[i]]))
    const key = r.section_key || slugify(r.section)
    let si = sections.findIndex((s) => s.key === key)
    if (si < 0) {
      si = sections.length
      sections.push({
        key,
        name: r.section,
        kind: r.section_kind || "food",
        items: [],
      })
      locations.push([])
    } else if (
      normaliseName(sections[si].name) !== normaliseName(r.section) ||
      sections[si].kind !== (r.section_kind || "food")
    )
      csvIssues.push(issue(`row ${n + 2}`, "Inconsistent section fields"))
    const meta: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(r)) {
      if (k.startsWith("meta_")) meta[k.slice(5)] = v
    }
    if (r.price) meta.price = r.price
    if (r.dietary)
      meta.labels = r.dietary
        .split("|")
        .map((x) => x.trim())
        .filter(Boolean)
    sections[si].items.push({
      name: r.item,
      ...(r.key ? { key: r.key } : {}),
      description: r.description || null,
      aliases: r.aliases ? r.aliases.split("|") : [],
      variants: r.variants ? r.variants.split("|") : [],
      meta,
    })
    locations[si].push(n + 2)
  })
  const result = parseMenuJson(
    JSON.stringify({
      format: "nabalens-menu@1",
      title: "Imported CSV",
      sections,
    })
  )
  const rowPath = (p: string) =>
    p.replace(
      /sections\[(\d+)\]\.items\[(\d+)\]/g,
      (_, s, i) => `row ${locations[+s]?.[+i] ?? "?"}`
    )
  const issues = [
    ...csvIssues,
    ...result.issues.map((i) => ({
      ...i,
      path: rowPath(i.path),
      message: rowPath(i.message),
    })),
  ]
  return !result.ok || issues.some((i) => i.severity === "error")
    ? { ok: false, issues }
    : { ...result, issues }
}
export function parseMenuFile(input: {
  fileName: string
  text: string
  format?: ImportFormat
}): ParseResult {
  const format = input.format ?? input.fileName.split(".").pop()?.toLowerCase()
  if (format !== "json" && format !== "csv")
    return {
      ok: false,
      issues: [
        issue(
          "file",
          "Only structured JSON/CSV text is supported; PDF, images and other formats cannot be imported"
        ),
      ],
    }
  const result =
    format === "json" ? parseMenuJson(input.text) : parseMenuCsv(input.text)
  if (result.ok && format === "csv") {
    result.document.title = normaliseName(
      input.fileName.replace(/^.*[\\/]/, "").replace(/\.[^.]*$/, "")
    )
    result.issues.push(...validateMenuDocument(result.document))
    if (result.issues.some((i) => i.severity === "error"))
      return { ok: false, issues: result.issues }
  }
  return result
}
export async function sha256Hex(text: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
    ),
    (b) => b.toString(16).padStart(2, "0")
  ).join("")
}
export {
  matchImportToBase,
  diffMenuDocuments,
  applyReviewDecision,
} from "./matching"
