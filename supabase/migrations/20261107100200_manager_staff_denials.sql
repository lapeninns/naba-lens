-- Venue manager accounts (part 3 of 3): what a manager account cannot do.
--
-- A manager account (role 'manager') does not upload, label, browse staff
-- community media or write the legacy coverage tables. Upload paths already
-- require role 'staff' (reserve_media_asset, can_upload_media_object,
-- guard_media_original_write, finalise); the functions below treated any
-- non-staff active role like an admin or like a community member, so they now
-- name the allowed roles. Legacy staff-held grants (role 'staff') are not
-- affected.

-- ---------------------------------------------------------------------------
-- Labels: staff (own assets) and admins only
-- ---------------------------------------------------------------------------

-- Body as in 20261030120100, plus the role allow-list after the profile read.
create or replace function public.save_media_labels(
  p_asset_id uuid,
  p_expected_revision integer,
  p_content_types text[],
  p_note text,
  p_items jsonb,
  p_missing_item text default null,
  p_catalogue_version_id uuid default null
)
returns table (revision integer, has_labels boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  c_codes constant text[] := array['dish', 'preparation', 'plating', 'drinks', 'kitchen', 'team', 'venue', 'event'];
  c_max_items constant integer := 20;
  c_max_types constant integer := 4;
  v_uid uuid := auth.uid();
  v_role public.app_role;
  v_asset public.media_assets;
  v_label public.media_labels;
  v_revision integer;
  v_types text[];
  v_note text;
  v_missing text;
  v_element jsonb;
  v_item_id uuid;
  v_variant_id uuid;
  v_requested jsonb := '[]'::jsonb;
  v_new jsonb;
  v_new_count integer;
  v_active uuid;
  v_wrong uuid[];
  v_unavailable uuid[];
  v_before jsonb;
  v_after jsonb;
  v_suggestion_before text;
  v_suggestion_after text;
  v_has boolean;
begin
  select p.role into v_role
  from public.profiles p
  where p.id = v_uid and p.active;
  if v_uid is null or v_role is null then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  if v_role not in ('staff', 'admin') then
    raise exception 'not_active_user' using errcode = '42501';
  end if;

  -- Serialises every label save of this asset with finalise/delete. No column changes.
  select a.* into v_asset from public.media_assets a where a.id = p_asset_id for update;
  if not found
     or v_asset.deleted_at is not null
     or v_asset.upload_state <> 'ready'
     or (v_role = 'staff' and v_asset.uploader_id <> v_uid) then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;

  -- Input validation.
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'invalid_revision' using errcode = '22023';
  end if;

  v_types := coalesce(p_content_types, '{}');
  if array_position(v_types, null) is not null or not (v_types <@ c_codes) then
    raise exception 'invalid_content_type' using errcode = '22023';
  end if;
  select coalesce(array_agg(c.code order by c.ord), '{}') into v_types
  from unnest(c_codes) with ordinality as c(code, ord)
  where c.code = any(v_types);
  if cardinality(v_types) > c_max_types then
    raise exception 'invalid_content_type' using errcode = '22023',
      detail = format('At most %s content types.', c_max_types);
  end if;

  v_note := nullif(btrim(p_note), '');
  if length(v_note) > 280 then
    raise exception 'note_too_long' using errcode = '22023';
  end if;

  if p_missing_item is not null then
    v_missing := btrim(p_missing_item);
    if length(v_missing) > 120 then
      raise exception 'missing_item_too_long' using errcode = '22023';
    end if;
  end if;

  if p_items is not null and jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'invalid_label_items' using errcode = '22023';
  end if;
  for v_element in select x.value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as x(value) loop
    if jsonb_typeof(v_element) is distinct from 'object' then
      raise exception 'invalid_label_items' using errcode = '22023';
    end if;
    v_item_id := private.jsonb_uuid(v_element -> 'itemId');
    if v_item_id is null then
      raise exception 'invalid_label_items' using errcode = '22023', detail = 'itemId';
    end if;
    if coalesce(jsonb_typeof(v_element -> 'variantId'), 'null') = 'null' then
      v_variant_id := null;
    else
      v_variant_id := private.jsonb_uuid(v_element -> 'variantId');
      if v_variant_id is null then
        raise exception 'invalid_label_items' using errcode = '22023', detail = 'variantId';
      end if;
    end if;
    -- Deduplicate exact tuples.
    if not v_requested @> jsonb_build_array(jsonb_build_object('itemId', v_item_id, 'variantId', v_variant_id)) then
      v_requested := v_requested || jsonb_build_array(jsonb_build_object('itemId', v_item_id, 'variantId', v_variant_id));
    end if;
  end loop;
  if jsonb_array_length(v_requested) > c_max_items then
    raise exception 'invalid_label_items' using errcode = '22023',
      detail = format('At most %s menu items per asset.', c_max_items);
  end if;

  -- Revision compare-and-set. A missing row is revision 0; the asset lock above
  -- makes a concurrent first save see the row and fail here, not on a unique key.
  select l.* into v_label from public.media_labels l where l.asset_id = p_asset_id for update;
  v_revision := coalesce(v_label.revision, 0);
  if p_expected_revision <> v_revision then
    raise exception 'label_conflict' using errcode = '40001',
      detail = jsonb_build_object('revision', v_revision)::text;
  end if;

  -- Lock order for every label save: asset row (above), label row, then the
  -- venue menu lock SHARED, then the caller's open suggestion row. Activation
  -- and suggestion resolution take the venue lock exclusively, so neither can
  -- change the active version or this suggestion until the save commits
  -- (final review I-1: a resolve between read and update lost the edit).
  perform private.lock_venue_menu(v_asset.venue_id, true);

  select s.suggested_name into v_suggestion_before
  from public.menu_item_suggestions s
  where s.asset_id = p_asset_id and s.created_by = v_uid and s.status = 'open'
  for update;

  v_before := jsonb_build_object(
    'revision', v_revision,
    'contentTypes', to_jsonb(coalesce(v_label.content_types, '{}')),
    'note', v_label.note,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('itemId', li.item_id, 'variantId', li.variant_id)
        order by li.added_at, li.id)
      from public.media_label_items li where li.asset_id = p_asset_id), '[]'::jsonb),
    'missingItem', v_suggestion_before);

  -- New tuples: requested but not already on the asset (exact match, A1.7).
  select coalesce(jsonb_agg(r.value), '[]'::jsonb) into v_new
  from jsonb_array_elements(v_requested) as r(value)
  where not exists (
    select 1 from public.media_label_items li
    where li.asset_id = p_asset_id
      and li.item_id = (r.value ->> 'itemId')::uuid
      and li.variant_id is not distinct from (r.value ->> 'variantId')::uuid
  );
  v_new_count := jsonb_array_length(v_new);

  if v_new_count > 0 then
    v_active := private.active_menu_version_id(v_asset.venue_id);

    if p_catalogue_version_id is distinct from v_active then
      raise exception 'menu_catalogue_conflict' using errcode = '40001',
        detail = jsonb_build_object('activeVersionId', v_active)::text;
    end if;

    -- Items of another venue are a forged request, not a stale catalogue.
    select array_agg(distinct i.id) into v_wrong
    from jsonb_array_elements(v_new) as n(value)
    join public.menu_items i on i.id = (n.value ->> 'itemId')::uuid
    where i.venue_id <> v_asset.venue_id;
    if v_wrong is not null then
      raise exception 'menu_item_wrong_venue' using errcode = '22023',
        detail = to_jsonb(v_wrong)::text;
    end if;

    -- Each new tuple must be in the active version, not archived, and its
    -- variant (if any) listed on that active entry.
    select array_agg(distinct (n.value ->> 'itemId')::uuid) into v_unavailable
    from jsonb_array_elements(v_new) as n(value)
    where not exists (
      select 1
      from public.menu_items i
      join public.menu_entries e on e.item_id = i.id and e.version_id = v_active
      where i.id = (n.value ->> 'itemId')::uuid
        and i.venue_id = v_asset.venue_id
        and i.archived_at is null
        and (
          n.value ->> 'variantId' is null
          or exists (
            select 1 from public.menu_entry_variants ev
            where ev.entry_id = e.id and ev.variant_id = (n.value ->> 'variantId')::uuid
          )
        )
    );
    if v_unavailable is not null then
      raise exception 'menu_item_unavailable' using errcode = 'P0001',
        detail = to_jsonb(v_unavailable)::text;
    end if;
  end if;

  v_has := jsonb_array_length(v_requested) > 0 or cardinality(v_types) > 0;

  if v_label.asset_id is null then
    insert into public.media_labels as l (asset_id, venue_id, content_types, note, has_labels, revision, updated_by)
    values (p_asset_id, v_asset.venue_id, v_types, v_note, v_has, 1, v_uid);
  else
    update public.media_labels l
    set content_types = v_types, note = v_note, has_labels = v_has,
        revision = l.revision + 1, updated_by = v_uid
    where l.asset_id = p_asset_id;
  end if;

  -- Removed tuples.
  delete from public.media_label_items li
  where li.asset_id = p_asset_id
    and not exists (
      select 1 from jsonb_array_elements(v_requested) as r(value)
      where (r.value ->> 'itemId')::uuid = li.item_id
        and (r.value ->> 'variantId')::uuid is not distinct from li.variant_id
    );

  -- New tuples with their snapshot from the active entry.
  if v_new_count > 0 then
    insert into public.media_label_items (
      asset_id, venue_id, item_id, variant_id, item_name, variant_name,
      section_name, section_slug, version_id, added_by
    )
    select p_asset_id, v_asset.venue_id, e.item_id, ev.variant_id, e.name, ev.name,
      s.name, s.slug, v_active, v_uid
    from jsonb_array_elements(v_new) with ordinality as n(value, ordinality)
    join public.menu_entries e
      on e.version_id = v_active and e.item_id = (n.value ->> 'itemId')::uuid
    join public.menu_sections s on s.id = e.section_id
    left join public.menu_entry_variants ev
      on ev.entry_id = e.id and ev.variant_id = (n.value ->> 'variantId')::uuid
    order by n.ordinality;
  end if;

  -- Missing-item suggestion: null = unchanged, '' = withdraw, text = upsert own open one.
  v_suggestion_after := v_suggestion_before;
  if v_missing is not null then
    if v_missing = '' then
      update public.menu_item_suggestions s
      set status = 'withdrawn'
      where s.asset_id = p_asset_id and s.created_by = v_uid and s.status = 'open';
      v_suggestion_after := null;
    elsif v_suggestion_before is not null then
      update public.menu_item_suggestions s
      set suggested_name = v_missing
      where s.asset_id = p_asset_id and s.created_by = v_uid and s.status = 'open';
      v_suggestion_after := v_missing;
    else
      insert into public.menu_item_suggestions (venue_id, asset_id, suggested_name, created_by)
      values (v_asset.venue_id, p_asset_id, v_missing, v_uid);
      v_suggestion_after := v_missing;
    end if;
  end if;

  v_after := jsonb_build_object(
    'revision', v_revision + 1,
    'contentTypes', to_jsonb(v_types),
    'note', v_note,
    'items', v_requested,
    'missingItem', v_suggestion_after,
    'catalogueVersionId', v_active);

  insert into public.media_label_events (asset_id, venue_id, actor_id, actor_role, action, before, after)
  values (p_asset_id, v_asset.venue_id, v_uid, v_role, 'labels_saved', v_before, v_after);

  return query select v_revision + 1, v_has;
