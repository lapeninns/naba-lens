// Remembers the idempotency key of an unfinished upload per local file, so that
// choosing the same file again after a reload or a closed tab reserves the SAME
// asset (no duplicate row) and its TUS transfer resumes from the server offset.
// Upload continuation after the tab closes is still not promised (spec §5): the
// person has to choose the file again. Keys are kept per purpose: the same file
// chosen for the portfolio and as amenity evidence are separate uploads. They
// are also kept per signed-in account, so a colleague signed in on the same
// phone never reuses them (the server would refuse them anyway).

import type { UploadPurpose } from "./types"

/**
 * Which uploads a key belongs to. `purpose` omitted: general. `account`
 * omitted: not scoped (callers that do not know who is signed in).
 */
export type UploadKeyScope = { purpose?: UploadPurpose; account?: string }

/** Where unfinished uploads' keys are kept. All methods are best effort. */
export type UploadKeyStore = {
  /** A purpose on its own is the same as `{ purpose }`. */
  get(
    file: File,
    scope?: UploadKeyScope | UploadPurpose
  ): Promise<string | null>
  set(
    file: File,
    key: string,
    scope?: UploadKeyScope | UploadPurpose
  ): Promise<void>
  delete(file: File, scope?: UploadKeyScope | UploadPurpose): Promise<void>
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
/** How long a stored key is kept after its last use (20 h). */
export const UPLOAD_KEY_MAX_AGE_MS = 20 * 60 * 60 * 1000
const DEFAULT_MAX_AGE_MS = UPLOAD_KEY_MAX_AGE_MS
const MAX_ENTRIES = 50

type Entries = Record<string, { key: string; at: number }>

/**
 * A localStorage-backed store. Entries are indexed by a SHA-256 of the file's
 * name, size, type and modification time (and purpose, unless general), so file
 * names are not stored. When storage or `crypto.subtle` is unavailable it
 * stores nothing (every attempt then starts a new reservation, as before).
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
    async get(file, scope) {
      const id = await fileIdentity(file, scope)
      return id ? (read()[id]?.key ?? null) : null
    },
    async set(file, key, scope) {
      const id = await fileIdentity(file, scope)
      if (!id) return
      const entries = read()
      entries[id] = { key, at: now() }
      write(entries)
    },
    async delete(file, scope) {
      const id = await fileIdentity(file, scope)
      if (!id) return
      const entries = read()
      if (!(id in entries)) return
      delete entries[id]
      write(entries)
    },
  }
}

/**
 * SHA-256 of what identifies a local file without reading its bytes, per
 * upload purpose and account. General keeps the original identity, so keys
 * saved before purposes existed still resume; an account always changes it.
 */
export async function fileIdentity(
  file: File,
  scope?: UploadKeyScope | UploadPurpose
): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return null
  const { purpose, account } =
    typeof scope === "string"
      ? { purpose: scope, account: undefined }
      : (scope ?? {})
  const parts: unknown[] = [file.name, file.size, file.type, file.lastModified]
  if (purpose && purpose !== "general") parts.push(purpose)
  if (account) parts.push(`account:${account}`)
  const text = parts.join("\0")
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
