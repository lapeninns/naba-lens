import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { LoginForm } from "@/app/login/login-form"
import { getAuthState, homePathFor, ROUTES } from "@/lib/auth"

export const metadata: Metadata = {
  title: "Sign in · NabaLens",
}

const NOTICES: Record<string, { tone: "error" | "info"; text: string }> = {
  link_invalid: {
    tone: "error",
    text: "That sign-in link has expired or was already used. Enter your email to get a new one.",
  },
  signed_out: { tone: "info", text: "You have signed out." },
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const state = await getAuthState()
  if (state.status === "active") redirect(homePathFor(state.profile.role))
  if (state.status === "inactive" || state.status === "no_profile")
    redirect(ROUTES.blocked)

  const params = await searchParams
  const key =
    typeof params.error === "string"
      ? params.error
      : params.signed_out
        ? "signed_out"
        : null
  const notice = key ? NOTICES[key] : undefined

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-semibold">NabaLens</h1>
          <p className="text-sm text-muted-foreground">
            Sign in with the email address your manager invited.
          </p>
        </div>
        {notice ? (
          <p
            role={notice.tone === "error" ? "alert" : "status"}
            className={
              notice.tone === "error"
                ? "rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                : "rounded-lg border bg-muted p-3 text-sm"
            }
          >
            {notice.text}
          </p>
        ) : null}
        <LoginForm />
      </div>
    </main>
  )
}
