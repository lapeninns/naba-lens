"use client"

import * as React from "react"

import { LoginCard } from "@/components/nabalens"
import { normaliseEmail, signInWithCode } from "@/lib/auth/magic-link"
import { createClient } from "@/lib/supabase/browser"

type LoginCardHostProps = Omit<
  React.ComponentProps<typeof LoginCard>,
  "onVerifyCode"
>

/**
 * The login card with the code checked from the browser, like the recovery
 * sheet: GoTrue then rate-limits code checks per person's own IP instead of
 * pooling every staff member's tries behind the server's address. The browser
 * client writes the session cookies; the card then loads "/".
 */
export function LoginCardHost(props: LoginCardHostProps) {
  const supabase = React.useMemo(() => createClient(), [])
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
  return <LoginCard {...props} onVerifyCode={verify} />
}
