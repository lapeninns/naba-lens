"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import {
  addToPhotoSet,
  readPhotoSet,
  replaceInPhotoSet,
  startPhotoSet,
} from "@/app/_media/actions"
import { useMediaUploader } from "@/app/_media/use-media-uploader"
import { UploadDialog } from "@/components/nabalens"
import {
  FixLabelsDialog,
  UploadLabelPanel,
  type CatalogueProp,
} from "@/components/nabalens/labels"
import type {
  PhotoSetRef,
  ReplaceState,
  SetReplace,
  UploadBusy,
} from "@/components/nabalens/upload-dialog"
import {
  sameLabelChoice,
  type UploadLabelFixProps,
  type UploadLabelPanelHostProps,
  type UploadLabels,
  type UploadLabelSettle,
} from "@/components/nabalens/upload-label-drafts"
import type {
  QueueItem,
  Uploader,
  UploadPurpose,
} from "@/components/nabalens/upload-queue"
import { SessionGuardProvider } from "@/components/nabalens/session-guard"
import { useBrowserSessionGuard } from "@/components/nabalens/session-guard-host"
import { usePhotoSource } from "@/components/nabalens/photo-source"
import {
  AddProvider,
  type AddLabelPreset,
  type AddReadyListener,
  type OpenAddOptions,
  type UnfinishedReason,
} from "@/components/nabalens/shell/add-context"
import { ENTRY_COPY } from "@/components/nabalens/shell/entry-copy"
import type { EntryStep } from "@/components/nabalens/shell/entry-flow"
import { EntrySheet } from "@/components/nabalens/shell/entry-sheet"
import {
  PhotoSets,
  sessionSetKeys,
  type ReplaceOutcome,
  type SetSubject,
} from "@/components/nabalens/shell/photo-sets"
import { LeaveGuard } from "@/components/nabalens/shell/leave-guard"
import { MANAGER_ENTRY_HREFS } from "@/components/nabalens/shell/manager-entry"
import {
  AddSheet,
  type AddBlocked,
} from "@/components/nabalens/shell/add-sheet"
import { useObjectUrl } from "@/components/nabalens/use-upload-queue"
import {
  CAPTURE_COPY,
  CaptureJournalContext,
  CaptureResumeBlock,
  createLabelJournal,
  journalLabels,
  panelChoiceCounts,
  journalMemberLines,
  resumableEntries,
} from "@/components/nabalens/shell/capture-resume"
import { MEDIA_LIMITS } from "@/lib/config/media"
import {
  annotateCapture,
  captureAnnotation,
  captureEntryId,
  type CaptureSession,
} from "@/lib/upload/capture-session"
import type { JournalEntry } from "@/lib/upload/journal"
import { localUploadKeyStore } from "@/lib/upload/upload-keys"
import type { WorkFocus } from "@/lib/config/work-roles"
import { dishName } from "@/lib/menus/dish-name"
import type { EntryIntent, EntryMenu } from "@/lib/work-client/entry"
import type {
  LabelCatalogue,
  MediaLabelSummary,
  SaveLabelsInput,
} from "@/lib/menus/types"
import { createClient } from "@/lib/supabase/browser"

import {
  discardUploadLabels,
  loadLabelAttention,
  loadPhotoLabels,
  loadUploadLabelContext,
  saveUploadLabels,
  type UploadLabelContext,
} from "./upload-label-api"

