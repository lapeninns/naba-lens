import type { User } from "@supabase/supabase-js"

import type { Db } from "./context"

const PAGE_SIZE = 1000

/**
 * Every auth user, read with the service role. GoTrue's admin API has no
 * lookup by email, so this pages through the list; one organisation's staff
 * fit in a page or two.
 */
export async function listAuthUsers(service: Db): Promise<User[]> {
  const users: User[] = []
  for (let page = 1; ; page++) {
    const { data, error } = await service.auth.admin.listUsers({
      page,
      perPage: PAGE_SIZE,
    })
    if (error) throw new Error(`Could not list auth users: ${error.code}`)
    users.push(...data.users)
    if (data.users.length < PAGE_SIZE) return users
  }
}

export async function findAuthUserByEmail(
  service: Db,
  email: string
): Promise<User | null> {
  const target = email.trim().toLowerCase()
  const users = await listAuthUsers(service)
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
