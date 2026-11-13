import "server-only"

import { isObject, isUuid } from "@/lib/server/coverage/validate"
import { cleanFilename, UPLOAD_KEY_PATTERN } from "@/lib/server/media/reserve"
import type { MediaActor } from "@/lib/server/media/types"

import {
  DOCUMENTS_BUCKET,
  DOCUMENT_LIMITS,
  DOCUMENT_PURPOSES,
  evidenceDocumentsEnabled,
  type DocumentPurpose,
} from "./config"
import {
  DOCUMENT_NOT_FOUND,
  documentFailure,
  documentRpcFailure,
} from "./errors"
import { documentRpc } from "./rpc"
import { fetchDocumentObject, readDocumentObject } from "./storage"
import type { DocumentMeta, DocumentResult, DocumentState } from "./types"
import { checkPdf, fileCodeMessage } from "./validate"

/**
 * Exact headers of a document download (b05-design §2A.4): always an
 * attachment, never shown inline, never cached. The filename is generic
 * because not every holder may see the original name.
 */
export const DOWNLOAD_HEADERS = {
  "content-type": "application/pdf",
  "content-disposition": 'attachment; filename="evidence-document.pdf"',
  "x-content-type-options": "nosniff",
  "cache-control": "private, no-store",
  "content-security-policy": "sandbox",
} as const

const invalid = (message: string) => documentFailure("invalid_input", message)

/**
 * Reserves a document upload at a venue the caller holds and returns a signed
 * upload URL for that key only (signed as the caller, so the storage insert
 * policy applies). A retry with the same key returns the same document.
 */
export async function reserveDocument(
  actor: MediaActor,
  input: unknown
): Promise<
  DocumentResult<{
    documentId: string
    state: DocumentState
    uploadUrl?: string
    token?: string
  }>
> {
  if (!evidenceDocumentsEnabled())
    return documentFailure("disabled", "Adding documents is switched off.")
  if (!isObject(input)) return invalid("This upload request is invalid.")
  const { key, venueId, purpose, filename, sizeBytes } = input
  if (typeof key !== "string" || !UPLOAD_KEY_PATTERN.test(key))
    return invalid("Reload and try again.")
  if (!isUuid(venueId)) return invalid("Choose a venue.")
  if (!DOCUMENT_PURPOSES.includes(purpose as DocumentPurpose))
    return invalid("This upload request is invalid.")
  const name = cleanFilename(String(filename ?? ""))
  if (!name) return invalid("This file has no name.")
  if (!name.toLowerCase().endsWith(".pdf"))
    return documentFailure(
      "invalid_file",
      fileCodeMessage("not_pdf"),
      "not_pdf"
    )
  const size = Number(sizeBytes)
  if (!Number.isSafeInteger(size) || size <= 0)
    return invalid("This file is empty.")
  if (size > DOCUMENT_LIMITS.maxBytes)
    return documentFailure(
      "invalid_file",
      fileCodeMessage("file_too_large"),
      "file_too_large"
    )

  const { data, error } = await documentRpc(
    actor.db,
    "evidence_document_reserve",
    {
      p_key: key,
      p_venue_id: venueId,
      p_purpose: purpose as DocumentPurpose,
      p_filename: name,
      p_size: size,
    }
  )
  if (error) return documentRpcFailure(error, "document reserve")
  if (data.state !== "uploading")
    return { ok: true, documentId: data.documentId, state: data.state }
  const signed = await actor.db.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUploadUrl(data.objectPath)
  if (signed.error || !signed.data)
    return documentFailure(
      "unavailable",
      "Could not prepare the upload. Try again."
    )
  return {
    ok: true,
    documentId: data.documentId,
    state: data.state,
    uploadUrl: signed.data.signedUrl,
    token: signed.data.token,
  }
}

/**
 * Validates the stored bytes of the caller's own upload and records the
 * result: ready with its SHA-256, or failed with a file code. Safe to repeat.
 */