/** What one Add call brings for the files it picks. */
type PickOwner = {
  onReady: ((assetIds: string[]) => boolean | void) | null
  /** Told once files are actually picked. */
  onPicked: ((files?: File[]) => void) | null
  /** Told of each file that ended without becoming ready, and why. */
  onUnfinished: ((reason: UnfinishedReason, file: File) => void) | null
  preset: AddLabelPreset | null
  /** Fixed at reservation; "amenity" keeps the files out of the community. */
  purpose: UploadPurpose
  /** What the files show, for a set of them (B02-05). */
  subject: SetSubject | null
  /** The set these files make, once picked while sets are on. */
  set: string | null
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
 *
 * A manager account's workspace (`role="manager"`) has Add only once the
 * entry's read says it can upload: until then, and when the read fails, its
 * pages see no Add at all. A finalise the server refused (403) ends Add for
 * the visit: the queue stays reachable to remove what didn't finish, and
 * new uploads aren't offered.
 */
export function AddHost({
  blocked,
  captchaRequired,
  captchaSiteKey,
  entry = null,
  venueName = null,
  role = "staff",
  children,
}: {
  blocked: AddBlocked | null
  captchaRequired: boolean
  captchaSiteKey: string | null
  /**
   * The shared entry's choices (B02-02), read on the server; none keeps
   * today's Add exactly (the entry is off for the venue).
   */
  entry?: Promise<EntryMenu | null> | null
  /** The person's venue, for the Add sheet's context lines with the entry on. */
  venueName?: string | null
  role?: "staff" | "manager"
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
  const supabase = React.useMemo(() => createClient(), [])
  // Kept through session expiry so an interrupted upload can offer a sign-in
  // link; the queue belongs to the first identity (guard.userId).
  const guard = useBrowserSessionGuard({ captchaRequired, captchaSiteKey })
  const { userId } = guard

  const [busy, setBusy] = React.useState<UploadBusy>({
    active: 0,
    failed: 0,
    stopped: 0,
  })
  // Per Add call: photos only for task screens.
  const [imagesOnly, setImagesOnly] = React.useState(false)
  // What an Add call brings for the files it picks (and only those): a task
  // screen's ready listener, Our menu's dish, and who to tell once files are
  // picked. Kept per File. `pickerOwner` goes only with files from Add's own
  // picker (openAdd({ source })); `sheetOwner` with the next pick from the Add
  // sheet or the upload dialog, and is dropped when they close without one.
  // A cancelled picker leaves nothing for a later pick ("Add more").
  const pickerOwner = React.useRef<PickOwner | null>(null)
  const sheetOwner = React.useRef<PickOwner | null>(null)
  const fileOwners = React.useRef(new WeakMap<File, PickOwner>())
  // Queue files whose dish has been on their labels. Once removed it stays
  // removed: the label field mounts again whenever the sheet reopens.
  const dishShown = React.useRef(new Set<string>())
  // Labels changed while the venue is unknown (see PanelHost), by queue file.
  const heldLabels = React.useRef(new Map<string, HeldLabels>())
  const readyListeners = React.useRef(new Set<AddReadyListener>())

  // Sets of photos of one subject (B02-05): on where the shared entry is
  // and the person can upload (R8, read with the entry's choices); off for
  // the rest of the visit once the database says it has no groups.
  const [intents, setIntents] = React.useState<readonly EntryIntent[] | null>(
    null
  )
  const [setsMissing, setSetsMissing] = React.useState(false)
  React.useEffect(() => {
    if (!entry) return
    let live = true
    entry.then(
      (menu) => {
        if (live) setIntents(menu?.intents ?? null)
      },
      () => {}
    )
    return () => {
      live = false
    }
  }, [entry])
  const setsOn = intents?.includes("photos") ?? false
  const groupsOn = setsOn && !setsMissing
  // A manager account's Add exists only while R8 says it can upload.
  const offered = role === "staff" || setsOn
  // The server refused to finish an upload (403): no new ones this visit.
  const [ended, setEnded] = React.useState(false)
  const sheetBlocked: AddBlocked | null =
    blocked ??
    (ended ? { reason: "access_ended", venueName: venueName ?? "" } : null)
  const groupsOnRef = React.useRef(groupsOn)
  React.useLayoutEffect(() => {
    groupsOnRef.current = groupsOn
  }, [groupsOn])
  // B05-05 (L1): the File of each reserved asset, so a label send the
  // server took can clear that file's labels in the journal.
  const [labelJournal] = React.useState(() =>
    createLabelJournal(annotateCapture, captureAnnotation)
  )
  // Continued files whose resumed labels haven't reached the panel yet (N4).
  const awaitingSeed = React.useRef(new WeakSet<File>())
  // B05-05c: each set's start key (the journal's groupKey), and the files
  // this tab picked, newest last (bounded).
  const setKeys = React.useRef(new Map<string, string>())
  const tabFiles = React.useRef<File[]>([])
  const [photoSets] = React.useState(
    () =>
      new PhotoSets(
        {
          start: startPhotoSet,
          add: addToPhotoSet,
          read: readPhotoSet,
          replace: replaceInPhotoSet,
        },
        sessionSetKeys(),
        {
          onMissing: () => setSetsMissing(true),
        }
      )
  )
  React.useEffect(
    () =>
      photoSets.listenKeys((setId, key) => {
        setKeys.current.set(setId, key)
        for (const file of tabFiles.current)
          if (fileOwners.current.get(file)?.set === setId)
            annotateCapture(file, { groupKey: key })
      }),
    [photoSets]
  )
  // Files that have been through claim, with an owner or none.
  const claimedFiles = React.useRef(new WeakSet<File>())
  // The latest pick that made a set: the upload dialog's own next pick
  // ("Add more to this set"), and a later Add call for the same subject,
  // join it. Any other Add call ends it.
  const setOwner = React.useRef<PickOwner | null>(null)
  const [addingToSet, setAddingToSet] = React.useState(false)

  // The Add queue's unfinished server assets: any other own upload the
  // server still has uploading has stopped (see useUploadStopped).
  const [heldIds, setHeldIds] = React.useState<ReadonlySet<string>>(
    () => new Set()
  )
  const holdsChanged = React.useCallback((assetIds: string[]) => {
    setHeldIds((current) =>
      current.size === assetIds.length &&
      assetIds.every((id) => current.has(id))
        ? current
        : new Set(assetIds)
    )
  }, [])
  const holds = React.useMemo(
    () => ({ assetIds: heldIds, account: userId ?? null }),
    [heldIds, userId]
  )

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
  // Loads that failed in a row: the next try waits longer.
  const catalogueFailures = React.useRef(0)
  React.useEffect(() => {
    if (!catalogueWanted) return
    const controller = new AbortController()
    void loadUploadLabelContext(controller.signal)
      .catch((): UploadLabelContext => ({
        ok: false,
        message: "The menu could not be loaded. Try again.",
      }))
      .then((result) => {
        if (controller.signal.aborted) return
        catalogueFailures.current = result.ok
          ? 0
          : catalogueFailures.current + 1
        setLabelContext(result)
      })
    return () => controller.abort()
  }, [catalogueWanted, catalogueAttempt])
  const reloadCatalogue = React.useCallback(() => {
    setLabelContext(null)
    setCatalogueAttempt((attempt) => attempt + 1)
  }, [])
  // A failed menu is tried again when the signal returns, and after a wait
  // (5 s, doubling to a minute), so a dish never waits for it for good; only
  // while one does (the label field has its own Retry). These tries keep the
  // failed answer until a new one arrives: the dish row stays on "Labels not
  // saved yet." rather than flipping to "Saving…" each time.
  const [dishWaiting, setDishWaiting] = React.useState(false)
  const catalogueFailed =
    catalogueWanted && labelContext?.ok === false && dishWaiting
  const retryCatalogue = React.useCallback(
    () => setCatalogueAttempt((attempt) => attempt + 1),
    []
  )
  React.useEffect(() => {
    if (!catalogueFailed) return
    const wait = Math.min(60_000, 5_000 * 2 ** (catalogueFailures.current - 1))
    const timer = window.setTimeout(retryCatalogue, wait)
    window.addEventListener("online", retryCatalogue)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener("online", retryCatalogue)
    }
    // Each failed answer (a new labelContext) waits again, longer.
  }, [catalogueFailed, labelContext, retryCatalogue])
  const catalogueProp: CatalogueProp = !labelContext
    ? { state: "loading" }
    : labelContext.ok
      ? { state: "ready", catalogue: labelContext.catalogue }
      : { state: "error", message: labelContext.message }

  /** B05-05c: what the journal records for a file this tab picked. */
  const noteCapture = (file: File, owner: PickOwner) => {
    tabFiles.current = [...tabFiles.current.slice(-49), file]
    annotateCapture(file, {
      ...(owner.subject
        ? {
            subject: {
              kind: owner.subject.kind,
              id: owner.subject.id,
              // For a set rebuilt in another tab (OD-B5-05-9 follow-up).
              ...(owner.subject.name ? { name: owner.subject.name } : {}),
            },
          }
        : {}),
      ...(owner.set && setKeys.current.has(owner.set)
        ? { groupKey: setKeys.current.get(owner.set)! }
        : {}),
    })
  }

  /** These files were picked for `owner`'s Add call. */
  const claim = React.useCallback(
    (files: File[], owner: PickOwner | null) => {
      for (const file of files) claimedFiles.current.add(file)
      if (!owner || files.length === 0) return
      if (owner.subject && !owner.set && groupsOnRef.current)
        owner.set = photoSets.open(owner.subject)
      if (owner.set) {
        setOwner.current = owner
        setAddingToSet(true)
      }
      if (
        owner.onReady ||
        owner.onUnfinished ||
        owner.preset ||
        owner.purpose !== "general" ||
        owner.set
      )
        for (const file of files) fileOwners.current.set(file, owner)
      for (const file of files) noteCapture(file, owner)
      owner.onPicked?.(files)
    },
    [photoSets]
  )

  /** Every pick (the dialog's own, or files handed to it). */
  const picked = React.useCallback(
    (files: File[]) => {
      if (files.length === 0) return
      setCatalogueWanted(true)
      // Files from Add's own pickers were claimed as they were picked.
      if (files.every((file) => claimedFiles.current.has(file))) return
      const owner = sheetOwner.current ?? setOwner.current
      sheetOwner.current = null
      claim(files, owner)
    },
    [claim]
  )

  /** Files from Add's own picker or the sheet go to the queue, shown. */
  const queueFiles = React.useCallback((files: File[]) => {
    setSheetOpen(false)
    setPickedFiles(files)
    setUploadOpen(true)
  }, [])

  // B05-05d: the account's capture journal, and what didn't finish in an
  // earlier tab (OD-B5-05-10): its unfinished entries, less those this tab
  // holds or picked and those the server is finalising (it finishes them).
  const openJournal = React.useContext(CaptureJournalContext)
  const [capture, setCapture] = React.useState<CaptureSession | null>(null)
  // Another account (or none): this page's asset files are not its (M5).
  React.useEffect(() => () => labelJournal.clear(), [labelJournal, userId])
  React.useEffect(() => {
    if (!userId) return
    let live = true
    void openJournal(userId)
      .catch(() => null)
      .then((session) => {
        if (live) setCapture(session)
      })
    return () => {
      live = false
    }
  }, [openJournal, userId])
  const [unfinishedEntries, setUnfinishedEntries] = React.useState<
    readonly JournalEntry[]
  >([])
  const [resumeRead, setResumeRead] = React.useState(0)
  // What this device's journal says of each unfinished asset, for set
  // members this tab doesn't hold (OD-B5-01-9: the server keeps no reason).
  const [memberLines, setMemberLines] = React.useState<
    ReadonlyMap<string, string>
  >(() => new Map())
  React.useEffect(() => {
    if (!capture) return
    let live = true
    void capture.journal.unfinished().then((entries) => {
      if (!live) return
      const tabEntryIds = new Set(
        tabFiles.current.flatMap((file) => captureEntryId(file) ?? [])
      )
      setUnfinishedEntries(resumableEntries(entries, heldIds, tabEntryIds))
      setMemberLines(journalMemberLines(entries))
    })
    return () => {
      live = false
    }
  }, [capture, resumeRead, sheetOpen, uploadOpen, heldIds])
  // Signed out or switched in another tab: nothing of that journal shows (K8).
  const resumable = capture?.alive() ? unfinishedEntries : []
  const memberLine = React.useCallback(
    (assetId: string) =>
      capture?.alive() ? (memberLines.get(assetId) ?? null) : null,
    [capture, memberLines]
  )
  const keepOpenNote =
    capture && !capture.capabilities.storeBytes ? CAPTURE_COPY.keepOpen : null
  // Labels typed before reservation in the earlier tab, by continued file.
  const resumedLabels = React.useRef(
    new WeakMap<File, { venueId: string; input: SaveLabelsInput }>()
  )
  /**
   * Continue (OD-B5-05-11): the stored File gets its upload key back, then
   * goes to the queue under its subject. A file the earlier tab picked into
   * a set rejoins that set (OD-B5-05-9 follow-up): the set is rebuilt here
   * under the earlier tab's start key, so the server returns the same group.
   */
  const continueEntry = async (entry: JournalEntry) => {
    const bytes = entry.bytes
    // A dead session (another tab signed out) writes no upload key (K8).
    if (!(bytes instanceof Blob) || !userId || !capture?.alive()) return
    const file =
      bytes instanceof File
        ? bytes
        : new File([bytes], entry.displayName, { type: bytes.type })
    setUnfinishedEntries((list) => list.filter((e) => e.id !== entry.id))
    await localUploadKeyStore()
      .set(file, entry.uploadKey, { purpose: entry.purpose, account: userId })
      .catch(() => {})
    // The entry keeps them only until the server took them (L1): still here,
    // they never reached it, so they go with the continued file. Staging
    // replaces what the server keeps for the asset, so a send whose answer
    // was lost is harmless to repeat.
    const labels = pendingLabelsOf(entry.pendingLabels)
    if (labels) {
      resumedLabels.current.set(file, labels)
      awaitingSeed.current.add(file)
    }
    const owner: PickOwner = {
      onReady: null,
      onPicked: null,
      onUnfinished: null,
      preset: null,
      purpose: entry.purpose,
      subject: null,
      set: null,
    }
    if (
      entry.groupKey &&
      entry.subject.kind === "menu_item" &&
      groupsOnRef.current
    ) {
      const subject = {
        kind: entry.subject.kind,
        id: entry.subject.id,
        name: entry.subject.name ?? "",
      }
      owner.set = photoSets.resume(subject, entry.groupKey)
      setKeys.current.set(owner.set, entry.groupKey)
      // Without the dish's name the set joins quietly: no notice to word.
      owner.subject = subject.name ? subject : null
    }
    claim([file], owner)
    annotateCapture(file, {
      subject: entry.subject,
      groupKey: entry.groupKey,
      ...(labels ? { pendingLabels: labels } : {}),
    })
    fileOwners.current.set(file, owner)
    queueFiles([file])
    setResumeRead((n) => n + 1)
  }
  /**
   * Dismiss: the entry (and any bytes) leaves this device's journal and the
   * block. The server's unfinished upload is left to its own clean-up (the
   * 24 h abandoned-upload window), as for an expired entry (§5.2 item 5).
   */
  const dismissEntry = (entry: JournalEntry) => {
    if (!capture?.alive()) return
    setUnfinishedEntries((list) => list.filter((e) => e.id !== entry.id))
    void capture.journal
      .done(entry.id)
      .catch(() => {})
      .then(() => setResumeRead((n) => n + 1))
  }
  const resumeBlock = (
    <CaptureResumeBlock
      entries={resumable}
      onContinue={(entry) => void continueEntry(entry)}
      onDismiss={dismissEntry}
    />
  )

  // Add's own pickers, for openAdd({ source }). Outside any dialog, so a
  // click on them never lands on content a modal has made inert.
  const picker = usePhotoSource({
    imagesOnly,
    onFiles: (files) => {
      const owner = pickerOwner.current
      pickerOwner.current = null
      claim(files, owner)
      queueFiles(files)
    },
  })
  const openPicker = picker.open
  const closeSheet = React.useCallback((open: boolean) => {
    if (!open) sheetOwner.current = null
    setSheetOpen(open)
  }, [])
  const closeUpload = React.useCallback((open: boolean) => {
    if (!open) sheetOwner.current = null
    setUploadOpen(open)
  }, [])

  // B05-01d: files picked to replace a set's photo, and how each went, by
  // the replaced row.
  const replacements = React.useRef(
    new Map<File, { set: string; assetId: string; row: string }>()
  )
  const [replaceStates, setReplaceStates] = React.useState<
    ReadonlyMap<string, ReplaceState>
  >(new Map())
  const setReplaceState = React.useCallback(
    (row: string, state: ReplaceState | null) =>
      setReplaceStates((current) => {
        const next = new Map(current)
        if (state) next.set(row, state)
        else next.delete(row)
        return next
      }),
    []
  )
  const replace = React.useMemo<SetReplace>(
    () => ({
      start(item: QueueItem, file: File) {
        const owner = fileOwners.current.get(item.file)
        if (!owner?.set || !item.assetId) return
        // The old photo's owner and set, without claim(): a replacement
        // never makes its set the one "Add more" joins (that stays the
        // latest pick's).
        claimedFiles.current.add(file)
        fileOwners.current.set(file, owner)
        noteCapture(file, owner)
        replacements.current.set(file, {
          set: owner.set,
          assetId: item.assetId,
          row: item.id,
        })
        setReplaceState(item.id, { kind: "pending", with: file.name })
      },
      abandon(file: File) {
        const swap = replacements.current.get(file)
        if (!swap) return
        replacements.current.delete(file)
        setReplaceState(swap.row, null)
      },
      stateOf: (item: QueueItem) => replaceStates.get(item.id) ?? null,
    }),
    [replaceStates, setReplaceState]
  )

  // Each photo of a set joins its group as soon as the server reserved it;
  // a replacement swaps in for the photo it replaces instead.
  const reservedForSet = React.useCallback(
    (file: File, assetId: string) => {
      labelJournal.reserved(assetId, file)
      const swap = replacements.current.get(file)
      if (swap) {
        replacements.current.delete(file)
        void photoSets
          .replace(swap.set, swap.assetId, assetId)
          .then(async (outcome) => {
            // No answer in the end: the server may have made the swap all
            // the same, so the set is read before saying it didn't.
            if (outcome.status === "unavailable") {
              const view = await photoSets.read(swap.set)
              if (
                view?.members.some(
                  (m) =>
                    m.assetId === assetId && m.replacesAssetId === swap.assetId
                )
              ) {
                photoSets.replacedOnServer(swap.set, swap.assetId, assetId)
                outcome = { status: "replaced" }
              }
            }
            setReplaceState(swap.row, replaceState(outcome))
          })
        return
      }
      const set = fileOwners.current.get(file)?.set
      if (set) photoSets.reserved(set, assetId)
    },
    [photoSets, setReplaceState, labelJournal]
  )
  const readSet = React.useCallback(
    (setId: string) => photoSets.read(setId),
    [photoSets]
  )
  const serverFailed = React.useCallback(
    (file: File, assetId: string) => {
      const set = fileOwners.current.get(file)?.set
      if (set) photoSets.serverFailed(set, assetId)
    },
    [photoSets]
  )
  // A set's one notice. Evidence for a question isn't reviewed photo by
  // photo, so its set is grouped without one.
  const setOf = React.useCallback((file: File): PhotoSetRef | null => {
    const owner = fileOwners.current.get(file)
    return owner?.set && owner.subject && owner.subject.kind !== "question"
      ? { id: owner.set, subject: owner.subject.name }
      : null
  }, [])

  const onReady = React.useCallback((listener: AddReadyListener) => {
    readyListeners.current.add(listener)
    return () => {
      readyListeners.current.delete(listener)
    }
  }, [])

  // Each file as soon as it is ready: its own Add call hears it (a task
  // screen selects it), then every subscriber. False: the screen that picked
  // it is gone, so the sheet keeps it listed as not added there.
  const handleReady = React.useCallback(
    (ids: string[], files: File[]) => {
      let kept = true
      ids.forEach((id, i) => {
        const owner = fileOwners.current.get(files[i])
        // Saved: nothing left for its labels to clear (M5).
        labelJournal.forgetAsset(id)
        // A photo the server failed, retried and finished, counts again.
        if (owner?.set) photoSets.finished(owner.set, id)
        if (owner?.onReady?.([id]) === false) kept = false
      })
      for (const listener of readyListeners.current) listener(ids)
      return kept
    },
    [photoSets, labelJournal]
  )

  // Me's Fix labels and Discard labels reach the sheet's rows (C6).
  const settleListeners = React.useRef(new Set<UploadLabelSettle>())
  const settled = React.useCallback((listener: UploadLabelSettle) => {
    settleListeners.current.add(listener)
    return () => {
      settleListeners.current.delete(listener)
    }
  }, [])
  const labelled = React.useCallback((assetIds: string[]) => {
    for (const listener of settleListeners.current)
      listener(assetIds, "labelled")
  }, [])
  const discarded = React.useCallback((assetIds: string[]) => {
    for (const listener of settleListeners.current)
      listener(assetIds, "discarded")
  }, [])

  // Today's Add without a source: the queue while files wait, the sheet on
  // phones (and when blocked), the upload dialog from md.
  const showAdd = React.useCallback(
    (dialog = false) => {
      const phone = !window.matchMedia("(min-width: 48rem)").matches
      if (waiting > 0 && !blocked) setUploadOpen(true)
      else if (blocked || (phone && !dialog)) setSheetOpen(true)
      else {
        setPickedFiles(undefined)
        setUploadOpen(true)
      }
    },
    [waiting, blocked]
  )

  // The shared entry's step, while it is open (B02-02).
  const [entryStep, setEntryStep] = React.useState<EntryStep | null>(null)
  const closeEntry = React.useCallback((open: boolean) => {
    if (!open) setEntryStep(null)
  }, [])
  const entryPhotos = React.useCallback(() => {
    setEntryStep(null)
    showAdd()
  }, [showAdd])
  const entryUnavailable = React.useCallback(() => {
    setEntryStep(null)
    // Without the entry, Add is today's Add; a question has no fallback.
    if (entryStep === "choose") showAdd()
  }, [entryStep, showAdd])

  const value = React.useMemo(
    () => ({
      openAdd: (opts: OpenAddOptions = {}) => {
        if (ended) {
          sheetOwner.current = null
          pickerOwner.current = null
          if (waiting > 0) setUploadOpen(true)
          else setSheetOpen(true)
          return
        }
        // Waiting files (unfinished, or needing the person): Add shows that
        // queue at every width, so a hidden run is never out of reach. A
        // source still opens its picker straight away. A dish and a ready
        // listener belong to the files this call picks, never to the queue
        // (see picked and handleReady).
        // The same subject again joins its set; any other call ends it.
        const subject = subjectOf(opts)
        const current = setOwner.current
        const joins =
          subject !== null &&
          current?.subject?.kind === subject.kind &&
          current.subject.id === subject.id
            ? current.set
            : null
        if (!joins) {
          setOwner.current = null
          setAddingToSet(false)
        }
        const owner: PickOwner = {
          onReady: opts.onReady ?? null,
          onPicked: opts.onPicked ?? null,
          onUnfinished: opts.onUnfinished ?? null,
          preset: opts.preset ?? null,
          purpose: opts.purpose ?? "general",
          subject,
          set: joins,
        }
        if (opts.entry && !opts.source) {
          if (entry && !blocked && waiting === 0) {
            sheetOwner.current = null
            setEntryStep(opts.entry)
            return
          }
          if (opts.entry === "question") return
        }
        const toPicker = !!opts.source && !blocked
        pickerOwner.current = toPicker ? owner : null
        sheetOwner.current = toPicker ? null : owner
        const only = opts.imagesOnly ?? false
        setImagesOnly(only)
        if (opts.source && !blocked) {
          // Synchronous: the picker needs this click's user activation. The
          // accept list is set for this call before the click.
          openPicker(opts.source, { imagesOnly: only })
          return
        }
        showAdd(opts.dialog)
      },
      onReady,
      labelled,
      discarded,
      busy: waiting > 0 ? { count: waiting, words: busyWords } : null,
      active: busy.active,
      failed: busy.failed + busy.stopped,
      refreshSignal,
      holds,
      intents,
    }),
    [
      blocked,
      ended,
      intents,
      entry,
      showAdd,
      waiting,
      busy.active,
      busy.failed,
      busy.stopped,
      busyWords,
      refreshSignal,
      onReady,
      labelled,
      discarded,
      openPicker,
      holds,
    ]
  )

  // With Add closed, a file that newly needs the person is said once, in
  // one polite region for the whole app (the Add button's name alone is
  // never announced).
  const needing = busy.failed + busy.stopped + (busy.attention ?? 0)
  const addShown = sheetOpen || uploadOpen
  const [attentionSaid, setAttentionSaid] = React.useState("")
  const [needingBefore, setNeedingBefore] = React.useState(needing)
  if (needing !== needingBefore) {
    setNeedingBefore(needing)
    setAttentionSaid(
      !addShown && needing > needingBefore ? needsAttentionWords(needing) : ""
    )
  }
  if (addShown && attentionSaid) setAttentionSaid("")

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
      try {
        return await uploader(file, {
          ...context,
          ...(purpose && purpose !== "general" ? { purpose } : {}),
          ...(account ? { account } : {}),
        })
      } catch (error) {
        if (role === "manager" && refusedFinalise(error)) setEnded(true)
        throw error
      }
    },
    [uploader, supabase, role]
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
        // Labels typed before reservation in an earlier tab (OD-B5-05-8),
        // addressed to this row.
        const resumed = resumedLabels.current.get(item.file)
        if (resumed)
          return {
            venueId: resumed.venueId,
            input: { ...resumed.input, assetId: item.id },
          }
        const preset = fileOwners.current.get(item.file)?.preset
        if (!preset) return null
        if (labelContext && !labelContext.ok) return "unavailable"
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
      retrySeed: reloadCatalogue,
      onSeedWaiting: setDishWaiting,
      // The server took the labels (staged, or on the photo): the journal no
      // longer needs its copy (L1).
      // The journal's copy follows the server's answers (M3, N2, N3).
      save: async (venueId, input) => {
        labelJournal.sending(input)
        const result = await saveUploadLabels(venueId, input)
        if (result.ok) labelJournal.confirmed(input)
        return result
      },
      discard: async (assetId) => {
        const result = await discardUploadLabels(assetId)
        if (result) labelJournal.discarded(assetId)
        return result
      },
      attention: loadLabelAttention,
      summary: loadPhotoLabels,
      settled,
      itemNames: (input) =>
        input.items.flatMap((ref) => {
          if (catalogue?.status !== "active") return []
          for (const section of catalogue.sections)
            for (const item of section.items)
              if (item.itemId === ref.itemId) {
                const variant = item.variants.find(
                  (v) => v.variantId === ref.variantId
                )
                return [
                  dishName(
                    { name: item.name, variantName: variant?.name ?? null },
                    ref.variantId === null && item.variants.length > 0
                  ),
                ]
              }
          return []
        }),
      // Review takes dishes in food and drinks sections only.
      reviewable: (refs) =>
        catalogue?.status === "active" &&
        refs.some((ref) =>
          catalogue.sections.some(
            (section) =>
              (section.kind === "food" || section.kind === "drinks") &&
              section.items.some((item) => item.itemId === ref.itemId)
          )
        ),
      onSaved: refreshAfterLabels,
      renderPanel: (props) => (
        <PanelHost
          {...props}
          onChange={(venueId, inputs) => {
            // UP-04: each row's latest label choice goes to its journal
            // entry until the server confirms it, so it survives a closed
            // tab (OD-B5-05-8, M3); an empty choice clears it.
            for (const input of inputs) {
              const item = props.items.find((i) => i.id === input.assetId)
              if (!item) continue
              const waiting = awaitingSeed.current.has(item.file)
              const seeded = props.initial.find((i) => i.assetId === item.id)
              if (!panelChoiceCounts(input, waiting, seeded)) continue
              awaitingSeed.current.delete(item.file)
              annotateCapture(item.file, {
                pendingLabels: journalLabels(venueId, input),
              })
            }
            props.onChange(venueId, inputs)
          }}
          catalogue={catalogueProp}
          venueId={catalogue?.venueId ?? null}
          focus={focus}
          onRetryCatalogue={reloadCatalogue}
          presetOf={(file) => fileOwners.current.get(file)?.preset ?? null}
          dishShown={(id) => dishShown.current.has(id)}
          onDishShown={(id) => dishShown.current.add(id)}
          held={heldLabels.current}
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
    [
      catalogue,
      focus,
      labelContext,
      refreshAfterLabels,
      reloadCatalogue,
      settled,
    ]
  )

  return (
    <SessionGuardProvider value={guard}>
      <LeaveGuard>
        <AddProvider value={offered ? value : null}>
          {children}
          {/* A manager account without R8's upload: nothing of Add at all. */}
          {offered ? (
            <>
              {picker.inputs}
              {entry ? (
                <EntrySheet
                  open={entryStep !== null}
                  onOpenChange={closeEntry}
                  entry={entry}
                  step={entryStep ?? "choose"}
                  onPhotos={entryPhotos}
                  onUnavailable={entryUnavailable}
                  hrefs={role === "manager" ? MANAGER_ENTRY_HREFS : undefined}
                  role={role}
                />
              ) : null}
              <AddSheet
                open={sheetOpen}
                onOpenChange={closeSheet}
                blocked={sheetBlocked}
                context={
                  entry && venueName
                    ? { venueName, audience: ENTRY_COPY.photosAudience }
                    : null
                }
                maxFiles={MEDIA_LIMITS.maxBatchFiles}
                imagesOnly={imagesOnly}
                onFiles={queueFiles}
                resume={resumeBlock}
                keepOpenNote={keepOpenNote}
              />
              <UploadDialog
                open={uploadOpen}
                onOpenChange={closeUpload}
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
                purposeOf={(file) =>
                  fileOwners.current.get(file)?.purpose ?? "general"
                }
                labels={labels}
                startOnPick
                keepRunningWhenClosed
                onBusyChange={setBusy}
                onHoldsChange={holdsChanged}
                onUnfinished={(file, reason) => {
                  // Removed or cancelled: its asset needs no label clear (M5).
                  if (reason !== "failed") labelJournal.forgetFile(file)
                  fileOwners.current.get(file)?.onUnfinished?.(reason, file)
                }}
                onReserved={reservedForSet}
                setOf={groupsOn ? setOf : undefined}
                readSet={groupsOn ? readSet : undefined}
                memberLine={groupsOn ? memberLine : undefined}
                replace={groupsOn ? replace : undefined}
                onServerFailed={serverFailed}
                idle={
                  // From md, idle Add is this dialog: the same block and line
                  // as the phone sheet, above its pickers (J2).
                  resumable.length > 0 || keepOpenNote ? (
                    <div className="grid gap-2">
                      {resumeBlock}
                      {keepOpenNote ? (
                        <p
                          data-capture-keep-open=""
                          className="text-meta text-ink-muted"
                        >
                          {keepOpenNote}
                        </p>
                      ) : null}
                    </div>
                  ) : null
                }
                addMoreLabel={
                  groupsOn && addingToSet ? ENTRY_COPY.addMoreToSet : undefined
                }
              />
              <p role="status" className="sr-only">
                {attentionSaid}
              </p>
            </>
          ) : null}
        </AddProvider>
      </LeaveGuard>
    </SessionGuardProvider>
  )
}

