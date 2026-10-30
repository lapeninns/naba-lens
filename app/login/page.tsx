import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { requestSignInLink } from "@/app/login/actions"
import { LoginCard } from "@/components/nabalens"
import { getAuthState, homePathFor, ROUTES } from "@/lib/auth"
import { getLoginCaptchaConfig } from "@/lib/auth/captcha"

export const metadata: Metadata = {
  title: "Sign in · NabaLens",
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
    <main className="flex min-h-svh items-center justify-center p-6">
      <LoginCard
        onSubmit={requestSignInLink}
        linkExpired={params.error === "link_invalid"}
        notice={params.signed_out ? "You have signed out." : null}
        captchaRequired={captcha.enabled}
        captchaSiteKey={captcha.siteKey}
      />
    </main>
  )
}
