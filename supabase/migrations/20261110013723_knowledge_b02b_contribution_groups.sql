-- B02-b: contribution groups (docs/knowledge/b02-design.md W1, OD-7).
--
-- * public.media_contribution_groups and public.media_contribution_group_members
--   record that several of one person's uploads were picked together for one
--   subject (a menu item, a task, a working-list question, or none). Each
--   asset keeps its own state; a group adds no state, no visibility and no
--   credit. Credit functions never read these tables.
-- * Append-only: groups are never changed or deleted, members never removed.
--   A deleted asset stays a member and is hidden by the asset gates.
-- * OD-7 default (owner to confirm): one group per asset, at most 10 members.
-- * Functions: contribution_group_start (idempotent by the caller's key),
--   contribution_group_add (own assets, same venue, idempotent per asset),
--   contribution_groups_for_assets and contribution_group (members filtered
--   through the viewer's existing asset gates: own uploads, admin, community
--   Photos, the menu-photo, task-evidence and amenity-evidence gates).
-- * RLS on with no client policies; functions only. Nothing existing is
--   re-created.
--
-- Rollback: the UI switches off contributionEntry and myContributions'
-- grouping; the tables stay (no data loss) and screens show photos one by
-- one. Dropping the functions removes every way in.

create table public.media_contribution_groups (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  created_by uuid not null references public.profiles (id) on delete restrict,
  subject_kind text not null check (subject_kind in ('menu_item', 'task', 'question', 'none')),
  subject_id uuid,
  client_group_key text not null check (client_group_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  created_at timestamptz not null default now(),
  constraint media_contribution_groups_subject check ((subject_kind = 'none') = (subject_id is null)),
  constraint media_contribution_groups_key unique (created_by, client_group_key),
  constraint media_contribution_groups_id_venue_key unique (id, venue_id)
);

create table public.media_contribution_group_members (
  group_id uuid not null,
  venue_id uuid not null,
  asset_id uuid not null,
  position smallint not null check (position between 1 and 10),
  added_at timestamptz not null default now(),
  primary key (group_id, asset_id),
  constraint media_contribution_group_members_group_fkey foreign key (group_id, venue_id)
    references public.media_contribution_groups (id, venue_id) on delete restrict,
  -- Same venue as the asset's upload-time venue, always.
  constraint media_contribution_group_members_asset_fkey foreign key (asset_id, venue_id)
    references public.media_assets (id, venue_id) on delete restrict,
  constraint media_contribution_group_members_one_group unique (asset_id),
  constraint media_contribution_group_members_position unique (group_id, position)
);

do $$
declare
  t text;
begin
  foreach t in array array['media_contribution_groups', 'media_contribution_group_members'] loop
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function private.append_only_guard()',
      t || '_append_only', t);
    execute format(
      'create trigger %I before truncate on public.%I for each statement execute function private.append_only_guard()',
      t || '_no_truncate', t);
  end loop;
end;
$$;

revoke all on public.media_contribution_groups, public.media_contribution_group_members
from public, anon, authenticated, service_role;
grant select on public.media_contribution_groups, public.media_contribution_group_members to service_role;
alter table public.media_contribution_groups enable row level security;
alter table public.media_contribution_group_members enable row level security;

-- ---------------------------------------------------------------------------
-- Gates
-- ---------------------------------------------------------------------------

-- The caller may already see this asset through an existing gate. A group
-- read shows a member only when this holds, so groups never widen visibility.
create function private.viewer_sees_asset(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user() and (
    exists (
      select 1 from public.media_assets a
      where a.id = p_asset_id and a.deleted_at is null
        and (a.uploader_id = (select auth.uid()) or private.is_active_admin())
    )
    or exists (select 1 from public.community_readable_assets(array[p_asset_id]))
    or exists (select 1 from public.menu_item_photo_asset(p_asset_id))
    or exists (select 1 from public.task_evidence_asset(p_asset_id))
    or exists (select 1 from public.amenity_evidence_asset(p_asset_id))
  );
$$;

-- The subject exists at the venue: an item on its active menu, a task
-- (coverage requirement) there that is not retired, or a check there on the
-- working list.
create function private.contribution_subject_exists(p_venue_id uuid, p_kind text, p_subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_kind
    when 'none' then p_subject_id is null
    when 'menu_item' then exists (
      select 1 from public.menu_entries e
      join public.menu_versions v on v.id = e.version_id
      where v.venue_id = p_venue_id and v.status = 'active' and e.item_id = p_subject_id)
    when 'task' then exists (
      select 1 from public.coverage_requirements r
      where r.id = p_subject_id and r.venue_id = p_venue_id and r.status <> 'retired')
    when 'question' then exists (
      select 1 from public.venue_amenity_checks c
      where c.id = p_subject_id and c.venue_id = p_venue_id and c.status = 'active'
        and private.knowledge_in_scope(c.venue_id, c.template_key))
    else false
  end;
$$;

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

-- Starts a group at the caller's upload venue, or returns the group already
-- started with this key. The same key for another subject is
-- idempotency_key_reused.
create function public.contribution_group_start(p_key text, p_subject_kind text, p_subject_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_venue uuid := private.uploadable_venue_id();
  v_group public.media_contribution_groups;
begin
  if v_venue is null then
    raise exception 'not_active_staff' using errcode = '42501';
  end if;
  if p_key is null or p_key !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'invalid_group_key' using errcode = '22023';
  end if;
  if p_subject_kind is null or p_subject_kind not in ('menu_item', 'task', 'question', 'none') then
    raise exception 'invalid_subject' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('nabalens_contribution_group:' || v_uid::text || ':' || p_key, 0));
  select g.* into v_group from public.media_contribution_groups g
  where g.created_by = v_uid and g.client_group_key = p_key;
  if found then
    if v_group.subject_kind <> p_subject_kind or v_group.subject_id is distinct from p_subject_id
       or v_group.venue_id <> v_venue then
      raise exception 'idempotency_key_reused' using errcode = 'P0001';
    end if;
    return v_group.id;
  end if;
  if not private.contribution_subject_exists(v_venue, p_subject_kind, p_subject_id) then
    raise exception 'contribution_subject_not_found' using errcode = 'P0002';
  end if;
  insert into public.media_contribution_groups (venue_id, created_by, subject_kind, subject_id, client_group_key)
  values (v_venue, v_uid, p_subject_kind, p_subject_id, p_key)
  returning * into v_group;
  return v_group.id;
end;
$$;

-- Adds the caller's own assets (any upload state, not deleted, at the group's
-- venue) in the order given. An asset already in this group is skipped; one
-- in another group is asset_in_other_group. Returns the group's member count.
create function public.contribution_group_add(p_group_id uuid, p_asset_ids uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_group public.media_contribution_groups;
  v_asset public.media_assets;
  v_id uuid;
  v_next integer;
  v_member uuid;
begin
  if p_asset_ids is null or cardinality(p_asset_ids) not between 1 and 10
     or array_position(p_asset_ids, null) is not null
     or (select count(distinct a) from unnest(p_asset_ids) a) <> cardinality(p_asset_ids) then
    raise exception 'invalid_asset_list' using errcode = 'P0001';
  end if;
  -- Serialises adds to one group (positions). No column changes.
  select g.* into v_group from public.media_contribution_groups g
  where g.id = p_group_id and g.created_by = v_uid
  for update;
  if not found or private.uploadable_venue_id() is distinct from v_group.venue_id then
    raise exception 'contribution_group_not_found' using errcode = 'P0002';
  end if;
  perform 1 from public.media_assets a where a.id = any(p_asset_ids) order by a.id for share;
  select coalesce(max(m.position), 0) into v_next
  from public.media_contribution_group_members m where m.group_id = v_group.id;
  foreach v_id in array p_asset_ids loop
    select a.* into v_asset from public.media_assets a where a.id = v_id;
    if not found or v_asset.venue_id <> v_group.venue_id then
      raise exception 'evidence_not_eligible' using errcode = 'P0001',
        detail = jsonb_build_object('assetId', v_id, 'reason', 'not_found')::text;
    end if;
    if v_asset.uploader_id <> v_uid then
      raise exception 'evidence_not_eligible' using errcode = 'P0001',
        detail = jsonb_build_object('assetId', v_id, 'reason', 'not_own')::text;
    end if;
    if v_asset.deleted_at is not null then
      raise exception 'evidence_not_eligible' using errcode = 'P0001',
        detail = jsonb_build_object('assetId', v_id, 'reason', 'deleted')::text;
    end if;
    select m.group_id into v_member from public.media_contribution_group_members m where m.asset_id = v_id;
    if found then
      if v_member <> v_group.id then
        raise exception 'asset_in_other_group' using errcode = 'P0001',
          detail = jsonb_build_object('assetId', v_id)::text;
      end if;
      continue;
    end if;
    v_next := v_next + 1;
    if v_next > 10 then
      raise exception 'contribution_group_full' using errcode = 'P0001';
    end if;
    insert into public.media_contribution_group_members (group_id, venue_id, asset_id, position)
    values (v_group.id, v_group.venue_id, v_id, v_next);
  end loop;
  return (select count(*)::integer from public.media_contribution_group_members m where m.group_id = v_group.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

-- For the assets a page already shows, which group each is in, only for
-- assets the viewer may see. At most 100 ids.
create function public.contribution_groups_for_assets(p_asset_ids uuid[])
returns table (asset_id uuid, group_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.amenity_assert_active_user();
  if p_asset_ids is null or cardinality(p_asset_ids) > 100 then
    raise exception 'invalid_asset_list' using errcode = 'P0001';
  end if;
  return query
  select m.asset_id, m.group_id
  from public.media_contribution_group_members m
  where m.asset_id = any(p_asset_ids) and private.viewer_sees_asset(m.asset_id)
  order by m.asset_id;
end;
$$;

-- One group: its subject and the members the viewer may already see, each
-- with its own state. A group with no member visible to the viewer reads as
-- not found, except to its creator (a group just started has no members).
create function public.contribution_group(p_group_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_group public.media_contribution_groups;
  v_members jsonb;
begin
  select g.* into v_group from public.media_contribution_groups g where g.id = p_group_id;
  if found then
    select jsonb_agg(jsonb_build_object(
        'assetId', a.id, 'position', m.position, 'mediaType', a.media_type,
        'uploadState', a.upload_state, 'mine', a.uploader_id = v_uid)
        order by m.position)
    into v_members
    from public.media_contribution_group_members m
    join public.media_assets a on a.id = m.asset_id
    where m.group_id = v_group.id and private.viewer_sees_asset(a.id);
  end if;
  if v_group.id is null or (v_members is null and v_group.created_by is distinct from v_uid) then
    raise exception 'contribution_group_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'groupId', v_group.id,
    'venueId', v_group.venue_id,
    'createdAt', v_group.created_at,
    'mine', v_group.created_by = v_uid,
    'subject', jsonb_build_object(
      'kind', v_group.subject_kind,
      'id', v_group.subject_id,
      'name', case v_group.subject_kind
        when 'menu_item' then (
          select e.name from public.menu_entries e
          join public.menu_versions v on v.id = e.version_id
          where v.venue_id = v_group.venue_id and v.status = 'active' and e.item_id = v_group.subject_id
          limit 1)
        when 'task' then (select r.title from public.coverage_requirements r where r.id = v_group.subject_id)
        when 'question' then (
          select t.question from public.venue_amenity_checks c
          join public.amenity_catalogue t on t.key = c.template_key
          where c.id = v_group.subject_id)
      end
    ),
    'members', coalesce(v_members, '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.viewer_sees_asset(uuid),
  private.contribution_subject_exists(uuid, text, uuid)
from public, anon, authenticated;

revoke all on function
  public.contribution_group_start(text, text, uuid),
  public.contribution_group_add(uuid, uuid[]),
  public.contribution_groups_for_assets(uuid[]),
  public.contribution_group(uuid)
from public, anon, service_role;

grant execute on function
  public.contribution_group_start(text, text, uuid),
  public.contribution_group_add(uuid, uuid[]),
  public.contribution_groups_for_assets(uuid[]),
  public.contribution_group(uuid)
to authenticated;
