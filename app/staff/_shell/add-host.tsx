"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { useMediaUploader } from "@/app/_media/use-media-uploader"
import { UploadDialog } from "@/components/nabalens"
import {
  FixLabelsDialog,
  UploadLabelPanel,
  type CatalogueProp,
} from "@/components/nabalens/labels"
import type { UploadBusy } from "@/components/nabalens/upload-dialog"
import type {
  UploadLabelFixProps,
  UploadLabelPanelHostProps,
  UploadLabels,
} from "@/components/nabalens/upload-label-drafts"
import type {
  QueueItem,
  Uploader,
  UploadPurpose,
} from "@/components/nabalens/upload-queue"
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
import { useObjectUrl } from "@/components/nabalens/use-upload-queue"
import { CAPTCHA_RETRY_MESSAGE } from "@/lib/auth/captcha"
import { sendSignInLink, signInWithCode } from "@/lib/auth/magic-link"
import { MEDIA_LIMITS } from "@/lib/config/media"
import type { WorkFocus } from "@/lib/config/work-roles"
import {
  EMPTY_LABEL_SUMMARY,
  type LabelCatalogue,
  type SaveLabelsInput,
} from "@/lib/menus/types"
import { createClient } from "@/lib/supabase/browser"
import { getSiteUrl } from "@/lib/supabase/env"

import {
  discardUploadLabels,
  loadLabelAttention,
  loadUploadLabelContext,
  saveUploadLabels,
  type UploadLabelContext,
} from "./upload-label-api"

/** What one Add call brings for the files it picks. */
type PickOwner = {
  onReady: ((assetIds: string[]) => boolean | void) | null
  preset: AddLabelPreset | null
  /** Fixed at reservation; "amenity" keeps the files out of the community. */
  purpose: UploadPurpose
}

function samePreset(a: AddLabelPreset | null | undefined, b: AddLabelPreset) {
  return !!a && a.itemId === b.itemId && a.variantId === b.variantId
}

/** The catalogue item for a preset, when this menu still offers it. */
function onMenu(catalogue: LabelCatalogue, preset: AddLabelPreset) {
  if (catalogue.status !== "active") return false
  return catalogue.sections.some((section) =>
    section.items.some(
      (item) =>
        item.itemId === preset.itemId &&
        (preset.variantId === null ||
          item.variants.some((v) => v.variantId === preset.variantId))
    )
  )
}

