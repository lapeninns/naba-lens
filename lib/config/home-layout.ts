import "server-only"

/**
 * Staff Home's layout. "goals" is the goal-led Home (goals-not-tasks G-1,
 * decision 9): Our menu, Your month and the retake note, with no To do for
 * menu work. "b02" (B02 UI design §3.6, D10) and "b01" stay selectable only
 * as a rollback, and go one release after the cut-over. URLs and parameters
 * are the same on all three.
 *
 * NABALENS_HOME_LAYOUT sets it for everyone ("goals", "b02" or "b01";
 * anything else is the default). NABALENS_HOME_LAYOUT_B01_VENUES, a
 * comma-separated list of venue ids, keeps those venues on "b01" whatever the
 * default.
 */
export type HomeLayout = "goals" | "b01" | "b02"

export const DEFAULT_HOME_LAYOUT: HomeLayout = "goals"

const LAYOUTS: readonly string[] = ["goals", "b01", "b02"]

export function homeLayout(venueId?: string | null): HomeLayout {
  const b01Venues = (process.env.NABALENS_HOME_LAYOUT_B01_VENUES ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
  if (venueId && b01Venues.includes(venueId)) return "b01"
  const value = process.env.NABALENS_HOME_LAYOUT?.trim()
  return value && LAYOUTS.includes(value)
    ? (value as HomeLayout)
    : DEFAULT_HOME_LAYOUT
}
