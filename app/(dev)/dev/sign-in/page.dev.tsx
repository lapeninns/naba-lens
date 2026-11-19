import type { Metadata } from "next"
import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"

import {
  SIGN_IN_CARD,
  SIGN_IN_TEXT,
  SignInHeading,
  SignInPage,
} from "@/app/login/sign-in-frame"
import { Button } from "@/components/ui/button"
import { canUseFixtureSignIn } from "@/lib/dev/phone-origin.mjs"
import { isSameOriginRequest } from "@/lib/server/http/same-origin"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"
export const metadata: Metadata = {
  title: "Fixture sign-in",
  robots: { index: false, follow: false },
}

const path = "/dev/sign-in"

// Match both identifiers from supabase/seed.sql. The form can never choose a
// different local account, even if it uses the same email domain or label.
const fixtures = new Map([
  ["00000000-0000-4000-8000-0000000000a1", "dev-admin@nabalens.test"],
  ["00000000-0000-4000-8000-0000000000b1", "dev-staff-a@nabalens.test"],
  ["00000000-0000-4000-8000-0000000000b2", "dev-staff-b@nabalens.test"],
  ["00000000-0000-4000-8000-0000000000b3", "dev-staff-inactive@nabalens.test"],
  ["00000000-0000-4000-8000-0000000000b4", "dev-manager-a@nabalens.test"],
])

function requireFixtureSignIn() {
  if (
    !canUseFixtureSignIn(
      process.env.NODE_ENV,
      process.env.NEXT_PUBLIC_SUPABASE_URL
    )
  ) {
    notFound()
  }
}

async function signIn(form: FormData) {
  "use server"

  requireFixtureSignIn()
  if (!isSameOriginRequest(await headers())) notFound()

  const id = form.get("fixture")
  const email = typeof id === "string" ? fixtures.get(id) : undefined
  if (typeof id !== "string" || !email) notFound()

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from("profiles")
    .select("active")
    .eq("id", id)
    .maybeSingle()
  if (!profile?.active) notFound()

  const { data: account } = await admin.auth.admin.getUserById(id)
  if (account?.user?.email !== email) notFound()

  const link = await admin.auth.admin.generateLink({ type: "magiclink", email })
  if (link.error || link.data.user.id !== id) redirect(`${path}?error=1`)

  const supabase = await createClient()
  const { data, error } = await supabase.auth.verifyOtp({
    type: "email",
    token_hash: link.data.properties.hashed_token,
  })
  if (error || !data.session) redirect(`${path}?error=1`)
  redirect("/")
}

export default async function FixtureSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  requireFixtureSignIn()

  const { data, error } = await createAdminClient()
    .from("profiles")
    .select("id, display_name, active")
    .in("id", [...fixtures.keys()])
    .order("display_name")
  const failed = (await searchParams).error === "1"

  // DESIGN.md §4. Reuse the signed-out card and its 52px button targets.
  return (
    <SignInPage>
      <form
        action={signIn}
        className={SIGN_IN_CARD}
        aria-labelledby="fixture-title"
      >
        <SignInHeading id="fixture-title" title="Fixture sign-in" />
        {error || failed ? (
          <p role="alert" className={SIGN_IN_TEXT}>
            Fixture sign-in failed. Check your local stack and try again.
          </p>
        ) : null}
        {data?.length === 0 ? (
          <p className={SIGN_IN_TEXT}>
            Reset your owned stack to load the fixtures.
          </p>
        ) : null}
        <div className="grid gap-2">
          {data?.map((profile) => (
            <Button
              key={profile.id}
              type="submit"
              name="fixture"
              value={profile.id}
              disabled={!profile.active}
            >
              {profile.display_name}
              {profile.active ? null : " (inactive)"}
            </Button>
          ))}
        </div>
      </form>
    </SignInPage>
  )
}
