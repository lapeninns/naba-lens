"use server"

import {
  decideMenuPhoto,
  getManagerPhotoCtx,
  listItemEvents,
  listManagerMenuItems,
  listReviewQueue,
  type DecisionOutcome,
  type ItemEvent,
  type ManagerMenuItem,
  type MenuPhotoResult,
  type Page,
  type QueueCard,
} from "@/lib/server/menu-photos"

// Server Functions of the manager workspace and the admin Review page. Every
// input is `unknown` (these are public POST endpoints) and every call
// re-authorises: a manager's venue always comes from their workspace scope (a
// different `venueId` is wrong_venue); an admin names the venue. Nothing is
// revalidated: Review updates the card in place, and the other manager pages
// are dynamic and re-read on navigation.

const venueOf = (input: unknown) =>
  input && typeof input === "object" && "venueId" in input
    ? input.venueId
    : undefined

/** One review decision; returns the item's fresh cards for `view.status`. */
export async function decideMenuPhotoAction(
  input: unknown,
  view: unknown
): Promise<MenuPhotoResult<{ outcome: DecisionOutcome }>> {
  const scope = await getManagerPhotoCtx(venueOf(input))
  if (!scope.ok) return scope
  return decideMenuPhoto(scope.ctx, input, view)
}

/** The next page of the Review queue (`{ status, sectionId, contributorId, itemId, cursor }`). */
export async function loadReviewPageAction(
  input: unknown
): Promise<MenuPhotoResult<Page<QueueCard>>> {
  const scope = await getManagerPhotoCtx(venueOf(input))
  if (!scope.ok) return scope
  return listReviewQueue(scope.ctx, input)
}

/** Menu items: load more, and the item picker's search (`{ status, sectionId, query, cursor }`). */
export async function loadMenuItemsPageAction(
  input: unknown
): Promise<MenuPhotoResult<Page<ManagerMenuItem>>> {
  const scope = await getManagerPhotoCtx(venueOf(input))
  if (!scope.ok) return scope
  return listManagerMenuItems(scope.ctx, input)
}

/** Older history of an item (`{ itemId, before }`). */
export async function loadItemEventsAction(
  input: unknown
): Promise<MenuPhotoResult<Page<ItemEvent>>> {
  const scope = await getManagerPhotoCtx(venueOf(input))
  if (!scope.ok) return scope
  return listItemEvents(scope.ctx, input)
}