/** A replacement's outcome as its old row says it (B05-01d). */
function replaceState(outcome: ReplaceOutcome): ReplaceState {
  if (outcome.status === "replaced") return { kind: "replaced" }
  if (outcome.status === "same") return { kind: "same" }
  const copy = ENTRY_COPY.replaceRefused
  const refusal = outcome.status === "refused" ? outcome.refusal : null
  const reason = refusal?.reason
  return {
    kind: "refused",
    // A refusal without set words of its own here says the server's.
    message:
      reason && reason in copy
        ? copy[reason as keyof typeof copy]
        : (refusal?.message ?? copy.other),
    at: Date.now(),
  }
}

/** A journal entry's labels typed before reservation, if well formed. */
function pendingLabelsOf(
  value: unknown
): { venueId: string; input: SaveLabelsInput } | null {
  if (!value || typeof value !== "object") return null
  const { venueId, input } = value as { venueId?: unknown; input?: unknown }
  return typeof venueId === "string" && input && typeof input === "object"
    ? { venueId, input: input as SaveLabelsInput }
    : null
}

/** What an Add call's files show: Our menu's dish, or the call's subject. */
function subjectOf(opts: OpenAddOptions): SetSubject | null {
  if (opts.preset)
    return {
      kind: "menu_item",
      id: opts.preset.itemId,
      name: dishName({
        name: opts.preset.itemName,
        variantName: opts.preset.variantName,
      }),
    }
  return opts.subject ? { ...opts.subject } : null
}

