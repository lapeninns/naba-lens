// Bounded, account-scoped capture journal (b05-design §5, B05-05b to e).
// Keeps what was picked and how far its upload got, so a closed or discarded
// tab can be continued (photo bytes kept) or re-picked with exact copy (no
// bytes). It never uploads by itself and never promises background upload.
// Nothing here is logged or sent anywhere.

import type { CaptureCapabilities } from "./capabilities"
import type { UploadPurpose } from "./types"

export const JOURNAL_DB_NAME = "nabalens-capture-journal"
/** Which account's entries the journal last held (a SHA-256, never the id). */
export const JOURNAL_ACCOUNT_STORAGE_KEY = "nabalens-capture-account"
/**
 * Set when a journal degraded (N1): writes after that were dropped, so what
 * is stored can't be trusted. The next open clears the whole store first.
 */
export const JOURNAL_UNTRUSTED_STORAGE_KEY =
  "nabalens-capture-journal-untrusted"

/** §5.3 technical defaults (reversible). */
export const JOURNAL_LIMITS = {
  maxEntries: 50,
  /** Below the server's 24 h abandoned-upload window. */
  expiryMs: 20 * 60 * 60 * 1000,
  maxPhotoBytes: 20 * 1024 * 1024,
  maxFilesWithBytes: 10,
  maxTotalBytes: 100 * 1024 * 1024,
  /** Bytes are kept only when at least this many times their size is free. */
  freeSpaceFactor: 2,
  progressThrottleMs: 2000,
} as const

export type JournalState =
  | "picked"
  | "reserved"
  | "transferring"
  | "finalising"
  | "done"
  | "failed"
  | "needs_reselection"

export type JournalSubject = {
  kind: "menu_item" | "task" | "question" | "none"
  id: string | null
  /**
   * The subject's name as the screen showed it (a dish), so a set rebuilt in
   * another tab can be worded (OD-B5-05-9 follow-up). On this device only,
   * like displayName; absent on entries written before it.
   */
  name?: string
}

export type JournalEntry = {
  id: string
  accountHash: string
  createdAt: number
  touchedAt: number
  expiresAt: number
  purpose: UploadPurpose
  subject: JournalSubject
  groupKey: string | null
  uploadKey: string
  assetId: string | null
  fileFingerprint: string
  displayName: string
  mediaType: "image" | "video"
  sizeBytes: number
  state: JournalState
  /** Bytes sent so far (throttled), for the progress line after a reopen. */
  transferredBytes?: number
  failure?: { code: string; permanent: boolean }
  /** Labels typed before reservation (UP-04), in stage_media_labels' shape. */
  pendingLabels?: unknown
  /** Photos only, within the limits. */
  bytes?: Blob
}

/** Where entries live. All methods may throw; the journal treats that as "not kept". */
export type JournalBackend = {
  getAll(): Promise<JournalEntry[]>
  put(entry: JournalEntry): Promise<void>
  delete(id: string): Promise<void>
  clear(): Promise<void>
}

/** What to offer for an unfinished entry (§5.4). */
export type ResumeAction =
  /** Bytes are here: one tap continues the same asset (same key, TUS offset). */
  | { kind: "continue" }
  /** "{name} didn't finish. Choose it again from Add; it continues where it stopped." */
  | { kind: "reselect" }
  /** A permanent failure: picking the same file fails again. */
  | { kind: "choose_different"; code: string }

export function resumeAction(entry: JournalEntry): ResumeAction {
  if (entry.failure?.permanent)
    return { kind: "choose_different", code: entry.failure.code }
  if (entry.bytes && entry.state !== "needs_reselection")
    return { kind: "continue" }
  return { kind: "reselect" }
}

export type PickInput = {
  purpose: UploadPurpose
  subject: JournalSubject
  groupKey: string | null
  uploadKey: string
  fileFingerprint: string
  file: Pick<File, "name" | "size" | "type"> & Partial<Blob>
  mediaType: "image" | "video"
  pendingLabels?: unknown
}

export type CaptureJournal = {
  /** Records a picked file; keeps photo bytes when the limits allow. */
  pick(input: PickInput): Promise<JournalEntry | null>
  /** Any lifecycle step except progress. Unknown or expired ids are ignored. */
  update(
    id: string,
    patch: Partial<
      Pick<JournalEntry, "state" | "assetId" | "pendingLabels" | "groupKey">
    >
  ): Promise<void>
  /** Transfer progress, written at most once per throttle window per entry. */
  progress(id: string, transferredBytes: number): Promise<void>
  /** Writes any throttled progress now (pagehide, visibilitychange hidden). */
  flush(): Promise<void>
  /** Finalise reported a failure; the code stays on this device only. */
  fail(id: string, code: string, permanent: boolean): Promise<void>
  /** Finalised: the entry and its bytes go. */
  done(id: string): Promise<void>
  /** Unfinished, unexpired entries of this account, newest first. */
  unfinished(): Promise<JournalEntry[]>
  /** Removes every entry (any account). */
  clear(): Promise<void>
}

