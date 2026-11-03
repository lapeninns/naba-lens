"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { useMediaUploader } from "@/app/_media/use-media-uploader"
import { UploadDialog } from "@/components/nabalens"
import type { UploadBusy } from "@/components/nabalens/upload-dialog"
import {
  SessionGuardProvider,
  type SessionGuard,
} from "@/components/nabalens/session-guard"
import { AddProvider } from "@/components/nabalens/shell/add-context"
import { LeaveGuard } from "@/components/nabalens/shell/leave-guard"
import {
  AddSheet,
  type AddBlocked,
} from "@/components/nabalens/shell/add-sheet"
import { CAPTCHA_RETRY_MESSAGE } from "@/lib/auth/captcha"
import { sendSignInLink } from "@/lib/auth/magic-link"
import { MEDIA_LIMITS } from "@/lib/config/media"
import { createClient } from "@/lib/supabase/browser"
import { getSiteUrl } from "@/lib/supabase/env"

/**
 * Hosts Add, the session guard every upload on the page uses, and the leave
 * guard, for every staff page. The Add queue keeps uploading when closed, and
 * while it has unfinished files Add reopens it. Otherwise phones get the Add
 * sheet first; from md the upload dialog opens straight away. A blocked
 * account sees why instead. The database repeats the block check, so this is
 * display only.
 */
export function AddHost({
  blocked,
  email,
  captchaRequired,
  captchaSiteKey,
  children,
}: {
  blocked: AddBlocked | null
  email: string | null
  captchaRequired: boolean
  captchaSiteKey: string | null
  children: React.ReactNode
}) {
  const router = useRouter()
  const uploader = useMediaUploader()
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [uploadOpen, setUploadOpen] = React.useState(false)
  const [picked, setPicked] = React.useState<File[] | undefined>(undefined)

  const guard = React.useMemo<SessionGuard>(() => {
    const supabase = createClient()
    return {
      email,
      captchaRequired,
      captchaSiteKey,
      // The same request the login page makes (never creates an account), sent
      // from the browser: while signed out, a Server Action posted from a staff
      // page is redirected to /login by the proxy.
      sendLink: async (to, captchaToken) => {
        const result = await sendSignInLink(
          supabase,
          to,
          `${getSiteUrl()}/auth/callback`,
          captchaToken
        )
        return result.status === "captcha_failed"
          ? { error: CAPTCHA_RETRY_MESSAGE }
          : {}
      },
      // Reads the session from this browser's auth cookies (refreshing it if
      // needed); the server still re-authorises every upload step.
      isSignedIn: async () => {
        if (navigator.onLine === false) return true
        const { data, error } = await supabase.auth.getSession()
        if (data.session) return true
        return error?.name === "AuthRetryableFetchError"
      },
    }
  }, [email, captchaRequired, captchaSiteKey])

  const [busy, setBusy] = React.useState<UploadBusy>({
    active: 0,
    failed: 0,
    stopped: 0,
  })
  const unfinished = busy.active + busy.failed + busy.stopped
  const busyWords = [
    busy.active ? `${busy.active} in progress` : null,
    busy.failed ? `${busy.failed} failed` : null,
    busy.stopped ? `${busy.stopped} stopped` : null,
  ]
    .filter(Boolean)
    .join(", ")

  const value = React.useMemo(
    () => ({
      openAdd: () => {
        const phone = !window.matchMedia("(min-width: 48rem)").matches
        // Unfinished files: Add shows that queue at every width, so a hidden
        // run (or a file that failed while hidden) is never out of reach.
        if (unfinished > 0) setUploadOpen(true)
        else if (blocked || phone) setSheetOpen(true)
        else {
          setPicked(undefined)
          setUploadOpen(true)
        }
      },
      busy: unfinished > 0 ? { count: unfinished, words: busyWords } : null,
    }),
    [blocked, unfinished, busyWords]
  )

  return (
    <SessionGuardProvider value={guard}>
      <LeaveGuard>
        <AddProvider value={value}>
          {children}
          <AddSheet
            open={sheetOpen}
            onOpenChange={setSheetOpen}
            blocked={blocked}
            onFiles={(files) => {
              setSheetOpen(false)
              setPicked(files)
              setUploadOpen(true)
            }}
          />
          <UploadDialog
            open={uploadOpen}
            onOpenChange={setUploadOpen}
            uploader={uploader}
            limits={MEDIA_LIMITS}
            initialFiles={picked}
            onUploaded={() => router.refresh()}
            keepRunningWhenClosed
            onBusyChange={setBusy}
          />
        </AddProvider>
      </LeaveGuard>
    </SessionGuardProvider>
  )
}
