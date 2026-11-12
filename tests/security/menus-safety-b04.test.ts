// B04-c1 database contract (b04-design §6.2–§6.5, §7.2, §18 L3, A1-7; task
// B04-03): modifiers and their price-delta lines, dietary claims and allergen
// statements that only a named authority confirms, the uncertainty outcome
// with the owner-decided message, evidence that is never a photo, and
// revocation by material change at activation that no rollback undoes. One
// psql session and one transaction that always rolls back, on the shared
// fixture world of tests/fixtures/menus/recheck-public-withdrawal; the SQL
// lives in menus-safety-fixtures.ts.
import { execFileSync } from "node:child_process"

import { beforeAll, describe, expect, it } from "vitest"

import { psql } from "./coverage-fixtures"
import { checkpoints, safetyScript } from "./menus-safety-fixtures"

const CREDIT_MD5 = "b78b9daeb8ede1fec0b7224d99348659"
const UK14 = [
  "celery",
  "cereals_gluten",
  "crustaceans",
  "eggs",
  "fish",
  "lupin",
  "milk",
  "molluscs",
  "mustard",
  "peanuts",
  "sesame",
  "soya",
  "sulphites",
  "tree_nuts",
]

type Outcome = Record<string, unknown> & {
  status: string
  reason?: string
  message?: string | null
  messageStatus?: string
  contains?: string[]
  mayContain?: string[]
  freeFrom?: string[]
  scope?: string
}
type Safety = {
  view: string
  allergens: Outcome
  dietary: { claim: string; status: string; value?: string }[]
  variants: { name: string; allergens: Outcome }[]
  pendingStatements?: unknown[]
  authorities?: { allergens: boolean; dietary: boolean }
}

function localDbUrl(): string {
  const url = process.env.NABALENS_TEST_DB_URL
  if (!url || !/^postgresql:\/\/[^@]+@(127\.0\.0\.1|localhost):/.test(url)) {
    throw new Error("Run through `pnpm test:security <workdir>` (local DB).")
  }
  return url
}

let out: Record<string, unknown>
let raw: string
const safety = (label: string) => out[label] as Safety
const variant = (s: Safety, name: string) =>
  s.variants.find((v) => v.name === name)!.allergens

