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
import { AreaLabelField } from "@/components/nabalens/area-photos/area-label-field"
import {
  FixLabelsDialog,
  UploadLabelPanel,
  type CatalogueProp,
} from "@/components/nabalens/labels"
import type {
  PhotoSetRef,
  QueuedOutcome,
  ReplaceState,
  SetReplace,
  UploadBusy,
  UploadControl,
} from "@/components/nabalens/upload-dialog"
import {
  sameLabelChoice,
  type UploadLabelFixProps,
  type UploadLabelPanelHostProps,
  type UploadLabels,
  type UploadLabelSettle,
} from "@/components/nabalens/upload-label-drafts"
import {
  checkFile,
  guessMediaKind,
  type QueueItem,
  type RejectedFile,
  type Uploader,
  type UploadPurpose,
  UploadWithdrawnError,
} from "@/components/nabalens/upload-queue"
import { useVenueChanges } from "@/components/nabalens/venue-switcher"
import { SessionGuardProvider } from "@/components/nabalens/session-guard"
import { useBrowserSessionGuard } from "@/components/nabalens/session-guard-host"
import { setAreaLabelAction } from "@/app/_labels/area-actions"
import { useGalleryPicker } from "@/components/nabalens/album/match/gallery-picker"
import { MATCH_COPY } from "@/components/nabalens/album/match/copy"
import {
  readLastPlace,
  readRecentSlots,
  writeLastPlace,
  writeRecentSlot,
} from "@/components/nabalens/album/match/last-place"
import type { BoardState } from "@/components/nabalens/album/match/match-picker"
import {
  MatchScreen,
  type MatchOutcome,
  type MatchPhoto,
  type SendState,
} from "@/components/nabalens/album/match/match-screen"
import {
  byCaptureTime,
  placeKey,
  type MatchTarget,
} from "@/components/nabalens/album/match/model"
import {
  AddProvider,
  type AddLabelPreset,
  type AddReadyListener,
  type OpenAddOptions,
  type SlotSend,
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
import {
  LeaveGuard,
  useLeaveGuard,
} from "@/components/nabalens/shell/leave-guard"
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
import type { UploadReceipt } from "@/lib/upload/states"
import { localUploadKeyStore } from "@/lib/upload/upload-keys"
import type { WorkFocus } from "@/lib/config/work-roles"
import { dishName } from "@/lib/menus/dish-name"
import { newClientId } from "@/lib/client-id"
import type { CaptureRoute } from "@/lib/metrics/events"
import { registerFlowSender, trackFlow } from "@/lib/metrics/track"
import { recordFlowEventsAction } from "@/app/_metrics/actions"
import type { EntryIntent, EntryMenu } from "@/lib/work-client/entry"
import type {
  ContentType,
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
import {
  loadMatchBoardAction,
  requestLabelHelpAction,
  suggestSpecialAction,
} from "./match-actions"

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
  /** Match (DESIGN.md §6.1): the venue area these photos fill (G-9). */
  area?: string | null
  /** Match's Not for a slot: what the photos show, saved as their labels. */
  contentTypes?: ContentType[] | null
  /** Match's optional note (spec §5.1), saved as the photos' label note. */
  note?: string | null
  /**
   * Match's I'm not sure (FA-4): sent to the manager as Needs label as soon
   * as the server has reserved the photo.
   */
  help?: boolean
  /** Match hears how each of these files gets on: Waiting once ready. */
  onSent?: ((file: File, state: SendState) => void) | null
  /**
   * Match (AC11): the venue the person matched these files for. Sent with
   * each reservation, so a file whose turn comes after a venue switch is
   * never reserved at the new venue.
   */
  venueId?: string | null
  /**
   * Match later (D9): the photo is matched to a slot afterwards, never
   * labelled in Add's sheet, so it never needs the person there.
   */
  noLabels?: boolean
}

/** Match takes at most this many photos from one pick (DESIGN.md §6.1). */
export const MATCH_MAX = 20

/** What an open Match holds. */
type MatchRun = {
  photos: MatchPhoto[]
  current: string | null
  notice: string | null
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
  venueId = null,
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
  /**
   * The person's active venue. When it changes while Match is open, every
   * choice not yet handed to the queue is undone and asked again for the new
   * venue (spec §6 S2, AC11).
   */
  venueId?: string | null
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
  // Match's photos not yet in the queue (its outbox, below): Add counts them
  // as in progress, and leaving the page would lose them.
  const [outbox, setOutbox] = React.useState<File[]>([])
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
    outbox.length +
    busy.active +
    busy.failed +
    busy.stopped +
    (busy.labels ?? 0) +
    (busy.attention ?? 0)
  const inProgress = busy.active + outbox.length
  const busyWords = [
    inProgress ? `${inProgress} in progress` : null,
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
  // V8 (AC11): the menu belongs to the venue that was active when it loaded.
  // A venue change loads the new venue's menu, so a dish matched there is
  // checked against its own menu, and the sheet offers its dishes.
  const [catalogueVenue, setCatalogueVenue] = React.useState(venueId)
  if (catalogueVenue !== venueId) {
    setCatalogueVenue(venueId)
    if (catalogueWanted) {
      setLabelContext(null)
      setCatalogueAttempt((attempt) => attempt + 1)
    }
  }
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
        owner.set ||
        owner.area ||
        owner.contentTypes?.length ||
        owner.onSent ||
        owner.noLabels
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

  // Match (DESIGN.md §6.1, D9): the photos picked for it, each one's answer
  // and how each matched photo is getting on in the queue.
  const [matchRun, setMatchRun] = React.useState<MatchRun | null>(null)
  const [outcomes, setOutcomes] = React.useState<
    ReadonlyMap<string, MatchOutcome>
  >(() => new Map())
  const [sendStates, setSendStates] = React.useState<
    ReadonlyMap<string, SendState>
  >(() => new Map())
  // Each matched photo's transfer progress in whole percent while it sends
  // (X6, spec §5.2 step 5), and the hidden queue's Retry for Match's rows.
  const [sendProgress, setSendProgress] = React.useState<
    ReadonlyMap<string, number>
  >(() => new Map())
  const uploadControl = React.useRef<UploadControl | null>(null)
  const sendStatesNow = React.useRef(sendStates)
  React.useEffect(() => {
    sendStatesNow.current = sendStates
  }, [sendStates])
  const [board, setBoard] = React.useState<BoardState>({ state: "loading" })
  const [boardTry, setBoardTry] = React.useState(0)
  const [lastPlace, setLastPlace] = React.useState<string | null>(null)
  const [recent, setRecent] = React.useState<readonly string[]>([])
  // Photos the server found were sent before (S1-UPLOAD duplicate link).
  const [duplicates, setDuplicates] = React.useState<ReadonlySet<string>>(
    () => new Set()
  )
  // The venue Match's run belongs to, and a line when it changed (AC11).
  const runVenue = React.useRef<string | null>(null)
  const [venueNotice, setVenueNotice] = React.useState<string | null>(null)
  const [venuesMixed, setVenuesMixed] = React.useState(false)
  const matchKeys = React.useRef(new WeakMap<File, string>())
  // Files whose reservation has started (the queue gave them their turn).
  // Then, per queue item, the matched photos handed to the queue and not
  // given their turn yet, and those Match took back before their turn
  // (AC11, revalidateVenue). A queue item is its File and the selection it
  // joined (UploadContext.batchId): one photo can wait as two items, taken
  // back at one venue and matched again at the next before the first item's
  // turn (S3-repair W6), and each item is dropped or sent on its own.
  const reserveStarted = React.useRef(new WeakSet<File>())
  const waitingTurns = React.useRef(new WeakMap<File, Set<string>>())
  const withdrawn = React.useRef(new WeakMap<File, Set<string>>())
  // Each matched photo's slot, and the slots whose photo this phone is
  // sending or has sent (DESIGN.md §4, §6.8): Album's tiles show them as
  // Sending, Saved on this phone or Waiting until the album reads them, so
  // a slot is never sent twice. Not in Match's own run: they outlive it.
  const fileSlots = React.useRef(new WeakMap<File, string>())
  const [slotSends, setSlotSends] = React.useState<
    ReadonlyMap<string, SlotSend>
  >(() => new Map())
  // Match holds back only slots whose photo is still on its way: a Waiting
  // slot welcomes another photo (spec §6 S1) and is offered under Recent and
  // Waiting in the same visit (S3-E2E-1 E5), whether or not Album has shown
  // its tile since.
  const sendingSlots = React.useMemo(
    () =>
      new Map([...slotSends].filter(([, send]) => send.state === "sending")),
    [slotSends]
  )
  const matchSeq = React.useRef(0)
  // S2-METRICS (spec §18.3): the current Match run's route and batch, and
  // how each matched file was started, for workflow events (ids and counts
  // only).
  const matchFlow = React.useRef<{ route: CaptureRoute; batchId: string }>({
    route: "gallery",
    batchId: "",
  })
  const fileRoutes = React.useRef(new WeakMap<File, CaptureRoute>())
  React.useEffect(() => registerFlowSender(recordFlowEventsAction), [])
  const boardWanted = matchRun?.photos.some((p) => !outcomes.has(p.key))
  React.useEffect(() => {
    if (!boardWanted) return
    let live = true
    void loadMatchBoardAction()
      .then((result) => {
        if (!live) return
        setBoard(
          result.ok
            ? { state: "ready", board: result.board }
            : { state: "error", message: result.message }
        )
      })
      .catch(() => {
        if (live) setBoard({ state: "error", message: "" })
      })
    return () => {
      live = false
    }
  }, [boardWanted, boardTry])
  const retryBoard = React.useCallback(() => {
    setBoard({ state: "loading" })
    setBoardTry((n) => n + 1)
  }, [])

  // The album reads the slot itself now (Waiting, or filled elsewhere): its
  // tile shows the album's state from here on, a retake included.
  const settleSlot = React.useCallback((slot: string) => {
    setSlotSends((current) => {
      if (!current.has(slot)) return current
      const next = new Map(current)
      next.delete(slot)
      return next
    })
  }, [])
  const setSent = React.useCallback((file: File, state: SendState | null) => {
    const slot = fileSlots.current.get(file)
    if (slot)
      setSlotSends((current) => {
        const was = current.get(slot)
        // A later photo for the same slot owns it now.
        if (was && was.file !== file && !(state === "sending")) return current
        const tile =
          state === "sending" || state === "offline" || state === "checking"
            ? "sending"
            : state === "waiting"
              ? "waiting"
              : null
        if (was?.file === file && was.state === tile) return current
        if (!was && !tile) return current
        const next = new Map(current)
        if (tile) next.set(slot, { state: tile, file })
        else next.delete(slot)
        return next
      })
    const key = matchKeys.current.get(file)
    if (!key) return
    setSendStates((current) => {
      if (current.get(key) === state) return current
      const next = new Map(current)
      if (state) next.set(key, state)
      else next.delete(key)
      return next
    })
  }, [])
  /**
   * A matched photo's bytes on their way (X6): its percent for Match, and,
   * after a Retry from the sheet, Sending again in place of the failure.
   */
  const progressed = React.useCallback(
    (file: File, percent: number) => {
      const key = matchKeys.current.get(file)
      if (!key || !fileOwners.current.get(file)?.onSent) return
      setSendProgress((current) =>
        current.get(key) === percent
          ? current
          : new Map(current).set(key, percent)
      )
      const was = sendStatesNow.current.get(key)
      if (was === "failed" || was === "unfinished") setSent(file, "sending")
    },
    [setSent]
  )
  /** Retry on one of Match's rows (X6): the sheet's own Retry, same asset. */
  const retryMatched = (key: string) => {
    const photo = matchRun?.photos.find((p) => p.key === key)
    if (!photo) return
    if (uploadControl.current?.retry(photo.file)) setSent(photo.file, "sending")
  }
  /**
   * An area or an I'm not sure that could not be saved: the photo waits under
   * Match later.
   */
  const areaUnsaved = React.useCallback(
    (file: File) => {
      const key = matchKeys.current.get(file)
      if (!key) return
      setOutcomes((current) => new Map(current).set(key, { kind: "later" }))
      setSent(file, null)
    },
    [setSent]
  )

  // Match's area labels and I'm not sure requests by asset: tried when
  // reserved, once more when ready, then the photo waits under Match later.
  const areaTries = React.useRef(
    new Map<string, "sending" | "failed" | "saved" | "gave-up">()
  )
  const areaReady = React.useRef(new Set<string>())
  // V8: assets whose dish label the server confirmed, and ready Match dish
  // photos still waiting for that confirmation to read Waiting.
  const labelSaved = React.useRef(new Set<string>())
  const awaitingLabel = React.useRef(new Map<string, File>())
  const saveArea = React.useCallback(
    async (file: File, assetId: string, owner: PickOwner) => {
      const area = owner.area ?? null
      if (!area && !owner.help) return
      const tries = areaTries.current
      for (;;) {
        const before = tries.get(assetId)
        if (before && before !== "failed") return
        tries.set(assetId, "sending")
        const saved = await (
          area
            ? setAreaLabelAction(assetId, area)
            : requestLabelHelpAction(assetId)
        ).then(
          (result) => result.ok,
          () => false
        )
        if (saved) {
          tries.set(assetId, "saved")
          return
        }
        if (before === "failed") {
          tries.set(assetId, "gave-up")
          areaUnsaved(file)
          return
        }
        tries.set(assetId, "failed")
        // Ready already: its second try is now, not at a ready that passed.
        if (!areaReady.current.has(assetId)) return
      }
    },
    [areaUnsaved]
  )

  // Matched photos on their way to the queue (the outbox, declared above).
  // The queue holds at most MEDIA_LIMITS.maxBatchFiles waiting or in flight,
  // and Match takes up to MATCH_MAX: the outbox hands it only as many as it
  // has room for, and the rest as files finish, so no photo is ever turned
  // away for a full queue (§2.8 "Never lose a photo"). One handoff at a
  // time: the next waits until the queue has said what it took.
  //
  // One with a label (a dish, or what it shows) waits for the menu: the
  // hidden queue clears itself once every file is done, so a label that
  // arrived after its upload finished would be lost.
  const [room, setRoom] = React.useState<number>(MEDIA_LIMITS.maxBatchFiles)
  const [handing, setHanding] = React.useState(false)
  const menuKnown = labelContext !== null
  React.useEffect(() => {
    if (outbox.length === 0 || handing || room <= 0) return
    const batch = outbox.slice(0, room)
    const waitsForMenu = batch.some((file) => {
      const owner = fileOwners.current.get(file)
      return !!owner?.preset || !!owner?.contentTypes?.length || !!owner?.note
    })
    if (waitsForMenu && !menuKnown) return
    // Hands the files to the queue (an external store) in one array.
    setHanding(true)
    setImagesOnly(true)
    setPickedFiles(batch)
    setOutbox((current) => current.slice(batch.length))
  }, [outbox, menuKnown, room, handing])

  /**
   * What the queue did with a pick. A matched photo it had no room for goes
   * back to the front of the outbox; one it refused outright is told to
   * Match. Either way Match keeps it, so the sheet doesn't list it.
   */
  const queued = React.useCallback(
    ({ rejected, room: left, added, batchId }: QueuedOutcome) => {
      setHanding(false)
      setRoom(left)
      for (const file of added) {
        if (!matchKeys.current.has(file)) continue
        const turns = waitingTurns.current.get(file) ?? new Set<string>()
        turns.add(batchId)
        waitingTurns.current.set(file, turns)
      }
      const kept: File[] = []
      const full: File[] = []
      for (const refused of rejected) {
        const file = refused.file
        if (!file || !matchKeys.current.has(file)) continue
        kept.push(file)
        if (refused.full) full.push(file)
        else setSent(file, "refused")
      }
      if (full.length > 0) setOutbox((current) => [...full, ...current])
      return kept
    },
    [setSent]
  )

  /** Matched photos go to the queue at once, with the sheet left closed. */
  const sendMatched = (
    files: File[],
    outcome: MatchOutcome,
    note: string | null = null
  ) => {
    const slot = outcome.kind === "slot" ? outcome.slot.target : null
    const unsure = outcome.kind === "unsure"
    // Match later carries no note: it is matched (and noted) later.
    const kept = outcome.kind === "later" ? null : note
    const owner: PickOwner = {
      onReady: null,
      onPicked: null,
      onUnfinished: null,
      preset:
        slot?.kind === "dish"
          ? {
              itemId: slot.itemId,
              variantId: null,
              itemName: slot.name,
              variantName: null,
            }
          : null,
      purpose: "general",
      subject: null,
      set: null,
      area: slot?.kind === "area" ? slot.subjectId : null,
      contentTypes: outcome.kind === "shared" ? [outcome.shared] : null,
      note: kept,
      help: unsure,
      onSent: slot || unsure ? setSent : null,
      noLabels: outcome.kind === "later" || (unsure && !kept),
      venueId: runVenue.current ?? venueId,
    }
    claim(files, owner)
    for (const file of files)
      fileRoutes.current.set(
        file,
        outcome.kind === "later" ? "match_later" : matchFlow.current.route
      )
    const slotId = outcome.kind === "slot" ? outcome.slot.id : null
    if (slotId)
      for (const file of files) {
        fileSlots.current.set(file, slotId)
        setSent(file, "sending")
      }
    setOutbox((current) => [...current, ...files])
  }

  const startMatch = (
    files: File[],
    current: string | null,
    decided: MatchOutcome | null,
    fromRequest = false
  ) => {
    const run = (matchSeq.current += 1)
    // A photo the queue would never take is said now and left in the
    // gallery; Match holds only photos it can send.
    const refused = files.flatMap((file) => {
      const why = matchRefusal(file)
      return why ? [why] : []
    })
    const usable = files.filter((file) => !refused.some((r) => r.file === file))
    const kept = usable.slice(0, MATCH_MAX)
    const extra = usable.length - kept.length
    const photos = byCaptureTime(
      kept.map((file, i) => ({ key: `m${run}-${i}`, file }))
    )
    for (const photo of photos) matchKeys.current.set(photo.file, photo.key)
    // S2-METRICS (K5): a manager's Asked for is its own route.
    matchFlow.current = {
      route: fromRequest ? "request" : decided ? "slot" : "gallery",
      batchId: newClientId(),
    }
    trackFlow({
      name: "flow_started",
      ...matchFlow.current,
      count: photos.length,
    })
    if (photos.length > 1)
      trackFlow({
        name: "batch_grouped",
        ...matchFlow.current,
        count: photos.length,
      })
    // The menu, so a dish matched in a moment is labelled as it is sent.
    setCatalogueWanted(true)
    setOutcomes(
      decided ? new Map(photos.map((p) => [p.key, decided])) : new Map()
    )
    setSendStates(new Map())
    setSendProgress(new Map())
    setDuplicates(new Set())
    setBoard({ state: "loading" })
    setLastPlace(readLastPlace())
    setRecent(readRecentSlots(venueId))
    runVenue.current = venueId
    setVenueNotice(null)
    setVenuesMixed(false)
    setMatchRun({
      photos,
      current,
      notice:
        [
          extra > 0 ? MATCH_COPY.tooMany(MATCH_MAX, extra) : null,
          refused.length > 0
            ? MATCH_COPY.notAdded(refused.map((r) => r.reason))
            : null,
        ]
          .filter(Boolean)
          .join(" ") || null,
    })
    if (decided && photos.length > 0)
      sendMatched(
        photos.map((p) => p.file),
        decided
      )
  }

  const decideMatch = (
    key: string,
    outcome: MatchOutcome,
    note: string | null = null
  ) => {
    const photo = matchRun?.photos.find((p) => p.key === key)
    if (!photo || outcomes.has(key)) return
    setOutcomes((current) => new Map(current).set(key, outcome))
    const target = outcome.kind === "slot" ? outcome.slot.target : null
    trackFlow({
      name:
        outcome.kind === "slot"
          ? "subject_selected"
          : outcome.kind === "later"
            ? "match_later"
            : outcome.kind === "unsure"
              ? "label_uncertain"
              : "not_for_slot",
      ...matchFlow.current,
      subjectKind: target?.kind ?? null,
      subjectId: target
        ? target.kind === "dish"
          ? target.itemId
          : target.subjectId
        : null,
    })
    if (outcome.kind === "slot") {
      const place = placeKey(outcome.slot.place)
      writeLastPlace(place)
      setLastPlace(place)
      writeRecentSlot(venueId, outcome.slot.id)
    }
    sendMatched([photo.file], outcome, note)
  }

  // AC11, spec §6 S2: the active venue changed while Match is open (another
  // tab, or a venue switch). Every choice whose photo has not started its
  // reservation is undone and asked again against the new venue's slots:
  // those still in the outbox, and those handed to the queue that are
  // waiting their turn (only maxParallelUploads run at once). The queue drops
  // the latter when their turn comes (UploadWithdrawnError). A photo whose
  // reservation already started belongs to the old venue and finishes there
  // (R10). Each file also carries its venue to the server, which refuses it
  // at another one (wrong_venue), so nothing lands at the new venue unasked.
  const revalidateVenue = () => {
    if (matchRun && runVenue.current && venueId !== runVenue.current) {
      const old = runVenue.current
      runVenue.current = venueId
      const waitingFiles = new Set(outbox)
      const undone = matchRun.photos.filter(
        (p) =>
          waitingFiles.has(p.file) ||
          (fileOwners.current.get(p.file)?.venueId === old &&
            !reserveStarted.current.has(p.file))
      )
      setOutbox((current) =>
        current.filter((file) => !matchKeys.current.has(file))
      )
      if (undone.length > 0) {
        const keys = new Set(undone.map((p) => p.key))
        setOutcomes(
          (current) => new Map([...current].filter(([key]) => !keys.has(key)))
        )
        setSendStates(
          (current) => new Map([...current].filter(([key]) => !keys.has(key)))
        )
        for (const photo of undone) {
          // Every queue item of this photo still waiting its turn was handed
          // for an earlier choice: each is dropped at its turn (W6).
          const turns = waitingTurns.current.get(photo.file)
          if (turns && turns.size > 0) {
            const taken = withdrawn.current.get(photo.file) ?? new Set<string>()
            for (const turn of turns) taken.add(turn)
            withdrawn.current.set(photo.file, taken)
            waitingTurns.current.delete(photo.file)
          }
          fileOwners.current.delete(photo.file)
          claimedFiles.current.delete(photo.file)
          const slot = fileSlots.current.get(photo.file)
          fileSlots.current.delete(photo.file)
          if (slot) settleSlot(slot)
        }
      }
      // Answers that stay went to the old venue: the end names no one venue.
      if (
        matchRun.photos.some((p) => outcomes.has(p.key) && !undone.includes(p))
      )
        setVenuesMixed(true)
      setRecent(readRecentSlots(venueId))
      setBoard({ state: "loading" })
      setBoardTry((n) => n + 1)
      setVenueNotice(MATCH_COPY.venueChanged(venueName ?? "", undone.length))
    }
  }
  // Another tab changed venue: this tab's layout reads it again, so venueId
  // changes here and the run is revalidated (E7).
  useVenueChanges((next) => {
    if (next !== venueId) router.refresh()
  })
  const revalidateRef = React.useRef(revalidateVenue)
  React.useLayoutEffect(() => {
    revalidateRef.current = revalidateVenue
  })
  React.useEffect(() => {
    revalidateRef.current()
  }, [venueId])

  /** Closing Match keeps every photo: the rest go under Match later. */
  const closeMatch = () => {
    const rest = matchRun?.photos.filter((p) => !outcomes.has(p.key)) ?? []
    if (rest.length > 0)
      sendMatched(
        rest.map((p) => p.file),
        { kind: "later" }
      )
    setMatchRun(null)
  }

  // What the gallery's next pick is for: today's Add, Match, or one slot.
  const pickMode = React.useRef<
    | { kind: "add" }
    | { kind: "match"; place: string | null; request: boolean }
    | { kind: "slot"; slot: MatchTarget; request: boolean }
  >({ kind: "add" })

  // Add's own picker (the phone's gallery; Add has no camera, DESIGN.md §9),
  // for openAdd({ source }), Match and a slot. Outside any dialog, so a
  // click on it never lands on content a modal has made inert.
  const picker = useGalleryPicker({
    onFiles: (files) => {
      const mode = pickMode.current
      pickMode.current = { kind: "add" }
      const owner = pickerOwner.current
      pickerOwner.current = null
      if (mode.kind === "match") {
        startMatch(files, mode.place, null, mode.request)
        return
      }
      if (mode.kind === "slot") {
        startMatch(
          files.slice(0, 1),
          null,
          { kind: "slot", slot: slotOf(mode.slot) },
          mode.request
        )
        return
      }
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
      // Match: an area slot's photo gets its venue-area label (G-9), and an
      // I'm not sure photo goes to the manager (FA-4), as soon as the server
      // has reserved it; a failure is tried again when ready.
      const matchOwner = fileOwners.current.get(file)
      if (matchOwner?.area || matchOwner?.help)
        void saveArea(file, assetId, matchOwner)
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
    [photoSets, setReplaceState, labelJournal, saveArea]
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
    (
      ids: string[],
      files: File[],
      receipts?: UploadReceipt[],
      duplicate?: boolean[]
    ) => {
      let kept = true
      ids.forEach((id, i) => {
        const owner = fileOwners.current.get(files[i])
        // Saved: nothing left for its labels to clear (M5).
        labelJournal.forgetAsset(id)
        // A photo the server failed, retried and finished, counts again.
        if (owner?.set) photoSets.finished(owner.set, id)
        if (owner?.onReady?.([id]) === false) kept = false
        if (owner?.area || owner?.help) {
          areaReady.current.add(id)
          if (areaTries.current.get(id) === "failed")
            void saveArea(files[i], id, owner)
        }
        // Sent before (same bytes at this venue): it counts once (AC21).
        const key = matchKeys.current.get(files[i])
        if (duplicate?.[i] && key)
          setDuplicates((current) => new Set(current).add(key))
        // Never Waiting without a review entry (spec §5.6): a photo whose
        // slot could not be saved with it reads Sent. A dish is its label:
        // until finalise saved it (Waiting) or a later save is confirmed, it
        // reads Sent, and turns Waiting when the save is (V8).
        const receipt = receipts?.[i]
        const labelPending =
          !!owner?.preset &&
          receipt !== "sent_for_review" &&
          !labelSaved.current.has(id)
        if (labelPending && receipt !== "label_not_saved")
          awaitingLabel.current.set(id, files[i])
        const sendState: SendState =
          receipt === "label_not_saved" || labelPending ? "sent" : "waiting"
        owner?.onSent?.(files[i], sendState)
        trackFlow({
          name: "submitted",
          assetId: id,
          route: fileRoutes.current.get(files[i]) ?? null,
          outcome: sendState,
        })
      })
      for (const listener of readyListeners.current) listener(ids)
      return kept
    },
    [photoSets, labelJournal, saveArea]
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

  // Files that need the person: failed, stopped, or labels needing them.
  const needing = busy.failed + busy.stopped + (busy.attention ?? 0)
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
        // Match and a slot's own photo are staff work (area labels earn
        // month credit): a manager account gets the gallery, a dish kept.
        // Add photos (Match): a photo that needs the person (failed,
        // stopped, or its labels need attention) is shown first, as today's
        // Add does; photos only sending never hold back the next pick. A
        // slot's own tile still opens its gallery, as any picker source does.
        if (opts.match && !blocked && role === "staff" && needing > 0) {
          sheetOwner.current = null
          pickerOwner.current = null
          setUploadOpen(true)
          return
        }
        if ((opts.match || opts.slot) && !blocked && role === "staff") {
          sheetOwner.current = null
          pickerOwner.current = null
          setImagesOnly(true)
          const request = opts.route === "request"
          pickMode.current = opts.slot
            ? { kind: "slot", slot: opts.slot, request }
            : { kind: "match", place: opts.match?.place ?? null, request }
          openPicker({ multiple: !opts.slot, imagesOnly: true })
          return
        }
        const slotPreset: AddLabelPreset | null =
          opts.slot?.kind === "dish"
            ? {
                itemId: opts.slot.itemId,
                variantId: null,
                itemName: opts.slot.name,
                variantName: null,
              }
            : null
        const owner: PickOwner = {
          onReady: opts.onReady ?? null,
          onPicked: opts.onPicked ?? null,
          onUnfinished: opts.onUnfinished ?? null,
          preset: opts.preset ?? slotPreset,
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
        // Every source is the gallery (DESIGN.md §9); Match and a slot open
        // it too where they are not offered.
        const toPicker =
          (!!opts.source || !!opts.match || !!opts.slot) && !blocked
        pickerOwner.current = toPicker ? owner : null
        sheetOwner.current = toPicker ? null : owner
        const only = opts.imagesOnly ?? (!!opts.match || !!opts.slot)
        setImagesOnly(only)
        if (toPicker) {
          // Synchronous: the picker needs this click's user activation. The
          // accept list is set for this call before the click.
          pickMode.current = { kind: "add" }
          openPicker({ multiple: !opts.slot, imagesOnly: only })
          return
        }
        showAdd(opts.dialog)
      },
      onReady,
      labelled,
      discarded,
      busy: waiting > 0 ? { count: waiting, words: busyWords } : null,
      active: inProgress,
      failed: busy.failed + busy.stopped,
      refreshSignal,
      holds,
      intents,
      slots: slotSends,
      settleSlot,
      earlier: resumable.length,
    }),
    [
      slotSends,
      settleSlot,
      resumable.length,
      inProgress,
      blocked,
      ended,
      needing,
      intents,
      entry,
      showAdd,
      waiting,
      busy.failed,
      busy.stopped,
      busyWords,
      refreshSignal,
      onReady,
      labelled,
      discarded,
      openPicker,
      holds,
      role,
    ]
  )

  // With Add closed, a file that newly needs the person is said once, in
  // one polite region for the whole app (the Add button's name alone is
  // never announced).
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
      // Taken back by Match before its turn: dropped, never reserved. The
      // photo may have been matched again since, as a new queue item, which
      // keeps its own turn (W6).
      const turn = context.batchId
      if (turn !== undefined) waitingTurns.current.get(file)?.delete(turn)
      const taken = withdrawn.current.get(file)
      if (turn !== undefined && taken?.delete(turn)) {
        throw new UploadWithdrawnError()
      }
      reserveStarted.current.add(file)
      const owner = fileOwners.current.get(file)
      const purpose = owner?.purpose
      const forVenue = owner?.venueId ?? null
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
          ...(forVenue ? { venueId: forVenue } : {}),
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
        return (
          !owner ||
          (!owner.onReady && owner.purpose === "general" && !owner.noLabels)
        )
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
        const owner = fileOwners.current.get(item.file)
        const preset = owner?.preset ?? null
        // Match's Not for a slot: what the photo shows.
        const types = owner?.contentTypes ?? []
        // Match's optional note (spec §5.1).
        const note = owner?.note ?? null
        if (!preset && types.length === 0 && !note) return null
        if (labelContext && !labelContext.ok) return "unavailable"
        if (!catalogue) return undefined
        if (preset && !onMenu(catalogue, preset)) return null
        return {
          venueId: catalogue.venueId,
          input: {
            assetId: item.id,
            expectedRevision: 0,
            catalogueVersionId:
              catalogue.status === "active" ? catalogue.versionId : null,
            contentTypes: types,
            note,
            items: preset
              ? [{ itemId: preset.itemId, variantId: preset.variantId }]
              : [],
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
        if (result.ok) {
          labelJournal.confirmed(input)
          // "saved": on the photo now. "pending" is staged for finalise,
          // whose own receipt says whether it took (sent_for_review).
          if (result.state === "saved" && input.items.length > 0) {
            labelSaved.current.add(input.assetId)
            const file = awaitingLabel.current.get(input.assetId)
            if (file) {
              awaitingLabel.current.delete(input.assetId)
              fileOwners.current.get(file)?.onSent?.(file, "waiting")
            }
          }
        }
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
          areas={role === "staff"}
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
                queueWhileClosed
                allowCamera={false}
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
                onRoomChange={setRoom}
                onQueued={queued}
                onHoldsChange={holdsChanged}
                onProcessing={(file) =>
                  fileOwners.current.get(file)?.onSent?.(file, "checking")
                }
                onProgress={progressed}
                controlRef={uploadControl}
                onUnfinished={(file, reason, stage, retryable) => {
                  if (reason === "failed")
                    trackFlow({
                      name: "transfer_failed",
                      route: fileRoutes.current.get(file) ?? null,
                      stage: stage === "processing" ? "processing" : "transfer",
                    })
                  // Removed or cancelled: its asset needs no label clear (M5).
                  if (reason !== "failed") labelJournal.forgetFile(file)
                  fileOwners.current.get(file)?.onUnfinished?.(reason, file)
                  fileOwners.current.get(file)?.onSent?.(
                    file,
                    // The server refused to finish it for good: Retry
                    // cannot help; choosing it again starts anew (§5.6).
                    retryable === false
                      ? "unprocessable"
                      : stage === "processing"
                        ? "unfinished"
                        : "failed"
                  )
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
              <MatchScreen
                open={matchRun !== null}
                photos={matchRun?.photos ?? []}
                outcomes={outcomes}
                sendStates={sendStates}
                progress={sendProgress}
                onRetry={retryMatched}
                board={board}
                onRetryBoard={retryBoard}
                current={matchRun?.current ?? null}
                last={lastPlace}
                notice={
                  [venueNotice, matchRun?.notice ?? null]
                    .filter(Boolean)
                    .join(" ") || null
                }
                busySlots={sendingSlots}
                venueName={
                  (board.state === "ready" ? board.board.venue?.name : null) ??
                  venueName
                }
                venuesMixed={venuesMixed}
                recent={recent}
                duplicates={duplicates}
                onSuggestSpecial={(name, kind) =>
                  suggestSpecialAction(name, kind)
                }
                onDecide={decideMatch}
                onClose={closeMatch}
              />
              <OutboxGuard
                count={outbox.length}
                onLeave={() => setOutbox([])}
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

/** Match's outbox counts as uploads that stop if the person leaves. */
function OutboxGuard({
  count,
  onLeave,
}: {
  count: number
  onLeave: () => void
}) {
  useLeaveGuard(count, onLeave)
  return null
}

/**
 * Why Match leaves a picked file in the gallery: what the queue would refuse
 * on its own (type, size, empty), or a video (Match takes photos only).
 */
function matchRefusal(file: File): RejectedFile | null {
  const refused = checkFile(file, MEDIA_LIMITS)
  if (refused) return refused
  return guessMediaKind(file) === "image"
    ? null
    : { name: file.name, reason: MATCH_COPY.photosOnly, file }
}

/** A slot's tile target as Match's slot (DESIGN.md §5 Slot tile). */
function slotOf(target: MatchTarget) {
  return {
    id:
      target.kind === "dish"
        ? `dish:${target.itemId}`
        : `area:${target.subjectId}`,
    name: target.name,
    group: "",
    place: null,
    placeLabel: "",
    brief: null,
    target,
  }
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
  areas = false,
}: UploadLabelPanelHostProps & {
  catalogue: CatalogueProp
  venueId: string | null
  focus: WorkFocus | null
  onRetryCatalogue: () => void
  presetOf: (file: File) => AddLabelPreset | null
  dishShown: (id: string) => boolean
  onDishShown: (id: string) => void
  held: Map<string, HeldLabels>
  /** G-9: offer the venue-area label (staff accounts). */
  areas?: boolean
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
  // G-9: images only; a photo still reserving gets the area when it can.
  const images = items.filter(
    (item) => item.kind === "image" && !disabledIds.includes(item.id)
  )
  const area = areas ? (
    <AreaLabelField
      assetIds={images.flatMap((item) => (item.assetId ? [item.assetId] : []))}
      waitingCount={images.filter((item) => !item.assetId).length}
    />
  ) : null
  return (
    <>
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
      {area}
    </>
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
