"use client"

import * as React from "react"

import { LoginCard } from "@/components/nabalens"
import { clearAllDrafts } from "@/components/nabalens/amenities/capture/draft"
import { normaliseEmail, signInWithCode } from "@/lib/auth/magic-link"
import { createClient } from "@/lib/supabase/browser"

type LoginCardHostProps = Omit<
  React.ComponentProps<typeof LoginCard>,
  "onVerifyCode" | "onSubmit"
> & {
  onSubmit: (
    email: string,
    captchaToken?: string,
    returnTo?: string
  ) => Promise<{ error?: string } | void>
  /** The safe page to return to after sign-in (the login page checked it). */
  returnTo?: string | null
}

/**
 * The login card with the code checked from the browser, like the recovery
 * sheet: GoTrue then rate-limits code checks per person's own IP instead of
 * pooling every staff member's tries behind the server's address. The browser
 * client writes the session cookies; the card then loads "/", which returns
 * to `returnTo` (remembered by the link request) if the role allows it.
 *
 * Every sign-out (app shell, Me, the blocked page) lands here with
 * `signed_out`, so unsent amenity drafts on a shared device go with it.
 */
export function LoginCardHost({
  onSubmit,
  returnTo,
  ...props
}: LoginCardHostProps) {
  const supabase = React.useMemo(() => createClient(), [])
  const { signedOut } = props
  React.useEffect(() => {
    if (signedOut) clearAllDrafts()
  }, [signedOut])
  const verify = React.useCallback(
    async (rawEmail: string, code: string) => {
      const email = normaliseEmail(rawEmail)
      if (!email)
        return { error: "Enter a full email address, like name@example.com." }
      const result = await signInWithCode(supabase, email, code)
      return result.error ? { error: result.error } : { ok: true as const }
    },
    [supabase]
  )
  const submit = React.useCallback(
    (email: string, captchaToken?: string) =>
      onSubmit(email, captchaToken, returnTo ?? undefined),
    [onSubmit, returnTo]
  )
  return <LoginCard {...props} onSubmit={submit} onVerifyCode={verify} />
}
