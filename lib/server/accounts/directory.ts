import type { User } from "@supabase/supabase-js"

import type { Department } from "@/lib/config/departments"
import { MEDIA_LIMITS } from "@/lib/config/media"
import { STORAGE_BUCKETS } from "@/lib/config/storage"

import {
  AuthLookupError,
  hasPendingInvitation,
  listAuthUsers,
  withAuthDeadline,
} from "./auth-users"
import {
  requireAdminCaller,
  type AccountResult,
  type AccountsContext,
  type Db,
} from "./context"
import { dbFailed, notFound } from "./invite"
import { isUuid } from "./validation"

/**
 * active: can sign in on their own (signed in before, or confirmed the email).
 * invited: hasn't accepted the invitation yet, so it can be resent.
 * inactive: deactivated.
 */
export type StaffAccountStatus = "active" | "invited" | "inactive"

/** Staff and venue manager accounts; admins are never listed. */
export type AccountRole = "staff" | "manager"

/** The roles the directory and account pages list. */
const LISTED_ROLES: AccountRole[] = ["staff", "manager"]

/** Same shape as the UI's StaffMember, plus the fields the admin pages need. */
export type StaffDirectoryEntry = {
  id: string
  /** Account type: a venue manager account was converted from staff by an admin. */
  role: AccountRole
  displayName: string
  avatarUrl: string | null
  jobTitle: string | null
  department: Department | null
  venueId: string | null
  venueName: string | null
  venueActive: boolean | null
  email: string | null
  status: StaffAccountStatus
  lastSignInAt: string | null
}

const PROFILE_COLUMNS =
  "id, role, display_name, avatar_path, job_title, department, venue_id, active, venue:venues(name, active)"

type ProfileRow = {
  id: string
  role: AccountRole
  display_name: string
  avatar_path: string | null
  job_title: string | null
  department: Department | null
  venue_id: string | null
  active: boolean
  venue: { name: string; active: boolean } | null
}

export function staffStatus(
  active: boolean,
  user: Pick<User, "last_sign_in_at" | "email_confirmed_at"> | null
): StaffAccountStatus {
  if (!active) return "inactive"
  return !user || hasPendingInvitation(user) ? "invited" : "active"
}

/**
 * Short-lived signed avatar URLs. Callers pass the service client only after
 * requireAdminCaller: end users have no storage read policy (wave 3 finding 1).
 */
async function signAvatars(
  service: Db,
  paths: string[]
): Promise<Map<string, string>> {
  const urls = new Map<string, string>()
  if (paths.length === 0) return urls
  const { data, error } = await service.storage
    .from(STORAGE_BUCKETS.avatars)
    .createSignedUrls(paths, MEDIA_LIMITS.signedUrlExpirySeconds)
  if (error || !data) return urls
  for (const item of data) {
    if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl)
  }
  return urls
}

/**
 * "unavailable": Supabase Auth was too slow or failed, so emails and sign-in
 * times are missing and an active account that never signed in shows as
 * Active, not Invited. Everything from `profiles` (name, venue, deactivation)
 * is still exact. The page says so instead of failing to render.
 */
export type AuthDetails = "ok" | "unavailable"

function logAuthUnavailable(where: string, error: unknown) {
  if (!(error instanceof AuthLookupError)) throw error
  console.error(`[accounts] ${where}: auth details unavailable`, {
    reason: error.reason,
  })
}

function toEntry(
  row: ProfileRow,
  user: User | null,
  avatarUrls: Map<string, string>,
  details: AuthDetails = "ok"
): StaffDirectoryEntry {
  return {
    id: row.id,
    role: row.role,
    displayName: row.display_name,
    avatarUrl: row.avatar_path
      ? (avatarUrls.get(row.avatar_path) ?? null)
      : null,
    jobTitle: row.job_title,
    department: row.department,
    venueId: row.venue_id,
    venueName: row.venue?.name ?? null,
    venueActive: row.venue?.active ?? null,
    email: user?.email ?? null,
    status:
      details === "ok"
        ? staffStatus(row.active, user)
        : row.active
          ? "active"
          : "inactive",
    lastSignInAt: user?.last_sign_in_at ?? null,
  }
}

/** Every staff and venue manager account (not admins), by name. One organisation: no pagination. */
export async function listStaffDirectory(
  ctx: AccountsContext
): Promise<
  AccountResult<{ staff: StaffDirectoryEntry[]; authDetails: AuthDetails }>
> {
  const auth = await requireAdminCaller(ctx.caller)
  if (!auth.ok) return auth

  const { data, error } = await ctx.caller
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .in("role", LISTED_ROLES)
    .order("display_name", { ascending: true })
    .order("id", { ascending: true })
  if (error) return dbFailed()
  const rows = data as ProfileRow[]

  // Auth and Storage in parallel; Auth is bounded and may degrade.
  const [users, avatarUrls] = await Promise.all([
    listAuthUsers(ctx.service, ctx.authDeadlineMs).then(
      (list) => new Map(list.map((u) => [u.id, u])),
      (error: unknown) => {
        logAuthUnavailable("directory", error)
        return null
      }
    ),
    signAvatars(
      ctx.service,
      rows.flatMap((r) => (r.avatar_path ? [r.avatar_path] : []))
    ),
  ])
  const details: AuthDetails = users ? "ok" : "unavailable"
  return {
    ok: true,
    authDetails: details,
    staff: rows.map((row) =>
      toEntry(row, users?.get(row.id) ?? null, avatarUrls, details)
    ),
  }
}

export async function getStaffAccount(
  ctx: AccountsContext,
  staffId: unknown
): Promise<
  AccountResult<{ staff: StaffDirectoryEntry; authDetails: AuthDetails }>
> {
  const auth = await requireAdminCaller(ctx.caller)
  if (!auth.ok) return auth
  if (!isUuid(staffId)) return notFound()

  const { data, error } = await ctx.caller
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", staffId)
    .in("role", LISTED_ROLES)
    .maybeSingle()
  if (error) return dbFailed()
  if (!data) return notFound()
  const row = data as ProfileRow

  const [user, avatarUrls] = await Promise.all([
    withAuthDeadline(
      ctx.service.auth.admin.getUserById(row.id).then(({ data, error }) => {
        if (error) throw new AuthLookupError("failed")
        return data.user
      }),
      ctx.authDeadlineMs
    ).catch((error: unknown) => {
      logAuthUnavailable("account", error)
      return undefined
    }),
    signAvatars(ctx.service, row.avatar_path ? [row.avatar_path] : []),
  ])
  const details: AuthDetails = user === undefined ? "unavailable" : "ok"
  return {
    ok: true,
    authDetails: details,
    staff: toEntry(row, user ?? null, avatarUrls, details),
  }
}

/** Venues that can take a new assignment (inactive venues are rejected). */
export async function listAssignableVenues(
  ctx: AccountsContext
): Promise<AccountResult<{ venues: { id: string; name: string }[] }>> {
  const auth = await requireAdminCaller(ctx.caller)
  if (!auth.ok) return auth
  const { data, error } = await ctx.caller
    .from("venues")
    .select("id, name")
    .eq("active", true)
    .order("name", { ascending: true })
  if (error) return dbFailed()
  return { ok: true, venues: data }
}
