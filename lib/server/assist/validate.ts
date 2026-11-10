// Strict output validators, one per schema version (§2.2 criterion 4, §2.4).
// Hand-written in the style of validateMenuDocument; the repo has no schema library.

import {
  CONTENT_TYPES,
  MENU_IMPORT_LIMITS,
  type ContentType,
  type MenuSectionKind,
} from "@/lib/menus/types"

import type { CandidateCodes } from "./codes"
import { looksLikeCredential } from "./sanitise"
import type { ValidationIssue, ValidationResult } from "./types"

type Obj = Record<string, unknown>

const INSTRUCTION_LIKE =
  /ignore (?:all |any )?(?:previous|prior|above)|disregard (?:all |the )?(?:previous|above)|you are now|\bsystem\s*:|https?:\/\/|www\./i

// Evidence descriptions must not carry these claims (§1.3 J3).
const MEASUREMENT =
  /\b\d+(?:[.,]\d+)?\s?(?:mm|cm|m|metres?|meters?|inch(?:es)?|in|ft|feet|foot)\b/i
const PROHIBITED_CLAIM =
  /\bstep[- ]free\b|\bwheelchair[- ]accessible\b|\bfully accessible\b|\b(?:dogs?|pets?) (?:are )?(?:allowed|permitted|not allowed|banned)\b|\bpolicy\b|\bopen(?:ing)? (?:hours|times)\b/i

class Checker {
  issues: ValidationIssue[] = []
  flags = new Set<string>()

  fail(path: string, code: string) {
    this.issues.push({ path, code })
  }

  object(value: unknown, path: string, keys: readonly string[]): Obj | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      this.fail(path, "not_object")
      return null
    }
    const obj = value as Obj
    for (const k of Object.keys(obj))
      if (!keys.includes(k)) this.fail(`${path}.${k}`, "extra_field")
    for (const k of keys)
      if (!(k in obj)) this.fail(`${path}.${k}`, "missing_field")
    return obj
  }

  array(value: unknown, path: string, max: number): unknown[] | null {
    if (!Array.isArray(value)) {
      this.fail(path, "wrong_type")
      return null
    }
    if (value.length > max) this.fail(path, "too_many")
    return value
  }

  text(
    value: unknown,
    path: string,
    max: number,
    opts: { nullable?: boolean; untrusted?: boolean } = {}
  ): string | null {
    if (value === null && opts.nullable) return null
    if (typeof value !== "string") {
      this.fail(path, "wrong_type")
      return null
    }
    if (value.length > max) this.fail(path, "too_long")
    if (opts.untrusted && INSTRUCTION_LIKE.test(value))
      this.flags.add("untrusted_text_seen")
    return value
  }

  oneOf<T extends string>(
    value: unknown,
    path: string,
    allowed: readonly T[]
  ): T | null {
    if (typeof value !== "string" || !allowed.includes(value as T)) {
      this.fail(path, "out_of_set")
      return null
    }
    return value as T
  }

  boolean(value: unknown, path: string): boolean {
    if (typeof value !== "boolean") this.fail(path, "wrong_type")
    return value === true
  }

  result<T>(value: T): ValidationResult<T> {
    return this.issues.length === 0
      ? { ok: true, value, flags: [...this.flags].sort() }
      : { ok: false, issues: this.issues }
  }
}

export function parseOutput(
  raw: string
): { ok: true; value: unknown } | { ok: false; issues: ValidationIssue[] } {
  try {
    return { ok: true, value: JSON.parse(raw) }
  } catch {
    return { ok: false, issues: [{ path: "$", code: "not_json" }] }
  }
}

// ---- J1 label_suggest@1 ------------------------------------------------------

export type LabelSuggestion = {
  candidates: {
    itemId: string
    variantId: string | null
    fit: "likely" | "possible"
  }[]
  contentType: ContentType | null
  notFood: boolean
}

export function validateLabelSuggest(
  value: unknown,
  codes: CandidateCodes
): ValidationResult<LabelSuggestion> {
  const c = new Checker()
  const root = c.object(value, "$", ["candidates", "contentType", "notFood"])
  if (!root) return c.result(null as never)
  const out: LabelSuggestion = {
    candidates: [],
    contentType: null,
    notFood: false,
  }
  const seen = new Set<string>()
  const list = c.array(root.candidates, "$.candidates", 3) ?? []
  list.forEach((entry, i) => {
    const path = `$.candidates[${i}]`
    const o = c.object(entry, path, ["code", "variantCode", "fit"])
    if (!o) return
    const fit = c.oneOf(o.fit, `${path}.fit`, ["likely", "possible"] as const)
    if (typeof o.code !== "string") return c.fail(`${path}.code`, "wrong_type")
    if (o.variantCode !== null && typeof o.variantCode !== "string")
      return c.fail(`${path}.variantCode`, "wrong_type")
    const resolved = codes.resolve(o.code, o.variantCode)
    if (!resolved) return c.fail(`${path}.code`, "out_of_set")
    const key = `${resolved.itemId}/${resolved.variantId ?? ""}`
    if (seen.has(key)) return c.fail(path, "duplicate")
    seen.add(key)
    if (fit) out.candidates.push({ ...resolved, fit })
  })
  if (root.contentType !== null)
    out.contentType = c.oneOf(root.contentType, "$.contentType", CONTENT_TYPES)
  out.notFood = c.boolean(root.notFood, "$.notFood")
  return c.result(out)
}

// ---- J2 menu_import_draft@1 --------------------------------------------------

export type MenuDraftItem = {
  name: string
  description: string | null
  variants: { name: string | null; priceText: string | null }[]
  pageRef: { page: number; region: string }
  transcriptionNote: "clear" | "unclear"
}