export async function finaliseDocument(
  actor: MediaActor,
  documentId: string
): Promise<DocumentResult<{ documentId: string; state: DocumentState }>> {
  if (!isUuid(documentId)) return DOCUMENT_NOT_FOUND
  const target = await documentRpc(
    actor.db,
    "evidence_document_finalise_target",
    {
      p_id: documentId,
    }
  )
  if (target.error) return documentRpcFailure(target.error, "document finalise")
  if (target.data.state === "ready")
    return { ok: true, documentId, state: "ready" }
  let bytes: Uint8Array | null
  try {
    bytes = await readDocumentObject(actor.storage, target.data.objectPath)
  } catch (error) {
    return documentRpcFailure(
      { message: error instanceof Error ? error.message : "storage_error" },
      "document read"
    )
  }
  if (!bytes)
    return documentFailure(
      "not_uploaded",
      "The file has not finished uploading."
    )
  const check = checkPdf(bytes)
  if (!check.ok) {
    const failed = await documentRpc(actor.service, "evidence_document_fail", {
      p_id: documentId,
    })
    if (failed.error) return documentRpcFailure(failed.error, "document fail")
    return documentFailure(
      "invalid_file",
      fileCodeMessage(check.code),
      check.code
    )
  }
  const done = await documentRpc(actor.service, "evidence_document_complete", {
    p_id: documentId,
    p_size: check.sizeBytes,
    p_sha256: check.sha256,
  })
  if (done.error) return documentRpcFailure(done.error, "document complete")
  return { ok: true, documentId, state: "ready" }
}

/** Metadata for documents at venues the caller holds; never a path. */
export async function getDocumentMeta(
  actor: MediaActor,
  input: unknown
): Promise<DocumentResult<{ documents: DocumentMeta[] }>> {
  const ids = isObject(input) ? input.documentIds : null
  if (!Array.isArray(ids) || ids.length > 100 || !ids.every(isUuid))
    return invalid("Reload and try again.")
  if (ids.length === 0) return { ok: true, documents: [] }
  const { data, error } = await documentRpc(
    actor.db,
    "evidence_document_meta",
    {
      p_ids: ids as string[],
    }
  )
  if (error) return documentRpcFailure(error, "document meta")
  return { ok: true, documents: data }
}

/** Tombstones an unreferenced document; the object goes at the next cleanup. */
export async function deleteDocument(
  actor: MediaActor,
  documentId: string
): Promise<DocumentResult<{ deleted: boolean }>> {
  if (!isUuid(documentId)) return DOCUMENT_NOT_FOUND
  const { data, error } = await documentRpc(
    actor.db,
    "evidence_document_delete",
    {
      p_id: documentId,
    }
  )
  if (error) return documentRpcFailure(error, "document delete")
  return { ok: true, deleted: data.deleted }
}

/**
 * The download response for a holder: the stored bytes as an attachment with
 * DOWNLOAD_HEADERS, or a failure for the route to answer.
 */
export async function downloadDocument(
  actor: MediaActor,
  documentId: string
): Promise<DocumentResult<{ response: Response }>> {
  if (!isUuid(documentId)) return DOCUMENT_NOT_FOUND
  const { data, error } = await documentRpc(
    actor.db,
    "evidence_document_download_target",
    { p_id: documentId }
  )
  if (error) return documentRpcFailure(error, "document download")
  const upstream = await fetchDocumentObject(actor.storage, data.objectPath)
  if (!upstream.ok || !upstream.body) {
    await upstream.arrayBuffer().catch(() => undefined)
    return documentFailure(
      "unavailable",
      "Could not read this document. Try again."
    )
  }
  return {
    ok: true,
    response: new Response(upstream.body, {
      status: 200,
      headers: {
        ...DOWNLOAD_HEADERS,
        "content-length": String(data.sizeBytes),
      },
    }),
  }
}
