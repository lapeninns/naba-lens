// B05-m6 evidence documents (contracts/b05-design.md §2A.7): PDF validation,
// exact download headers, the upload switch, the finalise flow with mocked
// RPC and storage, error mapping, and the bucket boundary (static).
import { createHash } from "node:crypto"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  checkPdf,
  documentRpcFailure,
  DOWNLOAD_HEADERS,
  finaliseDocument,
  reserveDocument,
} from "@/lib/server/documents"
import type { MediaActor } from "@/lib/server/media/types"

const DOC = "88888888-8888-4888-8888-888888888888"
const VENUE = "11111111-1111-4111-8111-111111111111"
const enc = (s: string) => new Uint8Array(Buffer.from(s, "latin1"))
const PDF = enc(
  "%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF"
)

function actorWith(
  handlers: Record<
    string,
    (args: Record<string, unknown>) => {
      data?: unknown
      error?: { message: string }
    }
  >
) {
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    const h = handlers[fn]
    if (!h) throw new Error(`unexpected rpc ${fn}`)
    const out = h(args)
    return { data: out.data ?? null, error: out.error ?? null }
  })
  const createSignedUploadUrl = vi.fn(async () => ({
    data: { signedUrl: "https://storage.test/upload", token: "tok" },
    error: null,
  }))
  const db = {
    rpc,
    storage: { from: vi.fn(() => ({ createSignedUploadUrl })) },
  }
  const service = { rpc }
  const actor = {
    profile: { id: "u", active: true, role: "manager" },
    db,
    service,
    storage: { url: "https://storage.test", serviceKey: "k" },
  } as unknown as MediaActor
  return { actor, rpc, db }
}

