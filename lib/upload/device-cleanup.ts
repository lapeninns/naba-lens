// Device clean-up for capture data (b05-design §5.2 item 4, B05-05f and
// finding J-1): sign-out removes the capture journal, any stored photo bytes
// and every upload resume key; a different account signing in removes the
// previous account's journal and keys before anything is shown.

import { JOURNAL_ACCOUNT_STORAGE_KEY, JOURNAL_DB_NAME } from "./journal"
import { UPLOAD_KEYS_STORAGE_KEY } from "./upload-keys"

type DeviceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">

export type DeviceCleanupEnvironment = {
  storage?: DeviceStorage
  indexedDB?: Pick<IDBFactory, "deleteDatabase">
}

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

/** Removes every upload resume key, the journal database and the account marker. */
export function clearCaptureDataOnDevice(
  env: DeviceCleanupEnvironment = defaults()
) {
  try {
    env.storage?.removeItem(UPLOAD_KEYS_STORAGE_KEY)
    env.storage?.removeItem(JOURNAL_ACCOUNT_STORAGE_KEY)
  } catch {
    // Nothing stored.
  }
  try {
    env.indexedDB?.deleteDatabase(JOURNAL_DB_NAME)
  } catch {
    // Nothing stored.
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
  if (cleared) clearCaptureDataOnDevice(env)
  try {
    env.storage?.setItem(JOURNAL_ACCOUNT_STORAGE_KEY, hash)
  } catch {
    // Storage blocked: every open purges by account anyway.
  }
  return cleared
}
