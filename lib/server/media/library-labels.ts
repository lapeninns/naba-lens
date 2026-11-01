import type { LibraryLabelFilterOptions } from "@/lib/menus/types"
import { redactError } from "@/lib/server/log/redact"

import type { MediaActor } from "./types"

/** PostgREST returns at most this many rows per request (config max_rows). */
const READ_PAGE = 1000
/** Item ids per `in.(…)` filter, keeping request URLs short. */
const ID_CHUNK = 100
export const NOT_ON_ACTIVE_MENU = "(not on active menu)"

const NONE: LibraryLabelFilterOptions = { categories: [], items: [] }

type Result<T> = { data: T[] | null; error: unknown }

/** Every row of an ordered query, page by page past the max_rows cap. */
async function readAll<T>(
  read: (from: number, to: number) => PromiseLike<Result<T>>
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += READ_PAGE) {
    const { data, error } = await read(from, from + READ_PAGE - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < READ_PAGE) return rows
  }
}

function chunks<T>(values: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size))
  }
  return out
}

type LabelledItem = {
  item_id: string
  item_name: string
  section_name: string | null
}
type LabelledVariant = {
  variant_id: string
  item_id: string
  variant_name: string
}

async function labelled<T>(
  db: MediaActor["db"],
  fn: "library_labelled_items" | "library_labelled_variants",
  venueId: string
): Promise<T[]> {
  const { data, error } = await db.rpc(fn, { p_venue_id: venueId })
  if (error) throw error
  return (data ?? []) as T[]
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" })

const historical = (section: string | null) =>
  section ? `${section} ${NOT_ON_ACTIVE_MENU}` : NOT_ON_ACTIVE_MENU

/**
 * Menu item and category choices for the admin library filters at one venue:
 * the venue's ACTIVE version in menu order, then items and categories that
 * only older labels still use (sorted by name, marked "(not on active menu)").
 * Names follow the current-name rule (contract A1.9): the active entry, else
 * the most recently activated retired entry, else the label snapshot.
 *
 * Read as the caller (RLS), so labels count only on non-deleted ready assets.
 * Admin only; no venue means no choices (item ids are per venue). Choices are
 * a convenience: on a read failure this logs and returns none, and the
 * library itself still loads.
 */
export async function libraryLabelFilterOptions(
  actor: MediaActor,
  venueId: string | null
): Promise<LibraryLabelFilterOptions> {
  if (actor.profile.role !== "admin" || !venueId) return NONE
  try {
    return await readOptions(actor, venueId)
  } catch (error) {
    console.error("[media] library label filter options unavailable", {
      error: redactError(error),
    })
    return NONE
  }
}

async function readOptions(
  actor: MediaActor,
  venueId: string
): Promise<LibraryLabelFilterOptions> {
  const db = actor.db
  const [active, sections, labelledItems, labelledVariants] = await Promise.all(
    [
      db
        .from("menu_versions")
        .select("id")
        .eq("venue_id", venueId)
        .eq("status", "active")
        .maybeSingle(),
      // Sections of the active and retired versions: every slug a label
      // snapshot can carry (snapshots come from the active version of the day).
      readAll((from, to) =>
        db
          .from("menu_sections")
          .select(
            "id, slug, name, position, version_id, version:menu_versions!inner(status, activated_at)"
          )
          .eq("venue_id", venueId)
          .in("version.status", ["active", "retired"])
          .order("id")
          .range(from, to)
      ),
      // Items and variants with at least one visible label, each with its
      // newest snapshot: one jsonb value each (not rows, which PostgREST cuts
      // at max_rows), read by an index probe per item.
      labelled<LabelledItem>(db, "library_labelled_items", venueId),
      labelled<LabelledVariant>(db, "library_labelled_variants", venueId),
    ]
  )
  if (active.error) throw active.error
  const activeId = active.data?.id ?? null

  const categories: LibraryLabelFilterOptions["categories"] = []
  const items: LibraryLabelFilterOptions["items"] = []
  const seenSlugs = new Set<string>()
  const seenItems = new Set<string>()

  // Variants that labels use, by item, named from the label snapshot.
  const variantsOf = new Map<string, { id: string; name: string }[]>()
  for (const v of labelledVariants) {
    const name = v.variant_name
    if (!name) continue
    const list = variantsOf.get(v.item_id) ?? []
    list.push({ id: v.variant_id, name })
    variantsOf.set(v.item_id, list)
  }

  if (activeId) {
    const activeSections = sections
      .filter((s) => s.version_id === activeId)
      .sort((a, b) => a.position - b.position)
    const sectionOrder = new Map(activeSections.map((s, i) => [s.id, i]))
    for (const s of activeSections) {
      seenSlugs.add(s.slug)
      categories.push({ slug: s.slug, name: s.name })
    }
    const entries = await readAll((from, to) =>
      db
        .from("menu_entries")
        .select(
          "id, item_id, name, section_id, position, menu_entry_variants(variant_id, name, position)"
        )
        .eq("version_id", activeId)
        .order("id")
        .range(from, to)
    )
    entries.sort(
      (a, b) =>
        (sectionOrder.get(a.section_id) ?? 0) -
          (sectionOrder.get(b.section_id) ?? 0) || a.position - b.position
    )
    const sectionName = new Map(activeSections.map((s) => [s.id, s.name]))
    for (const e of entries) {
      seenItems.add(e.item_id)
      const current = [...e.menu_entry_variants]
        .sort((a, b) => a.position - b.position)
        .map((v) => ({ id: v.variant_id, name: v.name }))
      // Variants dropped from the active menu but still on labels stay
      // filterable (final review I-5), marked as historical.
      const currentIds = new Set(current.map((v) => v.id))
      const past = (variantsOf.get(e.item_id) ?? [])
        .filter((v) => !currentIds.has(v.id))
        .map((v) => ({ id: v.id, name: `${v.name} ${NOT_ON_ACTIVE_MENU}` }))
        .sort(byName)
      items.push({
        id: e.item_id,
        name: e.name,
        sectionName: sectionName.get(e.section_id) ?? null,
        variants: [...current, ...past],
      })
    }
  }

  // Retired categories, named from their most recently activated version.
  const retired = sections
    .filter((s) => !seenSlugs.has(s.slug))
    .sort((a, b) =>
      (b.version?.activated_at ?? "").localeCompare(
        a.version?.activated_at ?? ""
      )
    )
  const older: LibraryLabelFilterOptions["categories"] = []
  for (const s of retired) {
    if (seenSlugs.has(s.slug)) continue
    seenSlugs.add(s.slug)
    older.push({ slug: s.slug, name: historical(s.name) })
  }
  categories.push(...older.sort(byName))

  // Items that only labels still use: not in the active version.
  const past = labelledItems.filter((i) => !seenItems.has(i.item_id))
  if (past.length > 0) {
    const latest = await latestRetiredNames(
      actor,
      venueId,
      past.map((i) => i.item_id)
    )
    const pastItems = past.map((i) => {
      const known = latest.get(i.item_id)
      return {
        id: i.item_id,
        name: known?.name ?? i.item_name ?? "Unknown item",
        sectionName: historical(known?.sectionName ?? i.section_name ?? null),
        variants: (variantsOf.get(i.item_id) ?? []).sort(byName),
      }
    })
    items.push(...pastItems.sort(byName))
  }

  return { categories, items }
}

/** Item name and section from each item's most recently activated retired entry. */
async function latestRetiredNames(
  actor: MediaActor,
  venueId: string,
  itemIds: string[]
): Promise<Map<string, { name: string; sectionName: string | null }>> {
  const names = new Map<
    string,
    { name: string; sectionName: string | null; at: string }
  >()
  for (const ids of chunks(itemIds, ID_CHUNK)) {
    const rows = await readAll((from, to) =>
      actor.db
        .from("menu_entries")
        .select(
          "id, item_id, name, section:menu_sections!inner(name), version:menu_versions!inner(status, activated_at)"
        )
        .eq("venue_id", venueId)
        .eq("version.status", "retired")
        .in("item_id", ids)
        .order("id")
        .range(from, to)
    )
    for (const row of rows) {
      const at = row.version?.activated_at ?? ""
      const seen = names.get(row.item_id)
      if (!seen || at > seen.at) {
        names.set(row.item_id, {
          name: row.name,
          sectionName: row.section?.name ?? null,
          at,
        })
      }
    }
  }
  return names
}
