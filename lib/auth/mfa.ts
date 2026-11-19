import type { SupabaseClient } from "@supabase/supabase-js"

import type { AppRole } from "@/lib/auth/routes"
import type { Database } from "@/lib/db/types"

/**
 * Second sign-in step (FA-23, spec §3.2): admins must pass a TOTP code on
 * every session; managers may turn it on, and once anyone has a verified
 * factor the app asks for it too. The database repeats the admin rule
 * (private.is_active_admin needs an aal2 session), so a skipped page check
 * can never grant admin access.
 */
export type MfaRequirement = "enrol" | "verify"

export type AssuranceLevel = "aal1" | "aal2"

/** The session's assurance level from its JWT claims (aal1 when absent). */
export function assuranceLevel(claims: { aal?: unknown }): AssuranceLevel {
  return claims.aal === "aal2" ? "aal2" : "aal1"
}

/**
 * What the account must do before it may continue, or null.
 * `verifiedFactors` may be null when it was not read (not needed: staff at
 * aal1 are never asked). An admin without a factor sets one up first.
 */
export function mfaRequirement(
  role: AppRole,
  aal: AssuranceLevel,
  verifiedFactors: number | null
): MfaRequirement | null {
  if (aal === "aal2") return null
  if (role === "admin")
    return verifiedFactors !== null && verifiedFactors > 0 ? "verify" : "enrol"
  if (verifiedFactors !== null && verifiedFactors > 0) return "verify"
  return null
}

/** Roles whose verified factors are read at aal1 (one RPC per request). */
export function readsFactors(role: AppRole): boolean {
  return role === "admin" || role === "manager"
}

/** Roles that may turn the second step on for themselves. */
export function mayEnrolMfa(role: AppRole): boolean {
  return role === "admin" || role === "manager"
}

/**
 * The caller's verified factor count from `my_mfa_status`. Throws when it
 * cannot be read: like a failed profile read, access is then unknown.
 */
export async function readVerifiedFactors(
  supabase: SupabaseClient<Database>
): Promise<number> {
  const { data, error } = await supabase.rpc("my_mfa_status")
  if (error) throw new Error(`Could not read MFA status: ${error.code}`)
  const count = (data as { verifiedFactors?: unknown } | null)?.verifiedFactors
  return typeof count === "number" && count >= 0 ? count : 0
}

/** Six digits, as authenticator apps show them (spaces allowed). */
export function normaliseTotpCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const code = raw.replace(/\s+/g, "")
  return /^\d{6}$/.test(code) ? code : null
}
