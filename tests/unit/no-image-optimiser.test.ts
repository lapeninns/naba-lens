import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import nextConfig from "../../next.config"

/**
 * Spec §7: private media must not pass through a shared image-optimisation
 * route that bypasses access control. Gallery images use plain <img> on the
 * authorised /api/media routes; this guards against a later `next/image`.
 */
const root = fileURLToPath(new URL("../../", import.meta.url))

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|tsx|mts)$/.test(name) ? [path] : []
  })
}

describe("no private media through next/image", () => {
  it("app, components and lib never import next/image or call /_next/image", () => {
    const offenders = ["app", "components", "lib"]
      .flatMap((dir) => sources(join(root, dir)))
      .filter((file) =>
        /from\s+["']next\/image["']|require\(["']next\/image["']\)|\/_next\/image/.test(
          readFileSync(file, "utf8")
        )
      )
      .map((file) => file.slice(root.length))
    expect(offenders).toEqual([])
  })

  it("no remote image patterns point the optimiser at storage", () => {
    expect(nextConfig.images?.remotePatterns ?? []).toEqual([])
    expect(nextConfig.images?.domains ?? []).toEqual([])
  })
})
