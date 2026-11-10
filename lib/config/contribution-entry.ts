import "server-only"

/**
 * The shared contribution entry (B02 UI design §4.4, D10). "b01" keeps the
 * B01 Add sheet and entry buttons exactly; "b02" adds the intent step, the
 * context strip and Home's "Answer a venue question". URLs and parameters
 * are the same on both.
 *
 * NABALENS_CONTRIBUTION_ENTRY sets it for everyone ("b01" or "b02"; anything
 * else is the default). NABALENS_CONTRIBUTION_ENTRY_B01_VENUES, a
 * comma-separated list of venue ids, keeps those venues on "b01" whatever
 * the default.
 */
export type ContributionEntry = "b01" | "b02"

export const DEFAULT_CONTRIBUTION_ENTRY: ContributionEntry = "b02"

export function contributionEntry(venueId?: string | null): ContributionEntry {
  const b01Venues = (process.env.NABALENS_CONTRIBUTION_ENTRY_B01_VENUES ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
  if (venueId && b01Venues.includes(venueId)) return "b01"
  const value = process.env.NABALENS_CONTRIBUTION_ENTRY?.trim()
  return value === "b01" || value === "b02" ? value : DEFAULT_CONTRIBUTION_ENTRY
}
