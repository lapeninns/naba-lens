// B04-a (docs: b04-design §4): declared menu sources, source snapshots, the
// field authority manifest and the reviewed crosswalk between NabaLens item and
// variant ids and source entries. Pure: no Supabase, no Node APIs, so server
// code, Server Functions and components may all import it.
//
// The matcher, the snapshot validator and the content hash mirror the SQL in
// supabase/migrations/20261110150000_menu_b04a_sources_crosswalk.sql
// (public.menu_crosswalk_propose, private.menu_snapshot_document_error,
// private.menu_crosswalk_content_hash). The database is authoritative for
// writes; tests/security/menus-crosswalk.test.ts pins both sides on shared
// fixtures. Tooling only proposes: nothing here confirms a row.

import { nameKey } from "../import/matching"
import { SOURCE_KEY_PATTERN } from "../types"

// ---------------------------------------------------------------------------
// Closed sets (one list per side, as the SQL checks)
// ---------------------------------------------------------------------------

export const MENU_SOURCE_KINDS = [
  "venue_website",
  "menu_design",
  "operator_document",
  "pos_export",
  "nabalens",
] as const
export type MenuSourceKind = (typeof MENU_SOURCE_KINDS)[number]

/** Manifest fields (§4.3), in report order. */
export const MENU_FIELDS = [
  "identity",
  "name",
  "description",
  "section",
  "variants",
  "price",
  "portion",
  "availability",
  "temporary_unavailability",
  "modifiers",
  "dietary",
  "allergens",
  "photos",
] as const
export type MenuField = (typeof MENU_FIELDS)[number]

export const MENU_CHANNELS = ["all", "dine_in", "takeaway"] as const
export type MenuChannel = (typeof MENU_CHANNELS)[number]

export const FIELD_AUTHORITIES = [
  "source_document",
  "venue_website",
  "nabalens",
  "not_published",
] as const
export type FieldAuthority = (typeof FIELD_AUTHORITIES)[number]

/**
 * §4.4 defaults (OD-B4-1, owner to confirm). Every field starts with today's
 * authority; none is switched to NabaLens by B04-a.
 */
export const DEFAULT_FIELD_AUTHORITY: Record<MenuField, FieldAuthority> = {
  identity: "nabalens",
  name: "source_document",
  description: "source_document",
  section: "source_document",
  variants: "source_document",
  price: "venue_website",
  portion: "venue_website",
  availability: "venue_website",
  temporary_unavailability: "venue_website",
  modifiers: "venue_website",
  dietary: "venue_website",
  allergens: "not_published",
  photos: "nabalens",
}

/**
 * Fields that may be recorded as `nabalens` in B04-a: only those already
 * NabaLens's (§4.4). Any other switch waits for the B04-05 reconciliation
 * report and the owner (§4.4, §12 OD-B4-1); the database refuses it with
 * `authority_switch_not_enabled`.
 */
export const NABALENS_FIELDS_NOW: readonly MenuField[] = ["identity", "photos"]

/** Which source kinds a field authority may cite. */
export function authoritySourceKinds(
  authority: FieldAuthority
): readonly MenuSourceKind[] {
  if (authority === "venue_website") return ["venue_website"]
  if (authority === "source_document")
    return ["menu_design", "operator_document", "pos_export"]
  return []
}

export const CROSSWALK_STATUSES = [
  "proposed",
  "ambiguous",
  "confirmed",
  "unmatched",
  "not_on_source",
  "needs_review",
  "rejected",
  "carried",
] as const
export type CrosswalkStatus = (typeof CROSSWALK_STATUSES)[number]

export const CROSSWALK_BASES = [
  "source_key_exact",
  "name_candidate",
  "manual",
  "carried",
] as const
export type CrosswalkBasis = (typeof CROSSWALK_BASES)[number]

/** What a reviewer may decide (§4.5). Tooling never writes these. */
export const CROSSWALK_DECISIONS = [
  "confirmed",
  "rejected",
  "unmatched",
] as const
export type CrosswalkDecisionStatus = (typeof CROSSWALK_DECISIONS)[number]

/** A row in one of these maps its identity line. */
export const CROSSWALK_MAPPED: readonly CrosswalkStatus[] = [
  "confirmed",
  "carried",
]
/** Rows a reviewer still has to look at. */
export const CROSSWALK_OPEN: readonly CrosswalkStatus[] = [
  "proposed",
  "ambiguous",
  "needs_review",
]

/** Source kinds whose entries carry NabaLens source keys (exact match). */
export const SOURCE_KEY_LINEAGE_KINDS: readonly MenuSourceKind[] = [
  "menu_design",
  "nabalens",
]

