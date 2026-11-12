// Vitest globals are off, so React Testing Library does not unmount between
// tests. A tree left mounted can commit after the jsdom environment has torn
// down, and React's scheduler then throws "window is not defined" outside any
// test (hosted run 43072631782 on PR #27; run 42522080449 on main at 64d536bb).
// Every UI test that renders through RTL must clean up.
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = join(import.meta.dirname, "..", "..")
const UI = join(ROOT, "tests", "ui")

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return files(path)
    return /\.test\.tsx?$/.test(entry.name) ? [path] : []
  })
}

const RTL_RENDER =
  /import\s*\{[^}]*\b(render|renderHook)\b[^}]*\}\s*from\s*["']@testing-library\/react["']/

function missingCleanup(source: string): boolean {
  return RTL_RENDER.test(source) && !/\bcleanup\b/.test(source)
}

describe("UI tests clean up what they render", () => {
  it("flags a file that renders without cleanup and accepts one that cleans up", () => {
    const renders = 'import { render } from "@testing-library/react"\nrender(x)'
    expect(missingCleanup(renders)).toBe(true)
    expect(
      missingCleanup(
        'import { cleanup, renderHook } from "@testing-library/react"\nafterEach(cleanup)'
      )
    ).toBe(false)
    expect(
      missingCleanup('import { screen } from "@testing-library/react"')
    ).toBe(false)
  })

  it("every tests/ui file that renders through RTL calls cleanup", () => {
    const offenders = files(UI)
      .filter((path) => missingCleanup(readFileSync(path, "utf8")))
      .map((path) => relative(ROOT, path))
    expect(offenders).toEqual([])
  })
})
