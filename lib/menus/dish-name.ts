/**
 * A labelled dish as people see it everywhere: "Momo (Chicken)", or
 * "Momo (Not specified)" when the dish has variants and none was chosen.
 */
export function dishName(
  item: { name: string; variantName: string | null },
  /** The dish has variants and none was chosen. */
  unspecified = false
) {
  if (item.variantName) return `${item.name} (${item.variantName})`
  return unspecified ? `${item.name} (Not specified)` : item.name
}