/** Per active entry and source, in the manifest (§4.2 #7). */
export const MANIFEST_OUTCOMES = [
  "confirmed",
  "needs_review",
  "not_on_source",
  "unmatched",
] as const
export type ManifestOutcome = (typeof MANIFEST_OUTCOMES)[number]

// ---------------------------------------------------------------------------
// Limits (mirror the SQL checks)
// ---------------------------------------------------------------------------

export const MENU_SOURCE_LIMITS = {
  labelMax: 200,
  locatorMax: 500,
  revisionMax: 80,
  reasonMax: 280,
  authorityReasonMax: 500,
} as const

/**
 * Entry locators: 900 characters and 1200 UTF-8 bytes. A generated locator
 * (`websiteLocators`) used to be admitted when its unencoded form fit 300
 * characters; `locatorPart` turns a `%` or `#` into three characters and
 * leaves every other character alone, so such an input now encodes to at most
 * 3 × 300 = 900 characters (888 in fact: the `#name=` delimiter is not
 * encoded) and at most 4 × 300 = 1200 bytes (an encoded `%23` is 3 bytes, a
 * character never more than 4). Every input admitted before encoding is
 * admitted with its encoded locator, and none changes identity. 1200 bytes is
 * also what a 300-character locator could already take, so the index keys of
 * `menu_crosswalk` and `menu_crosswalk_heads` stay within the same byte
 * envelope (see `CROSSWALK_LOCATOR_BYTES_MAX`).
 */
export const SNAPSHOT_LIMITS = {
  maxEntries: 2000,
  locatorMax: 900,
  locatorBytesMax: 1200,
  nameMax: 120,
  sectionMax: 120,
  descriptionMax: 600,
  priceTextMax: 80,
  maxAliases: 10,
  aliasMax: 80,
  maxVariants: 12,
  variantMax: 80,
  maxLabels: 20,
  labelMax: 40,
} as const

export const CROSSWALK_MAX_CANDIDATES = 20

/** Reserved inside locators: it separates an entry from its variant. */
export const VARIANT_LOCATOR_MARK = "#variant="

// ---------------------------------------------------------------------------
// Snapshot documents
// ---------------------------------------------------------------------------

/**
 * One normalised source entry (§4.3). Prices stay text exactly as the source
 * wrote them (a JSON number is read as its decimal text, §3 "Money"); labels
 * such as `GF` stay source labels, never claims.
 */
export type SnapshotEntry = {
  /** Stable within the source (see `websiteLocators`). */
  locator: string
  name: string
  section?: string | null
  description?: string | null
  aliases?: string[]
  variants?: string[]
  priceText?: string | null
  labels?: string[]
  /** A NabaLens source key, only for NabaLens-lineage sources. */
  sourceKey?: string | null
}

const ENTRY_KEYS = [
  "locator",
  "name",
  "section",
  "description",
  "aliases",
  "variants",
  "priceText",
  "labels",
  "sourceKey",
] as const

export type SnapshotIssue = { path: string; message: string }

const chars = (s: string) => [...s].length
/** As SQL `btrim(x) = x`: only spaces count as outer space. */
const trimmed = (s: string) => !s.startsWith(" ") && !s.endsWith(" ")
const utf8 = new TextEncoder()
/** jsonb key order: shorter keys first, then by UTF-8 bytes. */
function jsonbKeyOrder(a: string, b: string): number {
  const x = utf8.encode(a),
    y = utf8.encode(b)
  if (x.length !== y.length) return x.length - y.length
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

function textOk(value: unknown, max: number, optional: boolean): boolean {
  if (value === undefined || value === null) return optional
  return (
    typeof value === "string" &&
    chars(value) >= 1 &&
    chars(value) <= max &&
    trimmed(value)
  )
}

function listOk(value: unknown, maxItems: number, maxLength: number): boolean {
  if (value === undefined) return true
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every((v) => textOk(v, maxLength, false))
  )
}

/**
 * The first problem in a snapshot document, or null. Same checks, order, paths
 * and messages as `private.menu_snapshot_document_error`.
 */
