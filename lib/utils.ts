import { createCn } from "cn/config"

/*
 * The merger only knows Tailwind's stock names. A token it does not know is
 * either read as a colour (`text-label` is dropped when `text-ink` follows)
 * or not recognised at all (`gap-2 gap-gutter` keeps both). So every custom
 * name in app/globals.css is registered here, under the scale it belongs to.
 * Keep these lists in step with that file.
 */

// Type roles: text-*
const TYPE_ROLES = [
  "display",
  "title",
  "figure",
  "heading",
  "count",
  "page-title",
  "section-title",
  "heading-sm",
  "item-title",
  "lead",
  "field",
  "button",
  "body",
  "label",
  "meta",
  "mono",
  "tab-label",
  "chip",
  "caption",
]

// Heading recipes: type-*. They set a size, so they replace a text-* role
// and a text-* role replaces them. `type-stamp` is not here: it sets the
// lettering only, and the chip's `text-chip` beside it gives the size.
const TYPE_RECIPES = [
  "display",
  "title",
  "figure",
  "count",
  "page-title",
  "section-title",
  "heading-sm",
  "tab-label",
]

const RADII = ["control", "card", "sheet", "round", "square", "stamp"]

// gap-gutter, px-page-gutter, min-h-tabbar, min-w-tile-min, w-rail
const SPACING = ["gutter", "page-gutter", "tabbar", "tile-min", "rail"]

// max-w-feed and the rest; the last three are container-query sizes
const CONTAINERS = [
  "feed",
  "reading",
  "page",
  "dialog",
  "dialog-wide",
  "compact",
  "regular",
  "wide",
]

// shadow-card and the rest. Registered so a later `shadow-none` removes an
// earlier `shadow-card`, and two elevations do not both survive.
const ELEVATION = ["card", "float", "control", "bar"]

const LAYERS = ["local", "sticky", "dock", "nav", "overlay"]

const DURATIONS = ["quick", "move", "sheet"]

export const cn = createCn({
  extend: {
    theme: {
      text: TYPE_ROLES,
      radius: RADII,
      shadow: ELEVATION,
      spacing: SPACING,
      container: CONTAINERS,
    },
    classGroups: {
      "font-size": [{ type: TYPE_RECIPES }],
      "grid-cols": [{ "grid-cols": ["tiles"] }],
      // A caller's own width replaces the sheet's notch-safe width.
      w: ["w-safe"],
      z: [{ z: LAYERS }],
      duration: [{ duration: DURATIONS }],
      // One edge per element. `ring-selected` is listed so it is not read as
      // a ring colour and dropped by `ring-focus`.
      edge: [
        "edge",
        "edge-strong",
        "edge-selected",
        "edge-invalid",
        "ring-selected",
      ],
      // One rail per element: both directions draw on the same shadow layer.
      rail: [
        { rail: [{ start: ["ok", "warn", "info"] }] },
        { rail: [{ top: ["ok", "warn", "info"] }] },
      ],
      "focus-ring": ["focus-ring", "focus-ring-inset", "focus-ring-within"],
    },
    conflictingClassGroups: {
      // An edge sets the inset ring's width and colour, a rail the inset
      // shadow. Neither touches `shadow-card`, so they are kept beside it.
      edge: ["inset-ring-w", "inset-ring-color"],
      // The other way round: `inset-ring-0` is how a caller removes an edge
      // (`shadow-none` does not reach it).
      "inset-ring-w": ["edge"],
      rail: ["inset-shadow", "inset-shadow-color"],
    },
  },
})
