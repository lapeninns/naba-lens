// B04-c1 (b04-design §6; task B04-03): modifiers, dietary claims and allergen
// statements, shared by the server functions and tests. Pure. Mirrors
// supabase/migrations/20261112120000_menu_b04c1_modifiers_dietary_allergens.sql:
// private.menu_allergen_codes, private.menu_dietary_claims_vocabulary and
// private.menu_allergen_problems (the vocabularies are owner decisions
// OD-B4-7 and OD-B4-8; these are the design defaults).

/** The UK 14 allergens (OD-B4-7 default), as stored codes. */
export const ALLERGEN_CODES = [
  "celery",
  "cereals_gluten",
  "crustaceans",
  "eggs",
  "fish",
  "lupin",
  "milk",
  "molluscs",
  "mustard",
  "tree_nuts",
  "peanuts",
  "sesame",
  "soya",
  "sulphites",
] as const
export type AllergenCode = (typeof ALLERGEN_CODES)[number]

export const ALLERGEN_LEVELS = ["contains", "may_contain"] as const
export type AllergenLevel = (typeof ALLERGEN_LEVELS)[number]
export type AllergenMap = Partial<Record<AllergenCode, AllergenLevel>>

/** OD-B4-8 default: gluten-free is an allergen statement, not a claim. */
export const DIETARY_CLAIMS = ["vegetarian", "vegan"] as const
export type DietaryClaim = (typeof DIETARY_CLAIMS)[number]

export const SAFETY_DECISIONS = ["confirmed", "declined", "revoked"] as const
export type SafetyDecision = (typeof SAFETY_DECISIONS)[number]

export const EVIDENCE_KINDS = [
  "recipe_specification",
  "supplier_specification",
  "allergen_matrix",
  "authority_statement",
] as const
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number]

export const MODIFIER_SELECTIONS = ["single", "multiple"] as const
export type ModifierSelection = (typeof MODIFIER_SELECTIONS)[number]

export const SAFETY_LIMITS = {
  reasonMax: 500,
  noteMax: 500,
  modifierNameMax: 80,
} as const

export type FieldProblem = {
  path: string
  problem: "invalid" | "not_allowed" | "required" | "too_long"
}

/** private.menu_allergen_problems, sorted by path. */
export function allergenProblems(value: unknown): FieldProblem[] {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return [{ path: "allergens", problem: "invalid" }]
  const out: FieldProblem[] = []
  for (const [key, level] of Object.entries(value)) {
    const known = (ALLERGEN_CODES as readonly string[]).includes(key)
    if (
      !known ||
      typeof level !== "string" ||
      !(ALLERGEN_LEVELS as readonly string[]).includes(level)
    )
      out.push({
        path: `allergens.${key}`,
        problem: known ? "invalid" : "not_allowed",
      })
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

// ---------------------------------------------------------------------------
// Read shapes (public.menu_item_safety, public.menu_item_modifiers)
// ---------------------------------------------------------------------------

export type AllergenOutcome =
  | {
      status: "available"
      statementId: string
      scope: "item" | "variant"
      complete: boolean
      contains: AllergenCode[]
      mayContain: AllergenCode[]
      /** Only for a complete statement; otherwise empty (§6.2 #3). */
      freeFrom: AllergenCode[]
      confirmedAt: string
    }
  | {
      status: "unavailable"
      reason: "not_confirmed"
      messageKey: "allergen_unconfirmed"
      /** The owner-decided wording, or null until decided. */
      message: string | null
      messageVersion: number | null
      messageStatus: "decided" | "awaiting_decision"
    }

export type DietaryOutcome =
  | {
      claim: DietaryClaim
      status: "confirmed"
      value: "yes" | "no"
      claimId: string
    }
  | { claim: DietaryClaim; status: "not_confirmed" }

export type ItemSafety = {
  itemId: string
  view: "admin" | "manager" | "staff" | "authority"
  allergens: AllergenOutcome
  dietary: DietaryOutcome[]
  variants: {
    variantId: string
    name: string
    allergens: AllergenOutcome
    dietary: DietaryOutcome[]
  }[]
  /** Admin, manager and the venue's authorities only. */
  authorities?: { allergens: boolean; dietary: boolean }
  pendingStatements?: {
    statementId: string
    variantId: string | null
    allergens: AllergenMap
    complete: boolean
    statedAt: string
    reason: string | null
    recipeCurrent: boolean
    evidence: { count: number; kinds: EvidenceKind[] }
  }[]
  pendingClaims?: {
    claimId: string
    variantId: string | null
    claim: DietaryClaim
    value: "yes" | "no"
    statedAt: string
    reason: string | null
  }[]
}

export type ItemModifiers = {
  itemId: string
  groups: {
    groupId: string
    name: string
    selection: ModifierSelection
    minSelect: number
    maxSelect: number | null
    effectiveFrom: string
    effectiveTo: string | null
    options: {
      optionId: string
      name: string
      position: number
      lineIds: string[]
    }[]
  }[]
}