/** The queue's error for a finalise the server refused (403). */
function refusedFinalise(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "error" in error &&
    (error as { error?: { code?: unknown } }).error?.code === "finalise_refused"
  )
}

/** `1 photo needs attention. Open Add.` */
export function needsAttentionWords(count: number) {
  return count === 1
    ? "1 photo needs attention. Open Add."
    : `${count} photos need attention. Open Add.`
}

/** A file's labels changed in the field, and what the sheet had then. */
type HeldLabels = {
  base: SaveLabelsInput | undefined
  input: SaveLabelsInput
  discards: number
}

const hasDish = (input: SaveLabelsInput, preset: AddLabelPreset) =>
  input.items.some((ref) => ref.itemId === preset.itemId)

/**
 * The sheet's label field for the files that can carry labels. Each file
 * gets the dish it was picked for, once: `initial` already holding it wins
 * (the panel restores it as it is), and a file whose dish the person removed
 * never gets it back when the field mounts again.
 *
 * The host stores a file's dish on its own (UploadLabels.seed), so the field
 * may not drop it unless the person did: a dish the field has never shown
 * stays in what is stored, and a file that failed for good keeps its stored
 * labels (they read "Not saved (photo not saved)").
 *
 * Labels can only be stored once the venue is known (the menu loaded).
 * Changes made before that are `held` here, outside the field: a field that
 * mounts again meanwhile (the sheet's labels changed elsewhere) restores
 * them, they keep the sheet pending, and they are sent once the venue is
 * known (or dropped when the person discards them). A file whose labels the
 * sheet changed elsewhere meanwhile (finalise, Me) keeps those instead.
 */
