import "server-only"

/** The private bucket for evidence documents. Named only under lib/server/documents. */
export const DOCUMENTS_BUCKET = "documents"

/** Defaults decided under OD-B5-17 (PDF only, 10 MiB); the database repeats them. */
export const DOCUMENT_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  abandonedUploadWindowHours: 24,
} as const

export const DOCUMENT_PURPOSES = ["menu_allergen_evidence"] as const
export type DocumentPurpose = (typeof DOCUMENT_PURPOSES)[number]

/**
 * Rollback switch for evidence document upload (b05-design §2A.6). Off unless
 * NABALENS_EVIDENCE_DOCUMENTS is "on": enabling waits for OD-B5-17. Existing
 * documents stay readable and downloadable to their holders either way.
 */
export function evidenceDocumentsEnabled(): boolean {
  return process.env.NABALENS_EVIDENCE_DOCUMENTS?.trim() === "on"
}
