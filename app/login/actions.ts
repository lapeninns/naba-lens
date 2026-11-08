"use server"

import { cookies } from "next/headers"

import {
  normaliseEmail,
  normaliseSignInCode,
  sendSignInLink,
  signInCodeError,
  SIGN_IN_CODE_FORMAT_MESSAGE,
  verifySignInCode,
} from "@/lib/auth/magic-link"
import {
  CAPTCHA_RETRY_MESSAGE,
  CAPTCHA_UNAVAILABLE_MESSAGE,
  getLoginCaptchaConfig,
  normaliseCaptchaToken,
} from "@/lib/auth/captcha"
import {
  RETURN_TO_COOKIE,
  returnToCookieOptions,
  safeReturnPath,
} from "@/lib/auth/routes"
import { getSiteUrl } from "@/lib/supabase/env"
import { createClient } from "@/lib/supabase/server"

/**
 * Sends a sign-in link. The result is the same for known and unknown emails;
 * only invalid input or a failed CAPTCHA returns an actionable error.
 * `rawReturnTo` is the page to come back to: kept for whichever way this
 * browser finishes signing in (link, code), or forgotten when it is absent or
 * unsafe, so a plain sign-in lands on the role's home.
 */
export async function requestSignInLink(
  rawEmail: string,
  rawCaptchaToken?: string,
  rawReturnTo?: string
): Promise<{ error?: string }> {
  const email = normaliseEmail(rawEmail)
  if (!email) {
    return { error: "Enter a full email address, like name@example.com." }
  }

  const captcha = getLoginCaptchaConfig()
  const captchaToken = normaliseCaptchaToken(rawCaptchaToken)
  if (captcha.enabled && !captcha.siteKey) {
    return { error: CAPTCHA_UNAVAILABLE_MESSAGE }
  }
  if (captcha.enabled && !captchaToken) {
    return { error: CAPTCHA_RETRY_MESSAGE }
  }

  const store = await cookies()
  const returnTo = safeReturnPath(rawReturnTo)
  if (returnTo) store.set(RETURN_TO_COOKIE, returnTo, returnToCookieOptions())
  else store.delete(RETURN_TO_COOKIE)

  const supabase = await createClient()
  const result = await sendSignInLink(
    supabase,
    email,
    `${getSiteUrl()}/auth/callback`,
    captcha.enabled ? captchaToken! : undefined
  )
  if (result.status === "captcha_failed") {
    return { error: CAPTCHA_RETRY_MESSAGE }
  }
  return {}
}

/**
 * Signs in with the code from the sign-in email. Wrong, used and expired codes
 * and unknown emails get the same answer. Returns `ok` rather than calling
 * redirect(), which the caller's try/catch would swallow; the client then loads
 * "/" so role routing runs with the new session cookies.
 */
export async function verifySignInCodeAction(
  rawEmail: string,
  rawCode: string
): Promise<{ error?: string; ok?: true }> {
  const email = normaliseEmail(rawEmail)
  if (!email) {
    return { error: "Enter a full email address, like name@example.com." }
  }
  const code = normaliseSignInCode(rawCode)
  if (!code) return { error: SIGN_IN_CODE_FORMAT_MESSAGE }

  const result = await verifySignInCode(await createClient(), email, code)
  const error = signInCodeError(result)
  return error ? { error } : { ok: true }
}