/**
 * Hosts Add, the session guard every upload on the page uses, and the leave
 * guard, for every staff page. There is one upload queue for every staff
 * screen (Add, Home, welcome, Me, Our menu and task screens): files start
 * uploading as soon as they are picked, in one "Saving N photos" sheet with
 * optional labels ("What's in these photos?"). It keeps uploading when
 * closed, and while files are unfinished or need the person, Add reopens it.
 * `openAdd({ source })` opens that picker straight away; otherwise phones get
 * the Add sheet first and from md the upload dialog opens straight away. A
 * blocked account sees why instead. The database repeats the block check, so
 * this is display only.
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
  // Per Add call: photos only for task screens, Our menu's dish, and who to
  // tell once files are actually picked.
  const [imagesOnly, setImagesOnly] = React.useState(false)
  const onPicked = React.useRef<(() => void) | null>(null)
  // What an Add call brings for the files it picks (and only those): a task
  // screen's ready listener and Our menu's dish. Set by each openAdd, given to
  // the next picked files, kept per File.
  const pendingOwner = React.useRef<PickOwner | null>(null)
  const fileOwners = React.useRef(new WeakMap<File, PickOwner>())
  // Queue files whose dish has been on their labels. Once removed it stays
  // removed: the label field mounts again whenever the sheet reopens.
  const dishShown = React.useRef(new Set<string>())
  const readyListeners = React.useRef(new Set<AddReadyListener>())

  const waiting =
    busy.active +
    busy.failed +
    busy.stopped +
    (busy.labels ?? 0) +
    (busy.attention ?? 0)
  const busyWords = [
    busy.active ? `${busy.active} in progress` : null,
    busy.failed ? `${busy.failed} failed` : null,
    busy.stopped ? `${busy.stopped} stopped` : null,
    busy.labels ? `${busy.labels} saving labels` : null,
    busy.attention ? `${busy.attention} need attention` : null,
  ]
    .filter(Boolean)
    .join(", ")

  // The labelling menu (catalogue), loaded once files are picked: the sheet's
  // label field, and Our menu's dish, which is applied as soon as it is known.
  const [labelContext, setLabelContext] =
    React.useState<UploadLabelContext | null>(null)
  const [catalogueWanted, setCatalogueWanted] = React.useState(false)
  const [catalogueAttempt, setCatalogueAttempt] = React.useState(0)
  React.useEffect(() => {
    if (!catalogueWanted) return
    const controller = new AbortController()
    void loadUploadLabelContext(controller.signal)
      .catch((): UploadLabelContext => ({
        ok: false,
        message: "The menu could not be loaded. Try again.",
      }))
      .then((result) => {
        if (!controller.signal.aborted) setLabelContext(result)
      })
    return () => controller.abort()
  }, [catalogueWanted, catalogueAttempt])
  const reloadCatalogue = React.useCallback(() => {
    setLabelContext(null)
    setCatalogueAttempt((attempt) => attempt + 1)
  }, [])
  const catalogueProp: CatalogueProp = !labelContext
    ? { state: "loading" }
    : labelContext.ok
      ? { state: "ready", catalogue: labelContext.catalogue }
      : { state: "error", message: labelContext.message }

  const picked = React.useCallback((files: File[]) => {
    const notify = onPicked.current
    onPicked.current = null
    const owner = pendingOwner.current
    pendingOwner.current = null
    if (owner && (owner.onReady || owner.preset || owner.purpose !== "general"))
      for (const file of files) fileOwners.current.set(file, owner)
    if (files.length > 0) {
      setCatalogueWanted(true)
      notify?.()
    }
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

  // Each file as soon as it is ready: its own Add call hears it (a task
  // screen selects it), then every subscriber.
  const handleReady = React.useCallback((ids: string[], files: File[]) => {
    ids.forEach((id, i) => {
      const owner = fileOwners.current.get(files[i])
      owner?.onReady?.([id])
    })
    for (const listener of readyListeners.current) listener(ids)
  }, [])

  const labelled = React.useCallback(() => {}, [])

  const value = React.useMemo(
    () => ({
      openAdd: (opts: OpenAddOptions = {}) => {
        // Waiting files (unfinished, or needing the person): Add shows that
        // queue at every width, so a hidden run is never out of reach. A
        // source still opens its picker straight away. A dish and a ready
        // listener belong to the files this call picks, never to the queue
        // (see picked and handleReady).
        pendingOwner.current = {
          onReady: opts.onReady ?? null,
          preset: opts.preset ?? null,
          purpose: opts.purpose ?? "general",
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

  // Resume keys belong to the signed-in account (audit finding 15).
  const accountRef = React.useRef(userId)
  React.useLayoutEffect(() => {
    accountRef.current = userId
  }, [userId])

  // One queue, files from several Add calls: each file is reserved with the
  // purpose of the call that picked it (general unless it said otherwise).
  const upload = React.useMemo<Uploader>(
    () => async (file, context) => {
      const purpose = fileOwners.current.get(file)?.purpose
      const account =
        accountRef.current ??
        (await supabase.auth
          .getSession()
          .then(({ data }) => data.session?.user.id ?? null)
          .catch(() => null))
      return uploader(file, {
        ...context,
        ...(purpose && purpose !== "general" ? { purpose } : {}),
        ...(account ? { account } : {}),
      })
    },
    [uploader, supabase]
  )

  const refreshAfterLabels = React.useCallback(() => {
    setRefreshSignal((signal) => signal + 1)
    router.refresh()
  }, [router])

  const catalogue = labelContext?.ok ? labelContext.catalogue : null
  const focus = labelContext?.ok ? labelContext.focus : null
  const labels = React.useMemo<UploadLabels>(
    () => ({
      // Task screens own their upload hand-off; amenity evidence is never
      // labelled.
      canLabel: (file) => {
        const owner = fileOwners.current.get(file)
        return !owner || (!owner.onReady && owner.purpose === "general")
      },
      // Our menu's dish is applied by default, once the menu is known.
      seed: (item) => {
        const preset = fileOwners.current.get(item.file)?.preset
        if (!preset) return null
        if (!catalogue) return undefined
        if (!onMenu(catalogue, preset)) return null
        return {
          venueId: catalogue.venueId,
          input: {
            assetId: item.id,
            expectedRevision: 0,
            catalogueVersionId:
              catalogue.status === "active" ? catalogue.versionId : null,
            contentTypes: [],
            note: null,
            items: [{ itemId: preset.itemId, variantId: preset.variantId }],
            missingItem: null,
          },
        }
      },
      save: saveUploadLabels,
      discard: discardUploadLabels,
      attention: loadLabelAttention,
      itemNames: (input) =>
        input.items.flatMap((ref) => {
          if (catalogue?.status !== "active") return []
          for (const section of catalogue.sections)
            for (const item of section.items)
              if (item.itemId === ref.itemId) {
                const variant = item.variants.find(
                  (v) => v.variantId === ref.variantId
                )
                return [variant ? `${item.name} (${variant.name})` : item.name]
              }
          return []
        }),
      onSaved: refreshAfterLabels,
      renderPanel: (props) => (
        <PanelHost
          {...props}
          catalogue={catalogueProp}
          venueId={catalogue?.venueId ?? null}
          focus={focus}
          onRetryCatalogue={reloadCatalogue}
          presetOf={(file) => fileOwners.current.get(file)?.preset ?? null}
          dishShown={(id) => dishShown.current.has(id)}
          onDishShown={(id) => dishShown.current.add(id)}
        />
      ),
      renderFix: (props) => (
        <FixHost
          {...props}
          catalogue={catalogueProp}
          focus={focus}
          onRetryCatalogue={reloadCatalogue}
        />
      ),
    }),
    // catalogueProp is derived from labelContext.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalogue, focus, labelContext, refreshAfterLabels, reloadCatalogue]
  )

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
            onOpenChange={setUploadOpen}
            uploader={upload}
            limits={MEDIA_LIMITS}
            imagesOnly={imagesOnly}
            initialFiles={pickedFiles}
            onPick={picked}
            onUploaded={() => {
              setRefreshSignal((signal) => signal + 1)
              router.refresh()
            }}
            onReady={handleReady}
            labels={labels}
            startOnPick
            keepRunningWhenClosed
            onBusyChange={setBusy}
          />
        </AddProvider>
      </LeaveGuard>
    </SessionGuardProvider>
  )
}

const hasDish = (input: SaveLabelsInput, preset: AddLabelPreset) =>
  input.items.some((ref) => ref.itemId === preset.itemId)

/**
 * The sheet's label field for the files that can carry labels. Our menu's
 * dish goes on its files once: `initial` already holding it wins (the panel
 * restores it as it is), and a file whose dish the person removed never gets
 * it back when the field mounts again.
 */