end;
$$;

-- ---------------------------------------------------------------------------
-- Community reads: active staff or admins only
-- ---------------------------------------------------------------------------

-- Bodies as in 20261102120000 / 20261102160000, with the caller gate narrowed
-- from any active user to active staff or admins.
create or replace function public.community_members(
  p_venue uuid default null,
  p_member uuid default null,
  p_department text default null,
  p_query text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid, display_name text, job_title text, department text,
  venue_id uuid, venue_name text, avatar_path text, media_count bigint
)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.display_name, p.job_title, p.department,
    p.venue_id, v.name, p.avatar_path,
    (select count(*) from public.media_assets a
      where a.uploader_id = p.id and a.upload_state = 'ready' and a.deleted_at is null)
  from public.profiles p
  left join public.venues v on v.id = p.venue_id
  where (select private.is_active_staff() or private.is_active_admin())
    and p.active and p.role = 'staff'
    and (p_venue is null or p.venue_id = p_venue)
    and (p_member is null or p.id = p_member)
    and (p_department is null or p.department = p_department)
    and (p_query is null or strpos(lower(p.display_name), lower(left(p_query, 80))) > 0)
  order by p.display_name, p.id
  limit least(greatest(coalesce(p_limit, 25), 1), 101)
  offset least(greatest(coalesce(p_offset, 0), 0), 100000);
