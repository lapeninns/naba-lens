// S1-EXPORT services (lib/server/exports/service.ts): untrusted input from a
// Server Function is refused before any database call, database exceptions
// become the words the screens show, and anything unexpected is a 503.
import { describe, expect, it, vi } from "vitest"

import {
  createExportPackage,
  exportFailure,
  listExportCandidates,
  parseItemsInput,
  recordPublication,
} from "@/lib/server/exports/service"
import type { MediaActor } from "@/lib/server/media/types"

const A = "00000000-0000-4000-8000-0000000000a1"
const S = "00000000-0000-4000-8000-0000000000b1"

function actorWith(result: { data?: unknown; error?: unknown }) {
  const rpc = vi.fn(async () => ({
    data: result.data ?? null,
    error: result.error ?? null,
  }))
  return { actor: { db: { rpc } } as unknown as MediaActor, rpc }
}

describe("exportFailure", () => {
  it("maps known exceptions to statuses and words", () => {
    expect(
      exportFailure({ message: "export_not_allowed", code: "42501" }, "t")
    ).toMatchObject({
      status: 403,
      code: "export_not_allowed",
    })
    expect(exportFailure({ message: "export_nothing_left" }, "t").status).toBe(
      409
    )
  })

  it("turns anything else into a retry, logged without detail", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(exportFailure({ message: "boom" }, "t")).toMatchObject({
      status: 503,
      code: "unavailable",
    })
    log.mockRestore()
  })
})

describe("input checks before the database", () => {
  it("refuses a bad venue id without calling it", async () => {
    const { actor, rpc } = actorWith({})
    expect((await listExportCandidates(actor, "nope")).ok).toBe(false)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("refuses malformed items, modes and sizes", async () => {
    const { actor, rpc } = actorWith({})
    const base = {
      requestKey: "exp-12345678",
      mode: "public",
      profileKey: "website",
    }
    expect(
      await createExportPackage(actor, { ...base, items: [] })
    ).toMatchObject({ ok: false, code: "export_items_invalid" })
    expect(
      await createExportPackage(actor, {
        ...base,
        items: [{ assetId: A, subjectKind: "room", subjectId: S }],
      })
    ).toMatchObject({ ok: false, code: "export_items_invalid" })
    expect(
      await createExportPackage(actor, {
        ...base,
        mode: "everything",
        items: [{ assetId: A, subjectKind: "place", subjectId: S }],
      })
    ).toMatchObject({ ok: false, code: "export_mode_invalid" })
    expect(
      await createExportPackage(actor, {
        ...base,
        profileKey: "custom",
        customWidth: "wide",
        items: [{ assetId: A, subjectKind: "place", subjectId: S }],
      })
    ).toMatchObject({ ok: false, code: "export_size_invalid" })
    expect(
      await recordPublication(actor, {
        requestKey: "pub-12345678",
        destinationId: A,
        assetId: S,
        action: "published",
        occurredOn: "18/11/2026",
      })
    ).toMatchObject({
      ok: false,
      code: "publication_date_invalid",
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("trims texts and keeps at most 200 items", () => {
    expect(
      parseItemsInput([
        { assetId: A, subjectKind: "place", subjectId: S, altText: "  Bar  " },
      ])
    ).toEqual([
      {
        assetId: A,
        subjectKind: "place",
        subjectId: S,
        altText: "Bar",
        caption: null,
      },
    ])
    expect(
      parseItemsInput(
        Array.from({ length: 201 }, () => ({
          assetId: A,
          subjectKind: "place",
          subjectId: S,
        }))
      )
    ).toBeNull()
  })

  it("passes a valid package to the database as the caller", async () => {
    const { actor, rpc } = actorWith({ data: { packageId: A, itemCount: 1 } })
    const result = await createExportPackage(actor, {
      requestKey: "exp-12345678",
      mode: "public",
      profileKey: "custom",
      customWidth: "800",
      customHeight: "600",
      items: [{ assetId: A, subjectKind: "place", subjectId: S }],
    })
    expect(result).toEqual({ ok: true, packageId: A, itemCount: 1 })
    expect(rpc).toHaveBeenCalledWith(
      "export_package_create",
      expect.objectContaining({
        p_custom_width: 800,
        p_custom_height: 600,
        p_mode: "public",
      })
    )
  })
})
