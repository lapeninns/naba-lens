import "server-only"

/**
 * Staff Home's layout (B02 UI design §3.6, D10). "b01" renders the B01 Home
 * exactly; URLs and parameters are the same on both.
 *
 * NABALENS_HOME_LAYOUT sets it for everyone ("b01" or "b02"; anything else is
 * the default). NABALENS_HOME_LAYOUT_B01_VENUES, a comma-separated list of
 * venue ids, keeps those venues on "b01" whatever the default.
 */
export type HomeLayout = "b01" | "b02"

export const DEFAULT_HOME_LAYOUT: HomeLayout = "b02"

export function homeLayout(venueId?: string | null): HomeLayout {
  const b01Venues = (process.env.NABALENS_HOME_LAYOUT_B01_VENUES ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
  if (venueId && b01Venues.includes(venueId)) return "b01"
  const value = process.env.NABALENS_HOME_LAYOUT?.trim()
  return value === "b01" || value === "b02" ? value : DEFAULT_HOME_LAYOUT
}
