// CONTRACT STUB (owner C, docs/fanout/CONTRACT-v0.3-menus.md). Replace the
// bodies; keep these signatures. Pure functions: no Node-only APIs, no
// Supabase, never execute or dynamically import input.

import type {
  ImportFormat,
  ImportIssue,
  MenuDiff,
  MenuDocument,
  ReviewDecision,
} from "../types"

export type ParseResult =
  | { ok: true; document: MenuDocument; issues: ImportIssue[] }
  | { ok: false; issues: ImportIssue[] }

const notImplemented = (name: string): never => {
  throw new Error(`lib/menus/import: ${name} is not implemented yet`)
}

/** Parse the documented `nabalens-menu@1` JSON format (docs/menus-import.md). */
export function parseMenuJson(text: string): ParseResult {
  void text
  return notImplemented("parseMenuJson")
}

/** Parse the documented CSV format (header row required). */
export function parseMenuCsv(text: string): ParseResult {
  void text
  return notImplemented("parseMenuCsv")
}

/** Dispatch on format; rejects anything but JSON/CSV text within limits. */
export function parseMenuFile(input: {
  fileName: string
  text: string
  format?: ImportFormat
}): ParseResult {
  void input
  return notImplemented("parseMenuFile")
}

/** Lowercase ASCII slug: `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤80 chars ("" if none). */
export function slugify(value: string): string {
  void value
  return notImplemented("slugify")
}

/** Deterministic key `section-slug--item-slug` (explicit keys win). */
export function makeSourceKey(sectionSlug: string, itemName: string): string {
  void sectionSlug
  void itemName
  return notImplemented("makeSourceKey")
}

/** Structural and limit validation of a document (editor and import). */
export function validateMenuDocument(document: MenuDocument): ImportIssue[] {
  void document
  return notImplemented("validateMenuDocument")
}

/**
 * Fill `itemId`/`variantId` on `incoming` from `base` (a document whose items
 * carry ids) by exact source key only; name-only matches become `review`
 * entries with candidates. Never merges by name automatically.
 */
export function matchImportToBase(
  base: MenuDocument | null,
  incoming: MenuDocument
): MenuDocument {
  void base
  void incoming
  return notImplemented("matchImportToBase")
}

/** Added / changed / removed / uncertain between base and next (by itemId). */
export function diffMenuDocuments(
  base: MenuDocument | null,
  next: MenuDocument
): MenuDiff {
  void base
  void next
  return notImplemented("diffMenuDocuments")
}

/** Apply an admin decision to the item with `sourceKey` (clears `review`). */
export function applyReviewDecision(
  document: MenuDocument,
  sourceKey: string,
  decision: ReviewDecision
): MenuDocument {
  void document
  void sourceKey
  void decision
  return notImplemented("applyReviewDecision")
}

/** Lowercase hex SHA-256 of UTF-8 text via Web Crypto (browser and Node). */
export async function sha256Hex(text: string): Promise<string> {
  void text
  return notImplemented("sha256Hex")
}
