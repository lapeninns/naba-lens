import { createHash } from "node:crypto"

import { DOCUMENT_LIMITS } from "./config"

export type PdfCheck =
  | { ok: true; sizeBytes: number; sha256: string }
  | {
      ok: false
      code: "empty" | "file_too_large" | "not_pdf" | "encrypted_pdf"
    }

const MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] // "%PDF-"

/**
 * Checks stored bytes before a document becomes ready (b05-design §2A.4):
 * size within the cap, the `%PDF-` signature at offset 0, and no encryption
 * dictionary. It never renders or parses text.
 */
export function checkPdf(bytes: Uint8Array): PdfCheck {
  if (bytes.byteLength === 0) return { ok: false, code: "empty" }
  if (bytes.byteLength > DOCUMENT_LIMITS.maxBytes)
    return { ok: false, code: "file_too_large" }
  if (!MAGIC.every((b, i) => bytes[i] === b))
    return { ok: false, code: "not_pdf" }
  // An encrypted PDF names /Encrypt in its trailer or cross-reference stream
  // dictionary; neither is compressed, so a byte scan finds it.
  if (/\/Encrypt(?![A-Za-z])/.test(Buffer.from(bytes).toString("latin1")))
    return { ok: false, code: "encrypted_pdf" }
  return {
    ok: true,
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }
}

export function fileCodeMessage(code: string): string {
  switch (code) {
    case "file_too_large":
      return "Documents can be up to 10 MB."
    case "encrypted_pdf":
      return "This PDF is password-protected. Upload a copy without a password."
    case "empty":
      return "This file is empty."
    default:
      return "Only PDF documents can be added."
  }
}
