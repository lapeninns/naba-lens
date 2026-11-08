import { plural } from "@/components/nabalens/coverage/copy"

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
  /** What each page's error boundary says it couldn't load. */
  couldNotLoad: {
    overview: "the overview",
    review: "photos for review",
    contributor: "this contributor's photos",
    menu: "the menu",
    item: "this menu item",
    account: "your account",
  },
  notFound: {
    title: "This page isn't available in your workspace",
    back: "Go to Overview",
  },
  overview: {
    title: "Overview",
    loading: "Loading menu photos",
    noMenuTitle: "Menu photos will appear once your venue's menu is set up",
    noMenuBody:
      "An admin activates the menu. Staff can keep adding photos to their portfolios meanwhile.",
    emptyTitle: "Your active menu has no items to photograph",
    emptyBody: "Ask an admin to check the menu.",
    heading: (covered: number, eligible: number) =>
      `Menu photos · ${covered} of ${plural(eligible, "item")} covered`,
    photosWaiting: (n: number) =>
      `${plural(n, "photo")} waiting for a decision`,
    itemsAwaiting: (n: number) => `${plural(n, "item")} awaiting review`,
    itemsNoPhoto: (n: number) => `${plural(n, "item")} with no ready photo`,
    oldestWaiting: (waited: string) => `Oldest waiting: ${waited}`,
    replacement: (n: number) =>
      `${plural(n, "item")} ${n === 1 ? "has" : "have"} a new photo waiting`,
    recheck: (n: number) =>
      `${plural(n, "item")} ${n === 1 ? "needs" : "need"} a new decision after a menu or label change`,
    ownWaiting: (n: number) =>
      `${n} of your earlier photos ${n === 1 ? "is" : "are"} waiting for an admin`,
    reviewPhotos: "Review photos",
    quietTitle: "Nothing waiting for review",
    quietBody: (n: number) =>
      `${plural(n, "item")} still ${n === 1 ? "needs" : "need"} a photo. Staff see these gaps in Our menu.`,
    quietLink: "See items without a photo",
    doneTitle: "Every menu item has a photo",
    doneLink: "Review newer photos",
    sectionsTitle: "By section",
    section: (name: string, covered: number, eligible: number) =>
      `${name}: ${covered} of ${eligible}`,
    banner: (date: string, carried: number, recheck: number, added: number) =>
      `Menu active since ${date}: ${plural(carried, "item")} kept their photo, ${recheck} need a new decision, ${plural(added, "new item")}.`,
    reviewChanges: "Review changes",
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
    loading: "Loading the menu",
    search: "Search items",
    searchPlaceholder: "Item name",
    statusLabel: "Show",
    status: {
      all: "All",
      needs_photo: "Still needs a photo",
      awaiting_review: "Awaiting review",
      covered: "Has a photo",
      replacement: "New photo waiting",
      recheck: "Needs a recheck",
    },
    sectionLabel: "Section",
    allSections: "All sections",
    sectionCount: (covered: number, eligible: number) =>
      `${covered} of ${eligible} covered`,
    replacementChip: "New photo waiting",
    recheckChip: "Needs a recheck",
    ownWaiting: "Your earlier photo is waiting for an admin",
    showMore: "Show more items",
    loadingMore: "Loading…",
    loaded: (n: number) => `${plural(n, "more item")} loaded`,
    loadFailed: "More items could not load. Try again.",
    noMatch: (q: string) => `No items match '${q}'`,
    noMatchBody: "Try another word, or clear the search.",
    noneInView: "No items in this view",
    showAll: "Show all items",
  },
  item: {
    title: "Menu item",
    back: "Menu",
    menuPhoto: "Menu photo",
    noMenuPhoto: "No menu photo yet",
    fallback: "Showing the earliest accepted photo",
    photoBy: (name: string) => `Photo by ${name}`,
    acceptedBy: (name: string | null, date: string) =>
      name ? `Accepted by ${name} · ${date}` : `Accepted · ${date}`,
    alternatives: "Accepted alternatives",
    setPreferred: "Set as menu photo",
    withdrawAcceptance: "Withdraw acceptance",
    askedForAnother: "Asked for another photo",
    withdraw: "Withdraw",
    recheck: "Needs a recheck",
    recheckKind: {
      name_changed: "Name changed on the new menu",
      section_changed: "Section type changed",
      variant_removed: "Option no longer on the menu",
    },
    acceptAgain: "Accept again for this menu",
    variantRemoved: "This option is no longer on the menu",
    movedFrom: (name: string) => `Moved from ${name}`,
    waiting: "Waiting for review",
    waitingCount: (n: number) => `${plural(n, "photo")} waiting for a decision`,
    reviewWaiting: "Review these photos",
    noneWaiting: "No photos of this item are waiting for a decision.",
    othersWaiting: "Waiting for an admin",
    ownPhoto: "This is your photo. Another reviewer decides on it.",
    contributorLeft:
      "This contributor has left. An admin handles their photos.",
    withdrawTitle: "Withdraw acceptance",
    withdrawLabel: "Why is this photo no longer right?",
    withdrawPending: "Withdrawing…",
    withdrawPromote: "Another accepted photo becomes the menu photo.",
    withdrawReopen: (item: string) => `${item} will need a photo again.`,
    withdrawRequestTitle: "Withdraw the request",
    withdrawRequestLabel: "Why is this request no longer needed?",
    conflict: (item: string) =>
      `Someone else changed ${item} first. Here is the latest.`,
    network:
      "Could not reach the server. Try again; the photo will not be decided twice.",
    done: {
      set_preferred: (item: string) => `Set as the menu photo for ${item}.`,
      withdraw: "Withdrawn.",
      reaccept: (item: string) => `Accepted again for ${item}.`,
    },
    history: "History",
    historyVerb: {
      accepted: "accepted",
      better_photo_requested: "asked for another photo",
      withdrawn: "withdrew",
      primary_set: "set as menu photo",
      primary_cleared: "cleared the menu photo",
      carried: "kept after a menu change",
      needs_recheck: "sent for a recheck",
      invalidated: "lost its label",
    },
    historyMoved: (item: string) => `moved from ${item}`,
    historyEmpty: "No decisions yet.",
    historyFailed: "The history could not load. Try again.",
    showMore: "Show more",
    loadingMore: "Loading…",
  },
  notFoundItem: {
    title: "This item isn't on your current menu",
    back: "Go to Menu",
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
