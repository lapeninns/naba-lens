/**
 * Build the dish photo guide's static examples into public/guide/v1 from the
 * approved prototype images (not committed). Run once; commit the output.
 *
 *   pnpm exec tsx scripts/guide/build-guide-images.ts <prototype img folder>
 *
 * The prototype numbers its images per dish, in angle order: Mixed grill 1-4,
 * Garlic naan 5-8, Curry 9-12, Momos 13-16 (PNG, half size), Mint curry 17-20.
 * Each image becomes a 480 px grid thumbnail and a 1200 px viewer image (never
 * upscaled), WebP, metadata stripped. Changed images go in a new folder (v2):
 * next.config.ts caches /guide/v1 as immutable.
 */
import { mkdir, readdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import sharp from "sharp"

import {
  GUIDE_ANGLES,
  GUIDE_DISHES,
  GUIDE_IMAGE_WIDTHS,
} from "../../lib/guide/dish-guide"

const OUT = fileURLToPath(new URL("../../public/guide/v1/", import.meta.url))
const QUALITY = 78

async function main() {
  const source = process.argv[2]
  if (!source) {
    throw new Error(
      "Usage: tsx scripts/guide/build-guide-images.ts <prototype img folder>"
    )
  }
  const dir = resolve(source)
  const files = await readdir(dir)
  await mkdir(OUT, { recursive: true })

  let index = 0
  for (const dish of GUIDE_DISHES) {
    for (const angle of GUIDE_ANGLES) {
      index += 1
      const name = files.find((file) =>
        new RegExp(`^${index}\\.(webp|png)$`).test(file)
      )
      if (!name) throw new Error(`Missing source image ${index} in ${dir}`)
      const image = dish.images[angle.id]
      for (const [width, src] of [
        [GUIDE_IMAGE_WIDTHS.thumb, image.src],
        [GUIDE_IMAGE_WIDTHS.large, image.src2x],
      ] as const) {
        const out = join(OUT, src.slice("/guide/v1/".length))
        const info = await sharp(join(dir, name))
          .resize({ width, withoutEnlargement: true })
          .webp({ quality: QUALITY })
          .toFile(out)
        console.log(`${name} -> ${src} (${info.width}x${info.height})`)
      }
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
