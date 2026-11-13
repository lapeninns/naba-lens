// B05-m6 evidence documents (contracts/b05-design.md §2A.7). Real signed-in
// identities through PostgREST and Storage; the service role and psql only
// age rows, read state back and probe structure.
import { randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import {
  deleteDocument,
  downloadDocument,
  DOWNLOAD_HEADERS,
  finaliseDocument,
  getDocumentMeta,
  runDocumentCleanup,
} from "@/lib/server/documents"

import { actorFor } from "../slice/media-actor"
import { serviceClient, type TestIdentity } from "../support/identities"
import { psql } from "./coverage-fixtures"
import {
  call,
  json,
  photo,
  refused,
  world,
  type World,
} from "./knowledge-fixtures"

const service = serviceClient()
const PDF = Buffer.from(
  "%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF",
  "latin1"
)
const ENCRYPTED = Buffer.from(
  "%PDF-1.4\ntrailer << /Root 1 0 R /Encrypt 5 0 R >>\n%%EOF",
  "latin1"
)
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46])

type Reservation = {
  documentId: string
  objectPath: string
  state: string
  replayed: boolean
}

const key = () => `TEST-${randomUUID()}`
const reserve = (
  who: TestIdentity,
  venue: string,
  o: { k?: string; size?: number; name?: string } = {}
) =>
  call(who, "evidence_document_reserve", {
    p_key: o.k ?? key(),
    p_venue_id: venue,
    p_purpose: "menu_allergen_evidence",
    p_filename: o.name ?? "TEST spec.pdf",
    p_size: o.size ?? PDF.byteLength,
  })

/** Reserves, uploads through the signed URL as the caller, and finalises. */
async function upload(who: TestIdentity, venue: string, bytes: Buffer = PDF) {
  const r = await json<Reservation>(who, "evidence_document_reserve", {
    p_key: key(),
    p_venue_id: venue,
    p_purpose: "menu_allergen_evidence",
    p_filename: "TEST spec.pdf",
    p_size: bytes.byteLength,
  })
  const signed = await who.client.storage
    .from("documents")
    .createSignedUploadUrl(r.objectPath)
  if (signed.error) throw signed.error
  const put = await who.client.storage
    .from("documents")
    .uploadToSignedUrl(r.objectPath, signed.data.token, bytes, {
      contentType: "application/pdf",
    })
  if (put.error) throw put.error
  return {
    ...r,
    finalised: await finaliseDocument(await actorFor(who), r.documentId),
  }
}

