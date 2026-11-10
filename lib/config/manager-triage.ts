import "server-only"

/**
 * Manager triage (B02 UI design §6.2, §6.3): the Triage card on the manager,
 * staff-manager and admin venue overviews, the To confirm badge on the venue
 * tools and the kind filter on /manager/review. "b01" restores today's
 * overviews and Review page exactly. NABALENS_MANAGER_TRIAGE sets it ("b01" or
 * "b02"; anything else is the default).
 */
export type ManagerTriageSurface = "b01" | "b02"

export const DEFAULT_MANAGER_TRIAGE: ManagerTriageSurface = "b02"

export function managerTriageSurface(): ManagerTriageSurface {
  const value = process.env.NABALENS_MANAGER_TRIAGE?.trim()
  return value === "b01" || value === "b02" ? value : DEFAULT_MANAGER_TRIAGE
}
