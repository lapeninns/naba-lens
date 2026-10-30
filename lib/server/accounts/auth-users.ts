import type { User } from "@supabase/supabase-js"

import type { Db } from "./context"

const PAGE_SIZE = 1000
/** 20,000 accounts: far beyond one organisation; stops a runaway loop. */
const MAX_PAGES = 20

/**
 * How long a page render or invitation waits for Supabase Auth's admin API.
 * Under load a single listing took over 10 s (GoTrue's own deadline), which
 * made /admin/staff fail to render; past this, callers degrade instead.
 */
export const AUTH_LOOKUP_DEADLINE_MS = 4_000

/** Supabase Auth did not answer in time, refused, or the listing was too long. */
export class AuthLookupError extends Error {
  constructor(readonly reason: "timeout" | "failed" | "too_many") {
    super(`Auth lookup ${reason}`)
    this.name = "AuthLookupError"
  }
}

/**
 * Resolves with `work`, or rejects with AuthLookupError("timeout") after
 * `deadlineMs`. The underlying request is not cancelled (supabase-js has no
 * signal for the admin API); its late result is ignored.
 */
export async function withAuthDeadline<T>(
  work: Promise<T>,
  deadlineMs = AUTH_LOOKUP_DEADLINE_MS
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AuthLookupError("timeout")), deadlineMs)
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Every auth user, read with the service role. GoTrue's admin API has no
 * lookup by email, so this pages through the list; one organisation's staff
 * fit in one page. Bounded: at most MAX_PAGES requests and `deadlineMs` in
 * total. Throws AuthLookupError; callers decide how to degrade.
 */
export async function listAuthUsers(
  service: Db,
  deadlineMs = AUTH_LOOKUP_DEADLINE_MS
): Promise<User[]> {
  return withAuthDeadline(
    (async () => {
      const users: User[] = []
      for (let page = 1; page <= MAX_PAGES; page++) {
        const { data, error } = await service.auth.admin.listUsers({
          page,
          perPage: PAGE_SIZE,
        })
        if (error) throw new AuthLookupError("failed")
        users.push(...data.users)
        if (data.users.length < PAGE_SIZE) return users
      }
      throw new AuthLookupError("too_many")
    })(),
    deadlineMs
  )
}

export async function findAuthUserByEmail(
  service: Db,
  email: string,
  deadlineMs?: number
): Promise<User | null> {
  const target = email.trim().toLowerCase()
  const users = await listAuthUsers(service, deadlineMs)
  return users.find((u) => u.email?.toLowerCase() === target) ?? null
}

/**
 * Marks auth users created by `inviteStaff`. Provenance only, never used for
 * authorisation: it lets a retry adopt an account left without a profile by an
 * earlier, interrupted invitation instead of failing as a duplicate.
 */
export const INVITE_METADATA_KEY = "nabalens_invite"

export function isOrphanedInvite(user: User): boolean {
  return (
    user.user_metadata?.[INVITE_METADATA_KEY] === true && !user.last_sign_in_at
  )
}

/** Long enough to be permanent; cleared again on reactivation. */
export const DEACTIVATED_BAN_DURATION = "876000h"
