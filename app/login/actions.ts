"use server"

import { normaliseEmail, sendSignInLink } from "@/lib/auth/magic-link"
import { getSiteUrl } from "@/lib/supabase/env"
import { createClient } from "@/lib/supabase/server"

export type LoginState =
  | { status: "idle" }
  | { status: "invalid"; email: string }
  | { status: "sent"; email: string }

export async function requestSignInLink(
  _previous: LoginState,
  formData: FormData
): Promise<LoginState> {
  const raw = formData.get("email")
  const email = normaliseEmail(raw)
  if (!email) {
    return { status: "invalid", email: typeof raw === "string" ? raw : "" }
  }

  const supabase = await createClient()
  await sendSignInLink(supabase, email, `${getSiteUrl()}/auth/callback`)
  return { status: "sent", email }
}