export type MenuDraft = {
  title: string
  sections: { name: string; kind: MenuSectionKind; items: MenuDraftItem[] }[]
}

const SECTION_KINDS = ["food", "drinks", "other"] as const

export function validateMenuImportDraft(
  value: unknown,
  opts: { maxPage: number }
): ValidationResult<MenuDraft> {
  const c = new Checker()
  const root = c.object(value, "$", ["title", "sections"])
  if (!root) return c.result(null as never)
  const draft: MenuDraft = {
    title: c.text(root.title, "$.title", 120, { untrusted: true }) ?? "",
    sections: [],
  }
  let itemCount = 0
  const sections =
    c.array(root.sections, "$.sections", MENU_IMPORT_LIMITS.maxSections) ?? []
  sections.forEach((s, si) => {
    const sp = `$.sections[${si}]`
    const so = c.object(s, sp, ["name", "kind", "items"])
    if (!so) return
    const items: MenuDraftItem[] = []
    const rawItems =
      c.array(so.items, `${sp}.items`, MENU_IMPORT_LIMITS.maxItems) ?? []
    itemCount += rawItems.length
    rawItems.forEach((it, ii) => {
      const ip = `${sp}.items[${ii}]`
      const io = c.object(it, ip, [
        "name",
        "description",
        "variants",
        "pageRef",
        "transcriptionNote",
      ])
      if (!io) return
      const variants = (
        c.array(
          io.variants,
          `${ip}.variants`,
          MENU_IMPORT_LIMITS.maxVariantsPerItem
        ) ?? []
      ).map((v, vi) => {
        const vp = `${ip}.variants[${vi}]`
        const vo = c.object(v, vp, ["name", "priceText"])
        return {
          name: vo
            ? c.text(vo.name, `${vp}.name`, 80, {
                nullable: true,
                untrusted: true,
              })
            : null,
          priceText: vo
            ? c.text(vo.priceText, `${vp}.priceText`, 20, {
                nullable: true,
                untrusted: true,
              })
            : null,
        }
      })
      const ref = c.object(io.pageRef, `${ip}.pageRef`, ["page", "region"])
      const page = ref ? ref.page : null
      const pageOk =
        typeof page === "number" &&
        Number.isInteger(page) &&
        page >= 1 &&
        page <= opts.maxPage
      if (ref && !pageOk) c.fail(`${ip}.pageRef.page`, "out_of_range")
      items.push({
        name: c.text(io.name, `${ip}.name`, 120, { untrusted: true }) ?? "",
        description: c.text(io.description, `${ip}.description`, 500, {
          nullable: true,
          untrusted: true,
        }),
        variants,
        pageRef: {
          page: pageOk ? page : 0,
          region: ref
            ? (c.text(ref.region, `${ip}.pageRef.region`, 40) ?? "")
            : "",
        },
        transcriptionNote:
          c.oneOf(io.transcriptionNote, `${ip}.transcriptionNote`, [
            "clear",
            "unclear",
          ] as const) ?? "unclear",
      })
    })
    draft.sections.push({
      name: c.text(so.name, `${sp}.name`, 120, { untrusted: true }) ?? "",
      kind: c.oneOf(so.kind, `${sp}.kind`, SECTION_KINDS) ?? "other",
      items,
    })
  })
  if (itemCount > MENU_IMPORT_LIMITS.maxItems) c.fail("$.sections", "too_many")
  return c.result(draft)
}

// ---- J3 evidence_describe@1 --------------------------------------------------

export type EvidenceDescription = { observations: string[]; uncertain: boolean }

export function validateEvidenceDescribe(
  value: unknown
): ValidationResult<EvidenceDescription> {
  const c = new Checker()
  const root = c.object(value, "$", ["observations", "uncertain"])
  if (!root) return c.result(null as never)
  const observations: string[] = []
  ;(c.array(root.observations, "$.observations", 5) ?? []).forEach((o, i) => {
    const path = `$.observations[${i}]`
    const text = c.text(o, path, 120, { untrusted: true })
    if (text === null) return
    if (looksLikeCredential(text)) return c.fail(path, "credential_like")
    if (MEASUREMENT.test(text)) return c.fail(path, "measurement_claim")
    if (PROHIBITED_CLAIM.test(text)) return c.fail(path, "prohibited_claim")
    observations.push(text)
  })
  return c.result({
    observations,
    uncertain: c.boolean(root.uncertain, "$.uncertain"),
  })
}

// ---- J4 missing_field_prompts@1 ----------------------------------------------

export type FieldHints = { fields: { field: string; quote: string }[] }

export function validateMissingFieldPrompts(
  value: unknown,
  ctx: { fieldNames: readonly string[]; note: string }
): ValidationResult<FieldHints> {
  const c = new Checker()
  const root = c.object(value, "$", ["fields"])
  if (!root) return c.result(null as never)
  const fields: FieldHints["fields"] = []
  const seen = new Set<string>()
  ;(c.array(root.fields, "$.fields", ctx.fieldNames.length) ?? []).forEach(
    (f, i) => {
      const path = `$.fields[${i}]`
      const o = c.object(f, path, ["field", "quote"])
      if (!o) return
      const field = c.oneOf(o.field, `${path}.field`, ctx.fieldNames)
      const quote = c.text(o.quote, `${path}.quote`, 80)
      if (!field || quote === null) return
      if (quote.length === 0 || !ctx.note.includes(quote))
        return c.fail(`${path}.quote`, "not_substring")
      if (seen.has(field)) return c.fail(path, "duplicate")
      seen.add(field)
      fields.push({ field, quote })
    }
  )
  return c.result({ fields })
}
