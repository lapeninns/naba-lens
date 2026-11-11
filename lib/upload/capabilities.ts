// Capture capability probe (b05-design §5, B05-05a). Decides whether the
// capture journal may keep photo bytes on this device. Background sync and
// background fetch are always "unsupported": the app never promises an
// upload that continues while the page is closed.

export type CaptureCapabilities = {
  /** IndexedDB opened and a Blob round-tripped. */
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
    "no_indexeddb" | "write_refused" | "quota_zero" | "private_mode" | null
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

/** Opens a scratch database, writes and reads back a Blob, then deletes it. */
async function blobRoundTrip(
  idb: IDBFactory,
  timeoutMs: number
): Promise<boolean> {
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
  try {
    const blob = new Blob([new Uint8Array([1, 2, 3])])
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("p", "readwrite")
      tx.objectStore("p").put(blob, "b")
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
    const back = await new Promise<unknown>((resolve, reject) => {
      const req = db.transaction("p").objectStore("p").get("b")
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return back instanceof Blob && back.size === 3
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
  let roundTrip = false
  try {
    roundTrip = await blobRoundTrip(env.indexedDB, env.timeoutMs ?? 3000)
  } catch {
    roundTrip = false
  }
  if (!roundTrip) return result(false, "write_refused")
  if (quotaBytes === 0) return result(true, "quota_zero")
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
