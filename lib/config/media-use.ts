import "server-only"

/**
 * Rollback switch for creating purpose-specific use grants (B05-02). Off
 * unless NABALENS_PUBLIC_USE_GRANTS is "on": enabling waits for the owner's
 * granter, purpose and clearance decisions (OD-B5-1, OD-B5-3, OD-B5-4).
 * Withdrawal and status reads never depend on it.
 */
export function publicUseGrantsEnabled(): boolean {
  return process.env.NABALENS_PUBLIC_USE_GRANTS?.trim() === "on"
}
