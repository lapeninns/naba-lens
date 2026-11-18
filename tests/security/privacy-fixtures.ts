// S1-PRIVACY fixtures: accept an asset the way a manager's area decision
// does, so private.asset_is_accepted (FA-20, FA-21) holds for it. psql as
// the owner only builds the fixture; the tests read as real identities.
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
