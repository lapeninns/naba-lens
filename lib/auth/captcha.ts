/** Turnstile is optional for isolated fixtures, required when configured. */
export function getLoginCaptchaConfig() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || null
  return {
    // The server marker also fails closed if a deployment omitted its public key.
    enabled: process.env.AUTH_CAPTCHA_ENABLED === "true" || siteKey !== null,
    siteKey,
  }
}

export function normaliseCaptchaToken(input: unknown): string | null {
  if (typeof input !== "string") return null
  const token = input.trim()
  return token.length > 0 && token.length <= 2048 ? token : null
}

export const CAPTCHA_RETRY_MESSAGE =
  "The verification expired or could not be completed. Please try the verification again."

export const CAPTCHA_UNAVAILABLE_MESSAGE =
  "Sign-in verification is unavailable. Please try again later."
