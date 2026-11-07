import type { SupabaseClient } from "@supabase/supabase-js"

// Deliberately simple: the auth server is the real validator.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normaliseEmail(input: unknown): string | null {
  if (typeof input !== "string") return null
  const email = input.trim().toLowerCase()
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) return null
  return email
}

export type SignInLinkResult = { status: "sent" | "captcha_failed" }

/**
 * Requests a magic link without ever creating an account. The result is the same
 * for invited, uninvited and rate-limited addresses so the login form cannot be
 * used to discover who has an account. Failures are logged by code only.
 */
export async function sendSignInLink(
  supabase: SupabaseClient,
  email: string,
  emailRedirectTo: string,
  captchaToken?: string
): Promise<SignInLinkResult> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo,
      ...(captchaToken ? { captchaToken } : {}),
    },
  })

  // This reveals challenge validity, never whether the email has an account.
  if (error?.code === "captcha_failed") return { status: "captcha_failed" }

  if (error && !isExpectedNeutralError(error)) {
    console.error("[auth] sign-in link request failed", {
      code: error.code ?? null,
      status: error.status ?? null,
    })
  }

  return { status: "sent" }
}

function isExpectedNeutralError(error: { code?: string; status?: number }) {
  // Unknown/uninvited address (sign-ups disabled) or per-address rate limiting.
  return (
    error.code === "otp_disabled" ||
    error.code === "signup_disabled" ||
    error.code === "user_not_found" ||
    error.status === 429
  )
}

// Supabase's email OTP is 6–10 digits depending on the project's otp_length.
const SIGN_IN_CODE = /^\d{6,10}$/

/**
 * The sign-in code as typed, pasted or autofilled: spaces, dashes and any other
 * non-digits are dropped. Null unless what is left could be a code.
 */
export function normaliseSignInCode(input: unknown): string | null {
  if (typeof input !== "string") return null
  const code = input.replace(/\D/g, "")
  return SIGN_IN_CODE.test(code) ? code : null
}

export const SIGN_IN_CODE_FORMAT_MESSAGE =
  "Enter the whole code from the sign-in email."
export const SIGN_IN_CODE_INVALID_MESSAGE =
  "That code didn't work. Check you used the newest email, or send a new code."
export const SIGN_IN_CODE_RATE_LIMITED_MESSAGE =
  "Too many tries. Wait a few minutes, then try again."
export const SIGN_IN_CODE_UNREACHABLE_MESSAGE =
  "We couldn't reach Naba-Lens. Check your connection and try again."

export type SignInCodeResult =
  | { status: "verified"; userId: string }
  | { status: "invalid" | "rate_limited" | "unreachable" }

/**
 * Signs in with the code from the sign-in email (Supabase's email OTP). Wrong,
 * expired, used and superseded codes, and emails without an account, all come
 * back as "invalid", so the check cannot be used to find out who has an
 * account. The code is never logged; failures are logged by code only.
 */
export async function verifySignInCode(
  supabase: SupabaseClient,
  email: string,
  code: string
): Promise<SignInCodeResult> {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: code,
    type: "email",
  })
  if (!error && data.session && data.user) {
    return { status: "verified", userId: data.user.id }
  }
  if (error?.status === 429) return { status: "rate_limited" }
  if (error?.name === "AuthRetryableFetchError") {
    return { status: "unreachable" }
  }
  if (error && error.code !== "otp_expired" && error.status !== 403) {
    console.error("[auth] sign-in code check failed", {
      code: error.code ?? null,
      status: error.status ?? null,
    })
  }
  return { status: "invalid" }
}

/** What to tell the person for a code that did not sign them in. */
export function signInCodeError(result: SignInCodeResult): string | undefined {
  switch (result.status) {
    case "verified":
      return undefined
    case "rate_limited":
      return SIGN_IN_CODE_RATE_LIMITED_MESSAGE
    case "unreachable":
      return SIGN_IN_CODE_UNREACHABLE_MESSAGE
    default:
      return SIGN_IN_CODE_INVALID_MESSAGE
  }
}

/**
 * The browser's own code check, for signing in again without leaving a staff
 * page (a Server Action posted while signed out is redirected to /login by the
 * proxy). Resolves the signed-in user's id so the caller can tell whether the
 * same person is back.
 */
export async function signInWithCode(
  supabase: SupabaseClient,
  email: string,
  rawCode: string
): Promise<{ error?: string; userId?: string }> {
  const code = normaliseSignInCode(rawCode)
  if (!code) return { error: SIGN_IN_CODE_FORMAT_MESSAGE }
  const result = await verifySignInCode(supabase, email, code)
  return result.status === "verified"
    ? { userId: result.userId }
    : { error: signInCodeError(result) }
}