function PanelHost({
  items,
  initial,
  disabledIds,
  onChange,
  onPendingChange,
  catalogue,
  venueId,
  focus,
  onRetryCatalogue,
  presetOf,
  dishShown,
  onDishShown,
}: UploadLabelPanelHostProps & {
  catalogue: CatalogueProp
  venueId: string | null
  focus: WorkFocus | null
  onRetryCatalogue: () => void
  presetOf: (file: File) => AddLabelPreset | null
  dishShown: (id: string) => boolean
  onDishShown: (id: string) => void
}) {
  // The dish of the latest files that came with one, on those files only.
  const last = [...items].reverse().find((item) => presetOf(item.file))
  const preset = last ? presetOf(last.file) : null
  const restored = (id: string) => initial.find((i) => i.assetId === id)
  const presetTarget = (item: (typeof items)[number]) => {
    if (!preset || !samePreset(presetOf(item.file), preset)) return false
    const now = restored(item.id)
    return !dishShown(item.id) || (!!now && hasDish(now, preset))
  }
  return (
    <UploadLabelPanel
      catalogue={catalogue}
      onRetryCatalogue={onRetryCatalogue}
      focus={focus}
      files={items.map((item) => ({
        id: item.id,
        name: item.file.name,
        kind: item.kind,
      }))}
      preset={preset}
      presetAssetIds={items.filter(presetTarget).map((item) => item.id)}
      initial={initial}
      disabledIds={disabledIds}
      onChange={(inputs) => {
        for (const input of inputs) {
          const item = items.find((i) => i.id === input.assetId)
          const dish = item ? presetOf(item.file) : null
          if (dish && hasDish(input, dish)) onDishShown(input.assetId)
        }
        if (venueId) onChange(venueId, inputs)
      }}
      onPendingChange={onPendingChange}
    />
  )
}

/** "Fix labels": the stored labels against the menu as it is now. */
function FixHost({
  item,
  assetId,
  draft,
  problem,
  onClose,
  onSave,
  catalogue,
  focus,
  onRetryCatalogue,
}: UploadLabelFixProps & {
  catalogue: CatalogueProp
  focus: WorkFocus | null
  onRetryCatalogue: () => void
}) {
  // The menu may have changed since the sheet loaded it: load it again.
  const reload = React.useRef(onRetryCatalogue)
  React.useEffect(() => reload.current(), [])
  const preview = useObjectUrl(item.kind === "image" ? item.file : null)
  const ready = catalogue.state === "ready" ? catalogue.catalogue : null
  return (
    <FixLabelsDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      asset={assetOf(item, assetId, ready, preview)}
      draft={draft}
      problem={problem}
      catalogue={catalogue}
      onRetryCatalogue={onRetryCatalogue}
      focus={focus}
      onSave={onSave}
    />
  )
}

function assetOf(
  item: QueueItem,
  assetId: string,
  catalogue: LabelCatalogue | null,
  preview: string | null
) {
  return {
    id: assetId,
    venueId: catalogue?.venueId ?? "",
    venueName: catalogue?.venueName ?? "",
    originalFilename: item.file.name,
    mediaType: item.kind,
    thumbnailUrl: preview,
    labels: EMPTY_LABEL_SUMMARY,
  }
}
