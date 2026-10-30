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

/** IDs already in the inbox for `to`, so a later wait only accepts a new message. */
export async function mailboxIds(to: string): Promise<Set<string>> {
  return new Set((await search(to)).map((m) => m.ID))
}

export const SUBJECTS = {
  invite: "You have been invited to Naba-Lens",
  signIn: "Your Naba-Lens sign-in link",
} as const

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
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const fresh = (await search(to, subject)).find((m) => !seen.has(m.ID))
    if (fresh) {
      const message = await fetch(
        `${mailpitUrl()}/api/v1/message/${fresh.ID}`
      ).then((r) => r.json())
      const match = String(message.HTML).match(
        /href="[^"]*(\/auth\/confirm\?[^"]+)"/
      )
      if (!match) throw new Error(`No /auth/confirm link in "${subject}"`)
      return match[1].replace(/&amp;/g, "&")
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`No new "${subject}" email to ${to} within ${timeoutMs} ms`)
}

/** Every message to `to`, for absence checks (uninvited login). */
export async function messagesTo(to: string) {
  return search(to)
}
