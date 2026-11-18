-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, Sprint 3 repair S3-R6 (review V19; spec §11: a venue
-- correction suspends the affected approvals until someone re-reviews).
--
-- admin_correct_asset_venue withdraws the photo, and that withdrawal is the
-- only thing keeping its declared-venue approvals out of exports and primary
-- choices. library_restore_asset deleted it without looking at corrections,
-- so a restored corrected photo went back into public use at the wrong venue
-- with its old approvals and no re-review.
--
-- library_restore_asset now refuses ('venue_correction_pending') while the
-- photo has a venue correction. A correction always names a venue other than
-- the declared one (media_venue_corrections_differs) and is append-only, so
-- the photo stays withdrawn at the declared venue: the declared venue's
-- approvals can't be re-reviewed into being right, and moving the photo into
-- the corrected venue's review is not built (S2-LIBRARY report). The way to
-- use it at the right venue is a new upload there. Body as in
-- 20261118116000 otherwise.
--
-- Rollback: restore the 20261118116000 body.

create or replace function public.library_restore_asset(p_asset_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.library_assert_admin();
  v_reason text;
  v_asset record;
begin
  select a.id, a.venue_id, a.deleted_at into v_asset
  from public.media_assets a where a.id = p_asset_id for update;
  if v_asset.id is null or v_asset.deleted_at is not null then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  v_reason := private.library_reason(p_reason);
  if exists (select 1 from public.media_venue_corrections c where c.asset_id = p_asset_id) then
    raise exception 'venue_correction_pending' using errcode = 'P0001',
      detail = 'This photo was recorded at the wrong venue, so it stays withdrawn.';
  end if;
  delete from public.media_asset_withdrawals w where w.asset_id = p_asset_id;
  if not found then
    return jsonb_build_object('assetId', p_asset_id, 'withdrawn', false, 'changed', false);
  end if;
  insert into public.media_asset_withdrawal_events (asset_id, venue_id, action, reason, actor_id)
  values (p_asset_id, v_asset.venue_id, 'restored', v_reason, v_uid);
  perform private.record_activity(v_asset.venue_id, 'library_asset_restored', 'media_asset',
    p_asset_id::text, null, null, v_reason, null, null);
  return jsonb_build_object('assetId', p_asset_id, 'withdrawn', false, 'changed', true);
end;
$$;

revoke all on function public.library_restore_asset(uuid, text) from public, anon, service_role;
grant execute on function public.library_restore_asset(uuid, text) to authenticated;
