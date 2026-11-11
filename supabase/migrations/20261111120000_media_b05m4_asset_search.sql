-- B05-m4: asset search for venue managers and admins (contracts/b05-design.md
-- §6, tasks B05-06a, the B05-06b subset and B05-06e; build scope
-- contracts/b05-m4-build-scope.md).
--
-- * public.asset_search(p_filters, p_after_created_at, p_after_id, p_limit):
--   one keyset page, (created_at desc, id desc), 1..48 rows. The app decodes
--   its opaque cursor and passes the row values (contract note: no p_cursor
--   text argument).
-- * Callers: an active admin searches every venue (a venue filter must name
--   an existing venue); the venue's effective manager (a manager account, or
--   a staff account still holding an open grant, as asset_use_status admits)
--   searches that venue only. Everyone else, plain staff included, is refused
--   with not_venue_manager.
-- * Rows: ready and undeleted only. For a manager, one more rule applies,
--   shared with public.asset_search_can_open through
--   private.asset_search_admits: the upload venue is the managed venue, a
--   manager account's staff-era upload never shows (as in
--   private.viewer_sees_asset), and the asset is the caller's own
--   manager-era upload or passes menu_item_photo_asset, task_evidence_asset
--   or amenity_evidence_asset. The colleague portfolio arm is left out:
--   managers find nothing that only the portfolio would show.
-- * Results: asset id, media type, thumbnail flag, venue name, uploader first
--   name, upload time (created_at; never an observation time), subjects,
--   group id, the use summary with destination keys, menu decision states.
--   No notes, clearance or granter details.
-- * Not here: answer freshness (needs B03's K1), menu currency, derivative
--   state, reuse and reuse provenance (held). reused_from_grant_id stays
--   unused.
-- * Read only: no table, no row change, no grant or destination row, and no
--   existing function is re-created. Credit functions are untouched.
--
-- Rollback: drop the three public functions and the private helpers. Nothing
-- else depends on them.

-- ---------------------------------------------------------------------------
-- Caller and row predicate (shared by search and the thumbnail check)
-- ---------------------------------------------------------------------------

-- Who is searching: one row (admin, every venue) or (manager, its venue);
-- no row for anyone else.
create function private.asset_search_caller()
returns table (is_admin boolean, venue_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select true, null::uuid
  where private.is_active_user() and private.is_active_admin()
  union all
  select false, m.venue_id
  from (select private.effective_manager_venue_id((select auth.uid())) as venue_id) m
  where m.venue_id is not null
    and private.is_active_user()
    and not private.is_active_admin();
$$;

-- The search predicate for one asset row. A strict subset of
-- private.viewer_sees_asset for managers (venue limit, ready check, no
-- portfolio arm). The cost keeps it after the cheap filters of a search.
create function private.asset_search_admits(
  p_asset public.media_assets,
  p_admin boolean,
  p_venue_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
cost 10000
as $$
  select coalesce(
    p_asset.id is not null
    and p_asset.deleted_at is null
    and p_asset.upload_state = 'ready'
    and (
      p_admin
      or (
        p_venue_id is not null
        and p_asset.venue_id = p_venue_id
        and not (
          private.is_active_manager()
          and p_asset.uploader_id = (select auth.uid())
          and p_asset.uploader_role is distinct from 'manager'
        )
        and (
          (p_asset.uploader_id = (select auth.uid()) and p_asset.uploader_role = 'manager')
          or exists (select 1 from public.menu_item_photo_asset(p_asset.id))
          or exists (select 1 from public.task_evidence_asset(p_asset.id))
          or exists (select 1 from public.amenity_evidence_asset(p_asset.id))
        )
      )
    ), false);
$$;

-- ---------------------------------------------------------------------------
-- Filter values
-- ---------------------------------------------------------------------------

-- A uuid filter value: absent is null; anything but a uuid string is refused.
create function private.asset_search_filter_uuid(p_filters jsonb, p_key text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_value jsonb := p_filters -> p_key;
begin
  if v_value is null then
    return null;
  end if;
  if jsonb_typeof(v_value) <> 'string'
     or (v_value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_search_filter' using errcode = '22023', detail = p_key;
  end if;
  return (v_value #>> '{}')::uuid;
end;
$$;

-- A text filter value from a fixed list: absent is null.
create function private.asset_search_filter_choice(p_filters jsonb, p_key text, p_allowed text[])
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_value jsonb := p_filters -> p_key;
begin
  if v_value is null then
    return null;
  end if;
  if jsonb_typeof(v_value) <> 'string' or not ((v_value #>> '{}') = any (p_allowed)) then
    raise exception 'invalid_search_filter' using errcode = '22023', detail = p_key;
  end if;
  return v_value #>> '{}';
end;
$$;

-- An ISO instant with a zone (the app sends London day bounds as instants).
create function private.asset_search_filter_instant(p_filters jsonb, p_key text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_value jsonb := p_filters -> p_key;
begin
  if v_value is null then
    return null;
  end if;
  if jsonb_typeof(v_value) <> 'string'
     or (v_value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
    raise exception 'invalid_search_filter' using errcode = '22023', detail = p_key;
  end if;
  begin
    return (v_value #>> '{}')::timestamptz;
  exception when others then
    raise exception 'invalid_search_filter' using errcode = '22023', detail = p_key;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Search (B05-06a, B05-06b subset)
-- ---------------------------------------------------------------------------

-- Filters (every key optional, combinable; any other key is refused):
--   venue (uuid), mediaType ('image'|'video'), item / variant (uuid: labels
--   or menu_item_photos), check (uuid: an amenity or knowledge check through
--   its evidence, or a coverage task through its submission items), group
--   (uuid), submission ({source: 'coverage'|'amenity'|'knowledge', id}),
--   rights ('legacy_unknown'|'not_granted'|'in_force'|'expired'|'withdrawn'),
--   destination (narrows in_force to a grant in force there), uploadedFrom
--   (inclusive instant), uploadedBefore (exclusive instant), menuState (a
--   menu_item_photos state).
create function public.asset_search(
  p_filters jsonb default '{}'::jsonb,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 24
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set plan_cache_mode = force_custom_plan
as $$
declare
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_admin boolean;
  v_manager_venue uuid;
  v_venue uuid;
  v_type public.media_type;
  v_item uuid;
  v_variant uuid;
  v_check uuid;
  v_group uuid;
  v_submission_source text;
  v_submission_id uuid;
  v_rights text;
  v_destination text;
  v_from timestamptz;
  v_before timestamptz;
  v_menu_state text;
  v_limit integer := least(greatest(coalesce(p_limit, 24), 1), 48);
  v_now timestamptz := now();
  v_ids uuid[];
  v_more boolean;
begin
  perform private.amenity_assert_active_user();
  select c.is_admin, c.venue_id into v_admin, v_manager_venue from private.asset_search_caller() c;
  if not found then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;

  if jsonb_typeof(v_filters) <> 'object' then
    raise exception 'invalid_search_filter' using errcode = '22023', detail = 'filters';
  end if;
  if exists (
    select 1 from jsonb_object_keys(v_filters) k
    where k not in ('venue', 'mediaType', 'item', 'variant', 'check', 'group', 'submission',
      'rights', 'destination', 'uploadedFrom', 'uploadedBefore', 'menuState')
  ) then
    raise exception 'invalid_search_filter' using errcode = '22023', detail = 'unknown';
  end if;
  if (p_after_created_at is null) <> (p_after_id is null) then
    raise exception 'invalid_search_cursor' using errcode = '22023';
  end if;

  v_venue := private.asset_search_filter_uuid(v_filters, 'venue');
  v_type := private.asset_search_filter_choice(v_filters, 'mediaType', array['image', 'video'])::public.media_type;
  v_item := private.asset_search_filter_uuid(v_filters, 'item');
  v_variant := private.asset_search_filter_uuid(v_filters, 'variant');
  v_check := private.asset_search_filter_uuid(v_filters, 'check');
  v_group := private.asset_search_filter_uuid(v_filters, 'group');
  if v_filters ? 'submission' then
    if jsonb_typeof(v_filters -> 'submission') <> 'object'
       or exists (select 1 from jsonb_object_keys(v_filters -> 'submission') k where k not in ('source', 'id'))
       or not (v_filters -> 'submission' ? 'source' and v_filters -> 'submission' ? 'id') then
      raise exception 'invalid_search_filter' using errcode = '22023', detail = 'submission';
    end if;
    v_submission_source := private.asset_search_filter_choice(
      v_filters -> 'submission', 'source', array['coverage', 'amenity', 'knowledge']);
    v_submission_id := private.asset_search_filter_uuid(v_filters -> 'submission', 'id');
  end if;
  v_rights := private.asset_search_filter_choice(v_filters, 'rights',
    array['legacy_unknown', 'not_granted', 'in_force', 'expired', 'withdrawn']);
  if v_filters ? 'destination' then
    if v_rights is distinct from 'in_force'
       or jsonb_typeof(v_filters -> 'destination') <> 'string'
       or (v_filters ->> 'destination') !~ '^[a-z0-9_]{3,64}$' then
      raise exception 'invalid_search_filter' using errcode = '22023', detail = 'destination';
    end if;
    v_destination := v_filters ->> 'destination';
  end if;
  v_from := private.asset_search_filter_instant(v_filters, 'uploadedFrom');
  v_before := private.asset_search_filter_instant(v_filters, 'uploadedBefore');
  v_menu_state := private.asset_search_filter_choice(v_filters, 'menuState',
    array['accepted', 'better_photo_requested', 'needs_recheck', 'withdrawn', 'invalidated']);

  if v_admin then
    if v_venue is not null and not exists (select 1 from public.venues v where v.id = v_venue) then
      raise exception 'venue_not_found' using errcode = 'P0002';
    end if;
  else
    if v_venue is not null and v_venue <> v_manager_venue then
      raise exception 'wrong_venue' using errcode = '42501';
    end if;
    v_venue := v_manager_venue;
  end if;

  -- Cheap filters first; the gate predicate (cost 10000) runs last, on the
  -- feed index order, and the page stops at limit + 1 rows.
  select array_agg(x.id order by x.created_at desc, x.id desc) into v_ids
  from (
    select a.id, a.created_at
    from public.media_assets a
    where a.deleted_at is null
      and a.upload_state = 'ready'
      and (v_venue is null or a.venue_id = v_venue)
      and (v_type is null or a.media_type = v_type)
      and (v_from is null or a.created_at >= v_from)
      and (v_before is null or a.created_at < v_before)
      and (p_after_created_at is null or (a.created_at, a.id) < (p_after_created_at, p_after_id))
      and (v_group is null or exists (
        select 1 from public.media_contribution_group_members gm
        where gm.asset_id = a.id and gm.group_id = v_group))
      and (v_menu_state is null or exists (
        select 1 from public.menu_item_photos mp
        where mp.asset_id = a.id and mp.state = v_menu_state))
      and ((v_item is null and v_variant is null)
        or exists (
          select 1 from public.media_label_items li
          where li.asset_id = a.id
            and (v_item is null or li.item_id = v_item)
            and (v_variant is null or li.variant_id = v_variant))
        or exists (
          select 1 from public.menu_item_photos mp
          where mp.asset_id = a.id
            and (v_item is null or mp.item_id = v_item)
            and (v_variant is null or mp.variant_id = v_variant)))
      and (v_check is null
        or exists (
          select 1 from public.amenity_submission_assets sa
          join public.amenity_submissions s on s.id = sa.submission_id
          where sa.asset_id = a.id and s.check_id = v_check)
        or exists (
          select 1 from public.knowledge_contribution_assets ka
          join public.knowledge_contributions kc on kc.id = ka.contribution_id
          where ka.asset_id = a.id and kc.check_id = v_check)
        or exists (
          select 1 from public.coverage_submission_items ci
          where ci.asset_id = a.id and ci.requirement_id = v_check))
      and (v_submission_id is null
        or (v_submission_source = 'coverage' and exists (
          select 1 from public.coverage_submission_items ci
          where ci.asset_id = a.id and ci.submission_id = v_submission_id))
        or (v_submission_source = 'amenity' and exists (
          select 1 from public.amenity_submission_assets sa
          where sa.asset_id = a.id and sa.submission_id = v_submission_id))
        or (v_submission_source = 'knowledge' and exists (
          select 1 from public.knowledge_contribution_assets ka
          where ka.asset_id = a.id and ka.contribution_id = v_submission_id)))
      and (v_rights is null
        or (v_rights in ('legacy_unknown', 'not_granted', 'withdrawn')
          and private.media_asset_use_state(a.id, v_now) = v_rights)
        or (v_rights = 'in_force'
          and private.media_asset_use_state(a.id, v_now) = 'granted'
          and (v_destination is null or exists (
            select 1 from public.media_use_grants g
            where g.asset_id = a.id and g.destination_key = v_destination
              and private.media_use_grant_state(g, v_now) = 'in_force')))
        or (v_rights = 'expired'
          and private.media_asset_use_state(a.id, v_now) in ('legacy_unknown', 'not_granted')
          and exists (
            select 1 from public.media_use_grants g
            where g.asset_id = a.id and private.media_use_grant_state(g, v_now) = 'expired')))
      and private.asset_search_admits(a, v_admin, v_manager_venue)
    order by a.created_at desc, a.id desc
    limit v_limit + 1
  ) x;

  v_ids := coalesce(v_ids, '{}');
  v_more := cardinality(v_ids) > v_limit;
  if v_more then
    v_ids := v_ids[1:v_limit];
  end if;

  return jsonb_build_object(
    'hasMore', v_more,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', a.id,
          'mediaType', a.media_type,
          'hasThumbnail', a.thumbnail_path is not null,
          'venueName', v.name,
          'uploaderFirstName', nullif(split_part(btrim(p.display_name), ' ', 1), ''),
          'uploadedAt', a.created_at,
          'groupId', gm.group_id,
          'subjects', jsonb_build_object(
            'menuItems', coalesce((
              select jsonb_agg(jsonb_build_object(
                  'itemId', mi.item_id, 'variantId', mi.variant_id,
                  'itemName', mi.item_name, 'variantName', mi.variant_name)
                order by mi.item_name, mi.variant_name nulls first, mi.item_id, mi.variant_id)
              from (
                select distinct on (s.item_id, s.variant_id) s.item_id, s.variant_id, s.item_name, s.variant_name
                from (
                  select li.item_id, li.variant_id, li.item_name, li.variant_name, 1 as rank, li.added_at as at
                  from public.media_label_items li where li.asset_id = a.id
                  union all
                  select mp.item_id, mp.variant_id, mp.item_name, mp.variant_name, 2, mp.decided_at
                  from public.menu_item_photos mp where mp.asset_id = a.id
                ) s
                order by s.item_id, s.variant_id, s.rank, s.at desc
              ) mi), '[]'::jsonb),
            'checks', coalesce((
              select jsonb_agg(jsonb_build_object(
                  'checkId', ck.check_id, 'questionKey', ck.question_key, 'source', ck.source)
                order by ck.question_key, ck.source, ck.check_id)
              from (
                select distinct s.check_id, c.template_key as question_key, 'amenity' as source
                from public.amenity_submission_assets sa
                join public.amenity_submissions s on s.id = sa.submission_id
                join public.venue_amenity_checks c on c.id = s.check_id
                where sa.asset_id = a.id
                union
                select kc.check_id, kc.question_key, 'knowledge'
                from public.knowledge_contribution_assets ka
                join public.knowledge_contributions kc on kc.id = ka.contribution_id
                where ka.asset_id = a.id
              ) ck), '[]'::jsonb),
            'tasks', coalesce((
              select jsonb_agg(jsonb_build_object(
                  'requirementId', t.requirement_id, 'submissionId', t.submission_id)
                order by t.submission_id, t.requirement_id)
              from (
                select distinct ci.requirement_id, ci.submission_id
                from public.coverage_submission_items ci
                where ci.asset_id = a.id
              ) t), '[]'::jsonb),
            'group', case when g.id is not null
              then jsonb_build_object('kind', g.subject_kind, 'id', g.subject_id) end),
          'use', private.media_asset_use_summary(a.id, 'full') || jsonb_build_object(
            'destinations', coalesce((
              select jsonb_agg(jsonb_build_object(
                  'destinationKey', ug.destination_key, 'label', d.label,
                  'state', private.media_use_grant_state(ug, v_now), 'until', ug.effective_until)
                order by d.label, ug.created_at)
              from public.media_use_grants ug
              join public.media_use_destinations d on d.key = ug.destination_key
              where ug.asset_id = a.id), '[]'::jsonb)),
          'menuDecisions', coalesce((
            select jsonb_agg(jsonb_build_object(
                'itemId', mp.item_id, 'variantId', mp.variant_id,
                'itemName', mp.item_name, 'variantName', mp.variant_name,
                'state', mp.state, 'isPrimary', mp.is_primary, 'basis', mp.basis)
              order by mp.decided_at desc, mp.id)
            from public.menu_item_photos mp where mp.asset_id = a.id), '[]'::jsonb))
        order by o.ord)
      from unnest(v_ids) with ordinality as o(id, ord)
      join public.media_assets a on a.id = o.id
      join public.venues v on v.id = a.venue_id
      join public.profiles p on p.id = a.uploader_id
      left join public.media_contribution_group_members gm on gm.asset_id = a.id
      left join public.media_contribution_groups g on g.id = gm.group_id
    ), '[]'::jsonb));
end;
$$;

-- The thumbnail gate's manager arm: true when asset_search would list this
-- asset for the caller (same caller rule and predicate). False, never an
-- error, for anyone else and for unknown assets.
create function public.asset_search_can_open(p_asset_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin boolean;
  v_venue uuid;
  v_asset public.media_assets;
begin
  if p_asset_id is null or auth.uid() is null or not private.is_active_user() then
    return false;
  end if;
  select c.is_admin, c.venue_id into v_admin, v_venue from private.asset_search_caller() c;
  if not found then
    return false;
  end if;
  select a.* into v_asset from public.media_assets a where a.id = p_asset_id;
  if not found then
    return false;
  end if;
  return private.asset_search_admits(v_asset, v_admin, v_venue);
end;
$$;

comment on function public.asset_search(jsonb, timestamptz, uuid, integer) is
  'B05-m4 asset search: one keyset page for an admin (every venue) or a venue''s effective manager (its venue, existing gates only). Read only.';
comment on function public.asset_search_can_open(uuid) is
  'B05-m4: whether asset_search would list this asset for the caller. Used by the thumbnail route for managers.';

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.asset_search_caller(),
  private.asset_search_admits(public.media_assets, boolean, uuid),
  private.asset_search_filter_uuid(jsonb, text),
  private.asset_search_filter_choice(jsonb, text, text[]),
  private.asset_search_filter_instant(jsonb, text)
from public, anon, authenticated, service_role;

revoke all on function
  public.asset_search(jsonb, timestamptz, uuid, integer),
  public.asset_search_can_open(uuid)
from public, anon, service_role;

grant execute on function
  public.asset_search(jsonb, timestamptz, uuid, integer),
  public.asset_search_can_open(uuid)
to authenticated;
