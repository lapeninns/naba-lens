"use server"

import { normaliseEmail, sendSignInLink } from "@/lib/auth/magic-link"
import {
  CAPTCHA_RETRY_MESSAGE,
  CAPTCHA_UNAVAILABLE_MESSAGE,
  getLoginCaptchaConfig,
  normaliseCaptchaToken,
} from "@/lib/auth/captcha"
import { getSiteUrl } from "@/lib/supabase/env"
import { createClient } from "@/lib/supabase/server"

/**
 * Sends a sign-in link. The result is the same for known and unknown emails;
 * only invalid input or a failed CAPTCHA returns an actionable error.
 */
export async function requestSignInLink(
  rawEmail: string,
  rawCaptchaToken?: string
): Promise<{ error?: string }> {
  const email = normaliseEmail(rawEmail)
  if (!email) {
    return { error: "Enter the email address your invitation was sent to." }
  }

  const captcha = getLoginCaptchaConfig()
  const captchaToken = normaliseCaptchaToken(rawCaptchaToken)
  if (captcha.enabled && !captcha.siteKey) {
    return { error: CAPTCHA_UNAVAILABLE_MESSAGE }
  }
  if (captcha.enabled && !captchaToken) {
    return { error: CAPTCHA_RETRY_MESSAGE }
  }

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
