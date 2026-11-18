/**
 * Why a staff member can't add photos, in Album's words (DESIGN.md §7: "Add
 * photos", never "upload"). Shared by Album Home and Me so they say it the
 * same way.
 */
export const ADD_BLOCKED = {
  not_staff: "Only staff accounts can add photos.",
  no_venue: "You can't add photos until an admin assigns your venue.",
  venue_inactive:
    "Your venue isn't taking photos right now, so you can't add any. Ask an admin to check your venue.",
} as const
