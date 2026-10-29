"use client"

import { useActionState } from "react"

import { Button } from "@/components/ui/button"
import { requestSignInLink, type LoginState } from "@/app/login/actions"

const initialState: LoginState = { status: "idle" }

export function LoginForm() {
  const [state, formAction, pending] = useActionState(
    requestSignInLink,
    initialState
  )

  if (state.status === "sent") {
    return (
      <div role="status" className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-medium">Check your email</h2>
        <p className="text-sm text-muted-foreground">
          If <span className="font-medium text-foreground">{state.email}</span>{" "}
          has a NabaLens account, a sign-in link is on its way. The link works
          once and expires after a short time.
        </p>
        <form action={formAction}>
          <input type="hidden" name="email" value={state.email} />
          <Button type="submit" variant="outline" size="lg" disabled={pending}>
            {pending ? "Sending…" : "Send another link"}
          </Button>
        </form>
      </div>
    )
  }

  const invalid = state.status === "invalid"

  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <label htmlFor="email" className="text-sm font-medium">
        Work email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        defaultValue={invalid ? state.email : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? "email-error" : undefined}
        className="h-11 rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
      />
      {invalid ? (
        <p id="email-error" className="text-sm text-destructive">
          Enter a valid email address.
        </p>
      ) : null}
      <Button
        type="submit"
        size="lg"
        className="h-11 text-base"
        disabled={pending}
      >
        {pending ? "Sending…" : "Send sign-in link"}
      </Button>
    </form>
  )
}
