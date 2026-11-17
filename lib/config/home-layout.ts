import "server-only"

/**
 * Staff Home's layout. "goals" is the goal-led Home (goals-not-tasks G-1,
 * decision 9): Our menu, Your month and the retake note, with no To do for
 * menu work. "b02" (B02 UI design §3.6, D10) and "b01" stay selectable only
 * as a rollback, and go one release after the cut-over. URLs and parameters
 * are the same on all three.
 *
 * "album" is Album (docs/design-system/DESIGN.md §5a, batch A2): every slot
 * at the venue, grouped by place. It is opt-in until batch A5 makes it the
 * default.
 *
 * NABALENS_HOME_LAYOUT sets it for everyone ("goals", "album", "b02" or
 * "b01"; anything else is the default). NABALENS_HOME_LAYOUT_ALBUM_VENUES and
 * NABALENS_HOME_LAYOUT_B01_VENUES, comma-separated venue ids, put those
 * venues on "album" or keep them on "b01" whatever the default; B01 wins if
 * a venue is in both.
 */
export type HomeLayout = "goals" | "album" | "b01" | "b02"

export const DEFAULT_HOME_LAYOUT: HomeLayout = "goals"

const LAYOUTS: readonly string[] = ["goals", "album", "b01", "b02"]

const venueList = (name: string) =>
  (process.env[name] ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)

export function homeLayout(venueId?: string | null): HomeLayout {
  if (venueId && venueList("NABALENS_HOME_LAYOUT_B01_VENUES").includes(venueId))
    return "b01"
  if (
    venueId &&
    venueList("NABALENS_HOME_LAYOUT_ALBUM_VENUES").includes(venueId)
  )
    return "album"
  const value = process.env.NABALENS_HOME_LAYOUT?.trim()
  return value && LAYOUTS.includes(value)
    ? (value as HomeLayout)
    : DEFAULT_HOME_LAYOUT
}