export function snapshotDocumentError(document: unknown): SnapshotIssue | null {
  const L = SNAPSHOT_LIMITS
  if (!Array.isArray(document))
    return { path: "", message: "The document is a list of entries" }
  if (document.length > L.maxEntries)
    return { path: "", message: `At most ${L.maxEntries} entries` }
  const seen = new Set<string>()
  for (let i = 0; i < document.length; i++) {
    const p = `[${i}]`
    const entry: unknown = document[i]
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      return { path: p, message: "Each entry is an object" }
    const e = entry as Record<string, unknown>
    const unknown = Object.keys(e)
      .filter((k) => !(ENTRY_KEYS as readonly string[]).includes(k))
      .sort(jsonbKeyOrder)
    if (unknown.length)
      return { path: `${p}.${unknown[0]}`, message: "Unknown field" }
    // A key whose value is undefined is absent from JSON; treat it so.
    if (!textOk(e.locator, L.locatorMax, false))
      return {
        path: `${p}.locator`,
        message: `1 to ${L.locatorMax} characters, no outer spaces`,
      }
    if (utf8.encode(e.locator as string).length > L.locatorBytesMax)
      return {
        path: `${p}.locator`,
        message: `At most ${L.locatorBytesMax} bytes`,
      }
    if ((e.locator as string).includes(VARIANT_LOCATOR_MARK))
      return {
        path: `${p}.locator`,
        message: "Contains the reserved #variant=",
      }
    if (!textOk(e.name, L.nameMax, false))
      return {
        path: `${p}.name`,
        message: `1 to ${L.nameMax} characters, no outer spaces`,
      }
    for (const [key, max] of [
      ["section", L.sectionMax],
      ["description", L.descriptionMax],
      ["priceText", L.priceTextMax],
    ] as const)
      if (!textOk(e[key], max, true))
        return {
          path: `${p}.${key}`,
          message: `Up to ${max} characters, no outer spaces`,
        }
    if (
      e.sourceKey !== undefined &&
      e.sourceKey !== null &&
      !(typeof e.sourceKey === "string" && SOURCE_KEY_PATTERN.test(e.sourceKey))
    )
      return { path: `${p}.sourceKey`, message: "Invalid source key" }
    for (const [key, items, max] of [
      ["aliases", L.maxAliases, L.aliasMax],
      ["variants", L.maxVariants, L.variantMax],
      ["labels", L.maxLabels, L.labelMax],
    ] as const)
      if (!listOk(e[key], items, max))
        return {
          path: `${p}.${key}`,
          message: `Up to ${items} values of 1 to ${max} characters`,
        }
    if (seen.has(e.locator as string))
      return { path: `${p}.locator`, message: "Duplicate locator" }
    seen.add(e.locator as string)
  }
  return null
}

/**
 * One component of a generated locator: `%` and `#` percent-encoded
 * (`private.menu_locator_part`), so a name never contains the `#` that starts
 * a delimiter (`#category=`, `#name=`, `#variant=`) or a repeat suffix (`#2`).
 * Generated locators are therefore distinct for distinct occurrences, whatever
 * the source names contain.
 */
