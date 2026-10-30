-- Let cleanup continue past rows whose storage removal failed earlier in this run.
-- Excluding those IDs before LIMIT prevents a blocked oldest batch from starving
-- newer tombstones. Omitted arguments preserve all existing cleanup callers;
-- failures remain eligible again on the next run. Only the service role may run it.

drop function public.prepare_media_cleanup(interval, integer, timestamptz);

create function public.prepare_media_cleanup(
  p_abandoned_after interval,
  p_limit integer default 100,
  p_now timestamptz default now(),
  p_exclude_asset_ids uuid[] default '{}'::uuid[]
)
returns table (asset_id uuid, upload_state public.upload_state, object_names text[])
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz;
begin
  if p_abandoned_after is null or p_abandoned_after < interval '1 hour' then
    raise exception 'abandoned_window_too_short' using errcode = '22023';
  end if;
  if p_now is null then
    raise exception 'invalid_now' using errcode = '22023';
  end if;
  v_cutoff := p_now - p_abandoned_after;

  update public.media_assets a
  set deleted_at = now()
  where a.deleted_at is null
    and a.upload_state in ('uploading', 'failed')
    and a.updated_at < v_cutoff
    and not exists (
      select 1
      from storage.objects o
      where o.bucket_id = 'media'
        and o.name like a.uploader_id::text || '/' || a.id::text || '/%'
        and greatest(o.created_at, o.updated_at) >= v_cutoff
    );

  return query
    select a.id, a.upload_state, array_agg(o.name order by o.name)
    from public.media_assets a
    join storage.objects o
      on o.bucket_id = 'media'
     and o.name like a.uploader_id::text || '/' || a.id::text || '/%'
    where a.deleted_at is not null
      and not (a.id = any(coalesce(p_exclude_asset_ids, '{}'::uuid[])))
    group by a.id, a.upload_state
    order by min(a.deleted_at), a.id
    limit greatest(1, least(coalesce(p_limit, 100), 1000));
end;
$$;

revoke all on function public.prepare_media_cleanup(interval, integer, timestamptz, uuid[]) from public, anon, authenticated;
grant execute on function public.prepare_media_cleanup(interval, integer, timestamptz, uuid[]) to service_role;
