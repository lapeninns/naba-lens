"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { LabelEditorHost } from "@/app/_labels/label-editor-host"
import { useMediaUploader } from "@/app/_media/use-media-uploader"
import { UploadDialog } from "@/components/nabalens"
import type { UploadBusy } from "@/components/nabalens/upload-dialog"
import {
  SessionGuardProvider,
  type SessionGuard,
} from "@/components/nabalens/session-guard"
import { usePhotoSource } from "@/components/nabalens/photo-source"
import {
  AddProvider,
  type AddLabelPreset,
  type AddReadyListener,
  type OpenAddOptions,
} from "@/components/nabalens/shell/add-context"
import { LeaveGuard } from "@/components/nabalens/shell/leave-guard"
import {
  AddSheet,
  type AddBlocked,
} from "@/components/nabalens/shell/add-sheet"
import { CAPTCHA_RETRY_MESSAGE } from "@/lib/auth/captcha"
import { sendSignInLink, signInWithCode } from "@/lib/auth/magic-link"
import { MEDIA_LIMITS } from "@/lib/config/media"
import { createClient } from "@/lib/supabase/browser"
import { getSiteUrl } from "@/lib/supabase/env"

/** What one Add call brings for the files it picks. */
type PickOwner = {
  onReady: ((assetIds: string[]) => boolean | void) | null
  preset: AddLabelPreset | null
}

function samePreset(a: AddLabelPreset | undefined, b: AddLabelPreset) {
  return !!a && a.itemId === b.itemId && a.variantId === b.variantId
}

/**
 * Hosts Add, the session guard every upload on the page uses, and the leave
 * guard, for every staff page. There is one upload queue for every staff
 * screen (Add, Home, welcome, Me and task screens): it keeps uploading when
 * closed, and while it has unfinished files, or files that finished out of
 * sight and are ready to label, Add reopens it. `openAdd({ source })` opens
 * that picker straight away; otherwise phones get the Add sheet first and from
 * md the upload dialog opens straight away. Finished files can be labelled
 * from the queue ("Label these files"). A blocked account sees why instead.
 * The database repeats the block check, so this is display only.
 */
