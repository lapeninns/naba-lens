"use client"

import { ArrowClockwiseIcon, WarningIcon } from "@phosphor-icons/react"

import {
  SignInCard,
  SignInHeading,
  SignInPage,
} from "@/app/login/sign-in-frame"
import { IconDisc } from "@/components/nabalens/common-room/icon-disc"
import { Button } from "@/components/ui/button"

/**
 * /login could not render (chiefly the profile read that sends a signed-in
 * visitor on). Keeps the sign-in frame; `retry` renders the page again, which
 * checks the session again.
 */
export default function LoginError({ retry }: { retry: () => void }) {
  return (
    <SignInPage>
      <SignInCard aria-labelledby="login-error-title">
        <IconDisc tone="warn">
          <WarningIcon />
        </IconDisc>
        <SignInHeading id="login-error-title" title="Sign-in couldn't load">
          Check your connection and try again. Nothing was sent.
        </SignInHeading>
        <Button size="touch" className="w-full" onClick={() => retry()}>
          <ArrowClockwiseIcon data-icon="inline-start" aria-hidden />
          Try again
        </Button>
      </SignInCard>
    </SignInPage>
  )
}
