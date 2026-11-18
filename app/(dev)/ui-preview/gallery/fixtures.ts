/*
 * DEV FIXTURE: fake data for the design system gallery. Nothing here is a
 * real person, venue or photo. The photos are the guide examples that ship
 * with the app, so the gallery needs no upload and no network.
 *
 * Class names are written out in full on purpose: Tailwind finds the
 * utilities it must build by reading this file as text.
 */

/** The sections of the gallery, in page order. The nav and the page share it. */
export const GALLERY_SECTIONS = [
  {
    id: "album",
    title: "Album",
    description:
      "The Album components (docs/design-system/DESIGN.md §5), as each batch builds them. A1: the slot tile. A2: Album Home, a place and Album places.",
  },
  {
    id: "foundations",
    title: "Foundations",
    description:
      "The tokens and recipes in app/globals.css that every component is built from.",
  },
  {
    id: "button",
    title: "Button",
    description:
      "Button, LinkButton and Spinner: every variant, size and state.",
  },
  {
    id: "fields",
    title: "Fields",
    description:
      "Input, Textarea, Select, SearchField and the Field parts that label them.",
  },
  {
    id: "choice",
    title: "Choice",
    description:
      "Checkbox, RadioGroup, OptionRow and SelectableTile: picking one or many.",
  },
  {
    id: "pills",
    title: "Pills",
    description:
      "SegmentedControl for one choice of a few, FilterPill and PillGroup for filters.",
  },
  {
    id: "overlays",
    title: "Overlays",
    description:
      "Dialog, AlertDialog, DropdownMenu and Table, on the shared sheet recipe.",
  },
  {
    id: "display",
    title: "Display",
    description: "Heading, Progress, Photo, Avatar, Skeleton and Switch.",
  },
  {
    id: "combobox",
    title: "Combobox",
    description: "A field you type in to narrow a long list, then pick one.",
  },
  {
    id: "other",
    title: "Other primitives",
    description:
      "Label and Separator, the internal Toggle pair, and the deprecated Badge and Alert.",
  },
  {
    id: "patterns",
    title: "Patterns",
    description:
      "The shared patterns in components/nabalens, as they are built today.",
  },
  {
    id: "states",
    title: "States",
    description:
      "What a screen shows while it loads, when it is empty, and when it fails.",
  },
  {
    id: "metrics",
    title: "Metrics",
    description:
      "The manager and admin metrics screens (spec §18.1): a venue's report, one category, an empty venue, the admin overview, loading and a failed read.",
  },
] as const

export type GallerySectionId = (typeof GALLERY_SECTIONS)[number]["id"]

/* ------------------------------------------------------------ foundations */

export type Swatch = { name: string; fill: string; role: string }

