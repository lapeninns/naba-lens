// @vitest-environment jsdom
// The primitive contract (docs/design-system/strategy.md 6.2), checked on
// every file in components/ui: each root names itself with data-slot, says
// its variant, size and tone where it has those props, and a size called sm,
// md or lg is the same height on every control (44px; 52px for a button and
// 56px for a field; 60px). One table, so a new primitive is one new row, and
// a primitive with no row fails.
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { cleanup, render } from "@testing-library/react"
import * as React from "react"
import { afterEach, describe, expect, it } from "vitest"

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Combobox } from "@/components/ui/combobox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { FieldLegend, FieldSet, FormField } from "@/components/ui/field"
import { FilterPill, PillGroup } from "@/components/ui/filter-pill"
import { Heading } from "@/components/ui/heading"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LinkButton } from "@/components/ui/link-button"
import { OptionRow } from "@/components/ui/option-row"
import { Photo } from "@/components/ui/photo"
import { Progress } from "@/components/ui/progress"
import { Radio, RadioGroup } from "@/components/ui/radio-group"
import { SearchField } from "@/components/ui/search-field"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { Select, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SelectableTile } from "@/components/ui/selectable-tile"
import { Separator } from "@/components/ui/separator"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { Toggle } from "@/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

afterEach(cleanup)

const VARIANTS = [
  "primary",
  "secondary",
  "quiet",
  "danger",
  "danger-quiet",
  "link",
] as const

/** The min-height utility each size word stands for. */
const HEIGHT = {
  /** Buttons and rows of buttons: 44 / 52 / 60px. */
  control: { sm: "min-h-11", md: "min-h-13", lg: "min-h-15" },
  /** Fields and option rows: 44 / 56 / 60px. */
  field: { sm: "min-h-11", md: "min-h-14", lg: "min-h-15" },
} as const

type Row = {
  /** The export under test. */
  name: string
  /** Its file in components/ui, for the coverage check below. */
  file: string
  slot: string
  render: (props: { size?: string; variant?: string }) => React.ReactElement
  /** Values of the `variant` prop; each must show as data-variant. */
  variants?: readonly string[]
  /** Set when the plain look has no variant word, so no data-variant. */
  noDefaultVariant?: boolean
  /** Values of the `size` prop; each must show as data-size. */
  sizes?: readonly string[]
  /** A size the component fixes itself and reports without a prop. */
  fixedSize?: string
  /** Set when sm/md/lg are control heights; unset for a picture or a dialog. */
  height?: keyof typeof HEIGHT
  /** Where the height class sits, when not on the root. */
  heightOn?: string
  /** The default data-tone, for components with a `tone` prop. */
  tone?: string
}

const DISHES = [{ value: "dal", label: "Dal" }]