export const locatorPart = (s: string) =>
  s.replace(/%/g, "%25").replace(/#/g, "%23")

/**
 * Locators for sources without stable ids (§4.3): the document reference plus
 * the item's name within its category, with `#2`, `#3`… when a category
 * repeats a name. `file` may carry a menu prefix (for example
 * `takeaway/curries.json`) so one dish listed on two menus gets two locators.
 * Each component is encoded with `locatorPart`.
 */
export function websiteLocators(
  entries: { file: string; category?: string | null; name: string }[]
): string[] {
  const counts = new Map<string, number>()
  return entries.map(({ file, category, name }) => {
    const base = `${locatorPart(file)}${category ? `#category=${locatorPart(category)}` : ""}#name=${locatorPart(name)}`
    const n = (counts.get(base) ?? 0) + 1
    counts.set(base, n)
    return n > 1 ? `${base}#${n}` : base
  })
}

/** Variant names as the catalogue compares them (`lower(btrim(name))`). */
export const variantNameKey = (s: string) =>
  s.replace(/^ +| +$/g, "").toLowerCase()

/** One variant an entry lists, as `private.menu_crosswalk_variants`. */
export type VariantOccurrence = {
  name: string
  /** `variantNameKey(name)`. */
  key: string
  /** 1 for the first variant with this key in the entry, 2 for the next… */
  occurrence: number
  locator: string
}

/**
 * An entry's variants in list order with their locators: the entry locator,
 * `#variant=`, the encoded variant name, and `#2`… when the entry repeats a
 * variant name.
 */
export function variantOccurrences(entry: SnapshotEntry): VariantOccurrence[] {
  const counts = new Map<string, number>()
  return (entry.variants ?? []).map((name) => {
    const key = variantNameKey(name)
    const occurrence = (counts.get(key) ?? 0) + 1
    counts.set(key, occurrence)
    return {
      name,
      key,
      occurrence,
      locator: `${entry.locator}${VARIANT_LOCATOR_MARK}${locatorPart(name)}${occurrence > 1 ? `#${occurrence}` : ""}`,
    }
  })
}

/** The locators of an entry's variants (see `variantOccurrences`). */
export const variantLocators = (entry: SnapshotEntry): string[] =>
  variantOccurrences(entry).map((v) => v.locator)

/**
 * The longest crosswalk locator (`menu_crosswalk.locator`): an entry locator,
 * `#variant=`, a variant name whose every character is encoded to three, and
 * the largest repeat suffix: 900 + 9 + 240 + 3 = 1152 characters.
 */
export const CROSSWALK_LOCATOR_MAX =
  SNAPSHOT_LIMITS.locatorMax +
  VARIANT_LOCATOR_MARK.length +
  3 * SNAPSHOT_LIMITS.variantMax +
  `#${SNAPSHOT_LIMITS.maxVariants}`.length

/**
 * The same in UTF-8 bytes: 1200 + 9 + 4 × 80 (a variant character is at most
 * 4 bytes, encoded or not) + 3 = 1532. With the source id and sequence this
 * is well inside a btree index key (about 2700 bytes on an 8 kB page).
 */
export const CROSSWALK_LOCATOR_BYTES_MAX =
  SNAPSHOT_LIMITS.locatorBytesMax +
  VARIANT_LOCATOR_MARK.length +
  4 * SNAPSHOT_LIMITS.variantMax +
  `#${SNAPSHOT_LIMITS.maxVariants}`.length

/**
 * The entry of `entries` a crosswalk locator stands for (its index), or -1
 * when the snapshot does not list it: the entry itself, or for a variant row
 * the entry of `entryLocator` when it lists this variant occurrence. As
 * `private.menu_crosswalk_occurrence`.
 */
export function crosswalkOccurrence(
  entries: SnapshotEntry[],
  locator: string,
  entryLocator: string | null
): number {
  const i = entries.findIndex((e) => e.locator === (entryLocator ?? locator))
  if (i < 0 || entryLocator === null) return i
  return variantLocators(entries[i]).includes(locator) ? i : -1
}

const jsonText = (v: string | null | undefined) =>
  v === undefined || v === null ? "null" : JSON.stringify(v)
const jsonList = (v: string[] | undefined) =>
  `[${(v ?? []).map((x) => JSON.stringify(x)).join(", ")}]`

/**
 * The text whose SHA-256 is an entry's content hash: name, description,
 * variants, labels and price text (§4.3), written exactly as Postgres prints
 * `jsonb_build_array(...)::text`. The locator is not part of it.
 */
export function contentHashInput(entry: SnapshotEntry): string {
  return `[${jsonText(entry.name)}, ${jsonText(entry.description)}, ${jsonList(entry.variants)}, ${jsonList(entry.labels)}, ${jsonText(entry.priceText)}]`
}

// ---------------------------------------------------------------------------
// The matcher (proposals only)
// ---------------------------------------------------------------------------

/** One entry of the venue's active catalogue version, in display order. */
export type CatalogueEntry = {
  itemId: string
  sourceKey: string
  name: string
  aliases: string[]
  sectionName: string
  variants: { variantId: string; name: string }[]
}

/** The row in force for one `(source, locator)`. */
export type CrosswalkHead = {
  locator: string
  /** Set on variant rows: the locator of the entry the variant belongs to. */
  entryLocator: string | null
  status: CrosswalkStatus
  /** The basis of the head's row (see `isDeferredProposal`). */
  basis: CrosswalkBasis
  itemId: string | null
  variantId: string | null
  channel: MenuChannel
  contentHash: string
  snapshotId: string
}

export type ProposedRow = {
  locator: string
  entryLocator: string | null
  status: CrosswalkStatus
  basis: CrosswalkBasis
  itemId: string | null
  variantId: string | null
  channel: MenuChannel
  /** Item ids (entry rows) or variant ids (variant rows), at most 20. */
  candidates: string[]
  /** Before truncation to 20. */
  candidateCount: number
  contentHash: string
}

export type ProposeInput = {
  snapshotId: string
  sourceKind: MenuSourceKind
  entries: SnapshotEntry[]
  /** `contentHashes[i]` is SHA-256 hex of `contentHashInput(entries[i])`. */
  contentHashes: string[]
  /** The active version's entries; null when the venue has none. */
  catalogue: CatalogueEntry[] | null
  heads: CrosswalkHead[]
}

export type ProposeResult = { rows: ProposedRow[]; skipped: number }

const isMapped = (s: CrosswalkStatus) => CROSSWALK_MAPPED.includes(s)

/** A row that keeps a head's identity line (carried, needs review, removed). */
function mappedRow(
  head: CrosswalkHead,
  locator: string,
  entryLocator: string | null,
  contentHash: string
): Omit<ProposedRow, "status"> {
  return {
    locator,
    entryLocator,
    basis: "carried",
    itemId: head.itemId,
    variantId: head.variantId,
    channel: head.channel,
    candidates: [],
    candidateCount: 0,
    contentHash,
  }
}

/** `needs_review`, listing the previously mapped id as the one candidate. */
function reviewRow(
  head: CrosswalkHead,
  locator: string,
  entryLocator: string | null,
  contentHash: string
): ProposedRow {
  const previous = entryLocator ? head.variantId : head.itemId
  return {
    ...mappedRow(head, locator, entryLocator, contentHash),
    status: "needs_review",
    candidates: previous ? [previous] : [],
    candidateCount: previous ? 1 : 0,
  }
}

/**
 * A variant proposal deferred while its entry awaits review: `needs_review`
 * on `name_candidate`, inside the item it was proposed in, with no variant and
 * no candidates. What was proposed stays on the row this one supersedes (the
 * database also copies it into the evidence as `deferredProposal`, marked
 * historical); nothing here is a claim about the new snapshot.
 */
function deferredRow(
  head: CrosswalkHead,
  locator: string,
  entryLocator: string,
  contentHash: string
): ProposedRow {
  return {
    locator,
    entryLocator,
    status: "needs_review",
    basis: "name_candidate",
    itemId: head.itemId,
    variantId: null,
    channel: head.channel,
    candidates: [],
    candidateCount: 0,
    contentHash,
  }
}

/**
 * A head that is a deferred variant proposal (`deferredRow`): the matcher
 * proposes it afresh once its entry is mapped, even on the same snapshot and
 * item. Every other `needs_review` row (basis `carried`) awaits a reviewer.
 */
export const isDeferredProposal = (
  head: Pick<CrosswalkHead, "status" | "basis">
) => head.status === "needs_review" && head.basis === "name_candidate"

const isDecidedAway = (s: CrosswalkStatus) =>
  s === "unmatched" || s === "rejected"

/** Name keys of an entry or catalogue row: its name and aliases, non-empty. */
function keysOf(name: string, aliases: string[] | undefined): Set<string> {
  return new Set([name, ...(aliases ?? [])].map(nameKey).filter(Boolean))
}

/**
 * Proposals for one snapshot, in the order `menu_crosswalk_propose` writes
 * them: every entry row, then variant rows, then `not_on_source` rows for
 * locators the snapshot no longer lists.
 *
 * - An identical locator and content hash carries a confirmed row (`carried`,
 *   reviewer kept); any other change sends it to `needs_review` (§4.2 #6).
 * - A NabaLens-lineage source proposes by exact source key; otherwise names
 *   and aliases give candidates. Several candidates, or a name the source
 *   repeats, make the row `ambiguous` with every candidate listed (§4.2 #4).
 * - Variants are matched only inside the item the entry is confirmed to
 *   (§4.2 #5), so a variant name is never matched across items. A variant the
 *   snapshot lists is on the source even while its entry awaits review: a
 *   mapping it had, or a review still open on other content, goes to
 *   `needs_review` on this snapshot's evidence, and only a variant the
 *   snapshot no longer lists becomes `not_on_source`. An open proposal
 *   (`proposed`, `ambiguous`, or one deferred before) on other content is
 *   deferred (`deferredRow`): it claims no candidate until the entry is
 *   mapped again, when it is matched afresh.
 * - An entry row already written from this snapshot is skipped; a variant row
 *   is skipped only while it is from this snapshot, inside the item its entry
 *   is mapped to now, and not a deferred proposal. Running the matcher again
 *   after confirming (or correcting) entries adds or re-proposes only the
 *   variant rows.
 */
export function proposeCrosswalk(input: ProposeInput): ProposeResult {
  const heads = new Map(input.heads.map((h) => [h.locator, h]))
  const rows: ProposedRow[] = []
  let skipped = 0
  const write = (row: ProposedRow) => {
    rows.push(row)
    heads.set(row.locator, {
      locator: row.locator,
      entryLocator: row.entryLocator,
      status: row.status,
      basis: row.basis,
      itemId: row.itemId,
      variantId: row.variantId,
      channel: row.channel,
      contentHash: row.contentHash,
      snapshotId: input.snapshotId,
    })
  }
  /** Carry or re-review a mapped head; false when the head is not mapped. */
  const fromMapped = (
    head: CrosswalkHead | undefined,
    locator: string,
    entryLocator: string | null,
    contentHash: string,
    sameItem: boolean
  ): boolean => {
    if (!head || !isMapped(head.status)) return false
    if (head.contentHash === contentHash && sameItem)
      write({
        ...mappedRow(head, locator, entryLocator, contentHash),
        status: "carried",
      })
    else write(reviewRow(head, locator, entryLocator, contentHash))
    return true
  }

  const catalogue = input.catalogue ?? []
  const bySourceKey = new Map(catalogue.map((c) => [c.sourceKey, c]))
  const catalogueKeys = catalogue.map((c) => keysOf(c.name, c.aliases))
  const nameCounts = new Map<string, number>()
  for (const e of input.entries) {
    const k = nameKey(e.name)
    nameCounts.set(k, (nameCounts.get(k) ?? 0) + 1)
  }
  const lineage = SOURCE_KEY_LINEAGE_KINDS.includes(input.sourceKind)

  // 1. Entry rows.
  input.entries.forEach((entry, i) => {
    const hash = input.contentHashes[i]
    const head = heads.get(entry.locator)
    if (head?.snapshotId === input.snapshotId) return void skipped++
    if (fromMapped(head, entry.locator, null, hash, true)) return
    if (head && isDecidedAway(head.status) && head.contentHash === hash)
      return void skipped++
    const base = {
      locator: entry.locator,
      entryLocator: null,
      variantId: null,
      channel: "all" as const,
      contentHash: hash,
    }
    const exact =
      lineage && entry.sourceKey ? bySourceKey.get(entry.sourceKey) : undefined
    if (exact) {
      write({
        ...base,
        status: "proposed",
        basis: "source_key_exact",
        itemId: exact.itemId,
        candidates: [exact.itemId],
        candidateCount: 1,
      })
      return
    }
    const keys = keysOf(entry.name, entry.aliases)
    const found = catalogue.filter((_, n) =>
      [...catalogueKeys[n]].some((k) => keys.has(k))
    )
    const ids = [...new Set(found.map((c) => c.itemId))]
    const repeated = (nameCounts.get(nameKey(entry.name)) ?? 0) > 1
    const single = ids.length === 1 && !repeated
    write({
      ...base,
      status: ids.length === 0 || single ? "proposed" : "ambiguous",
      basis: "name_candidate",
      itemId: single ? ids[0] : null,
      candidates: ids.slice(0, CROSSWALK_MAX_CANDIDATES),
      candidateCount: ids.length,
    })
  })

  // 2. Variant rows. Every variant the snapshot lists is on the source whether
  // or not its entry is mapped; proposals are made only inside the item the
  // entry is mapped to.
  const listed = new Set(input.entries.map((e) => e.locator))
  input.entries.forEach((entry, i) => {
    const hash = input.contentHashes[i]
    const parent = heads.get(entry.locator)
    const parentItem =
      parent && isMapped(parent.status) && !parent.variantId
        ? parent.itemId
        : null
    const item = catalogue.find((c) => c.itemId === parentItem)
    for (const { key, occurrence, locator } of variantOccurrences(entry)) {
      listed.add(locator)
      const head = heads.get(locator)
      // Written from this snapshot's evidence already.
      const current =
        head?.snapshotId === input.snapshotId && head.contentHash === hash
      if (!parentItem) {
        // The entry is not mapped: a mapping (or a removal) the variant had is
        // reviewed again on this snapshot's evidence, as is a review still
        // open on older evidence; an open proposal on older evidence is
        // deferred. Nothing is proposed.
        if (!head || current) continue
        const changed = head.contentHash !== hash
        if (
          changed &&
          (head.status === "proposed" ||
            head.status === "ambiguous" ||
            isDeferredProposal(head))
        )
          write(deferredRow(head, locator, entry.locator, hash))
        else if (
          isMapped(head.status) ||
          head.status === "not_on_source" ||
          (head.status === "needs_review" && changed)
        )
          write(reviewRow(head, locator, entry.locator, hash))
        continue
      }
      const sameItem = head?.itemId === parentItem
      // A deferred proposal is matched afresh once its entry is mapped.
      if (current && sameItem && !(head && isDeferredProposal(head))) {
        skipped++
        continue
      }
      if (fromMapped(head, locator, entry.locator, hash, sameItem)) continue
      if (
        head &&
        isDecidedAway(head.status) &&
        head.contentHash === hash &&
        sameItem
      ) {
        skipped++
        continue
      }
      // New, removed and back, decided on other content, proposed inside
      // another item (the entry was mapped again), or deferred while the
      // entry awaited review: matched afresh.
      const ids = (item?.variants ?? [])
        .filter((v) => variantNameKey(v.name) === key)
        .map((v) => v.variantId)
      const single = ids.length === 1 && occurrence === 1
      write({
        locator,
        entryLocator: entry.locator,
        status: ids.length === 0 || single ? "proposed" : "ambiguous",
        basis: "name_candidate",
        itemId: parentItem,
        variantId: single ? ids[0] : null,
        channel: "all",
        candidates: ids.slice(0, CROSSWALK_MAX_CANDIDATES),
        candidateCount: ids.length,
        contentHash: hash,
      })
    }
  })

  // 3. Locators the snapshot no longer lists, entries and variants alike.
  const remaining = [...heads.values()]
    .filter((h) => h.status !== "not_on_source" && !listed.has(h.locator))
    .sort((a, b) =>
      a.locator < b.locator ? -1 : a.locator > b.locator ? 1 : 0
    )
  for (const h of remaining)
    write({
      ...mappedRow(h, h.locator, h.entryLocator, h.contentHash),
      status: "not_on_source",
    })
  return { rows, skipped }
}

// ---------------------------------------------------------------------------
// Decisions (uniqueness rules the database enforces, for early feedback)
// ---------------------------------------------------------------------------

export type CrosswalkDecision =
  | {
      status: "confirmed"
      itemId: string
      variantId: string | null
      channel: MenuChannel
    }
  | { status: "rejected" | "unmatched" }

export type CrosswalkDecisionError =
  | "crosswalk_conflict"
  | "crosswalk_not_on_source"
  | "crosswalk_parent_not_confirmed"
  | "crosswalk_variant_required"
  | "crosswalk_variant_wrong_item"

/**
 * Why the database would refuse this decision on `locator`, from the heads of
 * the same source, or null. `variantItem` names a variant's item (null when
 * unknown). Checks that need the database (venue, active menu, the source's
 * newest snapshot: `crosswalkProvenanceError`) are not here.
 */
export function crosswalkDecisionError(
  heads: CrosswalkHead[],
  locator: string,
  decision: CrosswalkDecision,
  variantItem: (variantId: string) => string | null
): CrosswalkDecisionError | null {
  const head = heads.find((h) => h.locator === locator)
  if (!head) return null
  // A removed entry is never decided on its last-known evidence.
  if (head.status === "not_on_source") return "crosswalk_not_on_source"
  if (decision.status !== "confirmed") return null
  if (decision.variantId && variantItem(decision.variantId) !== decision.itemId)
    return "crosswalk_variant_wrong_item"
  if (head.entryLocator) {
    if (!decision.variantId) return "crosswalk_variant_required"
    const parent = heads.find((h) => h.locator === head.entryLocator)
    if (
      !parent ||
      !isMapped(parent.status) ||
      parent.itemId !== decision.itemId
    )
      return "crosswalk_parent_not_confirmed"
  }
  if (
    isMapped(head.status) &&
    (head.itemId !== decision.itemId ||
      head.variantId !== decision.variantId ||
      head.channel !== decision.channel)
  )
    return "crosswalk_conflict"
  const taken = heads.some(
    (h) =>
      h.locator !== locator &&
      isMapped(h.status) &&
      h.itemId === decision.itemId &&
      h.variantId === decision.variantId &&
      h.channel === decision.channel
  )
  return taken ? "crosswalk_conflict" : null
}

/** The source's newest snapshot, as `menu_crosswalk_decide` reads it. */
export type CurrentSnapshot = {
  /** The matcher has run on it (`menu_crosswalk_runs`). */
  processed: boolean
  entries: SnapshotEntry[]
  /** `contentHashes[i]` is SHA-256 hex of `contentHashInput(entries[i])`. */
  contentHashes: string[]
}

/**
 * The provenance rule of `menu_crosswalk_decide` (§4.2 #2, #6): a decision is
 * refused while the source's newest snapshot awaits the matcher
 * (`crosswalk_reconcile_pending`), and for a row whose entry or variant that
 * snapshot does not list (`crosswalk_not_on_source`). A confirmation also
 * needs the row's content hash to be the listed entry's.
 */
export function crosswalkProvenanceError(
  head: Pick<
    CrosswalkHead,
    "locator" | "entryLocator" | "status" | "contentHash"
  >,
  decision: Pick<CrosswalkDecision, "status">,
  current: CurrentSnapshot
): "crosswalk_reconcile_pending" | "crosswalk_not_on_source" | null {
  if (!current.processed) return "crosswalk_reconcile_pending"
  const i = crosswalkOccurrence(
    current.entries,
    head.locator,
    head.entryLocator
  )
  if (
    head.status === "not_on_source" ||
    i < 0 ||
    (decision.status === "confirmed" &&
      current.contentHashes[i] !== head.contentHash)
  )
    return "crosswalk_not_on_source"
  return null
}

/**
 * The manifest outcome of one active item for one source (§4.2 #7), as
 * `public.menu_manifest` computes it: mapped by an entry row → `confirmed`;
 * named by an open entry row (as item or candidate) → `needs_review`; the
 * source has crosswalk rows but none names the item → `not_on_source`; no
 * crosswalk run for the source yet → `unmatched`.
 */
export function manifestOutcome(
  itemId: string,
  heads: (CrosswalkHead & { candidates: string[] })[]
): ManifestOutcome {
  const entryRows = heads.filter((h) => !h.entryLocator)
  if (entryRows.some((h) => isMapped(h.status) && h.itemId === itemId))
    return "confirmed"
  if (
    entryRows.some(
      (h) =>
        CROSSWALK_OPEN.includes(h.status) &&
        (h.itemId === itemId || h.candidates.includes(itemId))
    )
  )
    return "needs_review"
  return heads.length ? "not_on_source" : "unmatched"
}

// ---------------------------------------------------------------------------
// Manifest (public.menu_manifest, B04-01d)
// ---------------------------------------------------------------------------

export type ManifestFieldRow = {
  field: MenuField
  channel: MenuChannel
  authority: FieldAuthority
  sourceId: string | null
  sourceKind: MenuSourceKind | null
  sourceLabel: string | null
  effectiveFrom: string | null
  /** `design_default`: the §4.4 default, not yet confirmed by the owner. */
  basis: "design_default" | "owner_approval"
  /** Admin view only. */
  reason?: string
  approvedBy?: string | null
  approvedAt?: string | null
}

export type ManifestSnapshot = {
  /** Admin view only. */
  snapshotId?: string
  revision: string
  capturedAt: string | null
  retrievedAt: string
  entryCount: number
}

export type ManifestSource = {
  sourceId: string
  kind: MenuSourceKind
  label: string
  /** Admin view only. */
  locator?: string | null
  declaredAt: string
  retiredAt: string | null
  latestSnapshot: ManifestSnapshot | null
  /**
   * The newest snapshot the matcher has run on: the crosswalk rows, outcomes
   * and price text of this source stand for it.
   */
  reconciledSnapshot: ManifestSnapshot | null
  /**
   * The latest snapshot awaits the matcher; until it runs, no row of this
   * source can be decided (`crosswalk_reconcile_pending`).
   */
  reconciliationPending: boolean
  /** Rows in force by status. */
  counts: Partial<Record<CrosswalkStatus, number>>
}

export type ManifestEntry = {
  itemId: string
  name: string
  sectionName: string
  sectionKind: "food" | "drinks" | "other"
  outcomes: {
    sourceId: string
    outcome: ManifestOutcome
    /** Admin view only: the source's price text for this item, as written. */
    priceText?: string | null
  }[]
  /** Two sources give different price text for this item (never resolved here). */
  priceDisagreement: boolean
}

export type ManifestReviewRow = {
  rowId: string
  revision: number
  sourceId: string
  locator: string
  entryLocator: string | null
  status: CrosswalkStatus
  basis: CrosswalkBasis
  itemId: string | null
  variantId: string | null
  channel: MenuChannel
  candidates: string[]
  evidence: Record<string, unknown>
  proposedAt: string
}

/** Where the next page of `menu_crosswalk_rows` starts: after this row. */
export type CrosswalkRowsCursor = { sourceId: string; locator: string }

export type MenuManifest = {
  schema: "1.0"
  venueId: string
  view: "admin" | "manager"
  activeVersionId: string | null
  fields: ManifestFieldRow[]
  sources: ManifestSource[]
  entries: ManifestEntry[]
  /**
   * Admin view only (null for managers): the first
   * `MANIFEST_REVIEW_LIMIT` open and removed rows to review.
   */
  review: ManifestReviewRow[] | null
  reviewTruncated: boolean
  /**
   * Admin view only: when the review list is truncated, the cursor that
   * `menu_crosswalk_rows` continues it from (null otherwise).
   */
  reviewNext: CrosswalkRowsCursor | null
}

export const MANIFEST_REVIEW_LIMIT = 5000

/** `menu_crosswalk_rows` with no statuses: the manifest's review list. */
export const CROSSWALK_REVIEW_STATUSES: readonly CrosswalkStatus[] = [
  "proposed",
  "ambiguous",
  "needs_review",
  "not_on_source",
]

/** Page sizes of `menu_crosswalk_rows`. */
export const CROSSWALK_ROWS_PAGE = { default: 100, max: 1000 } as const

/**
 * A row in force (admin). Confirmed and carried rows carry their reviewer, so
 * a reviewer can find a current mapping and its revision to reject it.
 */
export type CrosswalkRow = ManifestReviewRow & {
  reviewedBy: string | null
  reviewedAt: string | null
  reason: string | null
}

const csvCell = (v: string) => {
  // Spreadsheet formula prefixes are neutralised; quotes doubled.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** The manifest's entry outcomes as CSV (one row per entry and source). */
export function manifestCsv(manifest: MenuManifest): string {
  const labels = new Map(manifest.sources.map((s) => [s.sourceId, s.label]))
  const lines = [
    ["item_id", "name", "section", "source", "outcome", "price_disagreement"],
  ]
  for (const e of manifest.entries) {
    const outcomes = e.outcomes.length
      ? e.outcomes
      : [{ sourceId: "", outcome: "unmatched" as const }]
    for (const o of outcomes)
      lines.push([
        e.itemId,
        e.name,
        e.sectionName,
        labels.get(o.sourceId) ?? "",
        o.outcome,
        e.priceDisagreement ? "yes" : "no",
      ])
  }
  return lines.map((l) => l.map(csvCell).join(",")).join("\r\n") + "\r\n"
}