export type CaptureJournalOptions = {
  backend: JournalBackend
  /** SHA-256 of the signed-in user's id (see accountHash). */
  accountHash: string
  capabilities: Pick<
    CaptureCapabilities,
    "storeBytes" | "quotaBytes" | "usageBytes"
  >
  now?: () => number
  randomId?: () => string
  /** When a running operation counts as stuck (default JOURNAL_STUCK_MS). */
  stuckMs?: number
  /** How long unfinished() waits for running operations (default JOURNAL_READ_WAIT_MS). */
  readWaitMs?: number
  /** Told once when the journal degrades (to mark the store untrusted). */
  onDegrade?: () => void
}

/**
 * An operation still running after this long marks the journal degraded
 * (M1): from then on every call answers its fallback at once and nothing
 * touches storage again on this page. The stuck operation may still finish;
 * nothing runs after it, so it can't overwrite a newer write.
 */
export const JOURNAL_STUCK_MS = 5000
/** How long unfinished() waits for running operations before answering []. */
export const JOURNAL_READ_WAIT_MS = 2000

/** SHA-256 of the user id; the raw id is never stored. */
export async function accountHash(userId: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`nabalens-journal:${userId}`)
  )
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("")
}

/**
 * Opens the journal for one account. Before anything is returned, entries of
 * any other account and expired entries are deleted (§5.2 items 4 and 5).
 */
