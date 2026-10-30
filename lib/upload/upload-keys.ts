// Remembers the idempotency key of an unfinished upload per local file, so that
// choosing the same file again after a reload or a closed tab reserves the SAME
// asset (no duplicate row) and its TUS transfer resumes from the server offset.
// Upload continuation after the tab closes is still not promised (spec §5): the
// person has to choose the file again.

/** Where unfinished uploads' keys are kept. All methods are best effort. */
export type UploadKeyStore = {
  get(file: File): Promise<string | null>
  set(file: File, key: string): Promise<void>
  delete(file: File): Promise<void>
}

export type LocalUploadKeyStoreOptions = {
  /** Defaults to `window.localStorage` when available. */
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">
  /**
   * Forget a key this long after its last use. Must stay below the server's
   * abandoned-upload window (24 h), after which the reservation is removed and
   * the key would only find a deleted asset.
   */
  maxAgeMs?: number
  now?: () => number
}

export const UPLOAD_KEYS_STORAGE_KEY = "nabalens-upload-keys"
const DEFAULT_MAX_AGE_MS = 20 * 60 * 60 * 1000
const MAX_ENTRIES = 50

type Entries = Record<string, { key: string; at: number }>

/**
 * A localStorage-backed store. Entries are indexed by a SHA-256 of the file's
 * name, size, type and modification time, so file names are not stored. When
 * storage or `crypto.subtle` is unavailable it stores nothing (every attempt
 * then starts a new reservation, as before).
 */
export function localUploadKeyStore(
  options: LocalUploadKeyStoreOptions = {}
): UploadKeyStore {
  const maxAge = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS
  const now = options.now ?? Date.now
  const storage =
    options.storage ??
    (typeof window !== "undefined" ? safeLocalStorage() : undefined)

  function read(): Entries {
    if (!storage) return {}
    try {
      const value = JSON.parse(
        storage.getItem(UPLOAD_KEYS_STORAGE_KEY) ?? "{}"
      ) as unknown
      if (!value || typeof value !== "object") return {}
      const fresh: Entries = {}
      for (const [id, entry] of Object.entries(value as Entries)) {
        if (
          entry &&
          typeof entry.key === "string" &&
          typeof entry.at === "number" &&
          now() - entry.at < maxAge
        ) {
          fresh[id] = entry
        }
      }
      return fresh
    } catch {
      return {}
    }
  }

  function write(entries: Entries) {
    if (!storage) return
    const newest = Object.entries(entries)
      .sort(([, a], [, b]) => b.at - a.at)
      .slice(0, MAX_ENTRIES)
    try {
      if (newest.length === 0) storage.removeItem(UPLOAD_KEYS_STORAGE_KEY)
      else
        storage.setItem(
          UPLOAD_KEYS_STORAGE_KEY,
          JSON.stringify(Object.fromEntries(newest))
        )
    } catch {
      // Quota or private mode: resuming after a reload is an enhancement.
    }
  }

  return {
    async get(file) {
      const id = await fileIdentity(file)
      return id ? (read()[id]?.key ?? null) : null
    },
    async set(file, key) {
      const id = await fileIdentity(file)
      if (!id) return
      const entries = read()
      entries[id] = { key, at: now() }
      write(entries)
    },
    async delete(file) {
      const id = await fileIdentity(file)
      if (!id) return
      const entries = read()
      if (!(id in entries)) return
      delete entries[id]
      write(entries)
    },
  }
}

/** SHA-256 of what identifies a local file without reading its bytes. */
export async function fileIdentity(file: File): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return null
  const text = [file.name, file.size, file.type, file.lastModified].join("\0")
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("")
}

function safeLocalStorage() {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}
