#!/usr/bin/env node
/**
 * Install icons for the web app manifest (FA-53; spec §15.3). Run with
 * `node scripts/pwa/generate-icons.mjs` after changing the mark; the PNGs are
 * committed, so builds never run this.
 *
 * The mark: an N inside a lens ring, in paper (`canvas`, #f6f1e7) on the
 * Album green (`accent`, #1d4d36). Values from app/globals.css and
 * docs/design-system/DESIGN.md §3.1. Drawn as paths, not text, so the
 * output never depends on an installed font.
 *
 *   public/icons/icon-192.png           purpose "any", rounded square
 *   public/icons/icon-512.png           purpose "any", rounded square
 *   public/icons/icon-maskable-512.png  purpose "maskable": full bleed, the
 *                                       mark inside the 80% safe circle
 *   app/apple-icon.png                  180 x 180, full bleed (iOS rounds it)
 */
import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import sharp from "sharp"

const ACCENT = "#1d4d36"
const PAPER = "#f6f1e7"

const root = fileURLToPath(new URL("../../", import.meta.url))

/** The mark on a 512 grid, scaled by `scale` about the centre. */
function mark(scale) {
  const t = `translate(256 256) scale(${scale}) translate(-256 -256)`
  return `<g transform="${t}" fill="${PAPER}">
    <circle cx="256" cy="256" r="150" fill="none" stroke="${PAPER}" stroke-width="34"/>
    <rect x="190" y="178" width="34" height="156"/>
    <rect x="288" y="178" width="34" height="156"/>
    <polygon points="190,178 224,178 322,334 288,334"/>
  </g>`
}

function svg({ rounded, scale }) {
  const bg = rounded
    ? `<rect width="512" height="512" rx="112" fill="${ACCENT}"/>`
    : `<rect width="512" height="512" fill="${ACCENT}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${bg}${mark(scale)}</svg>`
}

const OUTPUTS = [
  { file: "public/icons/icon-192.png", size: 192, rounded: true, scale: 1 },
  { file: "public/icons/icon-512.png", size: 512, rounded: true, scale: 1 },
  {
    file: "public/icons/icon-maskable-512.png",
    size: 512,
    rounded: false,
    // Ring outer radius 167 x 0.75 = 125, well inside the 205 safe circle.
    scale: 0.75,
  },
  { file: "app/apple-icon.png", size: 180, rounded: false, scale: 0.85 },
]

for (const out of OUTPUTS) {
  const target = join(root, out.file)
  await mkdir(dirname(target), { recursive: true })
  await sharp(Buffer.from(svg(out)))
    .resize(out.size, out.size)
    .png({ compressionLevel: 9 })
    .toFile(target)
  console.log(`${out.file} ${out.size}x${out.size}`)
}
