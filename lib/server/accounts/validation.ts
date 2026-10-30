import { normaliseEmail } from "@/lib/auth/magic-link"

// Mirrors the profiles table checks (1–80 characters after trimming).
const NAME_MAX = 80
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type FieldErrors = Partial<Record<string, string>>

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value)
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export type InviteInput = {
  displayName: string
  email: string
  jobTitle: string | null
  venueId: string
}

/** Validates untrusted invitation input from a Server Function argument. */
export function parseInviteInput(
  raw: unknown
): { ok: true; value: InviteInput } | { ok: false; fieldErrors: FieldErrors } {
  const input = (raw ?? {}) as Record<string, unknown>
  const fieldErrors: FieldErrors = {}

  const displayName = text(input.displayName)
  if (!displayName) fieldErrors.displayName = "Enter their name."
  else if (displayName.length > NAME_MAX)
    fieldErrors.displayName = `Use ${NAME_MAX} characters or fewer.`

  const email = normaliseEmail(input.email)
  if (!email) fieldErrors.email = "Enter a valid email address."

  const jobTitle = text(input.jobTitle)
  if (jobTitle.length > NAME_MAX)
    fieldErrors.jobTitle = `Use ${NAME_MAX} characters or fewer.`

  if (!isUuid(input.venueId)) fieldErrors.venueId = "Choose a venue."

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors }
  return {
    ok: true,
    value: {
      displayName,
      email: email!,
      jobTitle: jobTitle || null,
      venueId: input.venueId as string,
    },
  }
}

export type AccountPatch = {
  displayName?: string
  jobTitle?: string | null
  venueId?: string
  active?: boolean
}

/** Validates an admin's account edit. Only known fields survive. */
export function parseAccountPatch(
  raw: unknown
): { ok: true; value: AccountPatch } | { ok: false; fieldErrors: FieldErrors } {
  const input = (raw ?? {}) as Record<string, unknown>
  const fieldErrors: FieldErrors = {}
  const value: AccountPatch = {}

  if (input.displayName !== undefined) {
    const displayName = text(input.displayName)
    if (!displayName) fieldErrors.displayName = "Enter a display name."
    else if (displayName.length > NAME_MAX)
      fieldErrors.displayName = `Use ${NAME_MAX} characters or fewer.`
    else value.displayName = displayName
  }

  if (input.jobTitle !== undefined) {
    const jobTitle = input.jobTitle === null ? "" : text(input.jobTitle)
    if (jobTitle.length > NAME_MAX)
      fieldErrors.jobTitle = `Use ${NAME_MAX} characters or fewer.`
    else value.jobTitle = jobTitle || null
  }

  if (input.venueId !== undefined) {
    if (!isUuid(input.venueId)) fieldErrors.venueId = "Choose a venue."
    else value.venueId = input.venueId
  }

  if (input.active !== undefined) {
    if (typeof input.active !== "boolean")
      fieldErrors.active = "Choose active or inactive."
    else value.active = input.active
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors }
  return { ok: true, value }
}
