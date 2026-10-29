"use server"

import { normaliseEmail, sendSignInLink } from "@/lib/auth/magic-link"
import { getSiteUrl } from "@/lib/supabase/env"
import { createClient } from "@/lib/supabase/server"

/**
 * Sends a sign-in link. The result is the same for known and unknown emails;
 * only an unparseable address returns an error.
 */
export async function requestSignInLink(
  rawEmail: string
): Promise<{ error?: string }> {
  const email = normaliseEmail(rawEmail)
  if (!email) {
    return { error: "Enter the email address your invitation was sent to." }
  }

  const supabase = await createClient()
  await sendSignInLink(supabase, email, `${getSiteUrl()}/auth/callback`)
  return {}
}
