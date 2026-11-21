import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { SignOutButton } from "@/app/auth/sign-out-button"
import {
  SignInCard,
  SignInHeading,
  SignInPage,
} from "@/app/login/sign-in-frame"
import { Notice } from "@/components/nabalens/notice"
import { getAuthState, homePathFor, ROUTES } from "@/lib/auth"

export const metadata: Metadata = {
  title: "Account unavailable",
}

/** Shown to a signed-in account without an active Naba-Lens profile. */
export default async function BlockedPage() {
  const state = await getAuthState()
  if (state.status === "signed_out") redirect(ROUTES.login)
  if (state.status === "active") redirect(homePathFor(state.profile.role))
  if (state.status === "mfa_required") redirect(ROUTES.mfa)

  return (
    <SignInPage>
      <SignInCard aria-labelledby="blocked-title">
        <SignInHeading id="blocked-title" title="Account unavailable" />
        {/* What happened, what is kept and who can fix it (handoff). */}
        {state.status === "inactive" ? (
          <Notice tone="plain" title="This account has been deactivated">
            It can&apos;t open Naba-Lens. Your photos stay in the library. If
            that&apos;s a mistake, ask an admin.
          </Notice>
        ) : (
          <Notice tone="plain" title="This email has no Naba-Lens account yet">
            It isn&apos;t linked to an active account. Ask an admin to check
            your invitation.
          </Notice>
        )}
        {/* Sign out is the only action, so it is the screen's one bottle
            button; a grid form stretches it to the column's width. */}
        <SignOutButton className="grid" />
      </SignInCard>
    </SignInPage>
  )
}
