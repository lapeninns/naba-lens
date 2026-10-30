import "server-only"

// CONTRACT STUB (owner D, docs/fanout/CONTRACT-v0.3-menus.md). Replace the
// bodies; keep these signatures. Every function re-checks the actor is an
// active admin (actor.profile.role) and relies on RLS/RPC checks as well.

import type {
  ImportFormat,
  ImportIssue,
  MenuDiff,
  MenuDocument,
  MenuSource,
  MenuVenueSummary,
  MenuVersionDetail,
  MenuVersionSummary,
  SuggestionView,
} from "@/lib/menus/types"
import type { MediaActor, Outcome } from "@/lib/server/media/types"

const NOT_READY = {
  ok: false,
  status: 503,
  message: "Menus are not available yet.",
} as const

export type VenueMenuOverview = {
  venue: { id: string; name: string; active: boolean }
  active: MenuVersionSummary | null
  drafts: MenuVersionSummary[]
  /** Retired and discarded versions, newest first. */
  history: MenuVersionSummary[]
  suggestions: SuggestionView[]
}

export type ImportPreview = {
  /** Matched against the venue's active version (ids filled, reviews set). */
  document: MenuDocument
  issues: ImportIssue[]
  diff: MenuDiff
  source: MenuSource
  /** Active version the diff was computed against, or null. */
  baseVersionId: string | null
}

export async function listMenuVenues(
  actor: MediaActor
): Promise<Outcome<{ venues: MenuVenueSummary[] }>> {
  void actor
  return NOT_READY
}

export async function getVenueMenuOverview(
  actor: MediaActor,
  venueId: string
): Promise<Outcome<VenueMenuOverview>> {
  void actor
  void venueId
  return NOT_READY
}

/** A version with its document, and its diff against the venue's active one. */
export async function getMenuVersion(
  actor: MediaActor,
  versionId: string
): Promise<Outcome<{ version: MenuVersionDetail; diff: MenuDiff | null }>> {
  void actor
  void versionId
  return NOT_READY
}

/** Parse + validate + match + diff. Writes nothing. */
export async function previewMenuImport(
  actor: MediaActor,
  input: {
    venueId: string
    fileName: string
    text: string
    format?: ImportFormat
  }
): Promise<Outcome<ImportPreview>> {
  void actor
  void input
  return NOT_READY
}

export async function createMenuDraft(
  actor: MediaActor,
  input: {
    venueId: string
    title: string
    source: MenuSource
    document: MenuDocument
    basedOnVersionId: string | null
  }
): Promise<Outcome<{ versionId: string }>> {
  void actor
  void input
  return NOT_READY
}

export async function saveMenuDraft(
  actor: MediaActor,
  input: { versionId: string; expectedRevision: number; document: MenuDocument }
): Promise<Outcome<{ revision: number }>> {
  void actor
  void input
  return NOT_READY
}

export async function activateMenuVersion(
  actor: MediaActor,
  input: { versionId: string; expectedRevision: number }
): Promise<Outcome<Record<never, never>>> {
  void actor
  void input
  return NOT_READY
}

export async function retireMenuVersion(
  actor: MediaActor,
  versionId: string
): Promise<Outcome<Record<never, never>>> {
  void actor
  void versionId
  return NOT_READY
}

export async function discardMenuDraft(
  actor: MediaActor,
  versionId: string
): Promise<Outcome<Record<never, never>>> {
  void actor
  void versionId
  return NOT_READY
}

export async function setMenuItemArchived(
  actor: MediaActor,
  input: { itemId: string; archived: boolean }
): Promise<Outcome<Record<never, never>>> {
  void actor
  void input
  return NOT_READY
}

export async function resolveMenuSuggestion(
  actor: MediaActor,
  input: {
    suggestionId: string
    status: "resolved" | "dismissed"
    itemId: string | null
    note: string | null
  }
): Promise<Outcome<Record<never, never>>> {
  void actor
  void input
  return NOT_READY
}
