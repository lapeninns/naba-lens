import type { Rule } from "./support/token-discipline"

/*
 * The one list of exceptions to tests/unit/token-discipline.test.ts.
 *
 * An entry lets one finding through in one file: `match` is the text the
 * rule reports (the utility without its variants, or the whole class for
 * hand-focus), and it covers every line of that file where it appears.
 * `reason` is a full sentence saying why the value has no token yet, or which
 * batch removes it (docs/design-system/strategy.md, section 8).
 *
 * The list may only shrink. The test fails when an entry no longer matches
 * anything, so delete the entry with the code it excused.
 */
export type AllowEntry = {
  file: string
  rule: Rule
  match: string
  reason: string
}

/*
 * Each count is the exact length of its list. Take it down when you delete
 * an entry. Raising one means a new exception: say in the pull request why
 * no token or recipe fits, and expect to be asked. Do not raise it to get a
 * red test to pass.
 */
export const MAX_ALLOWED = 28
export const MAX_ALLOWED_DEV = 9

const HEADER_HAIRLINE =
  "The hairline under a header has no utility: shadow-bar is the line above a bottom bar."
const TAB_UNDERLINE =
  "The 3px tab underline is drawn on the shadow layer until the tab recipe lands in Batch 2."
const SEGMENT_EDGE =
  "A raised segment's outer edge is 1.5px beside shadow-control, and edge-strong is 1px."
const EDGE_1_5 =
  "This boundary is 1.5px and edge-strong is 1px; it waits for the control recipes in Batch 2."
const ACTIVE_TAB_BAR =
  "The active tab's top bar rounds its lower corners by its own 3px height; no radius token fits."
const WRAPPER_INSET_FOCUS =
  "The wrapper's outline sits inside its box, and focus-ring-within has no inset form."
const LINK_ONLY_FOCUS =
  "Only the link's focus marks the card, and focus-ring-within would answer to any child."

