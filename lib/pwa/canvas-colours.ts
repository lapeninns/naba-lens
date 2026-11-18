/**
 * Album's `canvas` (paper) in sRGB, for the places that cannot read a CSS
 * variable: the theme-color meta tags (app/layout.tsx) and the web app
 * manifest (app/manifest.ts, FA-53). The source of truth is app/globals.css
 * (DESIGN.md §3.1); tests/unit/pwa-manifest.test.ts checks they agree.
 */
export const CANVAS_SRGB = {
  light: "#f6f1e7",
  dark: "#151714",
} as const