beforeEach(() => vi.stubEnv("NABALENS_EVIDENCE_DOCUMENTS", "on"))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("checkPdf", () => {
  it("accepts a PDF and records its SHA-256", () => {
    expect(checkPdf(PDF)).toEqual({
      ok: true,
      sizeBytes: PDF.byteLength,
      sha256: createHash("sha256").update(PDF).digest("hex"),
    })
  })

  it("refuses a JPEG or PNG renamed .pdf, an encrypted PDF, an empty file and 11 MiB", () => {
    expect(checkPdf(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toEqual({
      ok: false,
      code: "not_pdf",
    })
    expect(
      checkPdf(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))
    ).toEqual({ ok: false, code: "not_pdf" })
    expect(
      checkPdf(enc("%PDF-1.4\ntrailer << /Root 1 0 R /Encrypt 5 0 R >>"))
    ).toEqual({ ok: false, code: "encrypted_pdf" })
    expect(checkPdf(new Uint8Array())).toEqual({ ok: false, code: "empty" })
    const big = new Uint8Array(11 * 1024 * 1024)
    big.set(PDF.subarray(0, 5))
    expect(checkPdf(big)).toEqual({ ok: false, code: "file_too_large" })
    // A name merely starting with Encrypt is not the encryption dictionary.
    expect(checkPdf(enc("%PDF-1.4\n/EncryptMetadata false")).ok).toBe(true)
  })
})

describe("download headers", () => {
  it("are exactly attachment, PDF, nosniff, private no-store and a sandbox CSP", () => {
    expect(DOWNLOAD_HEADERS).toEqual({
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="evidence-document.pdf"',
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
      "content-security-policy": "sandbox",
    })
  })
})

describe("reserveDocument", () => {
  const input = {
    key: "doc_0123456789",
    venueId: VENUE,
    purpose: "menu_allergen_evidence",
    filename: "spec.pdf",
    sizeBytes: 1000,
  }

  it("is refused while the evidenceDocuments switch is off", async () => {
    vi.stubEnv("NABALENS_EVIDENCE_DOCUMENTS", "")
    const { actor, rpc } = actorWith({})
    expect(await reserveDocument(actor, input)).toMatchObject({
      ok: false,
      code: "disabled",
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("refuses non-PDF names and oversized files before the database", async () => {
    const { actor, rpc } = actorWith({})
    expect(
      await reserveDocument(actor, { ...input, filename: "photo.jpg" })
    ).toMatchObject({ code: "invalid_file", fileCode: "not_pdf" })
    expect(
      await reserveDocument(actor, { ...input, sizeBytes: 11 * 1024 * 1024 })
    ).toMatchObject({ code: "invalid_file", fileCode: "file_too_large" })
    expect(
      await reserveDocument(actor, { ...input, purpose: "menu_photo" })
    ).toMatchObject({ code: "invalid_input" })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("reserves as the caller and signs an upload URL for the reserved key", async () => {
    const { actor, rpc, db } = actorWith({
      evidence_document_reserve: () => ({
        data: {
          documentId: DOC,
          objectPath: `${VENUE}/${DOC}/document.pdf`,
          state: "uploading",
          replayed: false,
        },
      }),
    })
    expect(await reserveDocument(actor, input)).toEqual({
      ok: true,
      documentId: DOC,
      state: "uploading",
      uploadUrl: "https://storage.test/upload",
      token: "tok",
    })
    expect(rpc).toHaveBeenCalledWith("evidence_document_reserve", {
      p_key: "doc_0123456789",
      p_venue_id: VENUE,
      p_purpose: "menu_allergen_evidence",
      p_filename: "spec.pdf",
      p_size: 1000,
    })
    expect(db.storage.from).toHaveBeenCalledWith("documents")
  })
})

describe("finaliseDocument", () => {
  const target = {
    data: {
      documentId: DOC,
      objectPath: `${VENUE}/${DOC}/document.pdf`,
      state: "uploading",
      declaredSizeBytes: 100,
    },
  }

  it("records a valid PDF as ready with its hash", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(PDF, { status: 200 }))
    )
    const complete = vi.fn(() => ({
      data: { documentId: DOC, state: "ready", replayed: false },
    }))
    const { actor } = actorWith({
      evidence_document_finalise_target: () => target,
      evidence_document_complete: complete,
    })
    expect(await finaliseDocument(actor, DOC)).toEqual({
      ok: true,
      documentId: DOC,
      state: "ready",
    })
    expect(complete).toHaveBeenCalledWith({
      p_id: DOC,
      p_size: PDF.byteLength,
      p_sha256: createHash("sha256").update(PDF).digest("hex"),
    })
  })

  it("marks an image renamed .pdf as failed with a file code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), {
            status: 200,
          })
      )
    )
    const fail = vi.fn(() => ({ data: { documentId: DOC, state: "failed" } }))
    const { actor } = actorWith({
      evidence_document_finalise_target: () => target,
      evidence_document_fail: fail,
    })
    expect(await finaliseDocument(actor, DOC)).toMatchObject({
      ok: false,
      code: "invalid_file",
      fileCode: "not_pdf",
      status: 400,
    })
    expect(fail).toHaveBeenCalledWith({ p_id: DOC })
  })

  it("answers not uploaded when no bytes are stored, without failing the document", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 }))
    )
    const { actor } = actorWith({
      evidence_document_finalise_target: () => target,
    })
    expect(await finaliseDocument(actor, DOC)).toMatchObject({
      ok: false,
      code: "not_uploaded",
    })
  })

  it("maps not found and keeps ids out of the log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const { actor } = actorWith({
      evidence_document_finalise_target: () => ({
        error: { message: "document_not_found" },
      }),
    })
    expect(await finaliseDocument(actor, DOC)).toMatchObject({
      ok: false,
      code: "not_found",
      status: 404,
    })
    expect(
      documentRpcFailure({ message: "document_referenced" }, "t")
    ).toMatchObject({ code: "referenced", status: 409 })
    expect(
      documentRpcFailure({ message: "not_document_holder" }, "t")
    ).toMatchObject({ code: "not_permitted", status: 403 })
    expect(
      documentRpcFailure({ message: "document_reference_unknown" }, "t")
    ).toMatchObject({ code: "unavailable", status: 503 })
    expect(JSON.stringify(log.mock.calls)).not.toContain(DOC)
  })
})

describe("documents bucket boundary (static)", () => {
  const root = join(import.meta.dirname, "..", "..")
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name)
      return statSync(p).isDirectory()
        ? files(p)
        : /\.(ts|tsx)$/.test(name)
          ? [p]
          : []
    })

  it("names the documents bucket only under lib/server/documents", () => {
    const offenders = [
      ...files(join(root, "lib")),
      ...files(join(root, "app")),
      ...files(join(root, "components")),
    ]
      .map((f) => relative(root, f))
      .filter((f) => !f.startsWith("lib/server/documents/"))
      .filter((f) =>
        /from\(\s*["'`]documents["'`]\s*\)|\/object\/[a-z/]*documents\/|DOCUMENTS_BUCKET/.test(
          readFileSync(join(root, f), "utf8")
        )
      )
    expect(offenders).toEqual([])
  })

  it("never reads media paths or media helpers from lib/server/documents", () => {
    const hits = files(join(root, "lib", "server", "documents")).filter((f) =>
      /mediaObjectKeys|original_path|preview_path|thumbnail_path|from\(\s*["']media/.test(
        readFileSync(f, "utf8")
      )
    )
    expect(hits).toEqual([])
  })
})
