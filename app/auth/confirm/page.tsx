import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { Button } from "@/components/ui/button"
import { parseEmailLink } from "@/lib/auth/email-link"

export const metadata: Metadata = {
  title: "Continue to NabaLens",
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
    <main className="flex min-h-svh items-center justify-center p-6">
      <form
        action="/auth/confirm/verify"
        method="post"
        className="flex w-full max-w-sm flex-col gap-4"
      >
        <h1 className="font-heading text-2xl font-semibold">
          {invite ? "Accept your invitation" : "Sign in to NabaLens"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {invite
            ? "Continue to activate your NabaLens account and sign in on this device."
            : "Continue to finish signing in on this device."}
        </p>
        <input type="hidden" name="token_hash" value={link.tokenHash} />
        <input type="hidden" name="type" value={link.type} />
        <Button type="submit" size="lg">
          Continue
        </Button>
      </form>
    </main>
  )
}
