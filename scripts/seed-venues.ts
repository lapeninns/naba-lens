/**
 * Upsert owner-confirmed venues from supabase/seed/venues.json (by slug).
 * Never deletes or deactivates venues and never invents names.
 *
 *   pnpm seed:venues [--file supabase/seed/venues.json]
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.
 */
import { readFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"

import { createServiceClientFromEnv, parseArgs } from "./lib/service-client"

export type VenueSeed = { name: string; slug: string; active?: boolean }

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function parseVenueSeed(json: unknown): VenueSeed[] {
  if (!Array.isArray(json)) throw new Error("venues.json must be a JSON array.")
  const slugs = new Set<string>()
  return json.map((entry, index) => {
    const { name, slug, active } = (entry ?? {}) as Record<string, unknown>
    if (typeof name !== "string" || !name.trim()) {
      throw new Error(`Venue #${index + 1}: "name" is required.`)
    }
    if (typeof slug !== "string" || !SLUG.test(slug)) {
      throw new Error(
        `Venue #${index + 1}: "slug" must be lowercase words joined by hyphens.`
      )
    }
    if (slugs.has(slug)) throw new Error(`Duplicate slug: ${slug}`)
    slugs.add(slug)
    return {
      name: name.trim(),
      slug,
      ...(typeof active === "boolean" ? { active } : {}),
    }
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const file =
    typeof args.file === "string" ? args.file : "supabase/seed/venues.json"
  const venues = parseVenueSeed(JSON.parse(await readFile(file, "utf8")))
  if (venues.length === 0) {
    console.log(
      `seed-venues: ${file} is empty; add the owner-confirmed venues first.`
    )
    return
  }
  const { error } = await createServiceClientFromEnv()
    .from("venues")
    .upsert(venues, { onConflict: "slug" })
  if (error) throw new Error(error.message)
  console.log(`seed-venues: upserted ${venues.length} venue(s).`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(
      `seed-venues: ${error instanceof Error ? error.message : String(error)}`
    )
    process.exit(1)
  })
}