$$;
create or replace function public.community_readable_assets(p_asset_ids uuid[])
returns table (
  id uuid, uploader_id uuid, venue_id uuid, media_type public.media_type,
  validated_mime_type text, size_bytes bigint, width integer, height integer,
  duration_seconds numeric, has_preview boolean, has_thumbnail boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_asset_ids is null or cardinality(p_asset_ids) > 100 then
    raise exception 'invalid_asset_ids' using errcode = '22023',
      detail = 'Between 0 and 100 asset ids.';
  end if;
  return query
  select a.id, a.uploader_id, a.venue_id, a.media_type, a.validated_mime_type,
    a.size_bytes, a.width, a.height, a.duration_seconds,
    a.preview_path is not null, a.thumbnail_path is not null, a.created_at
  from public.media_assets a
  where a.id = any(p_asset_ids)
    and a.upload_state = 'ready' and a.deleted_at is null
    and (select private.is_active_staff() or private.is_active_admin())
    and (
      a.uploader_id = (select auth.uid())
      or (select private.is_active_admin())
      or private.is_community_member(a.uploader_id)
    )
  order by a.id;
end;
$$;
create or replace function public.community_media_page(
  p_venue uuid default null,
  p_uploader uuid default null,
  p_type public.media_type default null,
  p_department text default null,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 25
)
returns table (
  id uuid, uploader_id uuid, contributor_name text, venue_name text,
  media_type public.media_type, has_thumbnail boolean, has_preview boolean,
  validated_mime_type text, original_filename text, created_at timestamptz,
  width integer, height integer, duration_seconds numeric, size_bytes bigint
)
language sql stable security definer set search_path = ''
as $$
  select a.id, a.uploader_id, p.display_name, v.name, a.media_type,
    a.thumbnail_path is not null, a.preview_path is not null,
    a.validated_mime_type,
    case when a.uploader_id = (select auth.uid()) then a.original_filename end,
    a.created_at, a.width, a.height, a.duration_seconds, a.size_bytes
  from public.media_assets a
  join public.profiles p on p.id = a.uploader_id and p.active and p.role = 'staff'
  join public.venues v on v.id = a.venue_id
  where (select private.is_active_staff() or private.is_active_admin())
    and a.upload_state = 'ready' and a.deleted_at is null
    and (p_venue is null or a.venue_id = p_venue)
    and (p_uploader is null or a.uploader_id = p_uploader)
    and (p_type is null or a.media_type = p_type)
    and (p_department is null or p.department = p_department)
    and (p_after_created_at is null or p_after_id is null
      or (a.created_at, a.id) < (p_after_created_at, p_after_id))
  order by a.created_at desc, a.id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 101);
