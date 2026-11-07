// The Menu list's URL state (`?status=&section=&q=`) and the item page's
// `?from=`, which keeps that state for the back link. Pure: safe in Server
// and Client Components.

import { isUuid } from "@/lib/server/coverage/validate"

import type { MenuStatusFilter } from "@/lib/server/menu-photos/types"

import { managerHrefs, type MenuQuery } from "../hrefs"

export const MENU_QUERY_MAX = 80

/** Status choices in the order the segmented control shows them. */
export const MENU_STATUS_ORDER: readonly MenuStatusFilter[] = [
  "needs_photo",
  "awaiting_review",
  "covered",
  "replacement",
  "recheck",
]

export type MenuFilter = {
  status: MenuStatusFilter | null
  sectionId: string | null
  query: string
}

type Search = Record<string, string | string[] | undefined>

const one = (value: string | string[] | undefined | null) =>
  typeof value === "string" ? value : undefined

/** Unknown values fall back to the defaults (all items, every section). */
export function parseMenuFilter(search: Search): MenuFilter {
  const status = one(search.status)
  const section = one(search.section)
  return {
    status: (MENU_STATUS_ORDER as readonly string[]).includes(status ?? "")
      ? (status as MenuStatusFilter)
      : null,
    sectionId: section && isUuid(section) ? section : null,
    query: (one(search.q) ?? "").trim().slice(0, MENU_QUERY_MAX),
  }
}

export function menuQueryOf(filter: MenuFilter): MenuQuery {
  return {
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.sectionId ? { section: filter.sectionId } : {}),
    ...(filter.query ? { q: filter.query } : {}),
  }
}

export function menuHref(filter: MenuFilter): string {
  return managerHrefs.menu(menuQueryOf(filter))
}

/** An item's page, carrying the list's filters for its back link. */
export function itemHref(itemId: string, filter: MenuFilter): string {
  const base = managerHrefs.item(itemId)
  const list = menuHref(filter)
  const at = list.indexOf("?")
  return at < 0
    ? base
    : `${base}?${new URLSearchParams({ from: list.slice(at + 1) })}`
}

/** The Menu link of an item page, rebuilt from `?from=` (never used as a raw URL). */
export function backHref(from: string | string[] | undefined): string {
  const raw = one(from)
  if (!raw) return managerHrefs.menu()
  const params = new URLSearchParams(raw)
  return menuHref(
    parseMenuFilter({
      status: params.get("status") ?? undefined,
      section: params.get("section") ?? undefined,
      q: params.get("q") ?? undefined,
    })
  )
}
