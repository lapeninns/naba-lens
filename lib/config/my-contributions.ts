import "server-only"

/**
 * Me's history list (B02 UI design §6.1, §6.3). "b02" shows My contributions
 * (photos, task photo sends and findings); "b01" restores B01's "Your
 * findings" exactly. NABALENS_MY_CONTRIBUTIONS sets it ("b01" or "b02";
 * anything else is the default).
 */
export type MyContributionsSurface = "b01" | "b02"

export const DEFAULT_MY_CONTRIBUTIONS: MyContributionsSurface = "b02"

export function myContributionsSurface(): MyContributionsSurface {
  const value = process.env.NABALENS_MY_CONTRIBUTIONS?.trim()
  return value === "b01" || value === "b02" ? value : DEFAULT_MY_CONTRIBUTIONS
}
