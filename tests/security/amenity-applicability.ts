// S2-MGR: signed-in users archive or restore an amenity check only through
// amenity_check_set_applicability, with a reason (AC29). The reasonless
// amenity_archive_check / amenity_restore_check are no longer granted to
// `authenticated`. Older suites that archive or restore as part of their
// set-up use this helper, which keeps their old result shape: the check's
// new revision, or the database error.
import { randomUUID } from "node:crypto"

import type { Db } from "../support/identities"

type Args = { p_check_id: string; p_revision: number }

export async function setApplicability(
  client: Db,
  kind: "archive" | "restore",
  args: Args,
  reason = "TEST applicability"
): Promise<{
  data: number | null
  error: { message: string; code: string; details: string | null } | null
}> {
  const { data, error } = await client.rpc("amenity_check_set_applicability", {
    p_check_id: args.p_check_id,
    p_applicable: kind === "restore",
    p_reason: reason,
    p_revision: args.p_revision,
    p_idempotency_key: randomUUID(),
  })
  if (error)
    return {
      data: null,
      error: {
        message: error.message,
        code: error.code,
        details: error.details ?? null,
      },
    }
  return { data: (data as { revision: number }).revision, error: null }
}