function PanelHost({
  items,
  initial,
  disabledIds,
  settledIds,
  onChange,
  onPendingChange,
  catalogue,
  venueId,
  focus,
  onRetryCatalogue,
  presetOf,
  dishShown,
  onDishShown,
  held,
  discards,
}: UploadLabelPanelHostProps & {
  catalogue: CatalogueProp
  venueId: string | null
  focus: WorkFocus | null
  onRetryCatalogue: () => void
  presetOf: (file: File) => AddLabelPreset | null
  dishShown: (id: string) => boolean
  onDishShown: (id: string) => void
  held: Map<string, HeldLabels>
}) {
  const recorded = (id: string) => initial.find((i) => i.assetId === id)
  const heldFor = (id: string) => {
    const h = held.get(id)
    return h && h.discards === discards && sameLabelChoice(recorded(id), h.base)
      ? h
      : undefined
  }
  const restored = (id: string) => heldFor(id)?.input ?? recorded(id)
  const holding = items.some((item) => {
    const h = heldFor(item.id)
    return !!h && !sameLabelChoice(h.input, recorded(item.id))
  })
  const [, heldChanged] = React.useReducer((n: number) => n + 1, 0)
  const [panelPending, setPanelPending] = React.useState(false)
  const pending = panelPending || holding
  React.useEffect(() => onPendingChange(pending), [onPendingChange, pending])
  React.useEffect(() => () => onPendingChange(false), [onPendingChange])
  const dishOf = (id: string) => {
    const item = items.find((i) => i.id === id)
    return item ? presetOf(item.file) : null
  }
  // Each file's own dish, unless the person removed it earlier (or its labels
  // were settled on Me: `initial` is what the photo has).
  const presetFor = (id: string) => {
    const dish = dishOf(id)
    if (!dish || settledIds.includes(id)) return null
    const now = restored(id)
    return !dishShown(id) || (!!now && hasDish(now, dish)) ? dish : null
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
      presetFor={presetFor}
      initial={items.flatMap((item) => {
        const input = restored(item.id)
        return input ? [input] : []
      })}
      disabledIds={disabledIds}
      onChange={(inputs) => {
        const kept = inputs.map((input) => {
          const saved = recorded(input.assetId)
          if (saved && disabledIds.includes(input.assetId)) return saved
          const stored = restored(input.assetId)
          const dish = dishOf(input.assetId)
          if (!dish) return input
          if (hasDish(input, dish)) {
            onDishShown(input.assetId)
            return input
          }
          // Removed by the person only once it was shown to them.
          if (!stored || !hasDish(stored, dish) || dishShown(input.assetId))
            return input
          return {
            ...input,
            items: [
              ...input.items,
              ...stored.items.filter((ref) => ref.itemId === dish.itemId),
            ],
          }
        })
        if (venueId) {
          onChange(venueId, kept)
          if (held.size > 0) {
            held.clear()
            heldChanged()
          }
          return
        }
        for (const input of kept) {
          const id = input.assetId
          const base = heldFor(id)?.base ?? recorded(id)
          const changed = !sameLabelChoice(input, base)
          if (!heldFor(id) && !changed) continue
          // The field names a file's dish only once the menu is known, so a
          // change made before that lacks it. Held as restored labels, it
          // would stop the dish being added later: keep a dish never shown.
          const dish = dishOf(id)
          const unseen =
            changed &&
            dish &&
            !settledIds.includes(id) &&
            !dishShown(id) &&
            !hasDish(input, dish)
          held.set(id, {
            base,
            input: unseen
              ? {
                  ...input,
                  items: [
                    ...input.items,
                    { itemId: dish.itemId, variantId: dish.variantId },
                  ],
                }
              : input,
            discards,
          })
        }
        heldChanged()
      }}
      onPendingChange={setPanelPending}
    />
  )
}

/** "Fix labels": the stored labels against the menu as it is now. */
function FixHost({
  item,
  assetId,
  draft,
  labels,
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
      asset={assetOf(item, assetId, labels, ready, preview)}
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
  labels: MediaLabelSummary,
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
    // The photo's labels as last known: Fix labels saves at their revision.
    labels,
  }
}
