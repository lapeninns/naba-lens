/** Words of the venue manager workspace, shared by its pages and tests. */
export const MANAGER_COPY = {
  navLabel: "Venue workspace",
  reviewBadge: (count: number) =>
    count === 1 ? "photo waiting" : "photos waiting",
  account: "Account",
  logOut: "Log out",
  unavailable: {
    title: "Venue access unavailable",
    body: "Your account doesn't have access to a venue workspace right now. Ask an admin to check your venue access.",
    reason: {
      venue_inactive: "Your venue is not active.",
      no_grant: "Your venue access has ended.",
      venue_mismatch: "Your venue access has ended.",
    },
    signOut: "Sign out",
  },
  notFound: {
    title: "This page isn't available in your workspace",
    back: "Go to Overview",
  },
  overview: {
    title: "Overview",
    pendingTitle: "Menu photos are being set up",
    pendingBody:
      "Menu photo progress will appear here once item review is switched on for your venue.",
    loading: "Loading menu photos",
    couldNotLoad: "menu photos",
  },
  review: {
    title: "Review",
    pendingTitle: "Photo review is being set up",
    pendingBody:
      "Photos waiting for a decision will appear here once item review is switched on for your venue.",
  },
  contributor: {
    title: "Contributor",
    pendingBody:
      "A contributor's photos will appear here once item review is switched on for your venue.",
  },
  menu: {
    title: "Menu",
    pendingTitle: "Menu photos are being set up",
    pendingBody:
      "Each menu item's photo status will appear here once item review is switched on for your venue.",
  },
  item: {
    title: "Menu item",
    back: "Menu",
    pendingBody:
      "This item's photos and history will appear here once item review is switched on for your venue.",
  },
  accountPage: {
    title: "Account",
    summary: "Your name as staff and admins see it.",
    displayName: "Display name",
    displayNameError: "Enter a name of up to 80 characters.",
    save: "Save name",
    saving: "Saving…",
    saved: "Your name is saved.",
    saveFailed: "Your name could not be saved. Try again.",
    email: "Email",
    noEmail: "Not available",
    venue: "Venue",
    venueNote: "Only an admin can change your venue.",
    signOut: "Sign out",
  },
} as const