$$;
-- ---------------------------------------------------------------------------
-- Legacy coverage writes: never from a manager account
-- ---------------------------------------------------------------------------

-- Every coverage write RPC is gated by can_manage_venue, which a manager
-- account with an effective grant passes. Denying the writes at the tables
-- covers every RPC (and its self-review path) at once. auth.uid() is the admin
-- during a conversion and NULL for the service role, cron and cleanup, so
-- none of those are affected.
create function private.deny_manager_coverage_writes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select private.is_active_manager()) then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger coverage_requirements_deny_manager_writes
  before insert or update on public.coverage_requirements
  for each row execute function private.deny_manager_coverage_writes();
create trigger coverage_requirement_assignees_deny_manager_writes
  before insert or update on public.coverage_requirement_assignees
  for each row execute function private.deny_manager_coverage_writes();
create trigger monthly_targets_deny_manager_writes
  before insert or update on public.monthly_targets
  for each row execute function private.deny_manager_coverage_writes();
create trigger venue_amenity_facts_deny_manager_writes
  before insert or update on public.venue_amenity_facts
  for each row execute function private.deny_manager_coverage_writes();
create trigger venue_amenity_fact_media_deny_manager_writes
  before insert or update on public.venue_amenity_fact_media
  for each row execute function private.deny_manager_coverage_writes();
create trigger menu_coverage_plans_deny_manager_writes
  before insert or update on public.menu_coverage_plans
  for each row execute function private.deny_manager_coverage_writes();
create trigger coverage_submissions_deny_manager_writes
  before insert or update on public.coverage_submissions
  for each row execute function private.deny_manager_coverage_writes();
create trigger coverage_submission_items_deny_manager_writes
  before insert or update on public.coverage_submission_items
  for each row execute function private.deny_manager_coverage_writes();
create trigger coverage_review_events_deny_manager_writes
  before insert or update on public.coverage_review_events
  for each row execute function private.deny_manager_coverage_writes();
create trigger coverage_preparation_runs_deny_manager_writes
  before insert or update on public.coverage_preparation_runs
  for each row execute function private.deny_manager_coverage_writes();

revoke all on function private.deny_manager_coverage_writes() from public, anon;
grant execute on function private.deny_manager_coverage_writes() to authenticated, service_role;
