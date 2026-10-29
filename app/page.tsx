import { redirect } from "next/navigation"

import { getAuthState, homePathFor, ROUTES } from "@/lib/auth"

/** Role redirect: staff to their portfolio, admins to the library. */
export default async function RootPage() {
  const state = await getAuthState()
  switch (state.status) {
    case "signed_out":
      redirect(ROUTES.login)
    case "no_profile":
    case "inactive":
      redirect(ROUTES.blocked)
    case "active":
      redirect(homePathFor(state.profile.role))
  }
}
