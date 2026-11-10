import { GROUP_LIMITS, type GroupSubjectKind } from "@/lib/knowledge/contract"
import type { GroupSubjectRef, PhotoSetReply } from "@/lib/work-client/contract"

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
}

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
  subject: SetSubject
  /** Reserved photos in arrival order, at most GROUP_LIMITS.maxMembers. */
  assets: string[]
  added: Set<string>
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
    } = {}
  ) {}

  /** A new set for one pick; photos join it with `reserved`. */
  open(subject: SetSubject): string {
    const id = `set-${++this.next}`
    this.sets.set(id, {
      subject,
      assets: [],
      added: new Set(),
      groupId: null,
      busy: false,
      done: false,
      attempts: 0,
    })
    return id
  }

  /** The server reserved one of the set's photos. */
  reserved(setId: string, assetId: string): void {
    const set = this.sets.get(setId)
    if (!set || set.assets.includes(assetId)) return
    if (set.assets.length >= GROUP_LIMITS.maxMembers) return
    set.assets.push(assetId)
    void this.run(set)
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

  private async run(set: SetState): Promise<void> {
    if (this.off || set.done || set.busy) return
    if (!set.groupId && set.assets.length < 2) return
    if (set.groupId && set.assets.every((id) => set.added.has(id))) return
    set.busy = true
    let outcome: Outcome = "ok"
    try {
      if (!set.groupId) {
        const scope = `${set.subject.kind}:${set.subject.id ?? ""}:${set.assets[0]}`
        const reply = await this.transport.start({
          key: this.keys.keyFor(scope),
          subject: { kind: set.subject.kind, id: set.subject.id },
        })
        outcome = this.outcome(reply)
        if (reply.status === "ok") set.groupId = reply.groupId
        if (outcome !== "retry") this.keys.settle(scope)
      }
      if (outcome === "ok" && set.groupId) {
        const batch = set.assets.filter((id) => !set.added.has(id))
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
    await this.run(set)
  }
}
