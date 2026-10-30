// Input checks for the admin menu operations (lib/server/menus). Pure, so the
// unit suite can exercise them; the database re-validates everything again.

import { validateMenuDocument } from "@/lib/menus/import"
import type {
  ImportIssue,
  MenuDocItem,
  MenuDocument,
  MenuSource,
} from "@/lib/menus/types"
import { MENU_IMPORT_LIMITS } from "@/lib/menus/types"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/

/** Limits of the provenance columns on menu_versions. */
export const SOURCE_LIMITS = {
  labelMax: 200,
  revisionMax: 80,
  notesMax: 1000,
} as const

/** Database limit on review candidates and reason (save_menu_draft). */
export const REVIEW_LIMITS = { maxCandidates: 20, reasonMax: 200 } as const

export const SUGGESTION_NOTE_MAX = 280

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value)
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v)

const chars = (s: string) => [...s].length

/** A trimmed 1..max title, or null when invalid. */
export function cleanTitle(value: unknown): string | null {
  if (typeof value !== "string") return null
  const title = value.trim()
  return title && chars(title) <= MENU_IMPORT_LIMITS.titleMax ? title : null
}

/** The uploaded file's base name, capped to the provenance column. */
export function cleanFileName(value: string): string {
  const base = value.replace(/^.*[\\/]/, "").trim() || "menu"
  return [...base].slice(0, SOURCE_LIMITS.labelMax).join("")
}

/** A provenance record as save_menu_draft accepts it, or null when invalid. */
export function parseSource(value: unknown): MenuSource | null {
  if (!isObject(value)) return null
  const kind = value.kind
  if (kind !== "manual" && kind !== "json" && kind !== "csv") return null
  const text = (v: unknown, max: number): string | null | undefined => {
    if (v === null || v === undefined) return null
    if (typeof v !== "string") return undefined
    const t = v.trim()
    if (!t) return null
    return chars(t) <= max ? t : undefined
  }
  const label = text(value.label, SOURCE_LIMITS.labelMax)
  const revision = text(value.revision, SOURCE_LIMITS.revisionMax)
  const notes = text(value.notes, SOURCE_LIMITS.notesMax)
  const sha = value.sha256 ?? null
  const captured = value.capturedAt ?? null
  if (label === undefined || revision === undefined || notes === undefined)
    return null
  if (sha !== null && (typeof sha !== "string" || !SHA256.test(sha)))
    return null
  if (
    captured !== null &&
    (typeof captured !== "string" || !Number.isFinite(Date.parse(captured)))
  )
    return null
  return {
    kind,
    label,
    sha256: sha,
    revision,
    capturedAt:
      captured === null ? null : new Date(captured as string).toISOString(),
    notes,
  }
}

/**
 * Validation errors that block saving a draft. An unresolved review is allowed
 * in a draft (it only blocks activation), so `validateMenuDocument`'s review
 * errors are dropped here; id and review shapes are checked as well, because
 * a malformed UUID would otherwise surface as a database cast failure.
 */
export function draftDocumentErrors(document: unknown): ImportIssue[] {
  if (!isObject(document) || !Array.isArray(document.sections))
    return [{ severity: "error", path: "document", message: "Expected a menu" }]
  let issues: ImportIssue[]
  try {
    issues = validateMenuDocument(document as MenuDocument)
  } catch {
    return [{ severity: "error", path: "document", message: "Malformed menu" }]
  }
  const errors = issues.filter(
    (i) => i.severity === "error" && !/\.review$/.test(i.path)
  )
  const add = (path: string, message: string) =>
    errors.push({ severity: "error", path, message })
  ;(document.sections as unknown[]).forEach((s, si) => {
    if (!isObject(s) || !Array.isArray(s.items)) return
    s.items.forEach((raw: unknown, ii: number) => {
      if (!isObject(raw)) return
      const item = raw as Partial<MenuDocItem>
      const p = `sections[${si}].items[${ii}]`
      if (item.itemId !== null && !isUuid(item.itemId))
        add(`${p}.itemId`, "Invalid item id")
      if (Array.isArray(item.variants))
        item.variants.forEach((v, vi) => {
          if (isObject(v) && v.variantId !== null && !isUuid(v.variantId))
            add(`${p}.variants[${vi}]`, "Invalid variant id")
        })
      const review = item.review
      if (review === undefined) add(`${p}.review`, "Missing review field")
      else if (review !== null) {
        if (
          !isObject(review) ||
          !Array.isArray(review.candidates) ||
          review.candidates.length > REVIEW_LIMITS.maxCandidates ||
          !review.candidates.every(isUuid) ||
          typeof review.reason !== "string" ||
          !review.reason.trim() ||
          chars(review.reason) > REVIEW_LIMITS.reasonMax
        )
          add(`${p}.review`, "Invalid review")
      }
    })
  })
  return errors
}

/** "3 errors. sections[0].name: Expected 1..120 characters; …" */
export function describeIssues(issues: ImportIssue[], shown = 3): string {
  const head = issues
    .slice(0, shown)
    .map((i) => (i.path ? `${i.path}: ${i.message}` : i.message))
    .join("; ")
  const more =
    issues.length > shown ? ` (and ${issues.length - shown} more)` : ""
  const count = issues.length === 1 ? "1 error" : `${issues.length} errors`
  return `The menu has ${count}. ${head}${more}`
}

/** A copy of the document with the given title, sections untouched. */
export function withTitle(document: MenuDocument, title: string): MenuDocument {
  return { ...document, title }
}

/** Integer revision ≥ 1. */
export function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
}

/** Trimmed note, null when empty; undefined when too long or not text. */
export function cleanNote(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null
  if (typeof value !== "string") return undefined
  const t = value.trim()
  if (!t) return null
  return chars(t) <= SUGGESTION_NOTE_MAX ? t : undefined
}