export function AddHost({
  blocked,
  captchaRequired,
  captchaSiteKey,
  children,
}: {
  blocked: AddBlocked | null
  captchaRequired: boolean
  captchaSiteKey: string | null
  children: React.ReactNode
}) {
  const router = useRouter()
  const uploader = useMediaUploader()
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [uploadOpen, setUploadOpen] = React.useState(false)
  const [pickedFiles, setPickedFiles] = React.useState<File[] | undefined>(
    undefined
  )
  const [refreshSignal, setRefreshSignal] = React.useState(0)
  const [email, setEmail] = React.useState<string | null>(null)
  const [userId, setUserId] = React.useState<string | null>(null)
  const supabase = React.useMemo(() => createClient(), [])

  React.useEffect(() => {
    // Read the email in the browser and keep it through session expiry so an
    // interrupted upload can offer a sign-in link.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) return
      setEmail(session.user.email ?? null)
      // Keep the first identity: the queue belongs to it, even if another
      // account signs in later in this browser.
      setUserId((current) => current ?? session.user.id)
    })
    return () => data.subscription.unsubscribe()
  }, [supabase])

  const guard = React.useMemo<SessionGuard>(() => {
    return {
      email,
      userId,
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
      // Also from the browser, for the same reason as sendLink.
      verifyCode: (to, code) => signInWithCode(supabase, to, code),
      // Reads the session from this browser's auth cookies (refreshing it if
      // needed); the server still re-authorises every upload step.
      isSignedIn: async () => {
        if (navigator.onLine === false) return true
        const { data, error } = await supabase.auth.getSession()
        // A different account does not resume this person's queue.
        if (data.session) return !userId || data.session.user.id === userId
        return error?.name === "AuthRetryableFetchError"
      },
    }
  }, [email, userId, captchaRequired, captchaSiteKey, supabase])

  const [busy, setBusy] = React.useState<UploadBusy>({
    active: 0,
    failed: 0,
    stopped: 0,
  })
  // Per Add call: photos only for task screens, a suggested label from Our
  // menu, and who to tell once files are actually picked.
  const [imagesOnly, setImagesOnly] = React.useState(false)
  const onPicked = React.useRef<(() => void) | null>(null)
  // What an Add call brings for the files it picks (and only those): a task
  // screen's ready listener and Our menu's suggested label. Set by each
  // openAdd, given to the next picked files, kept per File until ready.
  const pendingOwner = React.useRef<PickOwner | null>(null)
  const fileOwners = React.useRef(new WeakMap<File, PickOwner>())
  const presetFor = React.useRef(new Map<string, AddLabelPreset>())
  const [labelPreset, setLabelPreset] = React.useState<{
    preset: AddLabelPreset
    assetIds: string[]
  } | null>(null)
  // Files that finished while the queue was hidden: Add reopens the settled
  // queue so they can be labelled ("Ready to label").
  const [readyToLabel, setReadyToLabel] = React.useState<string[]>([])
  const [labelIds, setLabelIds] = React.useState<string[] | null>(null)
  const uploadOpenRef = React.useRef(uploadOpen)
  React.useLayoutEffect(() => {
    uploadOpenRef.current = uploadOpen
  }, [uploadOpen])
  const readyListeners = React.useRef(new Set<AddReadyListener>())

  const unfinished = busy.active + busy.failed + busy.stopped
  const waiting = unfinished + readyToLabel.length
  const busyWords = [
    busy.active ? `${busy.active} in progress` : null,
    busy.failed ? `${busy.failed} failed` : null,
    busy.stopped ? `${busy.stopped} stopped` : null,
    readyToLabel.length ? `${readyToLabel.length} ready to label` : null,
  ]
    .filter(Boolean)
    .join(", ")

  const picked = React.useCallback((files: File[]) => {
    const notify = onPicked.current
    onPicked.current = null
    const owner = pendingOwner.current
    pendingOwner.current = null
    if (owner && (owner.onReady || owner.preset))
      for (const file of files) fileOwners.current.set(file, owner)
    if (files.length > 0) notify?.()
  }, [])

  /** Files from Add's own picker or the sheet go to the queue, shown. */
  const queueFiles = React.useCallback((files: File[]) => {
    setSheetOpen(false)
    setPickedFiles(files)
    setUploadOpen(true)
  }, [])

  // Add's own pickers, for openAdd({ source }). Outside any dialog, so a
  // click on them never lands on content a modal has made inert.
  const picker = usePhotoSource({ imagesOnly, onFiles: queueFiles })
  const openPicker = picker.open

  const onReady = React.useCallback((listener: AddReadyListener) => {
    readyListeners.current.add(listener)
    return () => {
      readyListeners.current.delete(listener)
    }
  }, [])

  const handleReady = React.useCallback((ids: string[], files?: File[]) => {
    // Each Add call hears only its own files; a task screen that takes them
    // claims them, so they are not "ready to label" on Add as well.
    const unclaimed: string[] = []
    const byOwner = new Map<PickOwner, string[]>()
    ids.forEach((id, i) => {
      const file = files?.[i]
      const owner = file ? fileOwners.current.get(file) : undefined
      if (owner?.preset) presetFor.current.set(id, owner.preset)
      if (owner?.onReady)
        byOwner.set(owner, [...(byOwner.get(owner) ?? []), id])
      else unclaimed.push(id)
    })
    for (const [owner, own] of byOwner) {
      if (owner.onReady?.(own) === false) unclaimed.push(...own)
    }
    if (!uploadOpenRef.current && unclaimed.length > 0) {
      setReadyToLabel((current) => [
        ...current,
        ...unclaimed.filter((id) => !current.includes(id)),
      ])
    }
    for (const listener of readyListeners.current) listener(ids)
  }, [])

  const labelled = React.useCallback((ids: string[]) => {
    setReadyToLabel((current) => {
      const next = current.filter((id) => !ids.includes(id))
      return next.length === current.length ? current : next
    })
  }, [])

  /** The editor for these files, with the suggestion only on files it came with. */
  const openLabels = React.useCallback((ids: string[]) => {
    const last = [...ids].reverse().find((id) => presetFor.current.has(id))
    const preset = last ? presetFor.current.get(last)! : null
    setLabelPreset(
      preset
        ? {
            preset,
            assetIds: ids.filter((id) =>
              samePreset(presetFor.current.get(id), preset)
            ),
          }
        : null
    )
    setLabelIds(ids)
  }, [])

  const value = React.useMemo(
    () => ({
      openAdd: (opts: OpenAddOptions = {}) => {
        // Waiting files (unfinished, or finished while hidden and not yet
        // labelled): Add shows that queue at every width, so a hidden run is
        // never out of reach. A source still opens its picker straight away.
        // A suggestion and a ready listener belong to the files this call
        // picks, never to the queue (see picked and handleReady).
        pendingOwner.current = {
          onReady: opts.onReady ?? null,
          preset: opts.preset ?? null,
        }
        onPicked.current = opts.onPicked ?? null
        const only = opts.imagesOnly ?? false
        setImagesOnly(only)
        if (opts.source && !blocked) {
          // Synchronous: the picker needs this click's user activation. The
          // accept list is set for this call before the click.
          openPicker(opts.source, { imagesOnly: only })
          return
        }
        const phone = !window.matchMedia("(min-width: 48rem)").matches
        if (waiting > 0 && !blocked) setUploadOpen(true)
        else if (blocked || (phone && !opts.dialog)) setSheetOpen(true)
        else {
          setPickedFiles(undefined)
          setUploadOpen(true)
        }
      },
      onReady,
      labelled,
      busy: waiting > 0 ? { count: waiting, words: busyWords } : null,
      refreshSignal,
    }),
    [blocked, waiting, busyWords, refreshSignal, onReady, labelled, openPicker]
  )

  const refreshAfterLabels = React.useCallback(() => {
    setRefreshSignal((signal) => signal + 1)
    router.refresh()
  }, [router])

  return (
    <SessionGuardProvider value={guard}>
      <LeaveGuard>
        <AddProvider value={value}>
          {children}
          {picker.inputs}
          <AddSheet
            open={sheetOpen}
            onOpenChange={setSheetOpen}
            blocked={blocked}
            maxFiles={MEDIA_LIMITS.maxBatchFiles}
            imagesOnly={imagesOnly}
            onFiles={queueFiles}
          />
          <UploadDialog
            open={uploadOpen}
            onOpenChange={(open) => {
              setUploadOpen(open)
              // Closed when settled: the queue was cleared (or its files are
              // being labelled), so nothing waits any more.
              if (!open && busy.active === 0) setReadyToLabel([])
            }}
            uploader={uploader}
            limits={MEDIA_LIMITS}
            imagesOnly={imagesOnly}
            initialFiles={pickedFiles}
            onPick={picked}
            onUploaded={() => {
              setRefreshSignal((signal) => signal + 1)
              router.refresh()
            }}
            onReady={handleReady}
            onLabel={(ids) => {
              setReadyToLabel([])
              openLabels(ids)
            }}
            keepRunningWhenClosed
            onBusyChange={setBusy}
          />
          <LabelEditorHost
            assetIds={labelIds ?? []}
            open={labelIds !== null}
            onOpenChange={(open) => {
              if (!open) {
                for (const id of labelIds ?? []) presetFor.current.delete(id)
                setLabelIds(null)
                setLabelPreset(null)
              }
            }}
            preset={labelPreset?.preset ?? null}
            presetAssetIds={labelPreset?.assetIds}
            onSaved={refreshAfterLabels}
          />
        </AddProvider>
      </LeaveGuard>
    </SessionGuardProvider>
  )
}
