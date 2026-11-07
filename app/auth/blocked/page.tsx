import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { LockSimpleIcon } from "@phosphor-icons/react/dist/ssr"

import { SignOutButton } from "@/app/auth/sign-out-button"
import {
  SignInCard,
  SignInHeading,
  SignInPage,
} from "@/app/login/sign-in-frame"
import { IconDisc } from "@/components/nabalens/common-room/icon-disc"
import { getAuthState, homePathFor, ROUTES } from "@/lib/auth"

export const metadata: Metadata = {
  title: "Account unavailable · Naba-Lens",
}

/** Shown to a signed-in account without an active Naba-Lens profile. */
export default async function BlockedPage() {
  const state = await getAuthState()
  if (state.status === "signed_out") redirect(ROUTES.login)
  if (state.status === "active") redirect(homePathFor(state.profile.role))

  return (
    <SignInPage>
      <SignInCard aria-labelledby="blocked-title">
        <IconDisc>
          <LockSimpleIcon />
        </IconDisc>
        <SignInHeading id="blocked-title" title="Account unavailable">
          {state.status === "inactive"
            ? "This account has been deactivated, so it can't open Naba-Lens. Your photos stay in the library. If that's a mistake, ask an admin."
            : "This email isn't linked to an active Naba-Lens account yet. Ask an admin to check your invitation."}
        </SignInHeading>
        {/* A grid form stretches the button to the card's width. */}
        <SignOutButton className="grid" />
      </SignInCard>
    </SignInPage>
  )
}
