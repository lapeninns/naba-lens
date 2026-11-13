// Where the capture journal lives in the browser (b05-design §5, B05-05c and
// d; OD-B5-05-1). One journal per signed-in account, opened once:
//
//   1. the account claims this device's capture data (a different account's
//      journal and upload keys go first), before any upload key is read;
//   2. the capability probe decides whether photo bytes may be kept;
//   3. the IndexedDB backend when the probe allows it, else memory only;
//   4. the journal opens (other accounts' and expired entries are deleted);
//   5. pagehide and visibilitychange (hidden) write throttled progress now.
//
// A sign-out in another tab removes the account marker: this journal then
// stops writing. Files are linked to their entries here, by File, so the
// transport (queue-adapter) and the screen (AddHost) write to one entry.
// Nothing here is logged or sent anywhere.

import {
  detectCaptureCapabilities,
  type CaptureCapabilities,
} from "./capabilities"
import {
  claimCaptureDataForAccount,
  type DeviceCleanupEnvironment,
} from "./device-cleanup"
import {
  accountHash,
  indexedDbJournalBackend,
  JOURNAL_ACCOUNT_STORAGE_KEY,
  JOURNAL_UNTRUSTED_STORAGE_KEY,
  memoryJournalBackend,
  openCaptureJournal,
  type CaptureJournal,
  type JournalBackend,
  type JournalEntry,
  type JournalSubject,
} from "./journal"

export type CaptureSession = {
  accountHash: string
  capabilities: CaptureCapabilities
  /** Writes stop (no-ops) once the session is invalidated. */
  journal: CaptureJournal
  /** False once another tab signed out or another account took over. */
  alive(): boolean
}

/** What the screen knows about a file that the transport doesn't. */
export type CaptureAnnotation = {
  subject?: JournalSubject
  groupKey?: string | null
  pendingLabels?: unknown
}

export type CaptureSessionDeps = {
  probe?: () => Promise<CaptureCapabilities>
  /** IndexedDB for the backend (when the probe allows it). */
  indexedDB?: () => IDBFactory | undefined
  /** Where the account marker lives, and the clean-up's environment. */
  cleanup?: () => DeviceCleanupEnvironment
  /** Where pagehide, visibilitychange and storage are listened to. */
  events?: () => Pick<Window, "addEventListener"> | null
  /** document, for visibilityState. */
  document?: () => Pick<Document, "visibilityState"> | null
  backend?: (capabilities: CaptureCapabilities) => JournalBackend
}

type Live = {
  hash: string
  session: Promise<CaptureSession | null>
  alive: boolean
}

/** A journal that ignores every call once `alive()` is false. */
function guarded(
  journal: CaptureJournal,
  alive: () => boolean
): CaptureJournal {
  const off = <T>(value: T) => Promise.resolve(value)
  return {
    pick: (input) => (alive() ? journal.pick(input) : off(null)),
    update: (id, patch) =>
      alive() ? journal.update(id, patch) : off(undefined),
    progress: (id, bytes) =>
      alive() ? journal.progress(id, bytes) : off(undefined),
    flush: () => (alive() ? journal.flush() : off(undefined)),
    fail: (id, code, permanent) =>
      alive() ? journal.fail(id, code, permanent) : off(undefined),
    done: (id) => (alive() ? journal.done(id) : off(undefined)),
    unfinished: () => (alive() ? journal.unfinished() : off([])),
    clear: () => (alive() ? journal.clear() : off(undefined)),
  }
}

function browserEvents() {
  return typeof window === "undefined" ? null : window
}
function browserDocument() {
  return typeof document === "undefined" ? null : document
}
function browserIndexedDb() {
  try {
    return typeof window === "undefined"
      ? undefined
      : (window.indexedDB ?? undefined)
  } catch {
    return undefined
  }
}

/**
 * Sessions for one page. `get(userId)` is memoised per account: the same
 * account gets the same journal; another account drops the old one first.
 */