const ROWS: Row[] = [
  {
    name: "Button",
    file: "button.tsx",
    slot: "button",
    render: (p) => <Button {...(p as object)}>Save</Button>,
    variants: VARIANTS,
    sizes: ["sm", "md", "lg", "icon", "icon-lg"],
    height: "control",
  },
  {
    // The named exception (OFF_CONTRACT, departures.md C20). Its own row so
    // the six contract variants stay Button's list; it is text-sized, so its
    // sizes are not checked as heights.
    name: "Button (row-link)",
    file: "button.tsx",
    slot: "button",
    render: (p) => (
      <Button variant="row-link" {...(p as object)}>
        Refresh
      </Button>
    ),
    variants: ["row-link"],
  },
  {
    name: "LinkButton",
    file: "link-button.tsx",
    slot: "link-button",
    render: (p) => (
      <LinkButton href="/staff" {...(p as object)}>
        Open
      </LinkButton>
    ),
    variants: VARIANTS,
    sizes: ["sm", "md", "lg"],
    height: "control",
  },
  {
    name: "Spinner",
    file: "spinner.tsx",
    slot: "spinner",
    render: (p) => <Spinner {...(p as object)} />,
    sizes: ["sm", "md", "lg"],
  },
  {
    name: "Input",
    file: "input.tsx",
    slot: "input",
    render: (p) => <Input aria-label="Name" {...(p as object)} />,
    sizes: ["sm", "md", "lg"],
    height: "field",
  },
  {
    name: "Textarea",
    file: "textarea.tsx",
    slot: "textarea",
    render: () => <Textarea aria-label="Reason" />,
  },
  {
    name: "SelectTrigger",
    file: "select.tsx",
    slot: "select-trigger",
    render: (p) => (
      <Select items={DISHES}>
        <SelectTrigger aria-label="Dish" {...(p as object)}>
          <SelectValue placeholder="Choose…" />
        </SelectTrigger>
      </Select>
    ),
    sizes: ["sm", "md"],
    height: "field",
  },
  {
    name: "FormField",
    file: "field.tsx",
    slot: "field",
    render: () => (
      <FormField label="Name">
        <Input />
      </FormField>
    ),
  },
  {
    name: "SearchField",
    file: "search-field.tsx",
    slot: "search-field",
    render: (p) => <SearchField label="Search people" {...(p as object)} />,
    sizes: ["sm", "md"],
    height: "field",
    heightOn: '[data-slot="input"]',
  },
  {
    name: "Combobox",
    file: "combobox.tsx",
    slot: "combobox",
    render: (p) => (
      <Combobox aria-label="Dish" items={DISHES} {...(p as object)} />
    ),
    sizes: ["sm", "md", "lg"],
    height: "field",
    heightOn: '[data-slot="combobox-input"]',
  },
  {
    name: "Checkbox",
    file: "checkbox.tsx",
    slot: "checkbox",
    render: () => <Checkbox aria-label="Vegan" />,
  },
  {
    name: "RadioGroup",
    file: "radio-group.tsx",
    slot: "radio-group",
    render: () => (
      <RadioGroup aria-label="Portion">
        <Radio value="small" aria-label="Small" />
      </RadioGroup>
    ),
  },
  {
    name: "Radio",
    file: "radio-group.tsx",
    slot: "radio",
    render: () => (
      <RadioGroup aria-label="Portion">
        <Radio value="small" aria-label="Small" />
      </RadioGroup>
    ),
  },
  {
    name: "OptionRow",
    file: "option-row.tsx",
    slot: "option-row",
    render: (p) => (
      <OptionRow type="checkbox" label="Notify me" {...(p as object)} />
    ),
    sizes: ["sm", "md", "lg"],
    height: "field",
  },
  {
    name: "SelectableTile",
    file: "selectable-tile.tsx",
    slot: "selectable-tile",
    render: () => (
      <SelectableTile label="Bar, photo 2">
        <span />
      </SelectableTile>
    ),
  },
  {
    name: "SegmentedControl",
    file: "segmented-control.tsx",
    slot: "segmented-control",
    render: () => (
      <SegmentedControl
        label="Media"
        defaultValue="all"
        options={[
          { value: "all", label: "All" },
          { value: "videos", label: "Videos" },
        ]}
      />
    ),
    fixedSize: "sm",
    height: "control",
    heightOn: '[data-slot="segmented-control-item"]',
  },
  {
    name: "FilterPill",
    file: "filter-pill.tsx",
    slot: "filter-pill",
    render: () => <FilterPill>Waiting</FilterPill>,
    fixedSize: "sm",
    height: "control",
  },
  {
    name: "PillGroup",
    file: "filter-pill.tsx",
    slot: "pill-group",
    render: () => (
      <PillGroup label="Status">
        <FilterPill>Waiting</FilterPill>
      </PillGroup>
    ),
  },
  {
    name: "Toggle",
    file: "toggle.tsx",
    slot: "toggle",
    render: (p) => <Toggle {...(p as object)}>Videos only</Toggle>,
    variants: ["default", "outline"],
    sizes: ["default", "sm", "lg"],
  },
  {
    name: "ToggleGroup",
    file: "toggle-group.tsx",
    slot: "toggle-group",
    render: (p) => (
      <ToggleGroup aria-label="Media" {...(p as object)}>
        <ToggleGroupItem value="all">All</ToggleGroupItem>
      </ToggleGroup>
    ),
    variants: ["default"],
    sizes: ["default"],
  },
  {
    name: "DialogContent",
    file: "dialog.tsx",
    slot: "dialog-content",
    render: (p) => (
      <Dialog open>
        <DialogContent {...(p as object)}>
          <DialogTitle>Photo rules</DialogTitle>
          <DialogDescription>What a good photo shows.</DialogDescription>
        </DialogContent>
      </Dialog>
    ),
    sizes: ["sm", "md", "wide", "viewer"],
  },
  {
    name: "AlertDialogContent",
    file: "alert-dialog.tsx",
    slot: "alert-dialog-content",
    render: (p) => (
      <AlertDialog open>
        <AlertDialogContent {...(p as object)}>
          <AlertDialogTitle>Delete this photo?</AlertDialogTitle>
          <AlertDialogDescription>You cannot undo this.</AlertDialogDescription>
        </AlertDialogContent>
      </AlertDialog>
    ),
    sizes: ["sm", "md"],
  },
  {
    name: "DropdownMenuTrigger",
    file: "dropdown-menu.tsx",
    slot: "dropdown-menu-trigger",
    render: () => (
      <DropdownMenu>
        <DropdownMenuTrigger>More</DropdownMenuTrigger>
      </DropdownMenu>
    ),
  },
  {
    name: "DropdownMenuItem",
    file: "dropdown-menu.tsx",
    slot: "dropdown-menu-item",
    render: (p) => (
      <DropdownMenu open>
        <DropdownMenuTrigger>More</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem {...(p as object)}>Deactivate</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
    variants: ["danger"],
    noDefaultVariant: true,
  },
  {
    name: "FieldLegend",
    file: "field.tsx",
    slot: "field-legend",
    render: (p) => (
      <FieldSet>
        <FieldLegend {...(p as object)}>Contact</FieldLegend>
      </FieldSet>
    ),
    variants: ["legend", "label"],
  },
  {
    name: "Table",
    file: "table.tsx",
    slot: "table-container",
    render: () => (
      <Table aria-label="Venues">
        <TableBody>
          <TableRow>
            <TableCell>The Example Arms</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    ),
  },
  {
    name: "Heading",
    file: "heading.tsx",
    slot: "heading",
    render: (p) => <Heading {...(p as object)}>Home</Heading>,
    sizes: [
      "display",
      "page-title",
      "section-title",
      "heading-sm",
      "item-title",
    ],
  },
  {
    name: "Progress",
    file: "progress.tsx",
    slot: "progress",
    render: (p) => (
      <Progress value={40} aria-label="Uploading" {...(p as object)} />
    ),
    sizes: ["sm", "md"],
    tone: "neutral",
  },
  {
    name: "Photo",
    file: "photo.tsx",
    slot: "photo",
    render: () => <Photo src="/guide/v1/curry-45.webp" alt="Curry" />,
  },
  {
    name: "Avatar",
    file: "avatar.tsx",
    slot: "avatar",
    render: (p) => (
      <Avatar {...(p as object)}>
        <AvatarFallback>MW</AvatarFallback>
      </Avatar>
    ),
    sizes: ["sm", "md", "lg"],
  },
  {
    name: "Skeleton",
    file: "skeleton.tsx",
    slot: "skeleton",
    render: () => <Skeleton shape="line" />,
  },
  {
    name: "SkeletonRegion",
    file: "skeleton.tsx",
    slot: "skeleton-region",
    render: () => (
      <SkeletonRegion label="Loading photos…">
        <Skeleton />
      </SkeletonRegion>
    ),
  },
  {
    name: "Switch",
    file: "switch.tsx",
    slot: "switch",
    render: () => <Switch aria-label="Active" />,
    fixedSize: "md",
  },
  {
    name: "Label",
    file: "label.tsx",
    slot: "label",
    render: () => <Label>Name</Label>,
  },
  {
    name: "Separator",
    file: "separator.tsx",
    slot: "separator",
    render: () => <Separator />,
  },
]

/** Modules with nothing to render: recipes and a shared handler. */
const NOT_RENDERED = new Set([
  "button-hold.ts",
  "field-control.ts",
  "option-item.ts",
  "sheet-recipe.ts",
])

const readUi = (name: string) =>
  readFileSync(join(process.cwd(), "components", "ui", name), "utf8")

const SOURCE_FILES = readdirSync(join(process.cwd(), "components", "ui"))
  .filter((name) => /\.tsx?$/.test(name))
  .sort()

const AXES = ["variant", "size", "tone"] as const
type Axis = (typeof AXES)[number]

/** The contract's vocabulary (strategy.md 6.2). */
const CONTRACT: Record<Axis, ReadonlySet<string>> = {
  variant: new Set(VARIANTS),
  size: new Set(["sm", "md", "lg"]),
  tone: new Set(["neutral", "info", "ok", "warn"]),
}

/*
 * Words outside the contract that components/ui still uses. Each needs a
 * reason; a new entry is a decision to widen the vocabulary, not a way to
 * make this test pass.
 */
const OFF_CONTRACT: Record<
  string,
  Partial<Record<Axis, { words: string[]; reason: string }>>
> = {
  "button.tsx": {
    variant: {
      words: ["row-link"],
      reason:
        "B02 row actions: the link look with a 44px target at every width, for an action inside a row or a notice. departures.md C20; review in DS-202.",
    },
    size: {
      words: ["icon", "icon-lg"],
      reason:
        "The two icon-only squares (44px and 48px). They are shapes, not heights of a labelled button.",
    },
  },
  "sheet-recipe.ts": {
    size: {
      words: ["wide", "viewer"],
      reason:
        "Sheet widths: the wide form sheet and the full-screen photo viewer. Layouts, not control heights.",
    },
  },
  "heading.tsx": {
    size: {
      words: [
        "display",
        "page-title",
        "section-title",
        "heading-sm",
        "item-title",
      ],
      reason:
        "A heading's size is a type role from common-room.md §2, not a control height.",
    },
  },
  "field.tsx": {
    variant: {
      words: ["label", "legend"],
      reason:
        "FieldLegend's two looks, kept from the stock field set until screens move to FormField.",
    },
  },
  "toggle.tsx": {
    variant: {
      words: ["default", "outline"],
      reason:
        "Internal and older than the contract (see the note in toggle.tsx); new code uses SegmentedControl or FilterPill.",
    },
    size: {
      words: ["default"],
      reason:
        "Internal and older than the contract (see the note in toggle.tsx); new code uses SegmentedControl or FilterPill.",
    },
  },
  "toggle-group.tsx": {
    variant: {
      words: ["default"],
      reason: "Passes Toggle's older vocabulary through; internal with it.",
    },
    size: {
      words: ["default"],
      reason: "Passes Toggle's older vocabulary through; internal with it.",
    },
  },
}

/*
 * Files where sm, md and lg do not name a control height. Everywhere else
 * the words must be the heights in HEIGHT, checked row by row above.
 */
const SIZE_IS_NOT_A_HEIGHT: Record<string, string> = {
  "avatar.tsx": "A picture's diameter: 36, 44 and 84px.",
  "spinner.tsx": "A glyph's size beside words: 18, 20 and 24px.",
  "progress.tsx": "The bar's thickness (8 and 12px); a bar is not a control.",
  "switch.tsx":
    "One size, reported as md: a 32px track inside a 44px target (common-room.md §2).",
  "sheet-recipe.ts": "Sheet widths; a sheet is a layout, not a control.",
  "textarea.tsx":
    "One size: the md field recipe grown to several lines (120px at least).",
  "field-control.ts":
    "The shared field recipe. It has no markup of its own: its heights are checked through the Input, SelectTrigger, Combobox and SearchField rows.",
  "toggle.tsx":
    "Internal and older than the contract: its lg is 48px. See the note in toggle.tsx.",
  "toggle-group.tsx":
    "Internal with Toggle, whose older sizes it passes through.",
}

/*
 * Words a file writes because it passes them to another primitive (a Dialog
 * drawing its Close with Button's icon size). They are that primitive's to
 * render, in its own row.
 */
const BORROWED: Record<string, string[]> = {
  // Its Clear and Open buttons are quiet icon Buttons.
  "combobox.tsx": ["quiet", "icon"],
  // Clear search is a quiet icon Button.
  "search-field.tsx": ["quiet", "icon"],
  // Close is a quiet Button; the footer's buttons default to secondary.
  "dialog.tsx": ["quiet", "secondary", "icon"],
  "alert-dialog.tsx": ["icon"],
  // The md field recipe; Textarea has one size and no size prop.
  "textarea.tsx": ["md"],
}

/**
 * The variant, size and tone words a source file declares: the keys of a
 * cva `variants` block, a prop or type written as a union of literals, an
 * object entry such as `size: "md"`, and a fixed `data-size="md"`.
 */
function declaredWords(source: string): Record<Axis, Set<string>> {
  const words: Record<Axis, Set<string>> = {
    variant: new Set(),
    size: new Set(),
    tone: new Set(),
  }
  const isAxis = (name: string): name is Axis =>
    (AXES as readonly string[]).includes(name)
  // Comments go, and so does every string that is not one bare word: class
  // strings are full of `size-5` and `disabled:` and would read as options.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/`[^`]*`/g, "``")
    .replace(/"([^"\n]*)"/g, (whole, text: string) =>
      /^[\w-]+$/.test(text) ? whole : '""'
    )

  // cva: variants: { size: { sm: …, md: … } }
  for (const start of code.matchAll(/\bvariants:\s*\{/g)) {
    let depth = 1
    let axis: string | null = null
    const from = start.index + start[0].length
    const tokens = code
      .slice(from)
      .matchAll(/[{}]|(?:"([\w-]+)"|\b([A-Za-z]\w*))\s*:/g)
    for (const token of tokens) {
      if (token[0] === "{") depth += 1
      else if (token[0] === "}") {
        depth -= 1
        if (depth === 1) axis = null
        if (depth === 0) break
      } else {
        const name = token[1] ?? token[2]
        if (depth === 1) axis = name
        else if (depth === 2 && axis && isAxis(axis)) words[axis].add(name)
      }
    }
  }
  const literals = (union: string) =>
    [...union.matchAll(/"([\w-]+)"/g)].map((match) => match[1])
  const UNION = String.raw`\|?\s*((?:"[\w-]+"\s*\|?\s*)+)`
  // size?: "sm" | "md", and size: "md" in an object
  for (const match of code.matchAll(
    new RegExp(String.raw`\b(variant|size|tone)\??:\s*` + UNION, "g")
  )) {
    for (const word of literals(match[2])) words[match[1] as Axis].add(word)
  }
  // type ProgressSize = "md" | "sm"
  for (const match of code.matchAll(
    new RegExp(
      String.raw`\btype\s+\w*(Variant|Size|Tone)\w*\s*=\s*` + UNION,
      "g"
    )
  )) {
    const axis = match[1].toLowerCase() as Axis
    for (const word of literals(match[2])) words[axis].add(word)
  }
  // A fixed data-size="md" on a root with one size
  for (const match of code.matchAll(/\bdata-(variant|size|tone)="([\w-]+)"/g)) {
    words[match[1] as Axis].add(match[2])
  }
  return words
}

