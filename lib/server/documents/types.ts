import type { DocumentPurpose } from "./config"

export type DocumentState = "uploading" | "ready" | "failed"

export type DocumentReservation = {
  documentId: string
  objectPath: string
  state: DocumentState
  replayed: boolean
}

export type DocumentMeta = {
  documentId: string
  venueId: string
  purpose: DocumentPurpose
  uploadedAt: string
  uploaderFirstName: string
  sizeBytes: number | null
  state: DocumentState
  referencedBy: number
  /** Only for the uploader, admins and the venue's allergen authority. */
  filename: string | null
}

export type DocumentRpcs = {
  evidence_document_reserve: {
    args: {
      p_key: string
      p_venue_id: string
      p_purpose: DocumentPurpose
      p_filename: string
      p_size: number
    }
    returns: DocumentReservation
  }
  evidence_document_finalise_target: {
    args: { p_id: string }
    returns: {
      documentId: string
      objectPath: string
      state: DocumentState
      declaredSizeBytes: number
    }
  }
  evidence_document_meta: {
    args: { p_ids: string[] }
    returns: DocumentMeta[]
  }
  evidence_document_download_target: {
    args: { p_id: string }
    returns: {
      documentId: string
      objectPath: string
      sizeBytes: number
      sha256: string
    }
  }
  evidence_document_delete: {
    args: { p_id: string }
    returns: { documentId: string; deleted: boolean }
  }
  evidence_document_complete: {
    args: { p_id: string; p_size: number; p_sha256: string }
    returns: { documentId: string; state: "ready"; replayed: boolean }
  }
  evidence_document_fail: {
    args: { p_id: string }
    returns: { documentId: string; state: DocumentState }
  }
  prepare_document_cleanup: {
    args: {
      p_abandoned_after: string
      p_limit?: number
      p_now?: string
      p_exclude_ids?: string[]
    }
    returns: { document_id: string; object_names: string[] }[]
  }
}
export type DocumentRpcName = keyof DocumentRpcs

export type DocumentErrorCode =
  | "disabled"
  | "not_permitted"
  | "not_found"
  | "invalid_input"
  | "invalid_file"
  | "not_uploaded"
  | "referenced"
  | "state_conflict"
  | "unavailable"

export type DocumentFailure = {
  ok: false
  status: 400 | 401 | 403 | 404 | 409 | 503
  code: DocumentErrorCode
  message: string
  /** lib/server/documents/validate codes, for a refused file. */
  fileCode?: string
}

export type DocumentResult<T> = ({ ok: true } & T) | DocumentFailure
