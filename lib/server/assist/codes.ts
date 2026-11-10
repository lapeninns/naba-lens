// Per-request short codes, so no NabaLens ID ever reaches a provider (§2.3).

export type CandidateItem = {
  itemId: string
  name: string
  section: string
  variants: readonly { variantId: string; name: string }[]
}

export type CodedCandidate = {
  code: string
  name: string
  section: string
  variants: { code: string; name: string }[]
}

export type CandidateCodes = {
  coded: CodedCandidate[]
  resolve(
    code: string,
    variantCode: string | null
  ): { itemId: string; variantId: string | null } | null
  variantCodesFor(code: string): ReadonlySet<string>
}

export const MAX_CANDIDATES = 99

export function buildCandidateCodes(
  items: readonly CandidateItem[]
): CandidateCodes {
  if (items.length > MAX_CANDIDATES) throw new Error("too_many_candidates")
  const byCode = new Map<
    string,
    { itemId: string; variants: Map<string, string> }
  >()
  const coded = items.map((item, i) => {
    const code = `c${String(i + 1).padStart(2, "0")}`
    const variants = item.variants.map((v, j) => ({
      code: `${code}v${j + 1}`,
      name: v.name,
      variantId: v.variantId,
    }))
    byCode.set(code, {
      itemId: item.itemId,
      variants: new Map(variants.map((v) => [v.code, v.variantId])),
    })
    return {
      code,
      name: item.name,
      section: item.section,
      variants: variants.map(({ code, name }) => ({ code, name })),
    }
  })
  return {
    coded,
    resolve(code, variantCode) {
      const entry = byCode.get(code)
      if (!entry) return null
      if (variantCode === null) return { itemId: entry.itemId, variantId: null }
      const variantId = entry.variants.get(variantCode)
      return variantId ? { itemId: entry.itemId, variantId } : null
    },
    variantCodesFor(code) {
      return new Set(byCode.get(code)?.variants.keys() ?? [])
    },
  }
}
