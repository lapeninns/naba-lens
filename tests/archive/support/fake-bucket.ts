import {
  sha256,
  type ArchiveStore,
  type PreparedOriginal,
} from "../../../lib/server/archive/core"

import { abortError, type BucketClock } from "./clock"

export type StoreOp =
  | "putOriginalIfAbsent"
  | "verifyOriginal"
  | "putManifestIfAbsent"
  | "verifyManifest"

export type StoredObject = {
  sha256: string
  size: number
  kind: "original" | "manifest"
}

/**
 * One injected fault. A fault matches a call when `op` and `key` match, skips
 * the first `after` matching calls, then applies to the next `times` (default
 * forever). Kinds:
 * - `error`: reject with `error` (default `archive_destination_verification_failed`)
 * - `latency`: delay `ms` on the test clock, then continue normally
 * - `hang`: never settle. Honours the abort signal unless `ignoreSignal`, which
 *   models a store/SDK that does not cancel (the call settles after `ms`, or
 *   never when `ms` is omitted)
 * - `corrupt`: persistently flip the stored object so verification fails
 * - `vanish`: persistently delete the stored object
 */
export type Fault = {
  op?: StoreOp | StoreOp[]
  key?: string | RegExp
  kind: "error" | "latency" | "hang" | "corrupt" | "vanish"
  after?: number
  times?: number
  ms?: number
  error?: string
  ignoreSignal?: boolean
}

export type StoreCall = {
  seq: number
  at: number
  op: StoreOp
  key: string
  outcome: "ok" | "error" | "aborted" | "pending"
}

const VERIFY_FAILED = "archive_destination_verification_failed"

/** Shared in-process bucket. `store(signal)` hands out per-invocation store views. */
export class FakeBucket {
  objects = new Map<string, StoredObject>()
  calls: StoreCall[] = []
  closed = 0
  /**
   * When set, keys the bucket was never told about verify as present. The
   * shared e2e database holds receipts this suite did not create; only keys
   * touched by `corrupt`/`vanish` faults fail.
   */
  lenient = false
  private damaged = new Set<string>()
  private faults: { fault: Fault; seen: number; applied: number }[] = []
  private seq = 0

  constructor(private clock: BucketClock) {}

  seed(key: string, object: StoredObject) {
    this.damaged.delete(key)
    this.objects.set(key, object)
  }

  inject(fault: Fault) {
    this.faults.push({ fault, seen: 0, applied: 0 })
    return () => {
      this.faults = this.faults.filter((entry) => entry.fault !== fault)
    }
  }

  clearFaults() {
    this.faults = []
  }

  callsTo(op: StoreOp) {
    return this.calls.filter((call) => call.op === op)
  }

  store(signal?: AbortSignal): ArchiveStore {
    return {
      putOriginalIfAbsent: (key, original, mime) =>
        this.run("putOriginalIfAbsent", key, signal, () => {
          if (!this.objects.has(key))
            this.objects.set(key, {
              sha256: original.sha256,
              size: original.sizeBytes,
              kind: "original",
            })
          void mime
        }),
      verifyOriginal: (key, sha256, size) =>
        this.run("verifyOriginal", key, signal, () =>
          this.check(key, sha256, size)
        ),
      putManifestIfAbsent: (key, body) =>
        this.run("putManifestIfAbsent", key, signal, () => {
          if (!this.objects.has(key))
            this.objects.set(key, {
              sha256: sha256(body),
              size: body.byteLength,
              kind: "manifest",
            })
        }),
      verifyManifest: (key, sha256, size) =>
        this.run("verifyManifest", key, signal, () =>
          this.check(key, sha256, size)
        ),
      close: () => {
        this.closed++
      },
    }
  }

  private check(key: string, sha256: string, size: number) {
    const object = this.objects.get(key)
    if (!object && this.lenient && !this.damaged.has(key)) return
    if (!object || object.sha256 !== sha256 || object.size !== size)
      throw new Error(VERIFY_FAILED)
  }

  private async run(
    op: StoreOp,
    key: string,
    signal: AbortSignal | undefined,
    action: () => void
  ) {
    const call: StoreCall = {
      seq: this.seq++,
      at: this.clock.now(),
      op,
      key,
      outcome: "pending",
    }
    this.calls.push(call)
    try {
      if (signal?.aborted) throw abortError()
      for (const entry of this.faults) {
        const { fault } = entry
        const ops = fault.op === undefined ? null : [fault.op].flat()
        if (ops && !ops.includes(op)) continue
        if (
          fault.key !== undefined &&
          !(typeof fault.key === "string"
            ? key === fault.key
            : fault.key.test(key))
        )
          continue
        entry.seen++
        if (entry.seen <= (fault.after ?? 0)) continue
        if (entry.applied >= (fault.times ?? Infinity)) continue
        entry.applied++
        switch (fault.kind) {
          case "error":
            throw new Error(fault.error ?? VERIFY_FAILED)
          case "latency":
            await this.clock.sleep(fault.ms ?? 0, signal)
            break
          case "hang":
            if (fault.ignoreSignal) {
              if (fault.ms === undefined) await new Promise(() => undefined)
              await this.clock.sleep(fault.ms ?? 0)
            } else await this.clock.sleep(fault.ms ?? 2 ** 31, signal)
            break
          case "corrupt": {
            const object = this.objects.get(key)
            if (object)
              this.objects.set(key, { ...object, sha256: "f".repeat(64) })
            else this.damaged.add(key)
            break
          }
          case "vanish":
            this.objects.delete(key)
            this.damaged.add(key)
            break
        }
      }
      action()
      call.outcome = "ok"
    } catch (error) {
      call.outcome =
        error instanceof DOMException && error.name === "AbortError"
          ? "aborted"
          : "error"
      throw error
    }
  }
}

export function preparedOriginal(
  sha256: string,
  sizeBytes: number
): PreparedOriginal {
  return { sha256, sizeBytes, handle: null, dispose: async () => undefined }
}
