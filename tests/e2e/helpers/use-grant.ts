import { randomUUID } from "node:crypto"

import type { Db } from "../../support/identities"
import { psql } from "./stack"

/**
 * B05 use registry fixtures for the isolated stack (coordinator decision
 * SS-3): a synthetic, test-only place of use and clearance checklist, written
 * through psql as tests/security/media-use-grants.test.ts does. Migrations
 * seed none. Grants and withdrawals go through the admin's own session.
 */
export type TestDestination = { key: string; label: string; version: string }

const sql = (v: string) => `'${v.replace(/'/g, "''")}'`

export function testDestination(tag: string, venueId: string): TestDestination {
  const run = tag.replace(/[^a-z0-9]/gi, "").toLowerCase()
  const destination = {
    key: `test_srch_${run}`,
    label: `TEST place ${tag}`,
    version: `test-srch-${run}`,
  }
  psql(`insert into public.media_use_destinations
      (key, label, audience, venue_id, owner_workstream, requires_derivative, active)
    values (${sql(destination.key)}, ${sql(destination.label)}, 'internal',
      ${sql(venueId)}::uuid, 'WS5', false, true);
    insert into private.media_use_clearance_versions (version, keys, active)
    values (${sql(destination.version)}, array['a_ok'], true)`)
  return destination
}

type UntypedRpc = {
  rpc: (
    name: string,
    args: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>
}

async function call<T>(db: Db, name: string, args: Record<string, unknown>) {
  const { data, error } = await (db as unknown as UntypedRpc).rpc(name, args)
  if (error) throw new Error(`${name} failed: ${error.message}`)
  return data as T
}

/** An in-force grant (no end) for `assetId`, made by the admin's session. */
export async function grantUse(
  adminDb: Db,
  assetId: string,
  destination: TestDestination
): Promise<string> {
  const created = await call<{ grantId: string }>(
    adminDb,
    "media_use_grant_create",
    {
      p_request_key: `TEST-${randomUUID()}`,
      p_asset_id: assetId,
      p_destination_key: destination.key,
      p_purpose: "general_gallery",
      p_subject_kind: "none",
      p_subject_id: null,
      p_profile_key: null,
      p_effective_from: null,
      p_effective_until: null,
      p_clearance_version: destination.version,
      p_clearance: { a_ok: true },
      p_note: null,
    }
  )
  return created.grantId
}

/** Withdraws a grant, as the admin. */
export async function withdrawUse(adminDb: Db, grantId: string) {
  await call(adminDb, "media_use_grant_withdraw", {
    p_request_key: `TEST-${randomUUID()}`,
    p_grant_id: grantId,
    p_reason_code: "granter_withdrawn",
    p_note: null,
  })
}
