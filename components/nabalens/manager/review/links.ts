// Where the Review screen links to. The same screen runs in the manager
// workspace and on the admin Review page, so every URL comes from its scope
// (serialisable, passed from the server page).

import {
  managerHrefs,
  type ReviewAge,
  type ReviewCategory,
  type ReviewMedia,
  type ReviewQuery,
} from "../hrefs"

export type ReviewScope =
  { kind: "manager" } | { kind: "admin"; venueId: string }

/** The filters of one Review list; ids only (section, contributor, item). */
export type ReviewView = {
  status: NonNullable<ReviewQuery["status"]>
  sectionId: string | null
  contributorId: string | null
  itemId: string | null
  /** S2-REVIEW narrowing (spec §7 M2); absent or null means off. */
  category?: ReviewCategory | null
  minAgeDays?: ReviewAge | null
  possibleDuplicate?: boolean
  neededBy?: boolean
  /** K11: photos or videos only. */
  media?: ReviewMedia | null
}

/** The S2-REVIEW filters a view narrows by, as server read arguments. */
export function narrowingOf(view: ReviewView) {
  return {
    ...(view.category ? { sectionKind: view.category } : {}),
    ...(view.minAgeDays ? { minAgeDays: view.minAgeDays } : {}),
    ...(view.possibleDuplicate ? { possibleDuplicate: true } : {}),
    ...(view.neededBy ? { neededBy: true } : {}),
    ...(view.media
      ? { mediaType: view.media === "video" ? "video" : "image" }
      : {}),
  }
}

/** True when any S2-REVIEW filter is on. */
export function isNarrowed(view: ReviewView): boolean {
  return Boolean(
    view.category ||
    view.minAgeDays ||
    view.possibleDuplicate ||
    view.neededBy ||
    view.media
  )
}

/**
 * The photo's review detail: the manager's, or the admin photo route
 * (S3-R11) for an admin scope (S3-R13 X1).
 */
export function photoHref(scope: ReviewScope, assetId: string): string {
  return scope.kind === "admin"
    ? managerHrefs.adminPhoto(scope.venueId, assetId)
    : managerHrefs.photo(assetId)
}

/** The admin venue for every server action; undefined for a manager. */
export function venueIdOf(scope: ReviewScope): string | undefined {
  return scope.kind === "admin" ? scope.venueId : undefined
}

export function contributorHref(scope: ReviewScope, id: string): string {
  return scope.kind === "admin"
    ? managerHrefs.adminContributor(scope.venueId, id)
    : managerHrefs.contributor(id)
}

/** The manager item page; admins have none, so their link filters Review. */
export function itemHref(scope: ReviewScope, itemId: string): string {
  return scope.kind === "admin"
    ? managerHrefs.adminMenuPhotos(scope.venueId, { item: itemId })
    : managerHrefs.item(itemId)
}

/**
 * The URL of a filtered view. On the contributor page the contributor is in
 * the path, so only the other filters go in the query. The manager's bare
 * Review page is Review in a thumb (DESIGN.md §6.5), so a list view always
 * carries `view=list`: clearing the last filter keeps the full list.
 */
export function reviewHref(
  scope: ReviewScope,
  view: ReviewView,
  fixedContributorId?: string | null,
  defaultStatus: ReviewView["status"] = "pending"
): string {
  const query: ReviewQuery = {
    status: view.status === defaultStatus ? undefined : view.status,
    section: view.sectionId ?? undefined,
    item: view.itemId ?? undefined,
    contributor: fixedContributorId
      ? undefined
      : (view.contributorId ?? undefined),
    category: view.category ?? undefined,
    age: view.minAgeDays ? `${view.minAgeDays}` : undefined,
    dupes: view.possibleDuplicate ? "1" : undefined,
    needed: view.neededBy ? "1" : undefined,
    media: view.media ?? undefined,
  }
  if (fixedContributorId) {
    const base = contributorHref(scope, fixedContributorId)
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query))
      if (value) params.set(key, value)
    const search = params.toString()
    return search ? `${base}?${search}` : base
  }
  if (scope.kind === "admin")
    return managerHrefs.adminMenuPhotos(scope.venueId, query)
  const href = managerHrefs.review(query)
  return `${href}${href.includes("?") ? "&" : "?"}view=list`
}
