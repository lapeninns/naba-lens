function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? displayName
}

export const MANAGERS_COPY = {
  title: "Venue managers",
  scope: "All venues",
  summary:
    "Venue managers are a separate account type. Convert an account from its staff page, then manage its venue access here.",
  powers:
    "Venue managers sign in to the manager workspace for their venue. They can't add or label photos, invite or deactivate people, change venues or teams, change menus, download originals or delete colleagues' photos. Access ends if the person moves venue, is deactivated or returns to a staff account, and never moves with them.",
  grantHeading: "Give a venue manager access",
  currentHeading: "Current grants",
  endedHeading: "Ended grants",
  endedNote: "Kept for history",
  venueCount: (managed: number, total: number) =>
    `${managed} ${managed === 1 ? "venue" : "venues"} of ${total}`,
  sortNote: "A to Z by surname.",
  fields: {
    venue: "Venue",
    venuePlaceholder: "Choose a venue",
    person: "Venue manager",
    personPlaceholder: "Choose a person",
    personHint: "Manager accounts at this venue without access.",
    note: "Note",
    optional: "(optional)",
  },
  columns: {
    person: "Person",
    venue: "Venue",
    since: "Since",
    grantedBy: "Granted by",
    dates: "Dates",
    howItEnded: "How it ended",
    actions: "Actions",
  },
  grant: "Give access",
  granting: "Giving access…",
  showEnded: "Show ended grants",
  hideEnded: "Hide ended grants",
  moreActions: (name: string) => `More actions for ${name}`,
  revokeItem: "Revoke grant",
  chooseVenue: "Choose a venue.",
  choosePerson: "Choose a person.",
  granted: (name: string, venue: string) =>
    `${name} now has venue access at ${venue}. It takes effect on ${firstName(name)}'s next page load.`,
  noStaff: (venue: string) =>
    `${venue} has no manager accounts without access. Convert a staff account to a venue manager from its page in Staff.`,
  emptyTitle: "No venue managers yet.",
  emptyText:
    "Convert a staff account to a venue manager from its page in Staff. Until then, admins review every venue's photos from Coverage.",
  legacyStaffGrant: "Legacy staff grant",
  legacyStaffGrantNote:
    "Legacy staff grant: made before venue manager accounts. It stays in effect until you convert the person to a venue manager account from their staff page.",
  loading: "Loading grants…",
  couldNotLoad: "We couldn't load venue managers",
  couldNotLoadBody:
    "Check your connection and try again. No grant has changed.",
  venuesCouldNotLoad:
    "Venues could not be loaded. Reload the page to try again.",
  revoke: {
    title: (name: string) => `Revoke ${name}'s manager grant?`,
    description: (name: string) =>
      `It takes effect on ${firstName(name)}'s next page load, when ${firstName(name)}'s venue access ends. Review decisions ${firstName(name)} has made stand.`,
    reason: "Reason",
    help: "It's kept in the grant history, with your name and the time.",
    confirm: "Revoke grant",
    confirming: "Revoking…",
    failedTitle: "Couldn't revoke the grant",
    /** The server refused: the grant is unchanged, and it says why. */
    nothingChanged: (name: string, venue: string, reason: string) =>
      `Nothing changed. ${firstName(name)} is still ${venue}'s venue manager. ${reason}`,
    /** The reply was lost: the revoke may have happened. */
    notConfirmed: (name: string, venue: string) =>
      `We couldn't confirm ${firstName(name)} is no longer ${venue}'s venue manager. Check your connection, then refresh to see.`,
    done: (name: string, venue: string) =>
      `${name}'s grant at ${venue} was revoked. It takes effect on ${firstName(name)}'s next page load; ${firstName(name)}'s review decisions stand.`,
    context: (venue: string, since: string) =>
      `Venue manager at ${venue} since ${since}`,
  },
} as const

/** Sort key: surname (last word), then first name; A to Z. */
export function compareBySurname(a: string, b: string): number {
  const split = (name: string) => {
    const words = name.trim().split(/\s+/)
    return { last: words.at(-1) ?? "", first: words[0] ?? "" }
  }
  const x = split(a)
  const y = split(b)
  return (
    x.last.localeCompare(y.last, "en-GB", { sensitivity: "base" }) ||
    x.first.localeCompare(y.first, "en-GB", { sensitivity: "base" })
  )
}
