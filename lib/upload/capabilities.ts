// Capture capability probe (b05-design §5, B05-05a). Decides whether the
// capture journal may keep photo bytes on this device. Background sync and
// background fetch are always "unsupported": the app never promises an
// upload that continues while the page is closed.

export type CaptureCapabilities = {
  /** IndexedDB opened and a plain object round-tripped (the journal may live there). */
  indexedDb: boolean
  /** navigator.storage.persisted(); null when the API is missing. */
  persisted: boolean | null
  /** navigator.storage.estimate(); null when the API is missing. */
  quotaBytes: number | null
  usageBytes: number | null
  /** May the journal keep photo bytes at all (any size)? */
  storeBytes: boolean
  /** Why bytes are not kept, for the explanation shown instead. */
  reason:
    | "no_indexeddb"
    | "write_refused"
    | "quota_zero"
    | "private_mode"
    /** No storage estimate (OD-B5-05-3): free space can't be checked. */
    | "no_estimate"
    /** Metadata is kept but a Blob write is refused: no photo bytes. */
    | "blob_refused"
    | null
  backgroundSync: "unsupported"
  backgroundFetch: "unsupported"
}

export type ProbeEnvironment = {
  indexedDB?: IDBFactory
  storage?: Pick<StorageManager, "estimate" | "persisted">
  /** Give up on IndexedDB after this long (default 3 s): some locked-down browsers never answer. */
  timeoutMs?: number
}

const PROBE_DB = "nabalens-capture-probe"

/**
 * Opens a scratch database, then writes and reads back a small object (what
 * the journal's metadata needs) and, separately, a Blob (what photo bytes
 * need), then deletes it. WebKit in a private window takes the object and
 * refuses the Blob (its transaction errors): that browser can still keep the
 * journal, without bytes.
 */
async function writeRoundTrips(
  idb: IDBFactory,
  timeoutMs: number
): Promise<{ object: boolean; blob: boolean }> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs)
    const req = idb.open(PROBE_DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore("p")
    req.onsuccess = () => {
      clearTimeout(timer)
      resolve(req.result)
    }
    req.onerror = () => {
      clearTimeout(timer)
      reject(req.error)
    }
  })
  const roundTrip = async (value: unknown, key: string) => {
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("p", "readwrite")
        tx.objectStore("p").put(value, key)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
      return await new Promise<unknown>((resolve, reject) => {
        const req = db.transaction("p").objectStore("p").get(key)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
    } catch {
      return undefined
    }
  }
  try {
    const object = await roundTrip({ probe: 1 }, "m")
    const objectOk =
      typeof object === "object" &&
      object !== null &&
      (object as { probe?: unknown }).probe === 1
    if (!objectOk) return { object: false, blob: false }
    const blob = await roundTrip(new Blob([new Uint8Array([1, 2, 3])]), "b")
    return { object: true, blob: blob instanceof Blob && blob.size === 3 }
  } finally {
    db.close()
    try {
      idb.deleteDatabase(PROBE_DB)
    } catch {
      // The scratch database stays; the round trip itself succeeded.
    }
  }
}

/**
 * Probes what this browser can keep. Never throws: a failure is a reason,
 * and the caller keeps today's behaviour (re-pick after a closed tab) with
 * that explanation.
 */
export async function detectCaptureCapabilities(
  env: ProbeEnvironment = defaultEnvironment()
): Promise<CaptureCapabilities> {
  const base = {
    backgroundSync: "unsupported",
    backgroundFetch: "unsupported",
  } as const
  let persisted: boolean | null = null
  let quotaBytes: number | null = null
  let usageBytes: number | null = null
  try {
    persisted = env.storage ? await env.storage.persisted() : null
  } catch {
    persisted = null
  }
  try {
    const estimate = env.storage ? await env.storage.estimate() : null
    quotaBytes = estimate?.quota ?? null
    usageBytes = estimate?.usage ?? null
  } catch {
    quotaBytes = null
  }
  const result = (
    indexedDb: boolean,
    reason: CaptureCapabilities["reason"]
  ): CaptureCapabilities => ({
    ...base,
    indexedDb,
    persisted,
    quotaBytes,
    usageBytes,
    storeBytes: reason === null,
    reason,
  })
  if (!env.indexedDB) return result(false, "no_indexeddb")
  let writes = { object: false, blob: false }
  try {
    writes = await writeRoundTrips(env.indexedDB, env.timeoutMs ?? 3000)
  } catch {
    writes = { object: false, blob: false }
  }
  // Nothing can be kept: the journal lives in memory for this page only.
  if (!writes.object) return result(false, "write_refused")
  // The journal is kept, photo bytes are not (J1: WebKit private windows).
  if (!writes.blob) return result(true, "blob_refused")
  if (quotaBytes === 0) return result(true, "quota_zero")
  // Bytes are kept only with room to spare, which needs the estimate.
  if (quotaBytes === null || usageBytes === null)
    return result(true, "no_estimate")
  // Private windows report a small fixed quota (Safari, Firefox) and no
  // persistence; keeping photo bytes there would vanish with the window.
  if (
    quotaBytes !== null &&
    quotaBytes < 120 * 1024 * 1024 &&
    persisted === false
  )
    return result(true, "private_mode")
  return result(true, null)
}

function defaultEnvironment(): ProbeEnvironment {
  if (typeof window === "undefined") return {}
  let idb: IDBFactory | undefined
  try {
    idb = window.indexedDB ?? undefined
  } catch {
    idb = undefined
  }
  return { indexedDB: idb, storage: navigator.storage ?? undefined }
}
