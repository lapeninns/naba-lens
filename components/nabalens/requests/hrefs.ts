/**
 * Links into Requests (spec §7 M4; S2-REQ). Other screens (Overview, Album,
 * Review, a menu item) link to a prefilled New request with `newFor`.
 */
export type RequestFilterParam = "active" | "done" | "all"

export const requestHrefs = {
  list: (show?: RequestFilterParam) =>
    show && show !== "active"
      ? `/manager/requests?show=${show}`
      : "/manager/requests",
  request: (id: string) => `/manager/requests/${encodeURIComponent(id)}`,
  /** A New request: from a slot, a New brief, or a fact. */
  new: (mode: "slot" | "new" | "fact" = "slot") =>
    mode === "slot"
      ? "/manager/requests/new"
      : `/manager/requests/new?mode=${mode}`,
  /** A New request already pointed at one slot (kind as coverage_slots names it). */
  newFor: (kind: "dish" | "area" | "amenity", slotId: string) =>
    `/manager/requests/new?kind=${kind}&slot=${encodeURIComponent(slotId)}`,
  /** A fact confirmation for one amenity check. */
  newFact: (checkId: string) =>
    `/manager/requests/new?mode=fact&fact=${encodeURIComponent(checkId)}`,
} as const