describe("evidence documents (B05-02h to k)", () => {
  let w: World
  let other: World

  beforeAll(async () => {
    w = await world("b05-docs")
    other = await world("b05-docs-other")
  })

  it("refuses staff and other-venue managers; admits the manager, a staff grant holder and admins", async () => {
    for (const who of [w.staffA, w.staffB])
      await refused(
        who,
        "evidence_document_reserve",
        {
          p_key: key(),
          p_venue_id: w.venue,
          p_purpose: "menu_allergen_evidence",
          p_filename: "x.pdf",
          p_size: 10,
        },
        "not_document_holder"
      )
    await refused(
      other.manager,
      "evidence_document_reserve",
      {
        p_key: key(),
        p_venue_id: w.venue,
        p_purpose: "menu_allergen_evidence",
        p_filename: "x.pdf",
        p_size: 10,
      },
      "not_document_holder"
    )
    for (const who of [w.manager, w.staffManager, w.admin]) {
      const { error } = await reserve(who, w.venue)
      expect(error).toBeNull()
    }
  })

  it("uploads, validates and downloads a PDF with the exact headers", async () => {
    const doc = await upload(w.manager, w.venue)
    expect(doc.finalised).toMatchObject({ ok: true, state: "ready" })
    const res = await downloadDocument(await actorFor(w.admin), doc.documentId)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const headers = Object.fromEntries(res.response.headers.entries())
    expect(headers).toEqual({
      ...DOWNLOAD_HEADERS,
      "content-length": String(PDF.byteLength),
    })
    expect(Buffer.from(await res.response.arrayBuffer())).toEqual(PDF)
    expect(
      psql(
        `select sha256 is not null and size_bytes = ${PDF.byteLength} from public.evidence_documents where id = '${doc.documentId}'`
      )
    ).toBe("t")
    for (const who of [w.staffA, other.manager])
      expect(
        await downloadDocument(await actorFor(who), doc.documentId)
      ).toMatchObject({ ok: false, status: 404 })
  })

  it("refuses a JPEG renamed .pdf and an encrypted PDF", async () => {
    const jpeg = await upload(w.manager, w.venue, JPEG).catch((e: Error) => ({
      error: e,
    }))
    // Storage may already refuse the bytes by MIME; otherwise finalise must.
    if ("finalised" in jpeg)
      expect(jpeg.finalised).toMatchObject({ ok: false, fileCode: "not_pdf" })
    const enc = await upload(w.manager, w.venue, ENCRYPTED)
    expect(enc.finalised).toMatchObject({
      ok: false,
      fileCode: "encrypted_pdf",
    })
    expect(
      psql(
        `select upload_state from public.evidence_documents where id = '${enc.documentId}'`
      )
    ).toBe("failed")
  })

  it("refuses 11 MiB, replays by key and refuses a divergent replay", async () => {
    const big = await reserve(w.manager, w.venue, { size: 11 * 1024 * 1024 })
    expect(big.error?.message).toBe("invalid_size")
    const k = key()
    const first = await json<Reservation>(
      w.manager,
      "evidence_document_reserve",
      {
        p_key: k,
        p_venue_id: w.venue,
        p_purpose: "menu_allergen_evidence",
        p_filename: "a.pdf",
        p_size: 10,
      }
    )
    const again = await json<Reservation>(
      w.manager,
      "evidence_document_reserve",
      {
        p_key: k,
        p_venue_id: w.venue,
        p_purpose: "menu_allergen_evidence",
        p_filename: "a.pdf",
        p_size: 10,
      }
    )
    expect(again).toEqual({ ...first, replayed: true })
    await refused(
      w.manager,
      "evidence_document_reserve",
      {
        p_key: k,
        p_venue_id: w.venue,
        p_purpose: "menu_allergen_evidence",
        p_filename: "b.pdf",
        p_size: 10,
      },
      "idempotency_key_reused"
    )
  })

  it("shows the filename only to the uploader and admins, and never a path", async () => {
    const doc = await upload(w.admin, w.venue)
    const asManager = await getDocumentMeta(await actorFor(w.manager), {
      documentIds: [doc.documentId],
    })
    expect(asManager).toMatchObject({ ok: true })
    if (!asManager.ok) return
    expect(asManager.documents[0]).toMatchObject({
      documentId: doc.documentId,
      filename: null,
      state: "ready",
      referencedBy: 0,
    })
    expect(JSON.stringify(asManager)).not.toMatch(/document\.pdf|objectPath/)
    const asAdmin = await getDocumentMeta(await actorFor(w.admin), {
      documentIds: [doc.documentId],
    })
    expect(asAdmin.ok && asAdmin.documents[0]?.filename).toBe("TEST spec.pdf")
    expect(
      await json(w.staffA, "evidence_document_meta", {
        p_ids: [doc.documentId],
      })
    ).toEqual([])
  })

  it("ends access when the manager's grant ends", async () => {
    const v = await world("b05-docs-end")
    const doc = await upload(v.admin, v.venue)
    expect(
      (await downloadDocument(await actorFor(v.manager), doc.documentId)).ok
    ).toBe(true)
    psql(`update public.venue_manager_grants set revoked_at = now(), revoke_kind = 'revoked',
      revoked_by = '${v.admin.id}', revoke_reason = 'TEST end' where staff_id = '${v.manager.id}' and revoked_at is null`)
    expect(
      await downloadDocument(await actorFor(v.manager), doc.documentId)
    ).toMatchObject({ ok: false, status: 404 })
    await refused(
      v.manager,
      "evidence_document_reserve",
      {
        p_key: key(),
        p_venue_id: v.venue,
        p_purpose: "menu_allergen_evidence",
        p_filename: "x.pdf",
        p_size: 10,
      },
      "not_document_holder"
    )
  })

  it("deletes an unreferenced document and refuses a referenced one", async () => {
    const doc = await upload(w.manager, w.venue)
    const ref = psql(
      `select to_regclass('public.menu_allergen_evidence') is not null`
    )
    if (ref === "t") {
      // B04-c present: a referencing row blocks deletion (joint test lives with B04).
      expect(
        psql(
          `select private.evidence_document_reference_count('${doc.documentId}')`
        )
      ).toBe("0")
    }
    expect(
      await deleteDocument(await actorFor(w.staffA), doc.documentId)
    ).toMatchObject({ ok: false, status: 404 })
    expect(
      await deleteDocument(await actorFor(w.manager), doc.documentId)
    ).toEqual({ ok: true, deleted: true })
    expect(
      await deleteDocument(await actorFor(w.manager), doc.documentId)
    ).toEqual({ ok: true, deleted: false })
    expect(
      await downloadDocument(await actorFor(w.admin), doc.documentId)
    ).toMatchObject({ ok: false, status: 404 })
  })

  it("cleans up an abandoned reservation and a deleted document's object", async () => {
    const abandoned = await json<Reservation>(
      w.manager,
      "evidence_document_reserve",
      {
        p_key: key(),
        p_venue_id: w.venue,
        p_purpose: "menu_allergen_evidence",
        p_filename: "a.pdf",
        p_size: 10,
      }
    )
    const deleted = await upload(w.manager, w.venue)
    await deleteDocument(await actorFor(w.manager), deleted.documentId)
    psql(`set session_replication_role = replica;
      update public.evidence_documents set updated_at = now() - interval '2 days' where id = '${abandoned.documentId}'`)
    let report = await runDocumentCleanup(service)
    for (let i = 0; i < 5 && report.status === "skipped"; i++)
      report = await runDocumentCleanup(service)
    expect(report).toMatchObject({ status: "completed", failed: 0 })
    expect(
      psql(
        `select deleted_at is not null from public.evidence_documents where id = '${abandoned.documentId}'`
      )
    ).toBe("t")
    const { data } = await service.storage
      .from("documents")
      .list(`${w.venue}/${deleted.documentId}`)
    expect(data ?? []).toEqual([])
  })

  it("is structurally apart from media: no grant, group or asset can hold a document id", async () => {
    const doc = await upload(w.admin, w.venue)
    for (const sql of [
      `insert into public.media_use_grants (asset_id, venue_id, destination_key, audience, purpose, subject_kind, effective_from, authorised_by, authority_basis, clearance_version, clearance, request_key)
       values ('${doc.documentId}', '${w.venue}', 'x', 'internal', 'general_gallery', 'none', now(), '${w.admin.id}', 'admin', 'v', '{}', 'structural-${randomUUID()}')`,
      `insert into public.media_contribution_group_members (group_id, venue_id, asset_id, position) values ('${randomUUID()}', '${w.venue}', '${doc.documentId}', 1)`,
    ])
      expect(() => psql(sql)).toThrow(/foreign key|violates/)
    const asset = await photo(w.staffA.id, w.venue)
    expect(
      psql(
        `select count(*) from public.evidence_documents where id = '${asset}'`
      )
    ).toBe("0")
    expect(
      psql(`select count(*) from pg_proc where prosrc ~* 'evidence_documents'
      and proname !~ '^(evidence_document|can_upload_document_object|prepare_document_cleanup)'`)
    ).toBe("0")
  })

  it("keeps the table, helpers and service functions away from clients", async () => {
    const { error } = await w.admin.client
      .from("evidence_documents" as never)
      .select("id")
    expect(error).not.toBeNull()
    await refused(
      w.admin,
      "evidence_document_complete",
      { p_id: randomUUID(), p_size: 1, p_sha256: "a".repeat(64) },
      "permission denied for function evidence_document_complete"
    )
    expect(
      psql(`select public from storage.buckets where id = 'documents'`)
    ).toBe("f")
    expect(
      psql(
        `select md5(pg_get_functiondef('private.monthly_venue_completion_counts(uuid,uuid,date)'::regprocedure))`
      )
    ).toBe("595b567b933705e692d2f801d750b3fb")
  })
})