export async function openCaptureJournal(
  options: CaptureJournalOptions
): Promise<CaptureJournal> {
  const { backend, capabilities } = options
  const now = options.now ?? Date.now
  const randomId = options.randomId ?? (() => globalThis.crypto.randomUUID())
  const pending = new Map<string, number>()
  const lastWrite = new Map<string, number>()
  // Every change reads an entry and writes it back: run them one at a time,
  // so a fire-and-forget call never overwrites another's write (K11).
  // Strict order: operation N+1 never starts while N is still running
  // against storage. A stuck one degrades the journal instead (M1).
  let chain: Promise<unknown> = Promise.resolve()
  let degraded = false
  const stuckMs = options.stuckMs ?? JOURNAL_STUCK_MS
  /** Callers waiting behind a running operation, answered if it gets stuck. */
  const waiting = new Set<() => void>()
  const degrade = () => {
    if (!degraded) options.onDegrade?.()
    degraded = true
    for (const answer of [...waiting]) answer()
    waiting.clear()
  }
  const serial = <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    if (degraded) return Promise.resolve(fallback)
    const run = chain.then(async () => {
      if (degraded) return fallback
      const timer = setTimeout(degrade, stuckMs)
      try {
        return await fn()
      } catch {
        return fallback
      } finally {
        clearTimeout(timer)
      }
    })
    chain = run
    return new Promise<T>((resolve) => {
      const answer = () => resolve(fallback)
      waiting.add(answer)
      void run.then((value) => {
        waiting.delete(answer)
        resolve(value)
      })
    })
  }
  const readWait = options.readWaitMs ?? JOURNAL_READ_WAIT_MS

  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn()
    } catch {
      return fallback
    }
  }
  const all = () => safe(() => backend.getAll(), [] as JournalEntry[])

  for (const entry of await all())
    if (entry.accountHash !== options.accountHash || entry.expiresAt <= now())
      await safe(() => backend.delete(entry.id), undefined)

  const mine = async () =>
    (await all()).filter(
      (e) => e.accountHash === options.accountHash && e.expiresAt > now()
    )

  async function save(entry: JournalEntry) {
    const t = now()
    await backend.put({
      ...entry,
      touchedAt: t,
      expiresAt: t + JOURNAL_LIMITS.expiryMs,
    })
  }

  /** Bytes first (oldest first), then the oldest metadata (§5.9 order). */
  async function enforceLimits(keep: string) {
    const entries = (await mine()).sort((a, b) => a.touchedAt - b.touchedAt)
    const withBytes = entries.filter((e) => e.bytes)
    let total = withBytes.reduce((n, e) => n + (e.bytes?.size ?? 0), 0)
    let files = withBytes.length
    for (const e of withBytes) {
      if (
        files <= JOURNAL_LIMITS.maxFilesWithBytes &&
        total <= JOURNAL_LIMITS.maxTotalBytes
      )
        break
      if (e.id === keep) continue
      total -= e.bytes?.size ?? 0
      files--
      const { bytes: _dropped, ...rest } = e
      void _dropped
      await backend.put({
        ...rest,
        state: rest.state === "done" ? rest.state : "needs_reselection",
      })
    }
    const overflow = entries.length - JOURNAL_LIMITS.maxEntries
    for (const e of entries.slice(0, Math.max(0, overflow)))
      if (e.id !== keep) await backend.delete(e.id)
  }

  function bytesAllowed(
    input: PickInput,
    existingTotal: number,
    existingFiles: number
  ) {
    if (!capabilities.storeBytes || input.mediaType !== "image") return false
    if (!(input.file instanceof Blob)) return false
    const size = input.file.size
    if (size <= 0 || size > JOURNAL_LIMITS.maxPhotoBytes) return false
    if (existingFiles + 1 > JOURNAL_LIMITS.maxFilesWithBytes) return false
    if (existingTotal + size > JOURNAL_LIMITS.maxTotalBytes) return false
    const { quotaBytes, usageBytes } = capabilities
    if (quotaBytes === null || usageBytes === null) return false
    // usage is from the probe; bytes the journal stored since then count too.
    return (
      quotaBytes - usageBytes - existingTotal >=
      size * JOURNAL_LIMITS.freeSpaceFactor
    )
  }

  async function find(id: string) {
    return (await mine()).find((e) => e.id === id) ?? null
  }

  /**
   * A patch as stored: a reserve (or later step) clears an earlier failure
   * (K9); `pendingLabels: undefined` clears the labels typed before
   * reservation, once the label store says the server took them (L1); bytes
   * go once finalising starts (K12).
   */
  function patched(
    entry: JournalEntry,
    patch: Partial<
      Pick<JournalEntry, "state" | "assetId" | "pendingLabels" | "groupKey">
    >
  ): JournalEntry {
    const next: JournalEntry = { ...entry, ...patch }
    const moving =
      patch.state === "reserved" ||
      patch.state === "transferring" ||
      patch.state === "finalising"
    if (moving) delete next.failure
    // Cleared once the server took the labels (L1: the label store says so).
    if ("pendingLabels" in patch && patch.pendingLabels === undefined)
      delete next.pendingLabels
    if (patch.state === "finalising") delete next.bytes
    return next
  }

  return {
    pick: (input) => serial(() => pickNow(input), null),
    update: (id, patch) =>
      serial(async () => {
        const entry = await find(id)
        if (!entry) return
        await safe(() => save(patched(entry, patch)), undefined)
      }, undefined),
    progress(id, transferredBytes) {
      pending.set(id, transferredBytes)
      const t = now()
      if (t - (lastWrite.get(id) ?? 0) < JOURNAL_LIMITS.progressThrottleMs)
        return Promise.resolve()
      lastWrite.set(id, t)
      pending.delete(id)
      return serial(async () => {
        const entry = await find(id)
        if (entry)
          await safe(() => save(progressed(entry, transferredBytes)), undefined)
      }, undefined)
    },
    flush: () =>
      serial(async () => {
        for (const [id, transferredBytes] of [...pending]) {
          pending.delete(id)
          lastWrite.set(id, now())
          const entry = await find(id)
          if (entry)
            await safe(
              () => save(progressed(entry, transferredBytes)),
              undefined
            )
        }
      }, undefined),
    fail: (id, code, permanent) =>
      serial(async () => {
        const entry = await find(id)
        if (!entry) return
        const next: JournalEntry = {
          ...entry,
          state: "failed",
          failure: { code, permanent },
        }
        // A permanent failure is never continued: its bytes go (K12).
        if (permanent) delete next.bytes
        await safe(() => save(next), undefined)
      }, undefined),
    done: (id) =>
      serial(async () => {
        pending.delete(id)
        await safe(() => backend.delete(id), undefined)
      }, undefined),
    async unfinished() {
      // Waits a while for running operations, never moves past them.
      const idle = await new Promise<boolean>((resolve) => {
        if (degraded) return resolve(false)
        const timer = setTimeout(() => resolve(false), readWait)
        void chain.then(() => {
          clearTimeout(timer)
          resolve(!degraded)
        })
      })
      if (!idle) return []
      // A read that never answers is not waited for either (it changes
      // nothing, so it may run beside the chain).
      const entries = await new Promise<JournalEntry[]>((resolve) => {
        const timer = setTimeout(() => resolve([]), readWait)
        void mine().then(
          (all) => {
            clearTimeout(timer)
            resolve(all)
          },
          () => {
            clearTimeout(timer)
            resolve([])
          }
        )
      })
      return entries
        .filter((e) => e.state !== "done")
        .sort((a, b) => b.touchedAt - a.touchedAt)
    },
    clear: () =>
      serial(async () => {
        pending.clear()
        await safe(() => backend.clear(), undefined)
      }, undefined),
  }

  async function pickNow(input: PickInput): Promise<JournalEntry | null> {
    const existing = (await mine()).find((e) => e.uploadKey === input.uploadKey)
    const others = (await mine()).filter(
      (e) => e.bytes && e.uploadKey !== input.uploadKey
    )
    const total = others.reduce((n, e) => n + (e.bytes?.size ?? 0), 0)
    const keepBytes = bytesAllowed(input, total, others.length)
    const t = now()
    const entry: JournalEntry = {
      id: existing?.id ?? randomId(),
      accountHash: options.accountHash,
      createdAt: existing?.createdAt ?? t,
      touchedAt: t,
      expiresAt: t + JOURNAL_LIMITS.expiryMs,
      purpose: input.purpose,
      subject: input.subject,
      groupKey: input.groupKey,
      uploadKey: input.uploadKey,
      assetId: existing?.assetId ?? null,
      fileFingerprint: input.fileFingerprint,
      displayName: input.file.name,
      mediaType: input.mediaType,
      sizeBytes: input.file.size,
      // §5.2 item 6: a photo whose bytes could not be kept must be picked
      // again after a discard. Videos are never kept, so "picked" says enough.
      state:
        existing && existing.state !== "needs_reselection"
          ? existing.state
          : input.mediaType === "image" && !keepBytes
            ? "needs_reselection"
            : "picked",
      ...(input.pendingLabels !== undefined
        ? { pendingLabels: input.pendingLabels }
        : existing?.pendingLabels !== undefined
          ? { pendingLabels: existing.pendingLabels }
          : {}),
      // The same key picked again keeps what it learned (OD-B5-05-5): a
      // permanent failure fails again.
      ...(existing?.failure ? { failure: existing.failure } : {}),
      ...(keepBytes ? { bytes: input.file as Blob } : {}),
    }
    const stored = await safe(async () => {
      await save(entry)
      return true
    }, false)
    if (!stored && entry.bytes) {
      // A refused write with bytes (quota): keep the metadata only.
      const { bytes: _b, ...meta } = entry
      void _b
      const ok = await safe(async () => {
        await save({ ...meta, state: "needs_reselection" })
        return true
      }, false)
      return ok ? { ...meta, state: "needs_reselection" } : null
    }
    if (!stored) return null
    await safe(() => enforceLimits(entry.id), undefined)
    return (await find(entry.id)) ?? entry
  }
}

