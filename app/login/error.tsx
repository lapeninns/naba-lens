"use client"

import { SignInError } from "@/app/login/sign-in-error"

/**
 * /login could not render (chiefly the profile read that sends a signed-in
 * visitor on). The shared sign-in boundary, with Retry.
 */
export default function LoginError({ retry }: { retry: () => void }) {
  return <SignInError retry={retry} />
}
