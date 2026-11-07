// Staff describe their own work (public.staff_work_profiles). Every write goes
// through a SECURITY DEFINER RPC that acts only on the caller's own row while
// they are active staff, so the database decides who may write; the parser
// below only shapes untrusted Server Function input and words the errors.
// Admin-maintained job title and team are never touched here. Free of
// `server-only` so the security suite can call it with real identities.

import type { SupabaseClient } from "@supabase/supabase-js"

import { toWorkProfile, type WorkProfile } from "@/lib/auth/profile"
import {
  isWorkArea,
  isWorkRoleKey,
  WORK_AREAS,
  WORK_ROLE_TITLE_MAX,
  type WorkArea,
  type WorkRoleKey,
} from "@/lib/config/work-roles"
import type { Database } from "@/lib/db/types"

export type WorkProfileInput = {
  roleKey: WorkRoleKey
  /** Only for role "other"; null otherwise. */
  roleTitle: string | null
  /** Deduplicated, in WORK_AREAS order. */
  workAreas: WorkArea[]
}

type Field = "roleKey" | "roleTitle" | "workAreas"
export type WorkProfileFieldErrors = Partial<Record<Field, string>>

export type WorkProfileOutcome =
  | { ok: true; work: WorkProfile }
  | {
      ok: false
      status: number
      message: string
      fieldErrors?: WorkProfileFieldErrors
    }

/** Anything holding the caller's own RLS-scoped client (MediaActor qualifies). */
type Caller = { db: SupabaseClient<Database> }

const CHECK = "Check the highlighted field."

/**
 * Validates untrusted input. Reads only `roleKey`, `roleTitle` and `workAreas`;
 * anything else is ignored. A title sent with a listed role is dropped.
 */
export function parseWorkProfileInput(
  raw: unknown
):
  | { ok: true; value: WorkProfileInput }
  | { ok: false; fieldErrors: WorkProfileFieldErrors } {
  const input =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const fieldErrors: WorkProfileFieldErrors = {}

  const roleKey = isWorkRoleKey(input.roleKey) ? input.roleKey : null
  if (!roleKey) fieldErrors.roleKey = "Choose what you mainly do."

  let roleTitle: string | null = null
  if (roleKey === "other") {
    const title =
      typeof input.roleTitle === "string"
        ? input.roleTitle.trim().replace(/\s+/g, " ")
        : ""
    if (!title) fieldErrors.roleTitle = "Enter your role."
    else if (title.length > WORK_ROLE_TITLE_MAX)
      fieldErrors.roleTitle = `Use ${WORK_ROLE_TITLE_MAX} characters or fewer.`
    else roleTitle = title
  }

  let workAreas: WorkArea[] = []
  const areas = input.workAreas ?? []
  if (!Array.isArray(areas) || !areas.every(isWorkArea)) {
    fieldErrors.workAreas = "Choose from the listed areas."
  } else {
    const chosen = new Set<WorkArea>(areas)
    workAreas = WORK_AREAS.filter((area) => chosen.has(area))
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors }
  return { ok: true, value: { roleKey: roleKey!, roleTitle, workAreas } }
}

type RpcError = { code?: string; message?: string } | null

function failure(error: RpcError): Extract<WorkProfileOutcome, { ok: false }> {
  switch (error?.message) {
    case "work_profile_forbidden":
      return {
        ok: false,
        status: 403,
        message: "Only active staff can set their work details.",
      }
    case "invalid_work_role":
      return {
        ok: false,
        status: 400,
        message: CHECK,
        fieldErrors: { roleKey: "Choose what you mainly do." },
      }
    case "work_role_title_required":
      return {
        ok: false,
        status: 400,
        message: CHECK,
        fieldErrors: { roleTitle: "Enter your role." },
      }
    case "invalid_work_role_title":
      return {
        ok: false,
        status: 400,
        message: CHECK,
        fieldErrors: {
          roleTitle: `Use ${WORK_ROLE_TITLE_MAX} characters or fewer.`,
        },
      }
    case "invalid_work_areas":
      return {
        ok: false,
        status: 400,
        message: CHECK,
        fieldErrors: { workAreas: "Choose from the listed areas." },
      }
    default:
      return {
        ok: false,
        status: 503,
        message: "Could not save your changes. Try again.",
      }
  }
}

function outcome(
  data: Parameters<typeof toWorkProfile>[0],
  error: RpcError
): WorkProfileOutcome {
  const work = error ? null : toWorkProfile(data)
  return work ? { ok: true, work } : failure(error)
}

/** Saves the caller's main role and extra areas (clears an earlier skip). */
export async function saveWorkProfile(
  actor: Caller,
  raw: unknown
): Promise<WorkProfileOutcome> {
  const parsed = parseWorkProfileInput(raw)
  if (!parsed.ok) {
    return {
      ok: false,
      status: 400,
      message: CHECK,
      fieldErrors: parsed.fieldErrors,
    }
  }
  const { roleKey, roleTitle, workAreas } = parsed.value
  const { data, error } = await actor.db.rpc("save_work_profile", {
    p_role_key: roleKey,
    // The generated Args type has no nulls; the function accepts NULL.
    p_role_title: roleTitle as string,
    p_work_areas: workAreas,
  })
  return outcome(data, error)
}

/** "Skip for now": records the skip and keeps any saved role. */
export async function skipWorkProfile(
  actor: Caller
): Promise<WorkProfileOutcome> {
  const { data, error } = await actor.db.rpc("skip_work_profile")
  return outcome(data, error)
}

/** Hides (true) or shows again (false) Home's Start here card. */
export async function setWelcomeDismissed(
  actor: Caller,
  dismissed: boolean
): Promise<WorkProfileOutcome> {
  const { data, error } = await actor.db.rpc("set_welcome_dismissed", {
    p_dismissed: dismissed === true,
  })
  return outcome(data, error)
}
