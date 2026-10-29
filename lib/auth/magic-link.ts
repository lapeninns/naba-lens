import type { SupabaseClient } from "@supabase/supabase-js"

// Deliberately simple: the auth server is the real validator.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normaliseEmail(input: unknown): string | null {
  if (typeof input !== "string") return null
  const email = input.trim().toLowerCase()
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) return null
  return email
}

export type SignInLinkResult = { status: "sent" }

/**
 * Requests a magic link without ever creating an account. The result is the same
 * for invited, uninvited and rate-limited addresses so the login form cannot be
 * used to discover who has an account. Failures are logged by code only.
 */
export async function sendSignInLink(
  supabase: SupabaseClient,
  email: string,
  emailRedirectTo: string
): Promise<SignInLinkResult> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo },
  })

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
