import type { Metadata } from "next"

import { SignInPage } from "@/app/login/sign-in-frame"
import { NotFoundCard } from "@/components/nabalens/not-found-card"

export const metadata: Metadata = {
  title: "Page not found · Naba-Lens",
}

/**
 * Any URL the app does not have, and notFound() outside a segment with its own
 * page. It knows nothing about the visitor: "/" routes by role, or to sign-in.
 */
export default function NotFound() {
  return (
    <SignInPage>
      <NotFoundCard backHref="/" backLabel="Go to Naba-Lens" />
    </SignInPage>
  )
}
