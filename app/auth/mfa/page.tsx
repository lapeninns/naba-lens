import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { SignOutButton } from "@/app/auth/sign-out-button"
import { SIGN_IN_FOOTNOTE, SignInPage } from "@/app/login/sign-in-frame"
import { LinkButton } from "@/components/ui/link-button"
import { getAuthState, homePathFor, ROUTES } from "@/lib/auth"
import { mayEnrolMfa, readVerifiedFactors } from "@/lib/auth/mfa"
import { createClient } from "@/lib/supabase/server"

import { MfaCard } from "./mfa-card"

export const metadata: Metadata = {
  title: "Two-step sign-in",
  robots: { index: false, follow: false },
}

/**
 * Second sign-in step (FA-23, spec §3.2). An admin always comes here after
 * signing in (set up once, then a code each session); anyone with a factor
 * enters its code. A manager or admin turns it on with `?setup=1`.
 */
export default async function MfaPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const state = await getAuthState()
  if (state.status === "signed_out") redirect(ROUTES.login)
  if (state.status === "no_profile" || state.status === "inactive")
    redirect(ROUTES.blocked)

  let mode: "enrol" | "verify"
  let required = true
  if (state.status === "mfa_required") {
    mode = state.requirement
  } else {
    // Active: only an opt-in set-up by an account without a factor.
    const home = homePathFor(state.profile.role)
    if (params.setup !== "1" || !mayEnrolMfa(state.profile.role)) redirect(home)
    if ((await readVerifiedFactors(await createClient())) > 0) redirect(home)
    mode = "enrol"
    required = false
  }

  return (
    <SignInPage>
      <MfaCard mode={mode} required={required} />
      {required ? (
        <>
          {/* No recovery codes exist, so the screen says who can reset it. */}
          <p className={SIGN_IN_FOOTNOTE}>
            Lost your phone? Ask an admin to reset your two-step sign-in.
          </p>
          <SignOutButton className="grid" variant="secondary" />
        </>
      ) : (
        <LinkButton href={homePathFor(state.profile.role)}>Not now</LinkButton>
      )}
    </SignInPage>
  )
}
