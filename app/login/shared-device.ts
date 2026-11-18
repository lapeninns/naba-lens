import { clearAllDrafts } from "@/components/nabalens/amenities/capture/draft"
import { clearCaptureDataOnDevice } from "@/lib/upload/device-cleanup"

/*
 * Shared-device mode (spec §3.2, AC36). The person signing in says whether
 * this is a shared device; the choice stays on the device, not the account.
 *
 *   personal  as before: signing out removes unsent drafts and the capture
 *             journal; a plain return to sign in (an expired session) keeps
 *             them for the same person, and another account signing in
 *             clears the previous one's capture data (claimCaptureDataForAccount).
 *   shared    nothing private outlives the session: any arrival at sign in
 *             (signing out, an expired or ended session, a deactivation that
 *             never passed /auth/logout) removes the drafts, the capture
 *             journal and its photos, upload resume keys, this tab's working
 *             copies (sessionStorage) and any Cache Storage, before the next
 *             person can type.
 *
 * Media responses are already `private, no-store` (lib/server/media/access),
 * so the HTTP cache keeps no private preview to remove.
 */

export type DeviceMode = "personal" | "shared"

export const DEVICE_MODE_KEY = "nabalens.device-mode"
/** Album's last chosen place (components/nabalens/album/match/last-place.ts). */
const LAST_PLACE_KEY = "nabalens.match.last-place"
/** Working copies this app keeps in a tab's sessionStorage. */
const SESSION_PREFIX = "nabalens"

type DeviceStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>

function local(): DeviceStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

function session(): DeviceStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage
  } catch {
    return null
  }
}

/** The device's mode; personal unless someone chose shared here. */
export function readDeviceMode(storage = local()): DeviceMode {
  try {
    return storage?.getItem(DEVICE_MODE_KEY) === "shared"
      ? "shared"
      : "personal"
  } catch {
    return "personal"
  }
}

const listeners = new Set<() => void>()

export function writeDeviceMode(mode: DeviceMode, storage = local()): void {
  try {
    if (mode === "shared") storage?.setItem(DEVICE_MODE_KEY, "shared")
    else storage?.removeItem(DEVICE_MODE_KEY)
  } catch {
    // Storage blocked: the default (personal) applies.
  }
  for (const listener of listeners) listener()
}

/** For useSyncExternalStore: this tab's writes and other tabs' changes. */
export function subscribeDeviceMode(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key === DEVICE_MODE_KEY || event.key === null) listener()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

/** Every explicit sign-out wipes; on a shared device any arrival does. */
export function shouldWipeOnSignIn(
  mode: DeviceMode,
  signedOut: boolean
): boolean {
  return signedOut || mode === "shared"
}

function removeMatching(storage: DeviceStorage | null, prefix: string) {
  if (!storage) return
  try {
    const keys: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key?.startsWith(prefix)) keys.push(key)
    }
    for (const key of keys) storage.removeItem(key)
  } catch {
    // Nothing stored.
  }
}

/**
 * Removes what the last person left on this device. `shared` also removes
 * the tab's working copies, the last place and Cache Storage.
 */
export async function wipePrivateDeviceData(mode: DeviceMode): Promise<void> {
  clearAllDrafts()
  const journal = clearCaptureDataOnDevice()
  if (mode === "shared") {
    removeMatching(session(), SESSION_PREFIX)
    try {
      local()?.removeItem(LAST_PLACE_KEY)
    } catch {
      // Nothing stored.
    }
    try {
      if (typeof caches !== "undefined") {
        const names = await caches.keys()
        await Promise.all(names.map((name) => caches.delete(name)))
      }
    } catch {
      // Cache Storage unavailable: nothing cached there.
    }
  }
  await journal
}
