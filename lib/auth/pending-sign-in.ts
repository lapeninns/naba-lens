/**
 * Browser-only memory of sign-in emails sent from this tab (sessionStorage,
 * never the code): when each address was last sent to, so the resend cooldown
 * holds across "Use a different email" and a reopened sheet, and which request
 * the login card is waiting on, so a phone that reloads /login while the person
 * reads their email comes back to the code step instead of asking again.
 * Storage can be missing or full (private mode); every call then does nothing.
 */
const KEY = "nabalens:pending-sign-in"

type Stored = { sends: Record<string, number>; pending: string | null }

function key(email: string) {
  return email.trim().toLowerCase()
}

function read(): Stored {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    const value = raw ? (JSON.parse(raw) as Partial<Stored>) : null
    return {
      sends: value?.sends && typeof value.sends === "object" ? value.sends : {},
      pending: typeof value?.pending === "string" ? value.pending : null,
    }
  } catch {
    return { sends: {}, pending: null }
  }
}

function write(value: Stored) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(value))
  } catch {
    // Private mode or full storage: the cooldown falls back to this screen.
  }
}

/** A sign-in email really went to `email` at `at` (epoch ms). */
export function recordSignInSent(
  email: string,
  at: number,
  { pending = false }: { pending?: boolean } = {}
) {
  const current = read()
  write({
    sends: { ...current.sends, [key(email)]: at },
    pending: pending ? key(email) : current.pending,
  })
}

/** When a sign-in email last went to `email` from this tab, or null. */
export function lastSignInSent(email: string): number | null {
  const at = read().sends[key(email)]
  return typeof at === "number" && Number.isFinite(at) ? at : null
}

/**
 * The request the login card was waiting on, when it is younger than `maxAgeMs`
 * (the code's lifetime); an older one is forgotten.
 */
export function pendingSignIn(
  maxAgeMs: number,
  now = Date.now()
): { email: string; sentAt: number } | null {
  const { pending } = read()
  if (!pending) return null
  const sentAt = lastSignInSent(pending)
  if (sentAt === null || now - sentAt >= maxAgeMs || sentAt > now) {
    clearPendingSignIn()
    return null
  }
  return { email: pending, sentAt }
}

/** No request is being waited on (changed email). Cooldowns are kept. */
export function clearPendingSignIn() {
  const current = read()
  if (current.pending) write({ ...current, pending: null })
}

/** Signed in: forget everything. */
export function forgetSignIns() {
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    // Nothing to forget.
  }
}
