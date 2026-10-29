import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { SignOutButton } from "@/app/auth/sign-out-button"
import { getAuthState, homePathFor, ROUTES } from "@/lib/auth"

export const metadata: Metadata = {
  title: "Account unavailable · NabaLens",
}

/** Shown to a signed-in account without an active NabaLens profile. */
export default async function BlockedPage() {
  const state = await getAuthState()
  if (state.status === "signed_out") redirect(ROUTES.login)
  if (state.status === "active") redirect(homePathFor(state.profile.role))

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col gap-4">
        <h1 className="font-heading text-2xl font-semibold">
          Account unavailable
        </h1>
        <p className="text-sm text-muted-foreground">
          {state.status === "inactive"
            ? "Your NabaLens account has been deactivated."
            : "This sign-in is not linked to an active NabaLens account."}{" "}
          Ask a NabaLens admin at your organisation if you think this is a
          mistake.
        </p>
        <SignOutButton />
      </div>
    </main>
  )
}
