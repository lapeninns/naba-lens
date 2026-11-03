function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? displayName
}

export const MANAGERS_COPY = {
  title: "Venue managers",
  scope: "All venues",
  summary:
    "A grant on a staff account for one venue, never a role. It works only while the person is active and at that venue.",
  powers:
    "Managers review photos, set targets and run their venue's checklist. They can't invite or deactivate people, change venues or teams, change menus, download originals or delete colleagues' photos. A grant ends if the person moves venue or is deactivated, and never moves with them.",
  grantHeading: "Make someone a venue manager",
  currentHeading: "Current grants",
  endedHeading: "Ended grants",
  endedNote: "Kept for history",
  venueCount: (managed: number, total: number) =>
    `${managed} ${managed === 1 ? "venue" : "venues"} of ${total}`,
  sortNote: "A to Z by surname.",
  fields: {
    venue: "Venue",
    venuePlaceholder: "Choose a venue",
    person: "Staff member",
    personPlaceholder: "Choose a person",
    personHint: "Only active staff currently at this venue.",
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
  grant: "Make venue manager",
  granting: "Making venue manager…",
  showEnded: "Show ended grants",
  hideEnded: "Hide ended grants",
  moreActions: (name: string) => `More actions for ${name}`,
  revokeItem: "Revoke grant",
  chooseVenue: "Choose a venue.",
  choosePerson: "Choose a person.",
  granted: (name: string, venue: string) =>
    `${name} is now ${venue}'s venue manager. It takes effect on ${firstName(name)}'s next page load.`,
  noStaff: (venue: string) =>
    `${venue} has no active staff. Invite staff first.`,
  emptyTitle: "No venue managers yet.",
  emptyText:
    "Make someone a venue manager above. Until then, admins review every venue's photos from Coverage.",
  loading: "Loading grants…",
  couldNotLoad: "We couldn't load venue managers",
  couldNotLoadBody:
    "Check your connection and try again. No grant has changed.",
  venuesCouldNotLoad:
    "Venues could not be loaded. Reload the page to try again.",
  revoke: {
    title: (name: string) => `Revoke ${name}'s manager grant?`,
    description: (name: string) =>
      `It takes effect on ${firstName(name)}'s next page load: Manage disappears and Manage links show why. Review decisions ${firstName(name)} has made stand.`,
    reason: "Reason",
    help: "It's kept in the grant history, with your name and the time.",
    confirm: "Revoke grant",
    confirming: "Revoking…",
    failedTitle: "Couldn't revoke the grant",
    nothingChanged: (name: string, venue: string) =>
      `Nothing changed. ${firstName(name)} is still ${venue}'s venue manager. Try again.`,
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