export const COLOUR_GROUPS: { title: string; swatches: Swatch[] }[] = [
  {
    title: "Surfaces",
    swatches: [
      { name: "canvas", fill: "bg-canvas", role: "Paper behind everything" },
      { name: "surface", fill: "bg-surface", role: "Cards, bars, sheets" },
      { name: "surface-2", fill: "bg-surface-2", role: "Grey buttons, fields" },
      { name: "raised", fill: "bg-raised", role: "Hover on grey" },
      {
        name: "media-placeholder",
        fill: "bg-media-placeholder",
        role: "Behind a photo before it loads",
      },
    ],
  },
  {
    title: "Text",
    swatches: [
      { name: "ink", fill: "bg-ink", role: "Text and icons" },
      { name: "ink-muted", fill: "bg-ink-muted", role: "Secondary text" },
      {
        name: "ink-subtle",
        fill: "bg-ink-subtle",
        role: "Separators between words",
      },
    ],
  },
  {
    title: "Boundaries",
    swatches: [
      { name: "line", fill: "bg-line", role: "Dividers. Decoration only" },
      {
        name: "edge-strong",
        fill: "bg-edge-strong",
        role: "The edge of a live control",
      },
    ],
  },
  {
    title: "Accent, selection and focus",
    swatches: [
      { name: "accent", fill: "bg-accent", role: "The one primary button" },
      { name: "accent-hover", fill: "bg-accent-hover", role: "Its hover" },
      { name: "on-accent", fill: "bg-on-accent", role: "Text on accent" },
      {
        name: "accent-text",
        fill: "bg-accent-text",
        role: "Active tab, selected edge",
      },
      {
        name: "accent-soft",
        fill: "bg-accent-soft",
        role: "Selected filter, segment or row",
      },
      {
        name: "select",
        fill: "bg-select",
        role: "Ticked box, chosen radio, picked tile",
      },
      { name: "on-select", fill: "bg-on-select", role: "The tick itself" },
      { name: "focus", fill: "bg-focus", role: "The focus outline" },
    ],
  },
  {
    title: "Tones",
    swatches: [
      { name: "ok-fg", fill: "bg-ok-fg", role: "Accepted, met: text and bar" },
      { name: "ok-bg", fill: "bg-ok-bg", role: "Its tint" },
      {
        name: "ok-waiting",
        fill: "bg-ok-waiting",
        role: "Waiting part of the album bar",
      },
      { name: "on-ok", fill: "bg-on-ok", role: "Text on the Accepted mark" },
      {
        name: "ring-waiting",
        fill: "bg-ring-waiting",
        role: "Ring round a photo waiting for review",
      },
      {
        name: "ring-retake",
        fill: "bg-ring-retake",
        role: "Ring round a photo that needs another",
      },
      {
        name: "warn-fg",
        fill: "bg-warn-fg",
        role: "Problems and warnings: text and bar",
      },
      { name: "warn-bg", fill: "bg-warn-bg", role: "Its tint" },
      {
        name: "info-fg",
        fill: "bg-info-fg",
        role: "Information: text and bar",
      },
      { name: "info-bg", fill: "bg-info-bg", role: "Its tint" },
      { name: "stamp-fg", fill: "bg-stamp-fg", role: "The Complete stamp" },
      { name: "hatch", fill: "bg-hatch", role: "Needs setup: hatched fill" },
      { name: "stripe", fill: "bg-stripe", role: "Submitted: striped segment" },
    ],
  },
  {
    title: "Photo surfaces",
    swatches: [
      { name: "stage", fill: "bg-stage", role: "Behind a photo shown large" },
      { name: "on-stage", fill: "bg-on-stage", role: "Text on the stage" },
      {
        name: "on-stage-muted",
        fill: "bg-on-stage-muted",
        role: "Secondary text on the stage",
      },
      { name: "plate", fill: "bg-plate", role: "Under text on a photo" },
      { name: "scrim", fill: "bg-scrim", role: "Behind a sheet or dialog" },
      {
        name: "avatar-fill",
        fill: "bg-avatar-fill",
        role: "Behind initials; the hue is per person",
      },
      { name: "on-avatar", fill: "bg-on-avatar", role: "The initials" },
    ],
  },
]

export const EDGES = [
  {
    name: "edge",
    className: "edge",
    role: "Hairline on a tile or an off field",
  },
  {
    name: "edge-strong",
    className: "edge-strong",
    role: "A field or a grey control",
  },
  {
    name: "edge-accent",
    className: "edge-accent",
    role: "The primary button. Shows in dark only",
  },
  {
    name: "edge-selected",
    className: "edge-selected",
    role: "A selected pill or row",
  },
  { name: "edge-invalid", className: "edge-invalid", role: "An invalid field" },
  {
    name: "ring-selected",
    className: "ring-selected",
    role: "A picked photo tile",
  },
] as const

