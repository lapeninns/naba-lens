import { psql } from "./stack"

const sql = (v: string) => `'${v.replace(/'/g, "''")}'`

/**
 * DEV FIXTURE: a place (area) photo accepted by `deciderId`, written through
 * psql as tests/security/library.test.ts's acceptPlacePhoto does. FA-20 shows
 * colleagues a photo only once it is accepted at a venue whose album they can
 * see, so specs that need a visible colleague photo accept one here; the
 * decision itself is not what they test. Returns the new place's subject id.
 */
export function acceptPlacePhoto(assetId: string, deciderId: string): string {
  return psql(
    `with a as (
       select id, venue_id, uploader_id from public.media_assets where id = ${sql(assetId)}::uuid
     ), s as (
       insert into public.knowledge_subjects (venue_id, kind, label, created_by)
       select a.venue_id, 'area', 'DEV FIXTURE place ' || left(md5(random()::text), 8), ${sql(deciderId)}::uuid
       from a returning id, venue_id, label
     ), l as (
       insert into public.media_area_labels (asset_id, venue_id, subject_id, subject_kind, subject_label, added_by)
       select a.id, s.venue_id, s.id, 'area', s.label, a.uploader_id
       from s, a returning id, venue_id, asset_id, subject_id
     ), d as (
       insert into public.area_photo_decisions (label_id, venue_id, asset_id, action, decided_by)
       select l.id, l.venue_id, l.asset_id, 'accepted', ${sql(deciderId)}::uuid from l
       returning label_id
     )
     select l.subject_id from l join d on d.label_id = l.id`
  )
}
