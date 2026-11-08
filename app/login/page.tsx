import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { requestSignInLink } from "@/app/login/actions"
import { LoginCardHost } from "@/app/login/login-card-host"
import { SignInPage } from "@/app/login/sign-in-frame"
import { getAuthState, ROUTES } from "@/lib/auth"
import { getLoginCaptchaConfig } from "@/lib/auth/captcha"
import {
  RETURN_TO_PARAM,
  returnPathFor,
  safeReturnPath,
} from "@/lib/auth/routes"

export const metadata: Metadata = {
  title: "Sign in · Naba-Lens",
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  // An unsafe ?next= is dropped here, never shown or followed.
  const returnTo = safeReturnPath(params[RETURN_TO_PARAM])
  const state = await getAuthState()
  if (state.status === "active")
    redirect(returnPathFor(state.profile.role, returnTo))
  if (state.status === "inactive" || state.status === "no_profile")
    redirect(ROUTES.blocked)

  const captcha = getLoginCaptchaConfig()

  return (
    <SignInPage>
      {/* The code is checked from the browser (see LoginCardHost). */}
      <LoginCardHost
        onSubmit={requestSignInLink}
        returnTo={returnTo}
        linkExpired={params.error === "link_invalid"}
        signedOut={!!params.signed_out}
        captchaRequired={captcha.enabled}
        captchaSiteKey={captcha.siteKey}
      />
    </SignInPage>
  )
}
