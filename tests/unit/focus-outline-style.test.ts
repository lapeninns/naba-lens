import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

import { describe, expect, it } from "vitest"

const root = join(__dirname, "..", "..")

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

// Tailwind v4's `outline-none` sets `--tw-outline-style: none`, and
// `focus-visible:outline-2` reads that variable for its outline-style, so the
// focus outline never draws. An explicit `focus-visible:outline-solid` (or
// another style) restores it. `outline-hidden` sets the same variable, so it
// is no fix. The `focus-ring` utilities (app/globals.css) set the style
// themselves, so they draw beside `outline-none` and are not checked here.
const OUTLINE_NONE = /(?:^|[\s"'`])outline-(?:none|hidden)(?=[\s"'`]|$)/
const FOCUS_OUTLINE =
  /[\w-]*focus(?:-visible|-within)?:outline-(?!none\b|hidden\b|offset-)[\w[\]/.-]+/
const FOCUS_OUTLINE_STYLE =
  /[\w-]*focus(?:-visible|-within)?:outline-(?:solid|dashed|dotted|double)\b/

const FOCUS_RING = /(?:^|[\s"'`])focus-ring(?:-inset)?(?=[\s"'`]|$)/

describe("keyboard focus outlines", () => {
  it("never pair outline-none with a focus outline that has no style", () => {
    const offenders: string[] = []
    for (const file of ["app", "components"].flatMap((dir) =>
      sourceFiles(join(root, dir))
    )) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (
            OUTLINE_NONE.test(line) &&
            FOCUS_OUTLINE.test(line) &&
            !FOCUS_OUTLINE_STYLE.test(line)
          )
            offenders.push(`${relative(root, file)}:${i + 1}`)
        })
    }
    expect(offenders).toEqual([])
  })

  it("keeps the shared field style's outline drawable when merged with outline-none", () => {
    const styles = readFileSync(
      join(root, "components/ui/field-control.ts"),
      "utf8"
    )
    const control = styles.slice(styles.indexOf("fieldControlVariants = cva("))
    const recipe = control.split("\n").slice(0, 3).join(" ")
    // Either a hand-written outline with its style, or the focus-ring
    // utility, whose rule sets `outline: 3px solid`.
    expect(
      FOCUS_OUTLINE_STYLE.test(recipe) || FOCUS_RING.test(recipe),
      recipe
    ).toBe(true)
  })
})
