import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

/*
 * The gallery at /ui-preview/gallery is the one place every primitive and
 * every Common Room building block can be seen (docs/design-system/
 * strategy.md DS-207). This test keeps it whole, by name and not only by
 * file: every component exported from components/ui, from
 * components/nabalens/common-room and from the shared pattern files listed
 * below must be written as JSX (`<Name`) somewhere in the gallery, so a
 * component cannot ship without a specimen. An import alone is not a
 * specimen, and neither is the barrel.
 */

const root = fileURLToPath(new URL("../../", import.meta.url))
const galleryDir = join(root, "app", "(dev)", "ui-preview", "gallery")

/** Directories whose every component must appear in the gallery. */
const COMPONENT_DIRS = ["components/ui", "components/nabalens/common-room"]

/*
 * Modules with nothing to look at. Each needs a reason; a component does not
 * belong here.
 */
const NON_VISUAL: Record<string, string> = {
  "components/ui/button-hold.ts":
    "The click handler Button uses while it is switched off; no markup.",
  "components/ui/option-item.ts":
    "Class strings for an option's focus mark; seen through Select, DropdownMenu and Combobox.",
  "components/ui/sheet-recipe.ts":
    "The sheet's class recipe; seen through Dialog and AlertDialog.",
  "components/nabalens/common-room/index.ts":
    "The barrel the gallery imports the Common Room blocks through.",
}

/*
 * Shared patterns that live outside the two directories (strategy.md 6.3).
 * A new shared pattern is added here with its specimen.
 */
const PATTERN_FILES = [
  "components/nabalens/empty-state.tsx",
  "components/nabalens/not-found-card.tsx",
  "components/nabalens/notice.tsx",
  "components/nabalens/page-header.tsx",
  "components/nabalens/status-chip.tsx",
]

/*
 * Exported components with no specimen of their own, as "file#Name". Each
 * needs a reason; "not done yet" is not one.
 */
const NOT_SHOWN: Record<string, string> = {
  "components/ui/alert-dialog.tsx#AlertDialogOverlay":
    "The dimmed backdrop; AlertDialogContent draws it, and it is seen behind every open alert dialog.",
  "components/ui/alert-dialog.tsx#AlertDialogPortal":
    "Draws nothing: it moves the dialog to the end of the page. AlertDialogContent uses it.",
  "components/ui/dialog.tsx#DialogOverlay":
    "The dimmed backdrop; DialogContent draws it, and it is seen behind every open dialog.",
  "components/ui/dialog.tsx#DialogPortal":
    "Draws nothing: it moves the dialog to the end of the page. DialogContent uses it.",
  "components/ui/dropdown-menu.tsx#DropdownMenuPortal":
    "Draws nothing: it moves the menu to the end of the page. DropdownMenuContent uses it.",
  "components/ui/select.tsx#SelectScrollDownButton":
    "Drawn by SelectContent itself when the list is taller than the space; not placed by hand.",
  "components/ui/select.tsx#SelectScrollUpButton":
    "Drawn by SelectContent itself when the list is taller than the space; not placed by hand.",
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

const posix = (path: string) => path.split(sep).join("/")

/** Every module specifier imported by a file, static or re-exported. */
function specifiers(source: string): string[] {
  return [
    ...source.matchAll(/\bfrom\s+["']([^"']+)["']/g),
    ...source.matchAll(/\bimport\s+["']([^"']+)["']/g),
  ].map((match) => match[1])
}

/** Resolves a specifier to a repo-relative path without its extension. */
function resolve(specifier: string, fromFile: string): string | null {
  if (specifier.startsWith("@/")) return specifier.slice(2)
  if (specifier.startsWith(".")) {
    return posix(relative(root, join(fromFile, "..", specifier)))
  }
  return null
}

const withoutExtension = (path: string) => path.replace(/\.(tsx?|jsx?)$/, "")

function galleryImports(): Set<string> {
  const imported = new Set<string>()
  for (const file of walk(galleryDir)) {
    if (!/\.(tsx?|jsx?)$/.test(file)) continue
    for (const specifier of specifiers(readFileSync(file, "utf8"))) {
      const target = resolve(specifier, file)
      if (target) imported.add(target)
    }
  }
  // The barrel stands for the files it re-exports, and for nothing else.
  for (const dir of COMPONENT_DIRS) {
    if (!imported.has(dir)) continue
    const barrel = join(root, dir, "index.ts")
    for (const specifier of specifiers(readFileSync(barrel, "utf8"))) {
      const target = resolve(specifier, barrel)
      if (target) imported.add(target)
    }
  }
  return imported
}

function componentFiles(): string[] {
  return COMPONENT_DIRS.flatMap((dir) =>
    walk(join(root, dir)).map((file) => posix(relative(root, file)))
  ).filter((file) => /\.(tsx?|jsx?)$/.test(file))
}

/** A component's name: PascalCase with a lower-case letter (not a CONSTANT). */
const isComponentName = (name: string) => /^[A-Z][A-Za-z0-9]*[a-z]/.test(name)

/** The components a source file exports, by name. Types are left out. */
function exportedComponents(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "")
  const names = new Set<string>()
  for (const match of code.matchAll(/^export\s+\{([^}]*)\}/gm)) {
    for (const part of match[1].split(",")) {
      const entry = part.trim()
      if (!entry || entry.startsWith("type ")) continue
      names.add(
        entry
          .split(/\s+as\s+/)
          .pop()!
          .trim()
      )
    }
  }
  for (const match of code.matchAll(
    /^export\s+(?:default\s+)?(?:async\s+)?(?:function|const)\s+(\w+)/gm
  )) {
    names.add(match[1])
  }
  return [...names].filter(isComponentName).sort()
}