export const ALLOW: AllowEntry[] = [
  /* ---------------------------------------------------------- raw-colour */
  {
    file: "lib/pwa/canvas-colours.ts",
    rule: "raw-colour",
    match: "#f6f3ec",
    reason:
      "The theme-color meta tag and the web app manifest cannot read a CSS variable, so the light canvas is repeated in sRGB.",
  },
  {
    file: "lib/pwa/canvas-colours.ts",
    rule: "raw-colour",
    match: "#121613",
    reason:
      "The theme-color meta tag cannot read a CSS variable, so the dark canvas is repeated in sRGB.",
  },

  /* ------------------------------------------- arbitrary-value: shadows */
  {
    file: "components/nabalens/app-shell.tsx",
    rule: "arbitrary-value",
    match: "shadow-[0_1px_0_var(--line)]",
    reason: HEADER_HAIRLINE,
  },
  {
    file: "components/nabalens/manager/manager-shell.tsx",
    rule: "arbitrary-value",
    match: "shadow-[0_1px_0_var(--line)]",
    reason: HEADER_HAIRLINE,
  },
  {
    file: "components/nabalens/manager/venue-access-unavailable.tsx",
    rule: "arbitrary-value",
    match: "shadow-[0_1px_0_var(--line)]",
    reason: HEADER_HAIRLINE,
  },
  {
    file: "components/nabalens/section-tabs.tsx",
    rule: "arbitrary-value",
    match: "shadow-[inset_0_-1px_0_var(--line)]",
    reason:
      "The hairline under the tab strip is drawn inside the strip, and no utility draws a bottom hairline.",
  },
  {
    file: "components/nabalens/section-tabs.tsx",
    rule: "arbitrary-value",
    match: "shadow-[inset_0_-3px_0_transparent]",
    reason: TAB_UNDERLINE,
  },
  {
    file: "components/nabalens/section-tabs.tsx",
    rule: "arbitrary-value",
    match: "shadow-[inset_0_-3px_0_var(--accent-text)]",
    reason: TAB_UNDERLINE,
  },
  {
    file: "components/nabalens/app-shell.tsx",
    rule: "arbitrary-value",
    match: "shadow-[inset_0_-3px_0_transparent]",
    reason: TAB_UNDERLINE,
  },
  {
    file: "components/nabalens/app-shell.tsx",
    rule: "arbitrary-value",
    match: "shadow-[inset_0_-3px_0_var(--accent-text)]",
    reason: TAB_UNDERLINE,
  },

  {
    file: "components/nabalens/coverage/team-roster.tsx",
    rule: "arbitrary-value",
    match: "shadow-[inset_0_0_0_1.5px_var(--edge-strong)]",
    reason: EDGE_1_5,
  },
  {
    file: "components/nabalens/coverage/team-roster.tsx",
    rule: "arbitrary-value",
    match: "shadow-[inset_0_0_0_2px_var(--accent-text)]",
    reason:
      "A changed number field is marked with a 2px accent edge, and edge-selected is 1.5px.",
  },
  {
    file: "components/ui/field.tsx",
    rule: "arbitrary-value",
    match: "shadow-[inset_0_0_0_2px_var(--select)]",
    reason:
      "A checked choice card has a 2px select edge, and ring-selected is 3px.",
  },
  {
    file: "components/nabalens/tasks/photo-picker.tsx",
    rule: "arbitrary-value",
    match: "shadow-[0_0_0_3px_var(--select)]",
    reason:
      "The picked photo's ring is drawn outside the tile, and ring-selected draws inside it.",
  },
  {
    file: "components/nabalens/menus/import-issue-list.tsx",
    rule: "arbitrary-value",
    match: "shadow-[inset_4px_0_0_var(--edge-strong)]",
    reason:
      "A neutral rail has no utility: rails exist only for the ok, warn and info tones.",
  },

  /* ---------------------------------------- arbitrary-value: ring width */
  {
    file: "components/ui/toggle.tsx",
    rule: "arbitrary-value",
    match: "ring-[1.5px]",
    reason: SEGMENT_EDGE,
  },

  /* ----------------------------------------- arbitrary-value: type size */
  {
    file: "components/nabalens/common-room/stamp.tsx",
    rule: "arbitrary-value",
    match: "text-[1.3125rem]",
    reason:
      "The Complete stamp sets its own 21px size, because type-stamp carries the lettering and no size.",
  },
  {
    file: "components/ui/avatar.tsx",
    rule: "arbitrary-value",
    match: "text-[30px]",
    reason:
      "The large avatar's initials scale with the avatar and have no type role yet.",
  },

  /* -------------------------------------------- arbitrary-value: radius */
  {
    file: "components/nabalens/app-shell.tsx",
    rule: "arbitrary-value",
    match: "rounded-b-[3px]",
    reason: ACTIVE_TAB_BAR,
  },
  {
    file: "components/nabalens/manager/manager-nav.tsx",
    rule: "arbitrary-value",
    match: "rounded-b-[3px]",
    reason: ACTIVE_TAB_BAR,
  },
  {
    file: "components/nabalens/tasks/photo-picker.tsx",
    rule: "arbitrary-value",
    match: "rounded-[6px]",
    reason:
      "The tick box on a photo tile is 6px, between rounded-square and rounded-control; it needs a decision.",
  },

  /* --------------------------------------------- arbitrary-value: layer */
  {
    file: "components/nabalens/tasks/evidence-image.tsx",
    rule: "arbitrary-value",
    match: "z-20",
    reason:
      "The retry button sits one step above the tile's z-local overlay, and z-sticky would name it wrongly.",
  },

  /* -------------------------------------------------------- dark-variant */
  {
    file: "components/nabalens/edit-profile-dialog.tsx",
    rule: "dark-variant",
    match: "dark:bg-transparent",
    reason:
      "Left from overriding the stock Input's dark fill on the file input; remove it with the field recipes in Batch 2.",
  },

  /* ---------------------------------------------------------- hand-focus */
  {
    file: "components/nabalens/manager/review/item-picker-dialog.tsx",
    rule: "hand-focus",
    match: "has-focus-visible:outline-focus",
    reason: WRAPPER_INSET_FOCUS,
  },
  {
    file: "components/ui/field.tsx",
    rule: "hand-focus",
    match: "has-[>[data-slot=field]]:has-[:focus-visible]:outline-focus",
    reason:
      "Only a choice card that wraps a field is marked, a narrower match than focus-ring-within makes.",
  },
  {
    file: "components/nabalens/amenities/capture/amenity-task-list.tsx",
    rule: "hand-focus",
    match: "has-[a:focus-visible]:outline-focus",
    reason: LINK_ONLY_FOCUS,
  },
  {
    file: "components/nabalens/tasks/assignment-list.tsx",
    rule: "hand-focus",
    match: "has-[a:focus-visible]:outline-focus",
    reason: LINK_ONLY_FOCUS,
  },
  {
    file: "app/admin/menus/venue-controls.tsx",
    rule: "hand-focus",
    match: "focus-visible:outline-focus",
    reason:
      "The select is sized tightly, and focus-ring's 2px offset would push the outline over its neighbours.",
  },
]

/*
 * DEV FIXTURES ONLY: app/(dev)/**. The preview routes draw sample photos as
 * flat-colour SVG data URLs, and an SVG in a data URL cannot read a token.
 * Nothing outside app/(dev)/ belongs in this section.
 */
const SAMPLE_FILL =
  "A sample photo's fill colour, written into an SVG data URL that cannot read a token."

export const DEV_ALLOW: AllowEntry[] = [
  ...["#5b6b73", "#7a5c45", "#3f6b5a", "#8a6d2f", "#4b5d7a", "#6e4a5a"].map(
    (match): AllowEntry => ({
      file: "app/(dev)/ui-preview/fixtures.ts",
      rule: "raw-colour",
      match,
      reason: SAMPLE_FILL,
    })
  ),
  {
    file: "app/(dev)/ui-preview/fixtures.ts",
    rule: "raw-colour",
    match: "#56606a",
    reason: SAMPLE_FILL,
  },
  {
    file: "app/(dev)/ui-preview/fixtures.ts",
    rule: "raw-colour",
    match: "#fff",
    reason:
      "The label drawn on a sample photo, inside an SVG data URL that cannot read a token.",
  },
  {
    file: "app/(dev)/ui-preview/fixtures.ts",
    rule: "raw-colour",
    match: "rgba()",
    reason:
      "The highlight and shade drawn on a sample photo, inside an SVG data URL that cannot read a token.",
  },
]
