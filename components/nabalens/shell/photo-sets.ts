import {
  GROUP_LIMITS,
  type ContributionGroupReplaceResult,
  type ContributionGroupView,
  type GroupSubjectKind,
} from "@/lib/knowledge/contract"
import type {
  GroupSubjectRef,
  PhotoSetRefusal,
  PhotoSetReply,
} from "@/lib/work-client/contract"

// Several photos of one subject picked together (B02-05, W1) become one
// contribution group on the server. Grouping never holds back or fails an
// upload: each photo keeps its own state, and a group that can't be made
// leaves the photos single, said nowhere. A set starts once it has two
// reserved photos, and takes each photo as soon as the server has reserved
// it, whatever its upload state.

/** What a set is of, and the name its notice uses. */
export type SetSubject = {
  kind: GroupSubjectKind
  id: string | null
  name: string
}

export type SetTransport = {
  start: (input: {
    key: string
    subject: GroupSubjectRef
  }) => Promise<PhotoSetReply<{ groupId: string }>>
  add: (input: {
    groupId: string
    assetIds: string[]
  }) => Promise<PhotoSetReply<{ members: number }>>
  /** B05-m5: the set as the server derives it (per-member states). */
  read?: (input: {
    groupId: string
  }) => Promise<PhotoSetReply<{ group: ContributionGroupView }>>
  /** B05-m5: swaps a failed or removed member for a new photo, one for one. */
  replace?: (input: {
    groupId: string
    failedAssetId: string
    newAssetId: string
  }) => Promise<PhotoSetReply<ContributionGroupReplaceResult>>
}

/**
 * How a replacement ended. `refused` carries the server's refusal (its code
 * and reason) for the screen to word; the new photo stays on its own.
 */
export type ReplaceOutcome =
  | { status: "replaced" }
  | { status: "same" }
  | { status: "refused"; refusal: PhotoSetRefusal | null }
  | { status: "unavailable" }

/** One key per set start, kept until the server has answered it. */
export type SetKeyStore = {
  keyFor: (scope: string) => string
  settle: (scope: string) => void
}

const STORAGE_KEY = "nabalens.photo-set-keys"
/** Unsettled keys kept per tab; the oldest are dropped beyond this. */
const MAX_STORED = 50

type Store = Record<string, string>

function readStore(): Store {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Store)
      : {}
  } catch {
    return {}
  }
}

function writeStore(store: Store) {
  try {
    const entries = Object.entries(store).slice(-MAX_STORED)
    if (entries.length === 0) window.sessionStorage.removeItem(STORAGE_KEY)
    else
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(Object.fromEntries(entries))
      )
  } catch {
    // Storage unavailable (private mode, quota): the in-memory key still
    // covers retries within this page.
  }
}

/**
 * Keys in sessionStorage, as request ids are (use-request-id.ts): a retried
 * start, or one after a reload with the same first photo, reuses its key, so
 * the server returns the group it already made instead of a second one.
 */
export function sessionSetKeys(): SetKeyStore {
  const memory = new Map<string, string>()
  return {
    keyFor(scope) {
      const known = memory.get(scope) ?? readStore()[scope]
      const key = known ?? crypto.randomUUID()
      memory.set(scope, key)
      if (!known) writeStore({ ...readStore(), [scope]: key })
      return key
    },
    settle(scope) {
      memory.delete(scope)
      const store = readStore()
      if (!(scope in store)) return
      delete store[scope]
      writeStore(store)
    },
  }
}

/** Waits before each quiet retry; after the last, the photos stay single. */
export const SET_RETRY_DELAYS = [2_000, 8_000, 30_000]

type SetState = {
  id: string
  subject: SetSubject
  /**
   * Reserved photos in arrival order: at most GROUP_LIMITS.maxMembers live
   * ones and GROUP_LIMITS.maxPositions in all.
   */
  assets: string[]
  added: Set<string>
  /** Photos the server failed (they no longer count towards the cap). */
  failed: Set<string>
  /** Replaced member -> the photo that replaced it. */
  replaced: Map<string, string>
  /** The run in progress, if any (a read waits for it). */
  running: Promise<void> | null
  groupId: string | null
  busy: boolean
  /** Given up (refused, or out of retries): its photos stay as they are. */
  done: boolean
  attempts: number
}