// Overlays render into document.body, so look there and not in the container.
function root(row: Row, props: { size?: string; variant?: string } = {}) {
  render(row.render(props))
  const found = document.body.querySelector(`[data-slot="${row.slot}"]`)
  if (!found) throw new Error(`${row.name}: no [data-slot="${row.slot}"]`)
  return found
}

const classes = (element: Element) =>
  (element.getAttribute("class") ?? "").split(/\s+/)

describe("primitive contract", () => {
  it("has a row for every file in components/ui", () => {
    // jsdom gives this module an http address, so the path comes from the
    // project root that vitest runs in.
    const dir = join(process.cwd(), "components", "ui")
    const files = readdirSync(dir).filter((name) => !NOT_RENDERED.has(name))
    const covered = new Set(ROWS.map((row) => row.file))
    expect(files.filter((name) => !covered.has(name))).toEqual([])
    // And no row for a file that has gone.
    expect([...covered].filter((name) => !files.includes(name))).toEqual([])
  })

  describe.each(ROWS)("$name", (row) => {
    it("names its root with data-slot", () => {
      expect(root(row).getAttribute("data-slot")).toBe(row.slot)
    })

    if (row.variants) {
      it.each(row.variants)("says it is the %s variant", (variant) => {
        expect(root(row, { variant }).getAttribute("data-variant")).toBe(
          variant
        )
      })
      if (row.noDefaultVariant) {
        it("has no variant word for its plain look", () => {
          expect(root(row).hasAttribute("data-variant")).toBe(false)
        })
      } else {
        it("says its default variant", () => {
          expect(row.variants).toContain(root(row).getAttribute("data-variant"))
        })
      }
    }

    if (row.sizes) {
      it.each(row.sizes)("says it is size %s", (size) => {
        expect(root(row, { size }).getAttribute("data-size")).toBe(size)
      })
      it("says its default size", () => {
        expect(row.sizes).toContain(root(row).getAttribute("data-size"))
      })
    }

    if (row.fixedSize) {
      it(`says its one size, ${row.fixedSize}`, () => {
        expect(root(row).getAttribute("data-size")).toBe(row.fixedSize)
      })
    }

    if (row.tone) {
      it("says its tone", () => {
        expect(root(row).getAttribute("data-tone")).toBe(row.tone)
      })
    }

    if (row.height) {
      const heights = HEIGHT[row.height]
      const named = [...(row.sizes ?? []), row.fixedSize].filter(
        (size): size is keyof typeof heights =>
          size !== undefined && size in heights
      )
      it.each(named)("size %s is the height the word means", (size) => {
        const element = root(row, row.sizes ? { size } : {})
        const target = row.heightOn
          ? element.matches(row.heightOn)
            ? element
            : element.querySelector(row.heightOn)
          : element
        expect(target, `${row.name}: ${row.heightOn}`).not.toBeNull()
        expect(classes(target!)).toContain(heights[size])
      })
    }
  })

  it("uses only the contract's size words on a control with heights", () => {
    const allowed = new Set(["sm", "md", "lg", "icon", "icon-lg"])
    for (const row of ROWS.filter((r) => r.height)) {
      for (const size of [...(row.sizes ?? []), row.fixedSize ?? "sm"]) {
        expect(allowed.has(size), `${row.name} size ${size}`).toBe(true)
      }
    }
  })

  /*
   * The checks above read ROWS, which is typed by hand. These read the
   * components themselves, so an off-list variant, size or tone added to a
   * file in components/ui fails here whatever the table says.
   */
  describe("vocabulary, read from the source", () => {
    const found = Object.fromEntries(
      SOURCE_FILES.map((file) => [file, declaredWords(readUi(file))])
    )

    it("reads the words the components really declare", () => {
      // Proof the reader works: cva keys, a prop union, a type alias and a
      // fixed data attribute.
      expect([...found["button.tsx"].variant].sort()).toEqual(
        [...VARIANTS, "row-link"].sort()
      )
      expect([...found["button.tsx"].size].sort()).toEqual(
        ["icon", "icon-lg", "lg", "md", "sm"].sort()
      )
      expect([...found["spinner.tsx"].size].sort()).toEqual(["lg", "md", "sm"])
      expect([...found["progress.tsx"].size].sort()).toEqual(["md", "sm"])
      expect([...found["switch.tsx"].size]).toEqual(["md"])
      expect([...found["dropdown-menu.tsx"].variant]).toEqual(["danger"])
      expect(found["progress.tsx"].tone.has("ok")).toBe(true)
    })

    it.each(AXES)(
      "every %s is a contract word or a named exception",
      (axis) => {
        const offList = SOURCE_FILES.flatMap((file) =>
          [...found[file][axis]]
            .filter((word) => !CONTRACT[axis].has(word))
            .filter((word) => !OFF_CONTRACT[file]?.[axis]?.words.includes(word))
            // A word passed on to Button is Button's exception, not this file's.
            .filter(
              (word) =>
                !(
                  BORROWED[file]?.includes(word) &&
                  OFF_CONTRACT["button.tsx"]?.[axis]?.words.includes(word)
                )
            )
            .map((word) => `${file}: ${axis} "${word}"`)
        )
        expect(offList).toEqual([])
      }
    )

    it("has no stale exception, and each one says why", () => {
      const stale: string[] = []
      for (const [file, axes] of Object.entries(OFF_CONTRACT)) {
        for (const axis of AXES) {
          const entry = axes[axis]
          if (!entry) continue
          expect(entry.reason.length, `${file} ${axis}`).toBeGreaterThan(20)
          for (const word of entry.words) {
            if (!found[file]?.[axis].has(word)) {
              stale.push(`${file}: ${axis} "${word}"`)
            }
          }
        }
      }
      expect(stale).toEqual([])
    })

    it("sm, md and lg are a control height, or the file says what they measure", () => {
      const unexplained = SOURCE_FILES.filter((file) =>
        [...found[file].size].some((word) => CONTRACT.size.has(word))
      )
        .filter((file) => !ROWS.some((row) => row.file === file && row.height))
        .filter((file) => !(file in SIZE_IS_NOT_A_HEIGHT))
      expect(unexplained).toEqual([])
      for (const [file, reason] of Object.entries(SIZE_IS_NOT_A_HEIGHT)) {
        expect(reason.length, file).toBeGreaterThan(20)
        expect(SOURCE_FILES, file).toContain(file)
        // A file whose sizes are checked as heights does not belong here.
        expect(
          ROWS.some((row) => row.file === file && row.height),
          file
        ).toBe(false)
      }
    })

    it("the table renders every variant and size its file declares", () => {
      const untested = SOURCE_FILES.filter((file) =>
        ROWS.some((row) => row.file === file)
      ).flatMap((file) => {
        const rows = ROWS.filter((row) => row.file === file)
        const shown = {
          variant: new Set(rows.flatMap((row) => row.variants ?? [])),
          size: new Set(
            rows.flatMap((row) => [
              ...(row.sizes ?? []),
              ...(row.fixedSize ? [row.fixedSize] : []),
            ])
          ),
        }
        return (["variant", "size"] as const).flatMap((axis) =>
          [...found[file][axis]]
            .filter((word) => !shown[axis].has(word))
            .filter((word) => !BORROWED[file]?.includes(word))
            .map((word) => `${file}: ${axis} "${word}" has no row`)
        )
      })
      expect(untested).toEqual([])
    })
  })

  it("keeps Button server-safe: its held-click handler comes from a client module", () => {
    // A server component cannot pass a plain function to Base UI's client
    // Button; it can pass a reference to one that a client module exports.
    // jsdom cannot see the difference, so the sources are read instead.
    const read = (name: string) =>
      readFileSync(join(process.cwd(), "components", "ui", name), "utf8")
    const button = read("button.tsx")
    expect(button).not.toMatch(/^["']use client["']/m)
    expect(button).toMatch(
      /import \{ hold \} from "@\/components\/ui\/button-hold"/
    )
    expect(button).not.toMatch(/function hold\b/)
    expect(read("button-hold.ts")).toMatch(/^["']use client["']/)
  })

  it("keeps Button and LinkButton to the six contract variants", () => {
    for (const name of ["Button", "LinkButton"]) {
      expect(ROWS.find((row) => row.name === name)?.variants).toEqual(VARIANTS)
    }
  })
})
