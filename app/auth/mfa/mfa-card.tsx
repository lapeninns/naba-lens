"use client"

import * as React from "react"
import { ShieldCheckIcon } from "@phosphor-icons/react"

import { SignInCard, SignInHeading } from "@/app/login/sign-in-frame"
import { IconDisc } from "@/components/nabalens/common-room/icon-disc"
import { Notice } from "@/components/nabalens/notice"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import {
  confirmMfaCode,
  startMfaEnrolment,
  type CodeState,
  type EnrolmentResult,
} from "./actions"

type Enrolment = Extract<EnrolmentResult, { ok: true }>

/**
 * The second sign-in step (FA-23): set up an authenticator app, or enter its
 * code. One card on the sign-in canvas, one main button per state.
 */
export function MfaCard({
  mode,
  required,
}: {
  mode: "enrol" | "verify"
  /** False when a manager turns it on for themselves. */
  required: boolean
}) {
  const [enrolment, setEnrolment] = React.useState<Enrolment | null>(null)
  const [startError, setStartError] = React.useState<string | null>(null)
  const [starting, startTransition] = React.useTransition()

  const start = () =>
    startTransition(async () => {
      setStartError(null)
      const result = await startMfaEnrolment()
      if (result.ok) setEnrolment(result)
      else setStartError(result.error)
    })

  if (mode === "verify")
    return (
      <SignInCard aria-labelledby="mfa-title">
        <Heading title="Enter your sign-in code">
          Open your authenticator app and enter the 6-digit code for Naba-Lens.
        </Heading>
        <CodeForm submitLabel="Continue" />
      </SignInCard>
    )

  if (!enrolment)
    return (
      <SignInCard aria-labelledby="mfa-title">
        <Heading title="Set up two-step sign-in">
          {required
            ? "Admin accounts need a code from an authenticator app each time they sign in. Set it up once on your phone."
            : "Ask for a code from an authenticator app each time you sign in to this account."}
        </Heading>
        {startError ? <Notice tone="negative">{startError}</Notice> : null}
        <Button
          type="button"
          variant="primary"
          onClick={start}
          disabled={starting}
        >
          Set up with an authenticator app
        </Button>
      </SignInCard>
    )

  return (
    <SignInCard aria-labelledby="mfa-title">
      <Heading title="Scan this code">
        Scan it with your authenticator app, or enter the setup key by hand.
        Then enter the 6-digit code the app shows.
      </Heading>
      {/* Supabase Auth returns the QR code as an SVG data URL. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={enrolment.qrCode}
        alt="QR code for your authenticator app"
        width={176}
        height={176}
        className="size-44 justify-self-center rounded-control bg-surface p-2"
      />
      <p className="grid gap-1 text-meta text-ink-muted">
        Setup key
        <code
          data-testid="mfa-secret"
          className="font-mono text-body [overflow-wrap:anywhere] text-ink select-all"
        >
          {enrolment.secret}
        </code>
      </p>
      <CodeForm factorId={enrolment.factorId} submitLabel="Confirm code" />
    </SignInCard>
  )
}

function Heading({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-4">
      <IconDisc>
        <ShieldCheckIcon />
      </IconDisc>
      <SignInHeading id="mfa-title" title={title}>
        {children}
      </SignInHeading>
    </div>
  )
}

const INITIAL: CodeState = { error: null }

function CodeForm({
  factorId,
  submitLabel,
}: {
  factorId?: string
  submitLabel: string
}) {
  const [state, action, pending] = React.useActionState(confirmMfaCode, INITIAL)
  return (
    <form action={action} className="grid gap-5">
      {factorId ? (
        <input type="hidden" name="factorId" value={factorId} />
      ) : null}
      <FormField label="6-digit code" error={state.error} announce="assertive">
        <Input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          spellCheck={false}
        />
      </FormField>
      <Button type="submit" variant="primary" disabled={pending}>
        {submitLabel}
      </Button>
    </form>
  )
}