type Outcome = "ok" | "retry" | "stop"

export class PhotoSets {
  private sets = new Map<string, SetState>()
  private off = false
  private next = 0

  constructor(
    private transport: SetTransport,
    private keys: SetKeyStore,
    private options: {
      delays?: readonly number[]
      /** The database has no groups (or they are off): sets end here. */
      onMissing?: () => void
      later?: (run: () => void, ms: number) => void
      /** B05-05c: the set's start key, once it has one (the journal's groupKey). */
      onKey?: (setId: string, key: string) => void
    } = {}
  ) {}

  private keyListeners = new Set<(setId: string, key: string) => void>()

  /** Hear each set's start key (B05-05c); returns the unsubscribe. */
  listenKeys(listener: (setId: string, key: string) => void): () => void {
    this.keyListeners.add(listener)
    return () => {
      this.keyListeners.delete(listener)
    }
  }

  /** A new set for one pick; photos join it with `reserved`. */
  open(subject: SetSubject): string {
    const id = `set-${++this.next}`
    this.sets.set(id, {
      id,
      subject,
      assets: [],
      added: new Set(),
      failed: new Set(),
      replaced: new Map(),
      running: null,
      groupId: null,
      busy: false,
      done: false,
      attempts: 0,
    })
    return id
  }

  /**
   * The server reserved one of the set's photos. Like the server's cap, a
   * failed or replaced photo leaves room for another (B05-m5 S2).
   */
  reserved(setId: string, assetId: string): void {
    const set = this.sets.get(setId)
    if (!set || set.assets.includes(assetId)) return
    if (
      live(set) >= GROUP_LIMITS.maxMembers ||
      set.assets.length >= GROUP_LIMITS.maxPositions
    )
      return
    set.assets.push(assetId)
    void this.run(set)
  }

  /**
   * The server failed one of the set's photos (it could not be processed):
   * it stays a member but no longer counts towards the cap.
   */
  serverFailed(setId: string, assetId: string): void {
    this.sets.get(setId)?.failed.add(assetId)
  }

  /** A failed photo was retried and finished: it counts again. */
  finished(setId: string, assetId: string): void {
    this.sets.get(setId)?.failed.delete(assetId)
  }

  /**
   * The server's read shows `newAssetId` replacing `failedAssetId` though the
   * replace call never answered: record it as replace() would have.
   */
  replacedOnServer(setId: string, failedAssetId: string, newAssetId: string) {
    const set = this.sets.get(setId)
    if (!set) return
    set.replaced.set(failedAssetId, newAssetId)
    if (!set.assets.includes(newAssetId)) set.assets.push(newAssetId)
    set.added.add(newAssetId)
  }

  /** The photo's set has it as a member on the server. */
  isMember(setId: string, assetId: string): boolean {
    return this.sets.get(setId)?.added.has(assetId) ?? false
  }

  /**
   * B05-01e: the set as the server derives it, once every photo it took is
   * a member. Null when the set has no group, a photo never joined it, or
   * the read failed: the screen then words the set from its own queue.
   */
  async read(setId: string): Promise<ContributionGroupView | null> {
    const set = this.sets.get(setId)
    const read = this.transport.read
    if (!set || !read) return null
    // A join still on its way would leave a photo out of the read.
    for (let i = 0; set.running && i < 10; i++) await set.running
    if (!set.groupId || !set.assets.every((id) => set.added.has(id)))
      return null
    try {
      const reply = await read({ groupId: set.groupId })
      return reply.status === "ok" ? reply.group : null
    } catch {
      return null
    }
  }

