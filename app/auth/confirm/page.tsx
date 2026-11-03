import type { Metadata } from "next"
import { redirect } from "next/navigation"

import {
  SIGN_IN_CARD,
  SIGN_IN_TEXT,
  SIGN_IN_TITLE,
  SignInPage,
  SignInWordmark,
} from "@/app/login/sign-in-frame"
import { ConfirmSignInButton } from "@/components/nabalens/login-card"
import { parseEmailLink } from "@/lib/auth/email-link"

export const metadata: Metadata = {
  title: "Continue to Naba-Lens",
  robots: { index: false, follow: false },
  // The token hash is in this page's URL; never send it to another site in a
  // Referer. ("no-referrer" would also make the Continue POST send Origin: null.)
  referrer: "same-origin",
}

/**
 * Landing page for magic-link and invitation emails
 * (/auth/confirm?token_hash=...&type=email|invite, supabase/templates/*.html).
 *
 * Opening the link does NOT use the token: corporate mail scanners prefetch
 * links with GET, and a one-time token spent by a scanner would reach the person
 * as "link expired". The person presses Continue, which POSTs the token to
 * /auth/confirm/verify. Works in any browser and without JavaScript.
 *
 * The form, its hidden fields and the h1 stay literal elements in this server
 * tree: tests/integration/auth-confirm.ts reads them without rendering.
 */
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const link = parseEmailLink(params.token_hash, params.type)
  if (!link) redirect("/login?error=link_invalid")

  const invite = link.type === "invite"

  return (
    <SignInPage>
      <form
        action="/auth/confirm/verify"
        method="post"
        aria-labelledby="confirm-title"
        className={SIGN_IN_CARD}
      >
        <SignInWordmark />
        <div className="grid gap-1">
          <h1 id="confirm-title" className={SIGN_IN_TITLE}>
            {invite ? "Accept your invitation" : "Continue signing in"}
          </h1>
          <p className={SIGN_IN_TEXT}>
            {invite
              ? "An admin at Lapen Inns invited you to Naba-Lens, where staff keep the photos they take at work."
              : "You're signing in to Naba-Lens."}
          </p>
        </div>
        <input type="hidden" name="token_hash" value={link.tokenHash} />
        <input type="hidden" name="type" value={link.type} />
        <ConfirmSignInButton invite={invite} />
      </form>
    </SignInPage>
  )
}
