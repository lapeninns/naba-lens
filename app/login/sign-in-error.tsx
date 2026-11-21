"use client"

import * as React from "react"
import { ArrowClockwiseIcon } from "@phosphor-icons/react"

import {
  SignInCard,
  SignInHeading,
  SignInPage,
} from "@/app/login/sign-in-frame"
import { Button } from "@/components/ui/button"

/**
 * The one error boundary for /login and /auth/* (handoff "Sign-in": "Sign-in
 * couldn't load", with Retry; decision 11). Keeps the sign-in frame; `retry`
 * renders the page again, which reads the session again. Focus moves to the
 * heading so a screen reader hears what failed.
 */
export function SignInError({ retry }: { retry: () => void }) {
  const heading = React.useRef<HTMLHeadingElement>(null)
  React.useEffect(() => heading.current?.focus(), [])
  return (
    <SignInPage>
      <SignInCard aria-labelledby="sign-in-error-title">
        <div role="alert">
          <SignInHeading
            id="sign-in-error-title"
            title="Sign-in couldn't load"
            headingRef={heading}
          >
            Check your connection, then retry. Nothing was sent.
          </SignInHeading>
        </div>
        <Button variant="primary" className="w-full" onClick={() => retry()}>
          <ArrowClockwiseIcon data-icon="inline-start" aria-hidden />
          Retry
        </Button>
      </SignInCard>
    </SignInPage>
  )
}