  /**
   * B05-01d: `newAssetId` replaces the set's member `failedAssetId`, one for
   * one, instead of joining as a new member. The same photo picked again
   * (the same asset, resumed) is no replacement. Quiet retries as for adds.
   */
  async replace(
    setId: string,
    failedAssetId: string,
    newAssetId: string
  ): Promise<ReplaceOutcome> {
    if (failedAssetId === newAssetId) return { status: "same" }
    const set = this.sets.get(setId)
    const replace = this.transport.replace
    if (!set?.groupId || !replace || this.off) return { status: "unavailable" }
    const delays = this.options.delays ?? SET_RETRY_DELAYS
    for (let attempt = 0; ; attempt++) {
      let reply: PhotoSetReply<ContributionGroupReplaceResult> | null = null
      try {
        reply = await replace({
          groupId: set.groupId,
          failedAssetId,
          newAssetId,
        })
      } catch {
        // No answer: try again below.
      }
      if (reply?.status === "ok") {
        set.replaced.set(failedAssetId, newAssetId)
        if (!set.assets.includes(newAssetId)) set.assets.push(newAssetId)
        set.added.add(newAssetId)
        return { status: "replaced" }
      }
      if (reply?.status === "missing") return { status: "unavailable" }
      if (reply?.status === "failed" && !reply.retry)
        return { status: "refused", refusal: reply.refusal ?? null }
      if (attempt >= delays.length) return { status: "unavailable" }
      const wait = delays[attempt]
      const later =
        this.options.later ?? ((run, ms) => void window.setTimeout(run, ms))
      await new Promise<void>((resolve) => later(resolve, wait))
    }
  }

  /** The set's group and grouped photos so far (null before it starts). */
  groupOf(setId: string): { groupId: string; assetIds: string[] } | null {
    const set = this.sets.get(setId)
    return set?.groupId
      ? { groupId: set.groupId, assetIds: [...set.added] }
      : null
  }

  private outcome(reply: PhotoSetReply<object>): Outcome {
    if (reply.status === "ok") return "ok"
    if (reply.status === "missing") {
      if (!this.off) {
        this.off = true
        this.options.onMissing?.()
      }
      return "stop"
    }
    return reply.retry ? "retry" : "stop"
  }

  private run(set: SetState): Promise<void> {
    // A run already going takes the new photo when its join returns. Its
    // promise stays the one a read waits for: replacing it with this call's
    // (which returns at once) let a read go out before that join, and word
    // the set without the photo.
    if (set.busy && set.running) return set.running
    const running = this.step(set)
    set.running = running
    void running.finally(() => {
      if (set.running === running) set.running = null
    })
    return running
  }

  private async step(set: SetState): Promise<void> {
    if (this.off || set.done || set.busy) return
    if (!set.groupId && set.assets.length < 2) return
    if (set.groupId && set.assets.every((id) => set.added.has(id))) return
    set.busy = true
    let outcome: Outcome = "ok"
    try {
      if (!set.groupId) {
        const scope = `${set.subject.kind}:${set.subject.id ?? ""}:${set.assets[0]}`
        const key = this.keys.keyFor(scope)
        this.options.onKey?.(set.id, key)
        for (const listener of this.keyListeners) listener(set.id, key)
        const reply = await this.transport.start({
          key,
          subject: { kind: set.subject.kind, id: set.subject.id },
        })
        outcome = this.outcome(reply)
        if (reply.status === "ok") set.groupId = reply.groupId
        if (outcome !== "retry") this.keys.settle(scope)
      }
      if (outcome === "ok" && set.groupId) {
        // The server takes at most 10 a call; the rest go in the next run.
        const batch = set.assets
          .filter((id) => !set.added.has(id))
          .slice(0, GROUP_LIMITS.maxMembers)
        const reply = await this.transport.add({
          groupId: set.groupId,
          assetIds: batch,
        })
        outcome = this.outcome(reply)
        if (reply.status === "ok") for (const id of batch) set.added.add(id)
      }
    } catch {
      // The call never answered (network, a server error): try again later.
      outcome = "retry"
    } finally {
      set.busy = false
    }
    if (outcome === "stop") {
      set.done = true
      return
    }
    if (outcome === "retry") {
      const delays = this.options.delays ?? SET_RETRY_DELAYS
      if (set.attempts >= delays.length) {
        set.done = true
        return
      }
      const wait = delays[set.attempts++]
      const later =
        this.options.later ?? ((run, ms) => void window.setTimeout(run, ms))
      later(() => void this.run(set), wait)
      return
    }
    set.attempts = 0
    // Photos reserved while this ran.
    await this.step(set)
  }
}

/** Members that count towards the cap, as the server counts them (S2). */
function live(set: SetState): number {
  return set.assets.filter((id) => !set.failed.has(id) && !set.replaced.has(id))
    .length
}