/** Every name written as a JSX element in the gallery: `<Name` . */
function galleryElements(): Set<string> {
  const used = new Set<string>()
  for (const file of walk(galleryDir)) {
    if (!/\.(tsx|jsx)$/.test(file)) continue
    for (const match of readFileSync(file, "utf8").matchAll(
      /<([A-Z][A-Za-z0-9]*)[\s/>]/g
    )) {
      used.add(match[1])
    }
  }
  return used
}

describe("gallery completeness", () => {
  const files = componentFiles()
  const imported = galleryImports()
  const elements = galleryElements()
  const shownFiles = [...files, ...PATTERN_FILES].filter(
    (file) => !(file in NON_VISUAL) && /\.(tsx|jsx)$/.test(file)
  )
  const exported = shownFiles.flatMap((file) =>
    exportedComponents(readFileSync(join(root, file), "utf8")).map((name) => ({
      file,
      name,
      key: `${file}#${name}`,
    }))
  )

  it("reads exports and JSX by name", () => {
    const names = exported.map((entry) => entry.key)
    expect(names).toEqual(
      expect.arrayContaining([
        "components/ui/button.tsx#Button",
        "components/ui/field.tsx#FormField",
        "components/nabalens/notice.tsx#Notice",
      ])
    )
    // Class recipes and types are not components.
    expect(names).not.toContain("components/ui/button.tsx#buttonVariants")
    expect(names).not.toContain("components/ui/button.tsx#ButtonProps")
    expect(elements.has("Button")).toBe(true)
    expect(elements.has("NoSuchComponent")).toBe(false)
  })

  it("renders every exported component as a specimen, by name", () => {
    const missing = exported
      .filter((entry) => !elements.has(entry.name))
      .filter((entry) => !(entry.key in NOT_SHOWN))
      .map((entry) => entry.key)
    expect(missing).toEqual([])
  })

  it("has no stale name exception, and each one says why", () => {
    const keys = new Set(exported.map((entry) => entry.key))
    for (const [key, reason] of Object.entries(NOT_SHOWN)) {
      expect(keys.has(key), `${key} is no longer exported`).toBe(true)
      expect(elements.has(key.split("#")[1]), `${key} is now shown`).toBe(false)
      expect(reason.length, key).toBeGreaterThan(20)
    }
  })

  it("finds every listed pattern file", () => {
    for (const file of PATTERN_FILES) {
      expect(
        exportedComponents(readFileSync(join(root, file), "utf8")).length,
        file
      ).toBeGreaterThan(0)
    }
  })

  it("finds the components and the gallery", () => {
    expect(files).toEqual(
      expect.arrayContaining([
        "components/ui/button.tsx",
        "components/nabalens/common-room/card.tsx",
      ])
    )
    expect(imported.has("components/ui/button")).toBe(true)
  })

  it("shows every primitive and Common Room block in the gallery", () => {
    const missing = files
      .filter((file) => !(file in NON_VISUAL))
      .filter((file) => !imported.has(withoutExtension(file)))
    expect(missing).toEqual([])
  })

  it("mounts every gallery block on the page", () => {
    const page = readFileSync(join(galleryDir, "page.tsx"), "utf8")
    const mounted = new Set(
      specifiers(page).map((specifier) =>
        resolve(specifier, join(galleryDir, "page.tsx"))
      )
    )
    const blocks = walk(join(galleryDir, "blocks")).map((file) =>
      withoutExtension(posix(relative(root, file)))
    )
    expect(blocks.filter((block) => !mounted.has(block))).toEqual([])
  })

  it("has no stale exception: each one names a file that exists and is not imported for show", () => {
    const stale = Object.keys(NON_VISUAL).filter(
      (file) => !files.includes(file)
    )
    expect(stale).toEqual([])
  })

  it("gives every exception a reason", () => {
    for (const [file, reason] of Object.entries(NON_VISUAL)) {
      expect(reason.length, file).toBeGreaterThan(20)
    }
  })
})
