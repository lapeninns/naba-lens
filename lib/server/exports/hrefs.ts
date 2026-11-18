// S1-EXPORT links. Pure, so pages, client components and the download route
// share them.

export type ExportArea = "admin" | "manager"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const exportHrefs = {
  admin: "/admin/publishing",
  adminNew: (venueId?: string) =>
    venueId
      ? `/admin/publishing/new?venue=${encodeURIComponent(venueId)}`
      : "/admin/publishing/new",
  manager: "/manager/exports",
  managerNew: "/manager/exports/new",
} as const

/** A package's page; an id that is not a uuid goes to the area's list. */
export function packageHref(area: ExportArea, id: string): string {
  const base = area === "manager" ? exportHrefs.manager : exportHrefs.admin
  return UUID.test(id) ? `${base}/packages/${id}` : base
}

export function downloadHref(area: ExportArea, id: string): string {
  return `/api/exports/${encodeURIComponent(id)}/download${area === "manager" ? "?from=manager" : ""}`
}
