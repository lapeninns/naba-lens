// Where the Review screen links to. The same screen runs in the manager
// workspace and on the admin Review page, so every URL comes from its scope
// (serialisable, passed from the server page).

import { managerHrefs, type ReviewQuery } from "../hrefs"

export type ReviewScope =
  { kind: "manager" } | { kind: "admin"; venueId: string }

/** The filters of one Review list; ids only (section, contributor, item). */
export type ReviewView = {
  status: NonNullable<ReviewQuery["status"]>
  sectionId: string | null
  contributorId: string | null
  itemId: string | null
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
 * the path, so only the other filters go in the query.
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
  }
  if (fixedContributorId) {
    const base = contributorHref(scope, fixedContributorId)
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query))
      if (value) params.set(key, value)
    const search = params.toString()
    return search ? `${base}?${search}` : base
  }
  return scope.kind === "admin"
    ? managerHrefs.adminMenuPhotos(scope.venueId, query)
    : managerHrefs.review(query)
}
