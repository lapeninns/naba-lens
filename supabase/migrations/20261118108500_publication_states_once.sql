-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S2-FIX (Sprint 1 foundation review R23; spec §14.1, §14.2).
--
-- R23  export_candidates and export_package_detail called
--      private.publication_asset_state once per row, and each call rebuilt
--      the whole venue's publication pairs, re-running
--      private.export_candidate_rows for the venue whenever it had a
--      published record: quadratic work on the export screens.
--      private.publication_asset_states(asset ids) works out the pairs once
--      for every venue involved and returns each asset's state; the two
--      reads join it once. private.publication_asset_state(asset) keeps its
--      result and now calls the set version. Results are unchanged.
--
-- Rollback: restore the 20261118105100 / 20261118105200 bodies and drop
-- private.publication_asset_states.

-- The same JSON as private.publication_asset_state for each asset id, with
-- the publication pairs computed once for all their venues.
create function private.publication_asset_states(p_asset_ids uuid[])
returns table (asset_id uuid, publication jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  with ids as materialized (
    select distinct x as asset_id from unnest(p_asset_ids) x where x is not null
  ),
  pairs as materialized (
    select pp.*
    from private.publication_pairs(array(
      select distinct a.venue_id from public.media_assets a join ids on ids.asset_id = a.id
    )) pp
    join ids on ids.asset_id = pp.asset_id
  ),
  exported as materialized (
    select ids.asset_id, private.export_asset_last_exported(ids.asset_id) as at from ids
  )
  select e.asset_id, jsonb_build_object(
    'state', coalesce(
      (select p.state from pairs p
        where p.asset_id = e.asset_id
        order by case p.state
          when 'withdrawal_pending' then 1 when 'failed_unknown' then 2
          when 'published_confirmed' then 3 else 4 end
        limit 1),
      case when e.at is not null then 'exported' else 'not_selected' end),
    'exportedAt', e.at,
    'destinations', coalesce((
      select jsonb_agg(jsonb_build_object(
          'destinationId', p.destination_id, 'label', d.label, 'state', p.state,
          'externalUrl', p.external_url, 'externalRef', p.external_ref,
          'occurredOn', p.occurred_on)
        order by lower(d.label), d.id)
      from pairs p join public.publication_destinations d on d.id = p.destination_id
      where p.asset_id = e.asset_id
    ), '[]'::jsonb))
  from exported e;
$$;

revoke all on function private.publication_asset_states(uuid[]) from public, anon, authenticated, service_role;

-- Same result as in 20261118105100, through the set version.
create or replace function private.publication_asset_state(p_asset_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select s.publication from private.publication_asset_states(array[p_asset_id]) s;
$$;

-- Body as in 20261118105200, with the publication states computed once.
create or replace function public.export_candidates(p_venue_id uuid, p_mode text default 'public')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue public.venues;
begin
  if p_mode is null or p_mode not in ('public', 'internal') then
    raise exception 'export_mode_invalid' using errcode = '22023';
  end if;
  if not private.export_can_use_venue(p_venue_id, p_mode) then
    raise exception 'export_not_allowed' using errcode = '42501';
  end if;
  select v.* into v_venue from public.venues v where v.id = p_venue_id;
  if not found then
    raise exception 'export_not_allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'venueId', v_venue.id, 'venueName', v_venue.name, 'mode', p_mode,
    'items', coalesce((
      with c as materialized (
        select * from private.export_candidate_rows(v_venue.id, p_mode)
      ),
      s as materialized (
        select * from private.publication_asset_states(array(select distinct c.asset_id from c))
      )
      select jsonb_agg(jsonb_build_object(
          'assetId', c.asset_id, 'subjectKind', c.subject_kind, 'subjectId', c.subject_id,
          'subjectLabel', c.subject_label, 'category', c.category,
          'approvalKind', c.approval_kind, 'approvalId', c.approval_id,
          'approvalVersion', c.approval_version, 'approvalLevel', c.approval_level,
          'uploadedAt', c.uploaded_at, 'width', c.width, 'height', c.height,
          'publication', s.publication)
        order by c.category, lower(c.subject_label), c.subject_id, c.uploaded_at desc, c.asset_id)
      from c left join s on s.asset_id = c.asset_id
    ), '[]'::jsonb));
end;
$$;

-- Body as in 20261118105200, with the publication states computed once.
create or replace function public.export_package_detail(p_package_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pkg public.export_packages;
  v_json jsonb;
  v_stale uuid[];
begin
  if p_package_id is null or not private.export_package_access(p_package_id) then
    raise exception 'export_package_not_found' using errcode = 'P0002';
  end if;
  select p.* into v_pkg from public.export_packages p where p.id = p_package_id;
  v_json := private.export_package_json(v_pkg, true);
  v_stale := array(select jsonb_array_elements_text(v_json -> 'staleAssets')::uuid);
  return v_json || jsonb_build_object(
    'items', coalesce((
      with s as materialized (
        select * from private.publication_asset_states(array(
          select distinct i.asset_id from public.export_package_items i where i.package_id = p_package_id))
      )
      select jsonb_agg(jsonb_build_object(
          'position', i.position, 'assetId', i.asset_id, 'venueId', i.venue_id,
          'subjectKind', i.subject_kind, 'subjectId', i.subject_id, 'subjectLabel', i.subject_label,
          'category', i.category, 'approvalKind', i.approval_kind, 'approvalId', i.approval_id,
          'approvalVersion', i.approval_version, 'approvalLevel', i.approval_level,
          'filenameStem', i.filename_stem, 'altText', i.alt_text, 'caption', i.caption,
          'useRestrictions', to_jsonb(i.use_restrictions), 'uploadedAt', i.uploaded_at,
          'eligible', not (i.asset_id = any(v_stale)),
          'publication', s.publication)
        order by i.position)
      from public.export_package_items i
      left join s on s.asset_id = i.asset_id
      where i.package_id = p_package_id
    ), '[]'::jsonb),
    'downloads', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', d.id, 'downloadedBy', pr.display_name, 'startedAt', d.started_at,
          'completedAt', d.completed_at, 'failedAt', d.failed_at,
          'fileCount', case when d.files is null then null else jsonb_array_length(d.files) end)
        order by d.started_at desc, d.id)
      from public.export_package_downloads d
      join public.profiles pr on pr.id = d.downloaded_by
      where d.package_id = p_package_id
    ), '[]'::jsonb));
end;
$$;
