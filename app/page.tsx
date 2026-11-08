import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { getAuthState, ROUTES } from "@/lib/auth"
import { RETURN_TO_COOKIE, returnPathFor } from "@/lib/auth/routes"

/**
 * Role redirect: staff to Home, managers to the workspace, admins to the
 * library, or to the page they asked for before signing in when it is in their
 * own area. Every sign-in (link, code, invitation) finishes here, after the
 * session is set; the proxy then clears the remembered page.
 */
export default async function RootPage() {
  const state = await getAuthState()
  switch (state.status) {
    case "signed_out":
      redirect(ROUTES.login)
    case "no_profile":
    case "inactive":
      redirect(ROUTES.blocked)
    case "active": {
      const remembered = (await cookies()).get(RETURN_TO_COOKIE)?.value
      redirect(returnPathFor(state.profile.role, remembered))
    }
  }
}
