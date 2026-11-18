-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- S1-EXPORT: the caller-scoped check run before an export screen's thumbnail
-- is signed (lib/server/coverage/evidence.ts signEvidence, as
-- album_slot_asset). The asset must be a ready, undeleted still image that
-- the caller may export now (export_candidate_rows for its venue: public for
-- the venue's manager, internal as well for an admin) or that sits in a
-- package the caller may open. Unknown and forbidden return no row (404).
-- Thumbnails and previews only: originals leave through a package download.
--
-- Rollback: revoke execute on public.export_asset_thumb.

create function public.export_asset_thumb(p_asset_id uuid)
returns table (
  asset_id uuid,
  venue_id uuid,
  media_type public.media_type,
  has_preview boolean,
  has_thumbnail boolean,
  width integer,
  height integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.venue_id, a.media_type,
    a.preview_path is not null, a.thumbnail_path is not null, a.width, a.height
  from public.media_assets a
  where a.id = p_asset_id
    and a.upload_state = 'ready'
    and a.deleted_at is null
    and a.media_type = 'image'
    and private.is_active_user()
    and (
      (private.export_can_use_venue(a.venue_id, 'public')
        and exists (
          select 1 from private.export_candidate_rows(a.venue_id,
            case when private.is_active_admin() then 'internal' else 'public' end) c
          where c.asset_id = a.id))
      or exists (
        select 1 from public.export_package_items i
        where i.asset_id = a.id and private.export_package_access(i.package_id))
    );
$$;

revoke all on function public.export_asset_thumb(uuid) from public, anon, service_role;
grant execute on function public.export_asset_thumb(uuid) to authenticated;
