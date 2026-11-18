import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import sharp from "sharp"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font", className: "font" })
  return {
    Figtree: font,
    Fraunces: font,
  }
})

import manifest from "@/app/manifest"
import { metadata, viewport } from "@/app/layout"
import { config as proxyConfig } from "@/proxy"

/**
 * FA-53 (spec §15.3): the web app manifest, its icons, the Apple touch icon,
 * theme colours and appleWebApp metadata. v2 colours (D10) come from
 * app/globals.css (DESIGN.md §3.1).
 */

const root = fileURLToPath(new URL("../../", import.meta.url))
const PAPER_LIGHT = "#f6f3ec"
const PAPER_DARK = "#121613"
const ACCENT = "#1d4d36"

describe("app/manifest.ts", () => {
  const m = manifest()

  it("names Naba-Lens, opens standalone at / and uses Album's paper", () => {
    expect(m).toMatchObject({
      id: "/",
      name: "Naba-Lens",
      short_name: "Naba-Lens",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: PAPER_LIGHT,
      theme_color: PAPER_LIGHT,
    })
  })

  it("holds only static, public fields", () => {
    const text = JSON.stringify(m)
    expect(text).not.toMatch(/supabase|token|key|@|venue_id|user/i)
    expect(Object.keys(m).sort()).toEqual(
      [
        "id",
        "name",
        "short_name",
        "description",
        "start_url",
        "scope",
        "display",
        "orientation",
        "background_color",
        "theme_color",
        "icons",
      ].sort()
    )
  })

  it("lists 192 and 512 icons and a maskable 512, each a real PNG of its size", async () => {
    const icons = m.icons ?? []
    expect(icons.map((i) => [i.sizes, i.purpose])).toEqual([
      ["192x192", "any"],
      ["512x512", "any"],
      ["512x512", "maskable"],
    ])
    for (const icon of icons) {
      const file = join(root, "public", icon.src)
      expect(existsSync(file), icon.src).toBe(true)
      const meta = await sharp(file).metadata()
      expect(meta.format).toBe("png")
      expect(`${meta.width}x${meta.height}`).toBe(icon.sizes)
    }
  })

  it("draws the maskable icon full bleed in Album green", async () => {
    const { data } = await sharp(
      join(root, "public/icons/icon-maskable-512.png")
    )
      .extract({ left: 0, top: 0, width: 1, height: 1 })
      .raw()
      .toBuffer({ resolveWithObject: true })
    const hex = `#${[...data.subarray(0, 3)].map((b) => b.toString(16).padStart(2, "0")).join("")}`
    expect(hex).toBe(ACCENT)
  })

  it("has a 180 x 180 Apple touch icon", async () => {
    const meta = await sharp(join(root, "app/apple-icon.png")).metadata()
    expect([meta.width, meta.height, meta.format]).toEqual([180, 180, "png"])
  })
})

describe("app/layout.tsx", () => {
  it("sets theme-color to Album's canvas for light and dark", () => {
    expect(viewport.themeColor).toEqual([
      { media: "(prefers-color-scheme: light)", color: PAPER_LIGHT },
      { media: "(prefers-color-scheme: dark)", color: PAPER_DARK },
    ])
    const css = readFileSync(join(root, "app/globals.css"), "utf8")
    expect(css).toContain(`/* ${PAPER_LIGHT} paper */`)
    expect(css).toContain(`/* ${PAPER_DARK} */`)
  })

  it("names the app for iOS home screens", () => {
    expect(metadata.appleWebApp).toMatchObject({
      capable: true,
      title: "Naba-Lens",
    })
  })
})

describe("proxy.ts", () => {
  const matcher = new RegExp(`^${proxyConfig.matcher[0]}$`)
  it("skips the manifest and icons, so no session work runs for them", () => {
    expect(matcher.test("/manifest.webmanifest")).toBe(false)
    expect(matcher.test("/icons/icon-192.png")).toBe(false)
    expect(matcher.test("/apple-icon.png")).toBe(false)
    expect(matcher.test("/staff")).toBe(true)
  })
})