export const RAILS = [
  { name: "rail-start-ok", className: "rail-start-ok" },
  { name: "rail-start-warn", className: "rail-start-warn" },
  { name: "rail-start-info", className: "rail-start-info" },
  { name: "rail-top-ok", className: "rail-top-ok" },
  { name: "rail-top-warn", className: "rail-top-warn" },
  { name: "rail-top-info", className: "rail-top-info" },
] as const

export const ELEVATIONS = [
  {
    name: "shadow-card",
    className: "shadow-card",
    role: "A card on the canvas",
  },
  {
    name: "shadow-float",
    className: "shadow-float",
    role: "Sheets, dialogs, menus",
  },
  {
    name: "shadow-control",
    className: "shadow-control",
    role: "A raised segment or switch thumb",
  },
  {
    name: "shadow-bar",
    className: "shadow-bar",
    role: "The hairline above a bottom bar",
  },
] as const

export const TYPE_ROLES = [
  {
    name: "type-count",
    className: "type-count",
    spec: "46 / 0.95 / 800, display face",
    sample: "12",
  },
  {
    name: "type-display",
    className: "type-display",
    spec: "34 / 1.05 / 800, display face",
    sample: "Sign in to Naba-Lens",
  },
  {
    name: "type-page-title",
    className: "type-page-title",
    spec: "26 / 1.15 / 750, display face",
    sample: "Photos to review",
  },
  {
    name: "type-section-title",
    className: "type-section-title",
    spec: "21 / 1.25 / 700, display face",
    sample: "This month",
  },
  {
    name: "type-heading-sm",
    className: "type-heading-sm",
    spec: "19 / 1.3 / 700, display face",
    sample: "Photo rules",
  },
  {
    name: "type-tab-label",
    className: "type-tab-label",
    spec: "17 / 1.1 / 600, display face (active 800)",
    sample: "Overview",
  },
  {
    name: "text-item-title",
    className: "text-item-title",
    spec: "18 / 1.3 / 700",
    sample: "Chicken tikka masala",
  },
  {
    name: "text-lead",
    className: "text-lead",
    spec: "18 / 1.5 / 400",
    sample: "Send three photos of each dish this month.",
  },
  {
    name: "text-field",
    className: "text-field",
    spec: "18 / 1.3 / 400",
    sample: "mina@example.test",
  },
  {
    name: "text-button",
    className: "text-button",
    spec: "18 / 1.2 / 700",
    sample: "Send photos",
  },
  {
    name: "text-body",
    className: "text-body",
    spec: "17 / 1.5 / 400, the default",
    sample: "Photos you send are shared with your venue.",
  },
  {
    name: "text-label",
    className: "text-label",
    spec: "17 / 1.3 / 700",
    sample: "Work email",
  },
  {
    name: "text-meta",
    className: "text-meta text-ink-muted",
    spec: "17 / 1.35 / 400, with ink-muted",
    sample: "The Example Arms · 2 Nov 2026",
  },
  {
    name: "text-mono",
    className: "font-mono text-mono tabular-nums",
    spec: "17 / 1.3 / 400, mono face",
    sample: "14:06 · 3 of 5 · 60%",
  },
  {
    name: "text-chip",
    className: "text-chip",
    spec: "17 / 1.2 / 700",
    sample: "Accepted",
  },
  {
    name: "text-caption",
    className: "text-caption",
    spec: "15 / 1.25 / 400, only over a photo on a plate",
    sample: "From the front",
  },
] as const

export const RADII = [
  { name: "rounded-stamp", className: "rounded-stamp", value: "2px" },
  { name: "rounded-square", className: "rounded-square", value: "4px" },
  { name: "rounded-control", className: "rounded-control", value: "8px" },
  { name: "rounded-card", className: "rounded-card", value: "12px" },
  { name: "rounded-sheet", className: "rounded-sheet", value: "16px" },
  { name: "rounded-round", className: "rounded-round", value: "Full" },
] as const

