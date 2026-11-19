"use client"

import * as React from "react"

import { LoginCard } from "@/components/nabalens"
import { OptionRow } from "@/components/ui/option-row"
import { normaliseEmail, signInWithCode } from "@/lib/auth/magic-link"
import { createClient } from "@/lib/supabase/browser"

import {
  readDeviceMode,
  shouldWipeOnSignIn,
  subscribeDeviceMode,
  wipePrivateDeviceData,
  writeDeviceMode,
  type DeviceMode,
} from "./shared-device"

type LoginCardHostProps = Omit<
  React.ComponentProps<typeof LoginCard>,
  "onVerifyCode" | "onSubmit"
> & {
  onSubmit: (
    email: string,
    captchaToken?: string,
    returnTo?: string
  ) => Promise<{ error?: string } | void>
  /** The safe page to return to after sign-in (the login page checked it). */
  returnTo?: string | null
}

/**
 * The login card with the code checked from the browser, like the recovery
 * sheet: GoTrue then rate-limits code checks per person's own IP instead of
 * pooling every staff member's tries behind the server's address. The browser
 * client writes the session cookies; the card then loads "/", which returns
 * to `returnTo` (remembered by the link request) if the role allows it.
 *
 * Every sign-out (app shell, Me, the blocked page) lands here with
 * `signed_out`, so unsent amenity drafts, upload resume keys and the capture
 * journal go with it. On a device marked shared (the option under the card,
 * spec §3.2, AC36) any arrival here wipes, also after a session ended
 * without signing out (./shared-device.ts).
 */
export function LoginCardHost({
  onSubmit,
  returnTo,
  ...props
}: LoginCardHostProps) {
  const supabase = React.useMemo(() => createClient(), [])
  const { signedOut } = props
  // The device's choice; null on the server, which cannot know it.
  const mode = React.useSyncExternalStore<DeviceMode | null>(
    subscribeDeviceMode,
    () => readDeviceMode(),
    () => null
  )
  React.useEffect(() => {
    const current = readDeviceMode()
    if (!shouldWipeOnSignIn(current, !!signedOut)) return
    // J-1: upload resume keys and the capture journal (with any photo bytes)
    // go too; on a shared device also the tab's working copies.
    void wipePrivateDeviceData(current)
  }, [signedOut])
  const chooseMode = React.useCallback((shared: boolean) => {
    writeDeviceMode(shared ? "shared" : "personal")
  }, [])
  const verify = React.useCallback(
    async (rawEmail: string, code: string) => {
      const email = normaliseEmail(rawEmail)
      if (!email)
        return { error: "Enter a full email address, like name@example.com." }
      const result = await signInWithCode(supabase, email, code)
      return result.error ? { error: result.error } : { ok: true as const }
    },
    [supabase]
  )
  const submit = React.useCallback(
    (email: string, captchaToken?: string) =>
      onSubmit(email, captchaToken, returnTo ?? undefined),
    [onSubmit, returnTo]
  )
  return (
    <>
      <LoginCard {...props} onSubmit={submit} onVerifyCode={verify} />
      <OptionRow
        type="checkbox"
        label="This is a shared device"
        hint="Signing out, or a session ending, removes anything not yet sent from this device."
        checked={mode === "shared"}
        onCheckedChange={(checked) => chooseMode(checked === true)}
      />
    </>
  )
}