beforeAll(() => {
  raw = execFileSync(
    "psql",
    [localDbUrl(), "-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
    {
      encoding: "utf8",
      input: safetyScript(),
      maxBuffer: 16 * 1024 * 1024,
    }
  )
  out = checkpoints(raw.split("\n").filter((line) => line.length > 0))
})

describe("the uncertainty outcome (§6.2 #2, #3; B04-03d, B04-03e)", () => {
  it("reads every item with no confirmed statement as unavailable, awaiting the owner's wording, even with an accepted photo", () => {
    expect(out.F_PHOTO_STATE).toBe("accepted")
    for (const label of ["F_START_MANAGER", "F_START_STAFF"])
      expect(safety(label).allergens).toEqual({
        status: "unavailable",
        reason: "not_confirmed",
        messageKey: "allergen_unconfirmed",
        message: null,
        messageVersion: null,
        messageStatus: "awaiting_decision",
      })
    expect(safety("F_START_MANAGER").dietary).toEqual([
      { claim: "vegetarian", status: "not_confirmed" },
      { claim: "vegan", status: "not_confirmed" },
    ])
    // Staff see outcomes only.
    expect(safety("F_START_STAFF")).not.toHaveProperty("pendingStatements")
    expect(safety("F_START_MANAGER").authorities).toEqual({
      allergens: false,
      dietary: false,
    })
  })

  it("carries the latest message once the owner has decided its wording", () => {
    expect(safety("A_WITH_MESSAGE").allergens).toMatchObject({
      status: "unavailable",
      message: "Fixture: please ask the team about allergens before ordering.",
      messageVersion: 1,
      messageStatus: "decided",
    })
  })

  it("reads a missing allergen as not declared unless the statement is complete", () => {
    const partial = (out.CONFIRM_F as { allergens: Outcome }).allergens
    expect(partial).toMatchObject({
      status: "available",
      complete: false,
      contains: ["milk"],
      freeFrom: [],
    })
    const complete = safety("E_CONFIRMED").allergens
    expect(complete).toMatchObject({
      complete: true,
      contains: ["eggs"],
      mayContain: ["mustard"],
    })
    expect(complete.freeFrom).toEqual(
      UK14.filter((c) => c !== "eggs" && c !== "mustard")
    )
  })

  it("applies a variant's own statement, else the item's", () => {
    const d = safety("D_CONFIRMED")
    expect(variant(d, "Bean")).toMatchObject({
      scope: "variant",
      contains: ["soya"],
    })
    expect(variant(d, "Beef")).toMatchObject({
      scope: "item",
      contains: ["cereals_gluten"],
    })
  })

  it("never outputs a document id, filename or path, nor the photo's asset id", () => {
    expect(raw).not.toMatch(/documentId|document_id|storage_path|filename/i)
    const photo = out.F_PHOTO_ID as string
    expect(photo).toMatch(/^[0-9a-f-]{36}$/)
    const others = raw
      .split("\n")
      .filter((line) => !line.startsWith("F_PHOTO_ID "))
    expect(others.some((line) => line.includes(photo))).toBe(false)
  })
})

describe("statements, evidence and the named authority (§6.2 #1, #4; §6.4)", () => {
  it("lets managers and admins propose, never staff, over the closed list", () => {
    expect(out.PROPOSE_STAFF).toBe("not_venue_manager")
    expect(out.PROPOSE_BAD_CODE).toBe("invalid_allergen_statement")
    expect(out.PROPOSE_NO_COMPLETE).toBe("invalid_allergen_statement")
  })

  it("refuses every confirmation until the owner names an authority, and admins without it afterwards", () => {
    expect(out.CONFIRM_ADMIN_NO_AUTHORITY).toBe("allergen_authority_missing")
    expect(out.CONFIRM_MANAGER_NO_AUTHORITY).toBe("allergen_authority_missing")
    expect(out.CONFIRM_ADMIN_NOT_AUTHORITY).toBe("not_allergen_authority")
    expect(out.CONFIRM_NO_EVIDENCE).toBe("allergen_evidence_missing")
    expect(out.CONFIRM_TWICE).toBe("menu_safety_not_proposed")
    expect(out.DECLINE_ADMIN).toMatchObject({ decision: "declined" })
  })

  it("never takes a photo as evidence, whatever the kind; documents are not found until c2", () => {
    expect(out.EVIDENCE_PHOTO).toBe("photo_not_allergen_evidence")
    expect(out.EVIDENCE_PHOTO_AS_SPEC).toBe("photo_not_allergen_evidence")
    expect(out.EVIDENCE_DOCUMENT).toBe("document_not_found")
    expect(out.EVIDENCE_STAFF).toBe("not_venue_manager")
    expect(out.EVIDENCE_F).toMatchObject({ kind: "authority_statement" })
  })

  it("confirms dietary claims only through the named dietary authority", () => {
    expect(out.DIETARY_BAD).toBe("invalid_dietary_claim")
    expect(out.DIETARY_STAFF).toBe("not_venue_manager")
    expect(out.DIETARY_NO_AUTHORITY).toBe("dietary_authority_missing")
    expect(out.DIETARY_CONFIRM).toMatchObject({ decision: "confirmed" })
  })
})

describe("revocation at activation and rollback (§6.2 #6, §7.2, L3, A1-7)", () => {
  it("revokes confirmed statements by recipe, portion, variant meaning and a removed variant, and keeps the rest", () => {
    expect(out.REVOKED).toEqual([
      { statement: "G", reason: "material_change:portion", by: true },
      { statement: "F", reason: "material_change:recipe", by: true },
      {
        statement: "Bean",
        reason: "material_change:variant_meaning",
        by: true,
      },
      {
        statement: "Lamb",
        reason: "material_change:variant_removed",
        by: true,
      },
    ])
    expect(out.DIETARY_REVOKED).toEqual([
      { claim: "F", reason: "material_change:recipe" },
    ])
    expect(safety("F_AFTER").allergens).toMatchObject({
      status: "unavailable",
      reason: "not_confirmed",
      messageStatus: "decided",
    })
    expect(safety("G_AFTER").allergens.status).toBe("unavailable")
    // A presentation change keeps both the statement and the dietary claim.
    expect(safety("E_AFTER").allergens).toMatchObject({
      status: "available",
      contains: ["eggs"],
    })
    expect(safety("E_AFTER").dietary[0]).toEqual({
      claim: "vegetarian",
      status: "confirmed",
      value: "yes",
      claimId: expect.any(String),
    })
    // Bean falls back to the item's statement, which no change touched.
    expect(variant(safety("D_AFTER"), "Bean")).toMatchObject({
      scope: "item",
      contains: ["cereals_gluten"],
    })
  })

  it("refuses a statement bound to the recipe before the change, and a second revocation", () => {
    expect(out.CONFIRM_STALE_RECIPE).toBe("menu_safety_stale_recipe")
    expect(out.REVOKE_REVOKED).toBe("menu_safety_not_confirmed")
  })

  it("L3: re-issuing the menu writes no decision and revives nothing; only a new confirmed statement makes the item current", () => {
    expect(out.DECISIONS_BY_V3).toBe(0)
    expect(out.F_AFTER_ROLLBACK).toMatchObject({
      status: "unavailable",
      reason: "not_confirmed",
    })
    expect(out.F_RESTATED).toMatchObject({
      status: "available",
      complete: true,
      contains: ["celery", "milk"],
    })
  })

  it("moves no photo and leaves the credit function unchanged", () => {
    expect(out.PHOTOS_BEFORE_ACTIVATION).toBe(
      (out.INVARIANTS_BEFORE as { photos: string }).photos
    )
    expect((out.INVARIANTS_BEFORE as { creditMd5: string }).creditMd5).toBe(
      CREDIT_MD5
    )
    expect((out.INVARIANTS_AFTER as { creditMd5: string }).creditMd5).toBe(
      CREDIT_MD5
    )
  })
})

describe("modifiers (B04-03a)", () => {
  it("builds groups and options for managers, never staff, and validates single selection", () => {
    expect(out.GROUP_BAD).toBe("invalid_modifier")
    expect(out.GROUP_STAFF).toBe("not_venue_manager")
    expect(out.ATTACH).toMatchObject({ effectiveTo: null })
    expect(out.ATTACH_TWICE).toBe("menu_modifier_already_attached")
  })

  it("prices an option as its own trading line, only where its group is offered", () => {
    expect(out.LINE_NOT_OFFERED).toBe("menu_modifier_not_offered")
    expect(out.OPT_CONFIRM).toMatchObject({
      status: "available",
      value: { amountMinor: 150 },
    })
    expect(out.OPT_LINES).toMatchObject({
      modifierOptionId: expect.any(String),
      price: { value: { amountMinor: 150 } },
    })
    const staff = out.MODIFIERS_STAFF as {
      groups: { selection: string; options: { lineIds: string[] }[] }[]
    }
    expect(staff.groups).toHaveLength(1)
    expect(staff.groups[0]!.selection).toBe("single")
    expect(staff.groups[0]!.options.map((o) => o.lineIds.length)).toEqual([
      1, 0,
    ])
  })

  it("retires an option once; it is no longer offered", () => {
    expect(out.RETIRE_OPT).toMatchObject({ retired: true })
    expect(out.RETIRE_TWICE).toBe("menu_modifier_retired")
    const after = out.MODIFIERS_AFTER_RETIRE as {
      groups: { options: unknown[] }[]
    }
    expect(after.groups[0]!.options).toHaveLength(1)
  })
})

describe("catalogue and privileges", () => {
  it("keeps every new table and the authorities private, with RLS on", () => {
    for (const table of [
      "public.menu_modifier_groups",
      "public.menu_modifier_options",
      "public.menu_item_modifier_groups",
      "public.menu_public_messages",
      "public.menu_dietary_claims",
      "public.menu_dietary_decisions",
      "public.menu_allergen_statements",
      "public.menu_allergen_decisions",
      "public.menu_allergen_evidence",
    ])
      expect(
        psql(`select has_table_privilege('authenticated', '${table}', 'select') || ':' ||
          has_table_privilege('anon', '${table}', 'select') || ':' ||
          (select relrowsecurity from pg_class where oid = '${table}'::regclass)`),
        table
      ).toBe("false:false:true")
    for (const role of ["authenticated", "service_role"])
      expect(
        psql(
          `select has_table_privilege('${role}', 'private.menu_safety_authorities', 'select')`
        ),
        role
      ).toBe("f")
    expect(psql(`select count(*) from private.menu_safety_authorities`)).toBe(
      "0"
    )
    expect(psql(`select count(*) from public.menu_public_messages`)).toBe("0")
  })

  it("exposes the commands and reads to signed-in users only, the reads as STABLE definers", () => {
    for (const fn of [
      "public.menu_modifier_group_add(uuid,text,text,integer,integer,uuid)",
      "public.menu_modifier_option_add(uuid,text,integer,uuid)",
      "public.menu_item_modifier_group_attach(uuid,uuid,date,date,uuid)",
      "public.menu_modifier_retire(uuid,uuid,uuid)",
      "public.menu_modifier_option_line(uuid,uuid,text,uuid)",
      "public.menu_item_modifiers(uuid)",
      "public.menu_dietary_claim_propose(uuid,uuid,text,text,text,uuid)",
      "public.menu_dietary_claim_decide(uuid,text,text,uuid)",
      "public.menu_allergen_statement_propose(uuid,uuid,jsonb,boolean,text,uuid)",
      "public.menu_allergen_evidence_attach(uuid,text,uuid,text,uuid)",
      "public.menu_allergen_statement_decide(uuid,text,text,uuid)",
      "public.menu_item_safety(uuid)",
    ])
      expect(
        psql(`select has_function_privilege('anon', '${fn}', 'execute') || ':' ||
          has_function_privilege('authenticated', '${fn}', 'execute') || ':' ||
          has_function_privilege('service_role', '${fn}', 'execute')`),
        fn
      ).toBe("false:true:false")
    for (const fn of [
      "public.menu_item_safety(uuid)",
      "public.menu_item_modifiers(uuid)",
    ])
      expect(
        psql(`select provolatile::text || ':' || prosecdef || ':' || array_to_string(proconfig, ',')
          from pg_proc where oid = '${fn}'::regprocedure`),
        fn
      ).toBe('s:true:search_path=""')
    expect(
      psql(
        `select has_function_privilege('authenticated', 'private.menu_versions_revoke_statements()', 'execute')`
      )
    ).toBe("f")
  })
})