export const SPACING = [
  {
    name: "gap-gutter",
    className: "w-gutter",
    value: "12px",
    role: "Between cards in a feed",
  },
  {
    name: "px-page-gutter",
    className: "w-page-gutter",
    value: "12px",
    role: "The phone page gutter",
  },
  {
    name: "tabbar",
    className: "w-tabbar",
    value: "64px",
    role: "The tab bar's height",
  },
  {
    name: "tile-min",
    className: "w-tile-min",
    value: "160px",
    role: "The narrowest photo tile",
  },
] as const

export const CONTAINERS = [
  { name: "max-w-dialog", className: "max-w-dialog", value: "560px" },
  { name: "max-w-feed", className: "max-w-feed", value: "600px" },
  { name: "max-w-reading", className: "max-w-reading", value: "640px" },
  { name: "max-w-dialog-wide", className: "max-w-dialog-wide", value: "760px" },
  { name: "max-w-page", className: "max-w-page", value: "1200px" },
] as const

export const LAYERS = [
  { name: "z-local", value: "10", role: "Inside one component" },
  { name: "z-sticky", value: "20", role: "Sticky headers" },
  { name: "z-dock", value: "30", role: "Action docks" },
  { name: "z-nav", value: "40", role: "Tab bar and side nav" },
  { name: "z-overlay", value: "50", role: "Sheets, dialogs, menus" },
] as const

export const MOTION = [
  {
    name: "duration-quick",
    className: "duration-quick",
    value: "150ms",
    role: "Hover and press",
  },
  {
    name: "duration-move",
    className: "duration-move",
    value: "180ms",
    role: "Disclosure and reorder",
  },
  {
    name: "duration-sheet",
    className: "duration-sheet",
    value: "260ms",
    role: "A sheet rising",
  },
] as const

export const ICON_SIZES = [
  {
    name: "size-4.5",
    className: "size-4.5",
    value: "18px",
    role: "In a chip or a scope line",
  },
  {
    name: "size-5",
    className: "size-5",
    value: "20px",
    role: "In a button or a field",
  },
  {
    name: "size-6",
    className: "size-6",
    value: "24px",
    role: "In a notice or a row disc",
  },
  {
    name: "size-7",
    className: "size-7",
    value: "28px",
    role: "In a 52px icon disc",
  },
  {
    name: "size-9",
    className: "size-9",
    value: "36px",
    role: "In a 72px empty-state disc",
  },
] as const

/* ---------------------------------------------------------------- patterns */

export const PHOTOS = {
  curry: "/guide/v1/curry-45.webp",
  curryOverhead: "/guide/v1/curry-overhead.webp",
  currySide: "/guide/v1/curry-side.webp",
  grill: "/guide/v1/mixed-grill-45.webp",
} as const

export const PEOPLE = [
  { id: "p1", name: "Mina Walker", job: "Chef" },
  { id: "p2", name: "Tomasz Okafor", job: "Bar" },
  { id: "p3", name: "Priya Nair-Hetherington", job: "Front of house" },
] as const

export const VENUE = "The Example Arms"
export const LONG_VENUE =
  "The Example Arms and Coaching Inn at Lower Sample-on-the-Water"
export const MONTH = "November 2026"

export const VENUE_OPTIONS = [
  { id: "v1", name: VENUE },
  { id: "v2", name: "The Sample Tavern" },
  { id: "v3", name: LONG_VENUE },
]

export const TABS = [
  { id: "overview", label: "Overview", href: "#section-tabs" },
  {
    id: "review",
    label: "Review",
    href: "#section-tabs",
    count: { value: 4, label: "to review" },
  },
  { id: "menu", label: "Menu", href: "#section-tabs" },
  { id: "amenities", label: "Amenities", href: "#section-tabs" },
  { id: "account", label: "Account", href: "#section-tabs" },
]

export const PROGRESS_KEY = {
  accepted: "Accepted",
  submitted: "Submitted, waiting",
  needed: "Still needed",
}
