import { mailpitUrl } from "./stack"

type Summary = { ID: string; Subject: string; Created: string }

async function search(to: string, subject?: string): Promise<Summary[]> {
  const query = [`to:"${to}"`, subject ? `subject:"${subject}"` : null]
    .filter(Boolean)
    .join(" ")
  const response = await fetch(
    `${mailpitUrl()}/api/v1/search?query=${encodeURIComponent(query)}&limit=50`
  )
  if (!response.ok) throw new Error(`Mailpit search ${response.status}`)
  const body = (await response.json()) as { messages?: Summary[] }
  return body.messages ?? []
}

/**
 * The auth server sends one email per address per second
 * (supabase/config.toml [auth.email] max_frequency) and refuses a quicker one
 * with a 429 the app does not show (it answers "Check your email" either way).
 * Sign-ins of one address in quick succession (one per browser project, or a
 * second sign-in in the same test) wait out that window, with some margin.
 */
const SEND_GAP_MS = 1_500

/**
 * IDs already in the inbox for `to`, so a later wait only accepts a new
 * message. Called just before asking for one, so it also waits until the
 * address may be sent another email.
 */
export async function mailboxIds(to: string): Promise<Set<string>> {
  const messages = await search(to)
  const newest = Math.max(0, ...messages.map((m) => Date.parse(m.Created) || 0))
  const wait = newest + SEND_GAP_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  return new Set(messages.map((m) => m.ID))
}

export const SUBJECTS = {
  invite: "You have been invited to Naba-Lens",
  signIn: "Your Naba-Lens sign-in link and code",
} as const

type Message = { HTML?: unknown; Text?: unknown }

/** Waits for a NEW message (not in `seen`) to `to` with `subject`. */
async function waitForMessage(
  to: string,
  subject: string,
  seen: Set<string>,
  timeoutMs: number
): Promise<Message> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const fresh = (await search(to, subject)).find((m) => !seen.has(m.ID))
    if (fresh) {
      return (await fetch(`${mailpitUrl()}/api/v1/message/${fresh.ID}`).then(
        (r) => r.json()
      )) as Message
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`No new "${subject}" email to ${to} within ${timeoutMs} ms`)
}

function confirmLinkOf(message: Message, subject: string): string {
  const match = String(message.HTML).match(
    /href="[^"]*(\/auth\/confirm\?[^"]+)"/
  )
  if (!match) throw new Error(`No /auth/confirm link in "${subject}"`)
  return match[1].replace(/&amp;/g, "&")
}

/**
 * Waits for a NEW message (not in `seen`) to `to` with `subject`, and returns the
 * /auth/confirm path+query from its link. Polls the local inbox: event-based,
 * no fixed sleeps beyond the poll interval.
 */
export async function waitForLink(
  to: string,
  subject: string,
  seen: Set<string> = new Set(),
  timeoutMs = 30_000
): Promise<string> {
  const message = await waitForMessage(to, subject, seen, timeoutMs)
  return confirmLinkOf(message, subject)
}

/**
 * Waits for a NEW sign-in email (not in `seen`) to `to` and returns both ways in
 * it: the /auth/confirm path+query and the one-time code. Test-only: the code
 * stays in the test process (never in a URL or log).
 */
export async function waitForSignInEmail(
  to: string,
  seen: Set<string> = new Set(),
  timeoutMs = 30_000
): Promise<{ link: string; code: string }> {
  const message = await waitForMessage(to, SUBJECTS.signIn, seen, timeoutMs)
  const link = confirmLinkOf(message, SUBJECTS.signIn)
  // Links carry a hex token hash; only the code is a bare run of digits.
  const text = String(message.Text).replace(/https?:\/\/\S+/g, "")
  const code = text.match(/\b(\d{6,10})\b/)?.[1]
  if (!code) throw new Error(`No sign-in code in "${SUBJECTS.signIn}"`)
  return { link, code }
}

/** Every message to `to`, for absence checks (uninvited login). */
export async function messagesTo(to: string) {
  return search(to)
}
