-- NabaLens media lifecycle (spec v0.2 §5, §7): activity-guarded cleanup and a run lease.
-- The runner is lib/server/lifecycle/cleanup.ts (endpoint app/api/internal/cleanup,
-- script `pnpm cleanup`); scheduling options are in docs/cleanup.md.

-- ---------------------------------------------------------------------------
-- Run lease: one cleanup run at a time
-- ---------------------------------------------------------------------------
-- A cleanup run spans several Data API requests (claim rows, then Storage API
-- removals), and PostgREST runs each request in its own pooled transaction, so a
-- session advisory lock cannot be held for the whole run. A lease row with an
-- expiry does that job instead and is released (or expires) when the run ends.
-- Internal only: lives in `private`, which the Data API does not expose.

create table private.maintenance_leases (
  name text primary key check (name ~ '^[a-z0-9_]{1,40}$'),
  holder uuid not null,
  expires_at timestamptz not null
);

revoke all on private.maintenance_leases from public, anon, authenticated;

-- True when p_holder now holds the lease (newly, after expiry, or renewed).
create or replace function public.acquire_maintenance_lease(
  p_name text,
  p_holder uuid,
  p_ttl interval
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_holder is null or p_ttl is null
     or p_ttl < interval '1 second' or p_ttl > interval '1 hour' then
    raise exception 'invalid_lease' using errcode = '22023';
  end if;

  insert into private.maintenance_leases as l (name, holder, expires_at)
  values (p_name, p_holder, now() + p_ttl)
  on conflict (name) do update
    set holder = excluded.holder, expires_at = excluded.expires_at
    where l.expires_at <= now() or l.holder = excluded.holder;

  return found;
end;
$$;

create or replace function public.release_maintenance_lease(p_name text, p_holder uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from private.maintenance_leases l where l.name = p_name and l.holder = p_holder;
$$;

revoke all on function public.acquire_maintenance_lease(text, uuid, interval) from public, anon, authenticated;
revoke all on function public.release_maintenance_lease(text, uuid) from public, anon, authenticated;
grant execute on function public.acquire_maintenance_lease(text, uuid, interval) to service_role;
grant execute on function public.release_maintenance_lease(text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- prepare_media_cleanup: protect active transfers
-- ---------------------------------------------------------------------------
-- Replaces the foundation version (same name and first two parameters). Changes:
--   * A reservation is abandoned only when BOTH its row and every object under its
--     key prefix are untouched for the window. A transfer that stored an object (a
--     finished TUS upload or signed PUT whose finalise has not run yet) keeps the
--     reservation alive. In-progress TUS uploads leave no trace in the database (the
--     partial data lives in the storage backend), so the app must touch the row when
--     an attempt starts (reserve, including idempotent retries) and at finalise; the
--     storage server's TUS upload URLs expire well within the 24-hour window.
--   * p_now lets the runner and tests evaluate the window at a given instant.
--   * Returns upload_state so the runner can report removals, abandoned reservations
--     and failed uploads separately.

drop function public.prepare_media_cleanup(interval, integer);

create function public.prepare_media_cleanup(
  p_abandoned_after interval,
  p_limit integer default 100,
  p_now timestamptz default now()
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
    group by a.id, a.upload_state
    order by min(a.deleted_at), a.id
    limit greatest(1, least(coalesce(p_limit, 100), 1000));
end;
$$;

revoke all on function public.prepare_media_cleanup(interval, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.prepare_media_cleanup(interval, integer, timestamptz) to service_role;
