"use server"

import { getCoverageActor } from "@/lib/server/coverage"
import { resetMfa } from "@/lib/server/admin/venues"

export type MfaResetState =
  | { status: "idle" }
  | { status: "done"; removed: number }
  | { status: "error"; message: string; field?: "reason" }

/**
 * An admin resets another person's lost authenticator (FA-23; S1-PRIVACY
 * hand-off). Re-authorised here and in the database (an active admin on a
 * second-factor session, never for themselves); recorded in Activity.
 */
export async function resetMfaAction(
  _prev: MfaResetState,
  form: FormData
): Promise<MfaResetState> {
  const auth = await getCoverageActor()
  if (!auth.ok) return { status: "error", message: auth.message }
  const result = await resetMfa(auth.actor, auth.actor.service, {
    profileId: form.get("profileId"),
    reason: form.get("reason"),
  })
  if (!result.ok)
    return {
      status: "error",
      message: result.message,
      ...(result.field === "reason" ? { field: "reason" as const } : {}),
    }
  return { status: "done", removed: result.removed }
}