/**
 * Progress moves an entry to "transferring" only from an earlier step; a late
 * tick never overwrites failed, finalising or needs_reselection (OD-B5-05-5).
 */
function progressed(
  entry: JournalEntry,
  transferredBytes: number
): JournalEntry {
  const moves: JournalState[] = ["picked", "reserved", "transferring"]
  return {
    ...entry,
    transferredBytes,
    ...(moves.includes(entry.state) ? { state: "transferring" as const } : {}),
  }
}

/** An in-memory backend (tests, and browsers where IndexedDB is refused). */
export function memoryJournalBackend(): JournalBackend & { size(): number } {
  const rows = new Map<string, JournalEntry>()
  return {
    async getAll() {
      return [...rows.values()]
    },
    async put(entry) {
      rows.set(entry.id, entry)
    },
    async delete(id) {
      rows.delete(id)
    },
    async clear() {
      rows.clear()
    },
    size: () => rows.size,
  }
}

/** The IndexedDB backend (database JOURNAL_DB_NAME, one object store). */
export function indexedDbJournalBackend(
  idb: IDBFactory = indexedDB
): JournalBackend {
  let opened: Promise<IDBDatabase> | null = null
  const db = () =>
    (opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = idb.open(JOURNAL_DB_NAME, 1)
      req.onupgradeneeded = () =>
        req.result.createObjectStore("entries", { keyPath: "id" })
      req.onsuccess = () => {
        const conn = req.result
        // Sign-out deletes the database: close at once so the delete is not
        // blocked by this tab, and reopen (empty) on the next use.
        conn.onversionchange = () => {
          conn.close()
          opened = null
        }
        resolve(conn)
      }
      req.onerror = () => {
        opened = null
        reject(req.error)
      }
    }))
  const run = async <T>(
    mode: IDBTransactionMode,
    fn: (s: IDBObjectStore) => IDBRequest<T>
  ) => {
    const tx = (await db()).transaction("entries", mode)
    const req = fn(tx.objectStore("entries"))
    return new Promise<T>((resolve, reject) => {
      tx.oncomplete = () => resolve(req.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  }
  return {
    getAll: () =>
      run("readonly", (s) => s.getAll() as IDBRequest<JournalEntry[]>),
    put: async (entry) => void (await run("readwrite", (s) => s.put(entry))),
    delete: async (id) => void (await run("readwrite", (s) => s.delete(id))),
    clear: async () => void (await run("readwrite", (s) => s.clear())),
  }
}
