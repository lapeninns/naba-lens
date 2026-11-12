// B04-c1 (b04-design §6; task B04-03): the allergen and dietary vocabularies
// and the allergen-map validator match the migration's SQL, and the server
// functions check inputs before calling the database and map its codes to
// plain messages. The database behaviour is pinned by
// tests/security/menus-safety-b04.test.ts. Synthetic values only.
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it, vi } from "vitest"

import {
  ALLERGEN_CODES,
  DIETARY_CLAIMS,
  allergenProblems,
} from "@/lib/menus/trading/safety"
import {
  attachAllergenEvidence,
  decideAllergenStatement,
  addModifierGroup,
  itemSafety,
  proposeAllergenStatement,
  safetyRpcFailure,
} from "@/lib/server/menus/allergens"
import type { MediaActor } from "@/lib/server/media/types"

const ITEM = "11111111-1111-4111-8111-111111111111"
const STATEMENT = "22222222-2222-4222-8222-222222222222"
const KEY = "33333333-3333-4333-8333-333333333333"

const SQL = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20261112120000_menu_b04c1_modifiers_dietary_allergens.sql"
  ),
  "utf8"
)

/** The array literal a SQL vocabulary function returns. */
function sqlArray(fn: string): string[] {
  const body = new RegExp(
    `create function private\\.${fn}\\(\\)[\\s\\S]*?select array\\[([\\s\\S]*?)\\];`
  ).exec(SQL)
  if (!body) throw new Error(`no ${fn} in the migration`)
  return [...body[1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!)
}

function actorWith(handler: (fn: string) => object = () => ({})) {
  const rpc = vi.fn(async (fn: string) => {
    const out = handler(fn) as { data?: unknown; error?: unknown }
    return { data: out.data ?? null, error: out.error ?? null }
  })
  const db = { rpc }
  return {
    actor: { db, service: db, profile: { id: "p" } } as unknown as MediaActor,
    rpc,
  }
}

describe("vocabularies (OD-B4-7, OD-B4-8 defaults)", () => {
  it("matches the SQL allergen codes and dietary claims exactly", () => {
    expect(sqlArray("menu_allergen_codes")).toEqual([...ALLERGEN_CODES])
    expect(sqlArray("menu_dietary_claims_vocabulary")).toEqual([
      ...DIETARY_CLAIMS,
    ])
    expect(ALLERGEN_CODES).toHaveLength(14)
  })
})

describe("allergenProblems (private.menu_allergen_problems)", () => {
  it.each([
    [{}, []],
    [{ milk: "contains", mustard: "may_contain" }, []],
    [[], [{ path: "allergens", problem: "invalid" }]],
    [null, [{ path: "allergens", problem: "invalid" }]],
    [
      { gluten: "contains", milk: "maybe", eggs: true },
      [
        { path: "allergens.eggs", problem: "invalid" },
        { path: "allergens.gluten", problem: "not_allowed" },
        { path: "allergens.milk", problem: "invalid" },
      ],
    ],
    // A source label is never a code.
    [{ GF: "contains" }, [{ path: "allergens.GF", problem: "not_allowed" }]],
  ] as const)("%j", (value, problems) => {
    expect(allergenProblems(value)).toEqual(problems)
  })
})

describe("server functions check inputs first", () => {
  it("refuses an invalid allergen map, a missing completeness flag or a bad key without calling the database", async () => {
    const { actor, rpc } = actorWith()
    for (const input of [
      { allergens: { gluten: "contains" }, complete: false, requestKey: KEY },
      { allergens: {}, complete: "yes", requestKey: KEY },
      { allergens: {}, complete: true, requestKey: "nope" },
    ])
      expect(
        await proposeAllergenStatement(actor, {
          itemId: ITEM,
          ...(input as {
            allergens: object
            complete: boolean
            requestKey: string
          }),
        })
      ).toMatchObject({ ok: false, status: 400 })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("refuses a single-choice group with more than one choice", async () => {
    const { actor, rpc } = actorWith()
    expect(
      await addModifierGroup(actor, {
        venueId: ITEM,
        name: "Sauce",
        selection: "single",
        maxSelect: 2,
        requestKey: KEY,
      })
    ).toMatchObject({ ok: false, status: 400 })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("passes evidence through to the database, which refuses a photo", async () => {
    const { actor, rpc } = actorWith(() => ({
      error: { message: "photo_not_allergen_evidence", code: "P0001" },
    }))
    const out = await attachAllergenEvidence(actor, {
      statementId: STATEMENT,
      kind: "recipe_specification",
      documentId: ITEM,
      requestKey: KEY,
    })
    expect(out).toMatchObject({ ok: false, status: 400 })
    expect(!out.ok && out.message).toContain("A photo cannot show allergens")
    expect(rpc).toHaveBeenCalledWith("menu_allergen_evidence_attach", {
      p_statement: STATEMENT,
      p_kind: "recipe_specification",
      p_document: ITEM,
      p_note: null,
      p_request_key: KEY,
    })
  })

  it("returns the decision and the outcome after it", async () => {
    const allergens = {
      status: "unavailable",
      reason: "not_confirmed",
      messageKey: "allergen_unconfirmed",
      message: null,
      messageVersion: null,
      messageStatus: "awaiting_decision",
    }
    const { actor } = actorWith(() => ({
      data: {
        decisionId: KEY,
        statementId: STATEMENT,
        decision: "declined",
        allergens,
      },
    }))
    expect(
      await decideAllergenStatement(actor, {
        statementId: STATEMENT,
        decision: "declined",
        requestKey: KEY,
      })
    ).toMatchObject({
      ok: true,
      result: { decision: "declined", allergens, replayed: false },
    })
  })

  it("reads the item outcome", async () => {
    const { actor } = actorWith(() => ({
      data: {
        itemId: ITEM,
        view: "staff",
        allergens: { status: "unavailable" },
        dietary: [],
        variants: [],
      },
    }))
    expect(await itemSafety(actor, ITEM)).toMatchObject({
      ok: true,
      safety: { view: "staff" },
    })
    expect(await itemSafety(actor, "x")).toMatchObject({
      ok: false,
      status: 404,
    })
  })
})

describe("safetyRpcFailure", () => {
  it.each([
    ["allergen_authority_missing", 403, "No one has been named"],
    ["not_allergen_authority", 403, "Only the person named"],
    ["dietary_authority_missing", 403, "dietary information"],
    ["allergen_evidence_missing", 409, "Add evidence"],
    ["menu_safety_stale_recipe", 409, "recipe has changed"],
    ["menu_modifier_not_offered", 409, "before pricing"],
    ["document_not_found", 404, "document"],
  ] as const)("%s", (message, status, text) => {
    const out = safetyRpcFailure({ message, code: "P0001" }, "test")
    expect(out.status).toBe(status)
    expect(out.message).toContain(text)
  })

  it("logs and hides an unexpected failure", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(
      safetyRpcFailure({ message: "boom", code: "XX000" }, "test")
    ).toMatchObject({
      status: 503,
    })
    spy.mockRestore()
  })
})
