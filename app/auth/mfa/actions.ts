"use server"

import { redirect } from "next/navigation"

import { getAuthState } from "@/lib/auth"
import {
  mayEnrolMfa,
  normaliseTotpCode,
  readVerifiedFactors,
} from "@/lib/auth/mfa"
import { createClient } from "@/lib/supabase/server"

/*
 * Second sign-in step (FA-23, spec §3.2). Every call re-reads the account:
 * enrolment is open to an admin who has no factor yet (required) and to an
 * active manager or admin who turns it on; a code is checked for any signed-in
 * account that has a factor. Supabase Auth checks the code and raises the
 * session to aal2; the database then admits the admin (is_active_admin).
 */

export type EnrolmentResult =
  | { ok: true; factorId: string; qrCode: string; secret: string }
  | { ok: false; error: string }

export type CodeState = { error: string | null }

const NOT_NOW =
  "Two-step sign-in can't be set up for this account. Sign in again."
const TRY_AGAIN = "Couldn't reach the sign-in service. Try again."
const WRONG_CODE =
  "That code didn't match. Check the time on your phone and enter the newest code."

async function mayEnrol(): Promise<boolean> {
  const state = await getAuthState()
  if (state.status === "mfa_required") return state.requirement === "enrol"
  if (state.status !== "active" || !mayEnrolMfa(state.profile.role))
    return false
  const supabase = await createClient()
  return (await readVerifiedFactors(supabase)) === 0
}

/** Starts a TOTP factor and returns its QR code and setup key. */
export async function startMfaEnrolment(): Promise<EnrolmentResult> {
  let allowed: boolean
  try {
    allowed = await mayEnrol()
  } catch {
    return { ok: false, error: TRY_AGAIN }
  }
  if (!allowed) return { ok: false, error: NOT_NOW }
  const supabase = await createClient()
  // An earlier, unfinished set-up is replaced, so retries never pile up.
  const listed = await supabase.auth.mfa.listFactors()
  if (listed.error) return { ok: false, error: TRY_AGAIN }
  for (const factor of listed.data.all) {
    if (factor.factor_type === "totp" && factor.status === "unverified")
      await supabase.auth.mfa.unenroll({ factorId: factor.id })
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Naba-Lens ${new Date().toISOString().slice(0, 16)}`,
  })
  if (error || !data) return { ok: false, error: TRY_AGAIN }
  return {
    ok: true,
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
  }
}

/**
 * Checks a code: the factor being set up (`factorId` from the form) or the
 * account's verified TOTP factor. Success goes to "/", which routes by role.
 */
export async function confirmMfaCode(
  _previous: CodeState,
  form: FormData
): Promise<CodeState> {
  const code = normaliseTotpCode(form.get("code"))
  if (!code) return { error: "Enter the 6-digit code from your app." }
  const state = await getAuthState().catch(() => null)
  if (!state) return { error: TRY_AGAIN }
  if (state.status !== "mfa_required" && state.status !== "active")
    return { error: NOT_NOW }

  const supabase = await createClient()
  let factorId = form.get("factorId")
  if (typeof factorId !== "string" || !factorId) {
    const listed = await supabase.auth.mfa.listFactors()
    if (listed.error) return { error: TRY_AGAIN }
    factorId = listed.data.totp[0]?.id ?? ""
    if (!factorId) return { error: NOT_NOW }
  }
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId,
    code,
  })
  if (error) {
    const status = (error as { status?: number }).status
    if (status === 429)
      return { error: "Too many tries. Wait a minute, then try again." }
    return { error: status && status >= 500 ? TRY_AGAIN : WRONG_CODE }
  }
  redirect("/")
}