export function createCaptureSessions(deps: CaptureSessionDeps = {}) {
  let live: Live | null = null
  let listening = false

  const events = deps.events ?? browserEvents
  const doc = deps.document ?? browserDocument

  function invalidate() {
    if (live) live.alive = false
    live = null
  }

  function listen() {
    if (listening) return
    const target = events()
    if (!target) return
    listening = true
    const flush = () => {
      const current = live
      if (!current?.alive) return
      void current.session.then((s) => s?.journal.flush())
    }
    target.addEventListener("pagehide", flush)
    target.addEventListener("visibilitychange", () => {
      if (doc()?.visibilityState === "hidden") flush()
    })
    // A sign-out (or another account) in another tab: stop writing here.
    target.addEventListener("storage", (event) => {
      const e = event as StorageEvent
      if (e.key !== JOURNAL_ACCOUNT_STORAGE_KEY && e.key !== null) return
      if (live && e.newValue !== live.hash) invalidate()
    })
  }

  /**
   * The account marker on this device now. Undefined when storage can't be
   * read at all (then only the storage event can tell another tab's
   * sign-out); null when there is none.
   */
  function storageOf() {
    try {
      return (
        deps.cleanup?.().storage ??
        (typeof window === "undefined" ? undefined : window.localStorage)
      )
    } catch {
      return undefined
    }
  }

  function marker(): string | null | undefined {
    try {
      const storage = storageOf()
      if (!storage) return undefined
      return storage.getItem(JOURNAL_ACCOUNT_STORAGE_KEY)
    } catch {
      return undefined
    }
  }

  async function open(
    hash: string,
    entry: Live
  ): Promise<CaptureSession | null> {
    // Hear another tab's sign-out from the start, even during this open (K1).
    listen()
    // Before any upload key is read or anything is shown (§5.2 item 4).
    claimCaptureDataForAccount(hash, deps.cleanup?.())
    // Alive while not invalidated and the device is still this account's,
    // checked before every write (K6): a dead session never writes, so it
    // never reopens a deleted database either.
    const alive = () => {
      const now = marker()
      return entry.alive && (now === undefined || now === hash)
    }
    const capabilities = await (deps.probe ?? detectCaptureCapabilities)()
    const raw = deps.backend
      ? deps.backend(capabilities)
      : capabilities.indexedDb && (deps.indexedDB ?? browserIndexedDb)()
        ? indexedDbJournalBackend((deps.indexedDB ?? browserIndexedDb)()!)
        : memoryJournalBackend()
    const backend: JournalBackend = {
      getAll: () => (alive() ? raw.getAll() : Promise.resolve([])),
      put: (e) => (alive() ? raw.put(e) : Promise.resolve()),
      delete: (id) => (alive() ? raw.delete(id) : Promise.resolve()),
      clear: () => (alive() ? raw.clear() : Promise.resolve()),
    }
    if (!alive()) return null
    // A journal that degraded on an earlier page dropped writes (N1): clear
    // the store before anything is listed, and trust it again.
    const store = storageOf()
    let untrusted = false
    try {
      untrusted = !!store?.getItem(JOURNAL_UNTRUSTED_STORAGE_KEY)
    } catch {
      untrusted = false
    }
    if (untrusted) {
      await raw.clear().catch(() => {})
      try {
        store?.removeItem(JOURNAL_UNTRUSTED_STORAGE_KEY)
      } catch {
        // Kept: the next open clears again.
      }
    }
    const journal = await openCaptureJournal({
      backend,
      accountHash: hash,
      capabilities,
      onDegrade: () => {
        try {
          store?.setItem(JOURNAL_UNTRUSTED_STORAGE_KEY, "1")
        } catch {
          // Storage blocked: nothing to mark, and nothing persisted there.
        }
      },
    })
    // Signed out (or switched) in another tab while this opened.
    if (!alive()) {
      entry.alive = false
      return null
    }
    return {
      accountHash: hash,
      capabilities,
      journal: guarded(journal, alive),
      alive,
    }
  }

  return {
    /** The journal for this signed-in account (null without crypto). */
    async get(userId: string): Promise<CaptureSession | null> {
      let hash: string
      try {
        hash = await accountHash(userId)
      } catch {
        return null
      }
      if (live?.hash === hash && live.alive) return live.session
      invalidate()
      const entry: Live = { hash, alive: true, session: Promise.resolve(null) }
      // Live before the open starts, so a storage event during it counts.
      live = entry
      entry.session = open(hash, entry).catch(() => null)
      return entry.session
    },
    /** Drops the current journal (tests; an explicit sign-out here). */
    reset: invalidate,
  }
}

const pageSessions = createCaptureSessions()

/** The page's capture journal for this account (OD-B5-05-1). */
export function getCaptureJournal(
  userId: string
): Promise<CaptureSession | null> {
  return pageSessions.get(userId)
}

// ---- Files and their entries -----------------------------------------------

const annotations = new WeakMap<File, CaptureAnnotation>()
/** Rows removed before their entry existed: the entry goes when it does (K10). */
const forgotten = new WeakSet<File>()
const bindings = new WeakMap<File, { journal: CaptureJournal; id: string }>()

/** What the screen knows about `file` so far (read by the transport at pick). */
export function captureAnnotation(file: File): CaptureAnnotation | undefined {
  return annotations.get(file)
}

/**
 * The screen learned something about `file` (its subject, set key or the
 * labels typed before reservation): kept for its pick, or written to its
 * entry when it has one.
 */
export function annotateCapture(file: File, patch: CaptureAnnotation): void {
  annotations.set(file, { ...annotations.get(file), ...patch })
  const bound = bindings.get(file)
  if (!bound) return
  const update: Partial<Pick<JournalEntry, "groupKey" | "pendingLabels">> = {}
  if ("groupKey" in patch) update.groupKey = patch.groupKey ?? null
  if ("pendingLabels" in patch) update.pendingLabels = patch.pendingLabels
  if (Object.keys(update).length) void bound.journal.update(bound.id, update)
}

/** The transport recorded `file` as entry `id`. */
export function bindCapture(
  file: File,
  journal: CaptureJournal,
  id: string
): void {
  if (forgotten.has(file)) {
    forgotten.delete(file)
    void journal.done(id)
    return
  }
  bindings.set(file, { journal, id })
}

/** The entry id of `file` in this tab, if it has one. */
export function captureEntryId(file: File): string | null {
  return bindings.get(file)?.id ?? null
}

/** The row was removed or the queue cleared (OD-B5-05-7): the entry goes. */
export function forgetCapture(file: File): void {
  const bound = bindings.get(file)
  annotations.delete(file)
  if (!bound) {
    // Its pick may still be on its way.
    forgotten.add(file)
    return
  }
  bindings.delete(file)
  void bound.journal.done(bound.id)
}
