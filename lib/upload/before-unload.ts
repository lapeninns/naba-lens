// Warn before leaving the page while uploads are running. Browsers show their
// own generic text; the transfer cannot continue after the tab closes.

type UnloadTarget = Pick<Window, "addEventListener" | "removeEventListener">

/** How long a deliberate leave silences the prompt if the page stays. */
const DELIBERATE_LEAVE_MS = 5_000
let deliberateUntil = 0

/**
 * The person already chose to leave (e.g. "Log out anyway" after being told
 * uploads stop): the unload that follows must not ask again. A native POST
 * such as Log out unloads the page before the stopped queue's listener is
 * removed, so the listeners check this instead.
 */
export function leaveDeliberately(now = Date.now()) {
  deliberateUntil = now + DELIBERATE_LEAVE_MS
}

export function isLeavingDeliberately(now = Date.now()) {
  return now < deliberateUntil
}

/**
 * Installs a `beforeunload` listener that prompts only while `isActive()` is
 * true. Returns a function that removes it.
 */
export function guardBeforeUnload(
  isActive: () => boolean,
  target: UnloadTarget = window
): () => void {
  const listener = (event: BeforeUnloadEvent) => {
    if (!isActive() || isLeavingDeliberately()) return
    event.preventDefault()
    // Legacy browsers need returnValue set to show the prompt.
    event.returnValue = ""
  }
  target.addEventListener("beforeunload", listener)
  return () => target.removeEventListener("beforeunload", listener)
}
