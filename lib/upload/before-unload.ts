// Warn before leaving the page while uploads are running. Browsers show their
// own generic text; the transfer cannot continue after the tab closes.

type UnloadTarget = Pick<Window, "addEventListener" | "removeEventListener">

/**
 * Installs a `beforeunload` listener that prompts only while `isActive()` is
 * true. Returns a function that removes it.
 */
export function guardBeforeUnload(
  isActive: () => boolean,
  target: UnloadTarget = window
): () => void {
  const listener = (event: BeforeUnloadEvent) => {
    if (!isActive()) return
    event.preventDefault()
    // Legacy browsers need returnValue set to show the prompt.
    event.returnValue = ""
  }
  target.addEventListener("beforeunload", listener)
  return () => target.removeEventListener("beforeunload", listener)
}
