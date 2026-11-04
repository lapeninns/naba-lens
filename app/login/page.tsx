import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { requestSignInLink } from "@/app/login/actions"
import { SignInPage } from "@/app/login/sign-in-frame"
import { LoginCard } from "@/components/nabalens"
import { getAuthState, homePathFor, ROUTES } from "@/lib/auth"
import { getLoginCaptchaConfig } from "@/lib/auth/captcha"

export const metadata: Metadata = {
  title: "Sign in · Naba-Lens",
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const state = await getAuthState()
  if (state.status === "active") redirect(homePathFor(state.profile.role))
  if (state.status === "inactive" || state.status === "no_profile")
    redirect(ROUTES.blocked)

  const params = await searchParams
  const captcha = getLoginCaptchaConfig()

  return (
    <SignInPage>
      <LoginCard
        onSubmit={requestSignInLink}
        linkExpired={params.error === "link_invalid"}
        signedOut={!!params.signed_out}
        captchaRequired={captcha.enabled}
        captchaSiteKey={captcha.siteKey}
      />
    </SignInPage>
  )
}
