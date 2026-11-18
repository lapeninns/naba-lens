// FA-20 fixture for the integration suites (not a test file itself): staff
// see a colleague's photo only once it is accepted. Accepts an asset the way a
// manager's place (area) decision does, as tests/security/privacy-fixtures.ts
// and tests/e2e/helpers/accepted.ts do, through localSql so it uses this
// run's owned stack (SUPABASE_DB_URL). Suites whose subject is not the review
// itself use it to give a colleague something visible.
import { createIdentity, serviceClient } from "../support/identities"
import { localSql } from "./auth-support"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

let decider: Promise<string> | null = null

/** An admin who records the fixture decisions (no session needed). */
function fixtureDecider(): Promise<string> {
  decider ??= createIdentity(serviceClient(), {
    label: "it-accept-decider",
    role: "admin",
    session: false,
  }).then((identity) => identity.id)
  return decider
}

/** Labels the asset with a new place at its venue and accepts it there. */
export async function acceptForColleagues(assetId: string): Promise<void> {
  if (!UUID.test(assetId)) throw new Error("not a uuid")
  const deciderId = await fixtureDecider()
  const label = localSql(
    `with a as (
       select id, venue_id, uploader_id from public.media_assets where id = '${assetId}'::uuid
     ), s as (
       insert into public.knowledge_subjects (venue_id, kind, label, created_by)
       select a.venue_id, 'area', 'TEST place ' || left(md5(random()::text), 8), '${deciderId}'::uuid
       from a returning id, venue_id, label
     ), l as (
       insert into public.media_area_labels (asset_id, venue_id, subject_id, subject_kind, subject_label, added_by)
       select a.id, s.venue_id, s.id, 'area', s.label, a.uploader_id
       from s, a returning id, venue_id, asset_id
     ), d as (
       insert into public.area_photo_decisions (label_id, venue_id, asset_id, action, decided_by)
       select l.id, l.venue_id, l.asset_id, 'accepted', '${deciderId}'::uuid from l
       returning label_id
     )
     select label_id from d`
  )
  if (!label) throw new Error(`could not accept ${assetId}`)
}
