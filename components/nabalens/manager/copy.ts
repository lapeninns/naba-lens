import { plural } from "@/components/nabalens/coverage/copy"
import { CHIP_STATES } from "@/components/nabalens/status-chip"
import { INBOX_COPY } from "@/components/nabalens/manager/review/inbox-copy"

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
    team: "the team's targets",
    venue: "the venue",
    venueFacts: "what needs confirming",
    venueHistory: "the venue's history",
    venueReports: "reported changes",
  },
  notFound: {
    title: "This page isn't available in your workspace",
    back: "Go to Overview",
  },
  overview: {
    title: "Overview",
    loading: "Loading the overview",
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
    needsLabels: (n: number) =>
      `${plural(n, "photo")} ${n === 1 ? "needs" : "need"} labels`,
    reviewPhotos: "Review photos",
    exportsTitle: "Export photos",
    exportsLine:
      "Download photos accepted for public use and record where they are published.",
    quietTitle: "Nothing waiting for review",
    quietBody: (n: number) =>
      `${plural(n, "item")} still ${n === 1 ? "needs" : "need"} a photo. Staff see these gaps in Our menu.`,
    quietLink: "See items without a photo",
    // S3-R5: with the actions panel, Review next already says "Nothing
    // waiting for review", so the quiet card leads with the gap instead.
    gapsTitle: (n: number) =>
      `${plural(n, "item")} still ${n === 1 ? "needs" : "need"} a photo`,
    gapsBody: "Staff see these gaps in Our menu.",
    doneTitle: "Every menu item has a photo",
    doneLink: "Review newer photos",
    sectionsTitle: "By section",
    section: (name: string, covered: number, eligible: number) =>
      `${name}: ${covered} of ${eligible}`,
    banner: (date: string, carried: number, recheck: number, added: number) =>
      `Menu active since ${date}: ${plural(carried, "item")} kept their photo, ${recheck} need a new decision, ${plural(added, "new item")}.`,
    reviewChanges: "Review changes",
  },
  /** S2-MGR: the Venue hub and its pages (spec §7 M5). */
  venue: {
    title: "Venue",
    loading: "Loading the venue",
    summary:
      "Menus, specials, spaces, facilities, the team and who reviews photos here.",
    menusTitle: "Current menus",
    menusFailed: "Menus couldn't be loaded. Try again in a moment.",
    noMenu:
      "No menu is active yet. An admin imports and activates it; staff can keep adding photos meanwhile.",
    startsLater: (title: string, when: string) => `${title} starts ${when}`,
    menusLink: "Menus and change requests",
    menusLine:
      "The current menu, later ones, and asking an admin for a change.",
    availabilityLink: "Dishes, availability and local names",
    availabilityLine:
      "Mark a dish unavailable for now or give it a local name.",
    specialsTitle: "Local specials",
    specialsLine: (running: number, waiting: number) =>
      `${running} running · ${waiting} waiting for a decision`,
    specialsUnknown: "Dated specials for this venue.",
    spacesTitle: "Spaces",
    spacesLine: (current: number, due: number) =>
      `${current} photos current · ${due} due a check`,
    spacesUnknown: "Where staff photograph each part of the venue.",
    placesLink: "Album places and briefs",
    placesLine: "Where staff stand to photograph each section, and its brief.",
    facilitiesTitle: "Facilities and policies",
    factsLine: (text: string, percent: string | null, waiting: number) =>
      `${text} facts confirmed${percent ? ` (${percent})` : ""} · ${waiting} to confirm`,
    factsUnknown: "We couldn't count the facts.",
    amenitiesLink: "Facilities and questions",
    amenitiesLine: "Answer questions, mark what is not here, assign checks.",
    toConfirmLink: "To confirm",
    toConfirmLine: (n: number | null) =>
      n === null
        ? "Facts and space photos to confirm as still right."
        : n === 0
          ? "Nothing to confirm"
          : `${n} to confirm as still right`,
    // S3-R5 (K3): staff reports of a changed slot or photo detail.
    reportsLink: "Reported changes",
    reportsLine: (n: number | null) =>
      n === null
        ? "What staff told you has changed."
        : n === 0
          ? "Nothing reported"
          : `${n} reported by staff`,
    teamTitle: "Team",
    teamLink: "People and photo targets",
    teamLine: "Invite or remove staff, switch venue, set monthly targets.",
    reviewersTitle: "Review assignments",
    reviewersFailed: "Reviewers couldn't be loaded. Try again in a moment.",
    historyTitle: "History",
    historyEmpty: "No changes recorded yet.",
    historyFailed: "History couldn't be loaded. Try again in a moment.",
    historyAll: "See all history",
    exportsLink: "Export photos",
    exportsLine:
      "Packages of photos for public use, and where they are published.",
  },
  venueFacts: {
    title: "To confirm",
    loading: "Loading what needs confirming",
    summary:
      "Say whether each answer or photo is still right. Nothing changes except the date it was checked.",
    factsTitle: "Facts",
    factsEmpty: "Every fact is confirmed.",
    factsFailed: "Facts couldn't be loaded. Try again in a moment.",
    spacesTitle: "Space photos",
    spacesEmpty: "No space photos are due a check.",
    spacesFailed: "Space photos couldn't be loaded. Try again in a moment.",
  },
  /** S3-R5 (K3): Venue › Reported changes (spec §6 S3, S4, §7 M5). */
  venueReports: {
    title: "Reported changes",
    loading: "Loading reported changes",
    summary:
      "Staff told you something has changed. Nothing changes until you change it: open it, then mark the report dealt with.",
    listLabel: "Reported changes",
    empty: "Nothing reported. Staff can report a change from any slot.",
    failed: "Reported changes couldn't be loaded. Try again in a moment.",
  },
  venueHistory: {
    title: "History",
    loading: "Loading the venue's history",
    summary: "Every recorded change at this venue, newest first.",
    all: "All changes",
    empty: "No changes of this kind yet.",
    more: "Show older changes",
    loadingMore: "Loading",
    failed: "Older changes couldn't be loaded. Try again.",
    by: (name: string | null) => (name ? `by ${name}` : "by the system"),
  },
  review: {
    title: "Review",
    loading: "Loading photos for review",
    pendingTitle: "Photo review is being set up",
    pendingBody:
      "Photos waiting for a decision will appear here once item review is switched on for your venue.",
  },
  contributor: {
    title: "Contributor",
    loading: "Loading this contributor's photos",
    pendingBody:
      "A contributor's photos will appear here once item review is switched on for your venue.",
  },
  menu: {
    // S3-R13: the page the Album tab opens is headed as the tab is named.
    title: "Album",
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
    loading: "Loading this menu item",
    back: "Album",
    menuPhoto: "Menu photo",
    noMenuPhoto: "No menu photo yet",
    fallback: "Showing the earliest accepted photo",
    photoBy: (name: string) => `Photo by ${name}`,
    acceptedBy: (name: string | null, date: string) =>
      name ? `Accepted by ${name} · ${date}` : `Accepted · ${date}`,
    alternatives: "Accepted alternatives",
    setPreferred: "Set as menu photo",
    withdrawAcceptance: "Withdraw acceptance",
    askedForAnother: CHIP_STATES.coverage_replacement_needed.word,
    withdraw: "Withdraw",
    recheck: "Needs a recheck",
    recheckKind: {
      name_changed: "Name changed on the new menu",
      section_changed: "Section type changed",
      variant_removed: "Option no longer on the menu",
      presentation_changed: "Served differently now",
    },
    acceptAgain: INBOX_COPY.publicUse.again,
    variantRemoved: "This option is no longer on the menu",
    movedFrom: (name: string) => `Moved from ${name}`,
    waiting: CHIP_STATES.coverage_pending.word,
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
    // The reply was lost: the decision may be saved. The request id is kept.
    network:
      "We couldn't confirm the decision was saved. Check your connection, then try again or refresh to see if it was. The photo won't be decided twice.",
    done: {
      set_preferred: (item: string) => `Set as the menu photo for ${item}.`,
      withdraw: "Withdrawn.",
      reaccept: INBOX_COPY.publicUse.doneAgain,
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
  uploads: {
    title: "My uploads",
    summary: "Photos and videos you've added, with their labels and review.",
    empty: "Photos and videos you add show here.",
    missing: "Your uploads can't be shown here yet.",
    failed: "We couldn't load your uploads.",
    loading: "Loading your uploads…",
    addLabels: "Add labels",
    editLabels: "Edit labels",
  },
  team: {
    title: "Team targets",
    loading: "Loading the team's targets…",
    entry: "Team targets",
    entryNote: "Monthly photo targets for your team",
    summary: (month: string) =>
      `Accepted photos each person aims for in ${month}. Each person sees only their own month.`,
    defaultTitle: "Venue default",
    defaultBody:
      "Everyone at the venue gets this number each month, unless you set their own. New starters get it too.",
    defaultName: "Venue default photo target",
    defaultUnset:
      "No default yet. People without their own number show Needs setup.",
    defaultSet: (n: number) =>
      `${plural(n, "accepted photo")} per person each month.`,
    saveDefault: "Save default",
    clearDefault: "Clear default",
    defaultSaved: "The venue default is saved.",
    defaultCleared: "The venue default is cleared.",
    peopleTitle: "People",
    peopleEmpty: "Nobody works at this venue yet.",
    ownNumber: "Own number",
    usesDefault: "Venue default",
    noTarget: "No target yet",
    change: (name: string) => `Change ${name}'s target`,
    changeShort: "Change",
    personName: (name: string) => `${name}'s photo target`,
    savePerson: "Save target",
    cancel: "Cancel",
    personSaved: (name: string) => `${name}'s target is saved.`,
    useDefault: "Use the venue default",
    defaultUsed: (name: string) =>
      `${name} uses the venue default now. Their own number won't carry into next month.`,
    reasonLabel: "Reason for the change",
    reasonHelp: "Admins can see this reason.",
    saving: "Saving…",
    wholeVenue:
      "This month the venue has one target for the whole team, counted in menu items and amenity checks. Photo targets aren't used.",
    privacy: "Targets are private to each person, you and admins.",
  },
  accountPage: {
    title: "Account",
    loading: "Loading your account",
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
