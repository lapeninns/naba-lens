import type { MetadataRoute } from "next"

/**
 * Web app manifest (FA-53; spec §15.3): Naba-Lens can be added to a home
 * screen and opens standalone at "/", which sends each person to their own
 * area or to sign in. Browser use is unchanged. No service worker: the upload
 * outbox already keeps unsent photos, and there is no new cache.
 *
 * Static (no request-time API), so Next builds it once: it holds nothing about
 * the visitor and is served to signed-out browsers too (proxy.ts skips it).
 * Colours are Album's paper and green (app/globals.css; DESIGN.md §3.1). Icons
 * come from scripts/pwa/generate-icons.mjs.
 */
const MANIFEST_COLOURS = {
  /** `canvas`, light: the splash screen behind the icon. */
  background: "#f6f1e7",
  /** `canvas`, light: matches the browser chrome in app/layout.tsx. */
  theme: "#f6f1e7",
} as const

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Naba-Lens",
    short_name: "Naba-Lens",
    description:
      "Staff photos and videos of each venue's dishes, drinks and spaces, in one place.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: MANIFEST_COLOURS.background,
    theme_color: MANIFEST_COLOURS.theme,
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  }
}
