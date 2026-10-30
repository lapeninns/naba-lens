import type { EmailOtpType } from "@supabase/supabase-js"

/** Link types the NabaLens templates send (supabase/templates/*.html). */
export const EMAIL_LINK_TYPES = ["email", "magiclink", "invite"] as const

export type EmailLinkType = (typeof EMAIL_LINK_TYPES)[number] & EmailOtpType

export type EmailLink = { tokenHash: string; type: EmailLinkType }

// GoTrue token hashes are hex digests (optionally `pkce_`-prefixed); stay lenient
// on format and let the auth server decide validity.
const TOKEN_HASH = /^[A-Za-z0-9_-]{8,256}$/

/** Parses the token_hash/type pair from an email link or the confirm form. */
export function parseEmailLink(
  tokenHash: unknown,
  type: unknown
): EmailLink | null {
  if (typeof tokenHash !== "string" || !TOKEN_HASH.test(tokenHash)) return null
  if (!EMAIL_LINK_TYPES.includes(type as EmailLinkType)) return null
  return { tokenHash, type: type as EmailLinkType }
}
