// Pure helpers shared by the admin menu client components (import review,
// draft editor, suggestions). No server or browser APIs.

import { applyReviewDecision } from "@/lib/menus/import"
import type {
  ImportIssue,
  MenuDocument,
  ReviewDecision,
} from "@/lib/menus/types"

/**
 * The import document with every decision applied to the ORIGINAL preview
 * document, so a decision can be changed later (applyReviewDecision needs the
 * item's review, which the first decision clears). `base` carries variant ids
 * of the chosen existing item forward.
 */
export function resolveDecisions(
  original: MenuDocument,
  decisions: Record<string, ReviewDecision>,
  base: MenuDocument | null
): { document: MenuDocument; error: string | null } {
  let document = original
  for (const [sourceKey, decision] of Object.entries(decisions)) {
    try {
      document = applyReviewDecision(
        document,
        sourceKey,
        decision,
        base ?? undefined
      )
    } catch (error) {
      return {
        document,
        error:
          error instanceof Error
            ? `Could not apply the decision for ${sourceKey}: ${error.message}`
            : `Could not apply the decision for ${sourceKey}.`,
      }
    }
  }
  return { document, error: null }
}

/**
 * Applies one decision to an edited draft. If the item's review was already
 * cleared by an earlier (unsaved) decision, it is restored from the saved
 * document first so the decision can be changed.
 */
export function decideInDraft(
  current: MenuDocument,
  saved: MenuDocument,
  sourceKey: string,
  decision: ReviewDecision,
  base: MenuDocument | null
): MenuDocument {
  const review = saved.sections
    .flatMap((s) => s.items)
    .find((i) => i.sourceKey === sourceKey)?.review
  const doc = structuredClone(current)
  const item = doc.sections
    .flatMap((s) => s.items)
    .find((i) => i.sourceKey === sourceKey)
  if (!item) throw new Error("This item is no longer in the draft.")
  if (!item.review) {
    if (!review) throw new Error("This item has no review to resolve.")
    item.review = structuredClone(review)
  }
  return applyReviewDecision(doc, sourceKey, decision, base ?? undefined)
}

/** Validation errors only (warnings never block). */
export function errorCount(issues: ImportIssue[]): number {
  return issues.filter((i) => i.severity === "error").length
}

/**
 * Activation-blocking errors: everything except "needs review", which the
 * activation dialog counts separately as unresolved matches.
 */
export function blockingErrors(issues: ImportIssue[]): ImportIssue[] {
  return issues.filter(
    (i) => i.severity === "error" && !/\.review$/.test(i.path)
  )
}

/** Unresolved reviews in a document. */
export function reviewCount(document: MenuDocument): number {
  return document.sections.reduce(
    (n, s) => n + s.items.filter((i) => i.review).length,
    0
  )
}

/** Item options ("Name (Section)") for linking suggestions; archived omitted. */
export function itemOptions(
  document: MenuDocument | null,
  archivedItemIds: string[] = []
): { id: string; name: string }[] {
  if (!document) return []
  const archived = new Set(archivedItemIds)
  return document.sections.flatMap((s) =>
    s.items
      .filter((i) => i.itemId && !archived.has(i.itemId))
      .map((i) => ({ id: i.itemId!, name: `${i.name} (${s.name})` }))
  )
}

/** Stable comparison for "unsaved changes". */
export function sameDocument(a: MenuDocument, b: MenuDocument): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
