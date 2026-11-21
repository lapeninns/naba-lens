"use client"

import { SignInError } from "@/app/login/sign-in-error"

/**
 * /auth/confirm, /auth/mfa or /auth/blocked could not render (the session or
 * factor read). The same boundary as /login, with Retry.
 */
export default function AuthError({ retry }: { retry: () => void }) {
  return <SignInError retry={retry} />
}
