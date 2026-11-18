// S1-PRIVACY fixtures: accept an asset the way a manager's area decision
// does, so private.asset_is_accepted (FA-20, FA-21) holds for it. psql as
// the owner only builds the fixture; the tests read as real identities.
import {
  createIdentity,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import { psql } from "./coverage-fixtures"

/**
 * Labels the asset with a new area place at its venue and records an
 * accepted area decision by `deciderId` (a manager or admin). Returns the
 * label id.
 */
export function acceptAsset(assetId: string, deciderId: string): string {
  return psql(
    `with a as (
       select id, venue_id from public.media_assets where id = '${assetId}'
     ), s as (
       insert into public.knowledge_subjects (venue_id, kind, label, created_by)
       select a.venue_id, 'area', 'Privacy ' || left(md5(random()::text), 8), '${deciderId}'
       from a returning id, venue_id, label
     ), l as (
       insert into public.media_area_labels (asset_id, venue_id, subject_id, subject_kind, subject_label, added_by)
       select '${assetId}', s.venue_id, s.id, 'area', s.label, '${deciderId}'
       from s returning id, venue_id, asset_id
     ), d as (
       insert into public.area_photo_decisions (label_id, venue_id, asset_id, action, decided_by)
       select l.id, l.venue_id, l.asset_id, 'accepted', '${deciderId}' from l
       returning label_id
     )
     select label_id from d`
  )
}

/** Is the asset accepted, as the database decides it. */
export function isAccepted(assetId: string): boolean {
  return psql(`select private.asset_is_accepted('${assetId}')::text`) === "true"
}

let sharedAdmin: Promise<TestIdentity> | null = null

/**
 * Removes an accepted asset the only way FA-21 allows: an admin reads the
 * impact preview and removes it with a reason and the preview's token. For
 * tests whose subject is what a removal does downstream.
 */
export async function removeAsAdmin(
  assetId: string,
  reason = "TEST removal"
): Promise<void> {
  sharedAdmin ??= createIdentity(serviceClient(), {
    label: "privacy-remover",
    role: "admin",
  })
  const admin = await sharedAdmin
  const impact = await admin.client.rpc("media_removal_impact", {
    p_asset_id: assetId,
  })
  if (impact.error) throw new Error(impact.error.message)
  const token = (impact.data as { token: string }).token
  const removed = await admin.client.rpc("admin_delete_media_asset", {
    p_asset_id: assetId,
    p_reason: reason,
    p_impact_token: token,
  })
  if (removed.error) throw new Error(removed.error.message)
}
