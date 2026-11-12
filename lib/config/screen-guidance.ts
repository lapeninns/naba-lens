import "server-only"

/**
 * In-app screen guidance (B10-05a, switch SW-15). Off by default: the product
 * owner signs off the guidance copy (b10-design §7.2 item 2) and the owner
 * authorises the configuration change (X1) before anyone sets
 * NABALENS_SCREEN_GUIDANCE=on. Anything else, including unset, is off.
 */
export type ScreenGuidance = "on" | "off"

export const DEFAULT_SCREEN_GUIDANCE: ScreenGuidance = "off"

export function screenGuidance(): ScreenGuidance {
  return process.env.NABALENS_SCREEN_GUIDANCE?.trim() === "on"
    ? "on"
    : DEFAULT_SCREEN_GUIDANCE
}
