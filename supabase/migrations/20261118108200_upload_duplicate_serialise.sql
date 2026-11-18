-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S2-FIX (Sprint 1 foundation review R8; FA-35, AC21).
--
-- R8  complete_media_finalise looks for an earlier ready asset with the same
--     bytes at the venue, but two finalises of identical bytes running at the
--     same moment could not see each other's uncommitted rows: neither was
--     linked as a duplicate and both earned credit. The link cannot be added
--     later (media_assets_pipeline_guard).
--
--     Without changing complete_media_finalise (S2-INT owns it), finalise's
--     own first write is serialised: when an asset's content hash is first
--     stored, a BEFORE UPDATE trigger takes a transaction lock on (venue,
--     hash). A second finalise of the same bytes waits there until the first
--     commits, then the trigger looks again with a fresh snapshot and links
--     the earliest live ready asset as duplicate_of_asset_id when finalise's
--     own lookup found none. Only the first write of a hash on a processing
--     asset is affected; ready assets and other updates are untouched.
--
--     Known limit: in that race finalise's RPC result still reports
--     duplicate_of_asset_id null (it returns its own lookup); the stored
--     column, which credit and coverage read, is correct.
--
-- Rollback: drop trigger media_assets_duplicate_serialise.

create function private.media_assets_duplicate_serialise()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_duplicate uuid;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('nabalens_dup:' || new.venue_id::text || ':' || new.content_sha256, 0));
  if new.duplicate_of_asset_id is null then
    select d.id into v_duplicate
    from public.media_assets d
    where d.venue_id = new.venue_id
      and d.content_sha256 = new.content_sha256
      and d.id <> new.id
      and d.deleted_at is null
      and d.upload_state = 'ready'
    order by d.created_at, d.id
    limit 1;
    new.duplicate_of_asset_id := v_duplicate;
  end if;
  return new;
end;
$$;

revoke all on function private.media_assets_duplicate_serialise() from public, anon, authenticated;

create trigger media_assets_duplicate_serialise
  before update of content_sha256 on public.media_assets
  for each row
  when (old.content_sha256 is null and new.content_sha256 is not null
    and old.upload_state = 'processing' and new.deleted_at is null)
  execute function private.media_assets_duplicate_serialise();
