// Device clean-up for capture data (b05-design §5.2 item 4, B05-05f and
// finding J-1): sign-out removes the capture journal, any stored photo bytes
// and every upload resume key; a different account signing in removes the
// previous account's journal and keys before anything is shown.

import {
  JOURNAL_ACCOUNT_STORAGE_KEY,
  JOURNAL_DB_NAME,
  JOURNAL_UNTRUSTED_STORAGE_KEY,
} from "./journal"
import { UPLOAD_KEYS_STORAGE_KEY } from "./upload-keys"

type DeviceStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>

export type DeviceCleanupEnvironment = {
  storage?: DeviceStorage
  indexedDB?: Pick<IDBFactory, "deleteDatabase">
}

/**
 * tus-js-client's default URL storage keeps one localStorage entry per
 * unfinished transfer, `tus::<fingerprint>::<n>`, holding its upload URL;
 * lib/upload/tus.ts fingerprints as `nabalens-media:<assetId>`.
 */
export const TUS_RESUME_KEY_PREFIX = "tus::nabalens-media:"

/** How the journal database delete ended. "blocked" stays queued until other tabs close it. */
export type JournalDeleteOutcome = "deleted" | "blocked" | "failed" | "absent"

function defaults(): DeviceCleanupEnvironment {
  if (typeof window === "undefined") return {}
  const env: DeviceCleanupEnvironment = {}
  try {
    env.storage = window.localStorage
  } catch {
    // Storage blocked: nothing stored there.
  }
  try {
    env.indexedDB = window.indexedDB ?? undefined
  } catch {
    // IndexedDB blocked: nothing stored there.
  }
  return env
}

/**
 * Removes every upload resume key (ours and tus-js-client's), the journal
 * database and the account marker. Storage keys go synchronously; the
 * promise reports the database delete. Open journal connections close on
 * versionchange, so "blocked" means another tab that has not yet closed; the
 * delete stays queued and completes when it does.
 */
export function clearCaptureDataOnDevice(
  env: DeviceCleanupEnvironment = defaults()
): Promise<JournalDeleteOutcome> {
  try {
    const storage = env.storage
    if (storage) {
      const keys: string[] = []
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i)
        if (key?.startsWith(TUS_RESUME_KEY_PREFIX)) keys.push(key)
      }
      for (const key of keys) storage.removeItem(key)
      storage.removeItem(UPLOAD_KEYS_STORAGE_KEY)
      storage.removeItem(JOURNAL_ACCOUNT_STORAGE_KEY)
      storage.removeItem(JOURNAL_UNTRUSTED_STORAGE_KEY)
    }
  } catch {
    // Nothing stored.
  }
  if (!env.indexedDB) return Promise.resolve("absent")
  try {
    const req = env.indexedDB.deleteDatabase(JOURNAL_DB_NAME)
    return new Promise((resolve) => {
      req.onsuccess = () => resolve("deleted")
      req.onerror = () => resolve("failed")
      req.onblocked = () => resolve("blocked")
    })
  } catch {
    return Promise.resolve("failed")
  }
}

/**
 * Call with the signed-in account's hash (journal accountHash) before the
 * journal or upload keys are used. A different account than last time
 * clears everything first; the same account keeps its entries. Returns true
 * when it cleared.
 */
export function claimCaptureDataForAccount(
  hash: string,
  env: DeviceCleanupEnvironment = defaults()
): boolean {
  let previous: string | null = null
  try {
    previous = env.storage?.getItem(JOURNAL_ACCOUNT_STORAGE_KEY) ?? null
  } catch {
    previous = null
  }
  const cleared = previous !== null && previous !== hash
  if (cleared) void clearCaptureDataOnDevice(env)
  try {
    env.storage?.setItem(JOURNAL_ACCOUNT_STORAGE_KEY, hash)
  } catch {
    // Storage blocked: every open purges by account anyway.
  }
  return cleared
}
