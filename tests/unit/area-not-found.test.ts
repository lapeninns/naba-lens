import { readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

import { getRouteRegex } from "next/dist/shared/lib/router/utils/route-regex"
import { getSortedRoutes } from "next/dist/shared/lib/router/utils/sorted-routes"
import { describe, expect, it, vi } from "vitest"

import AdminMissingPage from "@/app/admin/[...missing]/page"
import ManagerMissingPage from "@/app/manager/[...missing]/page"
import StaffMissingPage from "@/app/staff/[...missing]/page"

vi.mock("server-only", () => ({}))

const appDir = fileURLToPath(new URL("../../app", import.meta.url))
const ROUTE_FILE = /^(page|route)\.(tsx?|jsx?)$/
const AREAS = ["/admin", "/staff", "/manager"] as const
const CATCH_ALL = (area: string) => `${area}/[...missing]`

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

/** Every page and route handler URL pattern, as Next names them. */
function appRoutes(): string[] {
  const urls = new Set<string>()
  for (const file of walk(appDir)) {
    if (!ROUTE_FILE.test(file.split(sep).pop()!)) continue
    const segments = relative(appDir, file).split(sep).slice(0, -1)
    if (segments.some((s) => s.startsWith("_"))) continue
    const url =
      "/" +
      segments.filter((s) => !(s.startsWith("(") && s.endsWith(")"))).join("/")
    urls.add(url)
  }
  return [...urls]
}

// Next's own order (static, then dynamic, then catch-all at each level); it
// also throws on clashing dynamic names, as `next build` would.
const sorted = getSortedRoutes(appRoutes())
const matchers = sorted.map((route) => ({
  route,
  re: getRouteRegex(route).re,
}))

function resolve(pathname: string): string | null {
  return matchers.find(({ re }) => re.test(pathname))?.route ?? null
}

/** A URL a real visitor could request for a route pattern. */
function sampleOf(route: string) {
  return route
    .replace(/\[\.\.\.[^\]]+\]/g, "a/b")
    .replace(/\[[^\]]+\]/g, "sample-id")
}

describe("unmatched URLs in an app area reach that area's not-found", () => {
  it("each area has exactly one catch-all, which only calls notFound()", () => {
    for (const area of AREAS) {
      const catchAlls = sorted.filter(
        (r) => r.startsWith(`${area}/`) && r.includes("[...")
      )
      expect(catchAlls, area).toEqual([CATCH_ALL(area)])
    }
    for (const page of [
      AdminMissingPage,
      StaffMissingPage,
      ManagerMissingPage,
    ]) {
      let digest: unknown
      try {
        page()
      } catch (error) {
        digest = (error as { digest?: unknown }).digest
      }
      expect(String(digest)).toMatch(/^NEXT_HTTP_ERROR_FALLBACK;404$/)
    }
  })

  it("never shadows a real page or route handler", () => {
    const real = sorted.filter((r) => !r.endsWith("/[...missing]"))
    expect(real.length).toBeGreaterThan(40)
    for (const route of real) {
      expect(resolve(sampleOf(route)), route).toBe(route)
    }
  })

  it("sends unknown URLs, at any depth, to the area's own catch-all", () => {
    const cases: [string, string][] = [
      ["/admin/this-page-does-not-exist", "/admin"],
      ["/admin/staff/abc/no/such/tab", "/admin"],
      ["/admin/menus/versions/v1/extra", "/admin"],
      ["/staff/nope", "/staff"],
      ["/staff/tasks/r1/no/such", "/staff"],
      ["/staff/manage/amenities/c1/capture/extra", "/staff"],
      ["/manager/nope", "/manager"],
      ["/manager/review/contributors/s1/extra", "/manager"],
    ]
    for (const [path, area] of cases) {
      expect(resolve(path), path).toBe(CATCH_ALL(area))
    }
  })

  it("leaves the area homes and everything outside the areas alone", () => {
    expect(resolve("/admin")).toBe("/admin")
    expect(resolve("/staff")).toBe("/staff")
    expect(resolve("/manager")).toBe("/manager")
    // Root not-found still answers these; look-alike prefixes are not areas.
    for (const path of [
      "/nope",
      "/administrator/x",
      "/staffroom",
      "/managers/x",
      "/auth/nope",
      "/login/x",
    ]) {
      expect(resolve(path), path).toBeNull()
    }
  })
})
