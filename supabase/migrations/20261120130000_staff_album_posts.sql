-- Venue Album visibility and moderation are independent of public-use approval.
-- Only processed general-purpose images are eligible. Evidence uses its own gates.
create table public.staff_album_feedback (
  id bigint generated always as identity primary key,
  asset_id uuid not null references public.media_assets(id) on delete cascade,
  manager_id uuid not null references public.profiles(id) on delete restrict,
  action text not null check (action in ('feedback', 'retake', 'remove', 'label')),
  note text check (note is null or length(note) between 1 and 500),
  label_kind text check (label_kind in ('dish', 'area')),
  label_id uuid,
  label_name text,
  created_at timestamptz not null default now(),
  check (
    (action = 'label' and label_kind is not null and label_id is not null and label_name is not null)
    or (action <> 'label' and label_kind is null and label_id is null and label_name is null and note is not null)
  )
);

alter table public.staff_album_feedback enable row level security;
revoke all on public.staff_album_feedback from public, anon, authenticated, service_role;
create index staff_album_feedback_asset_idx on public.staff_album_feedback(asset_id, id desc);
create unique index staff_album_feedback_one_removal on public.staff_album_feedback(asset_id) where action = 'remove';

create function private.staff_album_removed(p_asset_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select private.asset_set_aside(p_asset_id) or exists (
    select from public.staff_album_feedback f where f.asset_id = p_asset_id and f.action = 'remove'
  );
$$;

create function private.staff_album_labels(p_asset_id uuid)
returns table(kind text, id uuid, name text) language sql stable set search_path = '' as $$
  with correction as (
    select f.label_kind, f.label_id, f.label_name
    from public.staff_album_feedback f
    where f.asset_id = p_asset_id and f.action = 'label'
    order by f.id desc limit 1
  )
  select c.label_kind, c.label_id, c.label_name from correction c
  union all
  select 'dish', i.item_id, i.item_name
  from public.media_label_items i
  where i.asset_id = p_asset_id and not exists (select from correction)
  union all
  select 'area', l.subject_id, l.subject_label
  from public.media_area_labels l
  where l.asset_id = p_asset_id and l.removed_at is null and not exists (select from correction);
$$;

create function private.staff_album_label_options(p_venue_id uuid)
returns table(kind text, id uuid, name text, group_name text)
language sql stable set search_path = '' as $$
  select 'dish', e.item_id, e.name, s.name
  from public.menu_versions v
  join public.menu_entries e on e.version_id = v.id
  join public.menu_sections s on s.id = e.section_id
  join public.menu_items i on i.id = e.item_id
  where v.venue_id = p_venue_id and v.status = 'active' and i.archived_at is null
  union all
  select 'area', k.id, k.label, 'Spaces'
  from public.knowledge_subjects k where k.venue_id = p_venue_id and k.retired_at is null;
$$;

revoke all on function private.staff_album_removed(uuid),
  private.staff_album_labels(uuid), private.staff_album_label_options(uuid)
  from public, anon, authenticated, service_role;

create function public.staff_album_posts(
  p_asset_id uuid default null,
  p_slot_kind text default null,
  p_slot_id uuid default null,
  p_before timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 24
)
returns table(
  id uuid, uploader_id uuid, uploader_name text, created_at timestamptz, removed boolean,
  labels jsonb, feedback jsonb
)
language sql stable security definer set search_path = '' as $$
  with scope as (
    select auth.uid() as uid, private.uploadable_venue_id() as venue_id,
      private.effective_manager_venue_id(auth.uid()) as manager_venue_id
  ), page as (
    select a.id, a.uploader_id, a.venue_id, p.display_name, a.created_at,
      private.staff_album_removed(a.id) as removed,
      a.uploader_id = s.uid or a.venue_id = s.manager_venue_id as can_read_feedback
    from scope s
    join public.media_assets a on a.venue_id = s.venue_id
      or (p_asset_id is not null and a.uploader_id = s.uid and private.is_active_user())
    join public.profiles p on p.id = a.uploader_id
    where s.uid is not null and a.deleted_at is null and a.upload_state = 'ready'
      and a.purpose = 'general' and a.media_type = 'image' and a.preview_path is not null
      and (p.active or (p_asset_id is not null and a.venue_id = s.manager_venue_id))
      and (p_asset_id is null or a.id = p_asset_id)
      and (
        not private.staff_album_removed(a.id)
        or (p_asset_id is not null and (a.uploader_id = s.uid or a.venue_id = s.manager_venue_id))
      )
      and (p_before is null or (a.created_at, a.id) < (p_before, p_before_id))
      and (p_slot_id is null or exists (
        select from private.staff_album_labels(a.id) label
        where label.kind = p_slot_kind and label.id = p_slot_id
      ))
    order by a.created_at desc, a.id desc
    limit greatest(1, least(coalesce(p_limit, 24), 61))
  )
  select p.id, p.uploader_id, p.display_name, p.created_at, p.removed,
    coalesce((select jsonb_agg(to_jsonb(l) order by l.name, l.id) from private.staff_album_labels(p.id) l), '[]'::jsonb),
    case when p_asset_id is not null and p.can_read_feedback then coalesce((
      select jsonb_agg(to_jsonb(feedback_row) order by feedback_row.id desc)
      from (
        select f.id, f.action, f.note, f.label_name, f.created_at
        from public.staff_album_feedback f where f.asset_id = p.id
        order by f.id desc limit 30
      ) feedback_row
    ), '[]'::jsonb) else '[]'::jsonb end
  from page p order by p.created_at desc, p.id desc;
$$;

create function public.staff_album_can_view(p_asset_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select from public.media_assets a
    join public.profiles p on p.id = a.uploader_id and p.active
    where a.id = p_asset_id and a.venue_id = (select private.uploadable_venue_id())
      and a.upload_state = 'ready' and a.deleted_at is null and a.media_type = 'image'
      and a.purpose = 'general' and not private.staff_album_removed(a.id)
  );
$$;

-- Per-owner status for My photos, including older uploads after a venue switch.
create function public.staff_album_own_states(p_asset_ids uuid[])
returns table(id uuid, removed boolean, needs_attention boolean, labelled boolean)
language sql stable security definer set search_path = '' as $$
  select a.id, private.staff_album_removed(a.id),
    exists (select from public.staff_album_feedback f where f.asset_id = a.id and f.action in ('feedback', 'retake')),
    exists (select from private.staff_album_labels(a.id))
  from public.media_assets a
  where a.id = any(p_asset_ids) and cardinality(p_asset_ids) <= 100
    and a.uploader_id = (select auth.uid()) and (select private.is_active_user())
    and a.upload_state = 'ready' and a.deleted_at is null and a.purpose = 'general'
    and a.media_type = 'image' and a.preview_path is not null;
$$;

create function public.staff_album_review_options()
returns table(kind text, id uuid, name text, group_name text)
language sql stable security definer set search_path = '' as $$
  select o.* from private.staff_album_label_options(private.effective_manager_venue_id(auth.uid())) o
  order by o.group_name, o.name, o.id;
$$;

create function public.staff_album_moderate(
  p_asset_id uuid, p_action text, p_note text default null,
  p_label_kind text default null, p_label_id uuid default null
)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_venue uuid := private.effective_manager_venue_id(v_uid);
  v_note text := nullif(btrim(p_note), '');
  v_label text;
begin
  if v_venue is null then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('feedback', 'retake', 'remove', 'label')
     or length(v_note) > 500
     or (p_action <> 'label' and (v_note is null or p_label_kind is not null or p_label_id is not null)) then
    raise exception 'invalid_album_feedback' using errcode = '22023';
  end if;
  perform 1 from public.media_assets a
  where a.id = p_asset_id and a.venue_id = v_venue and a.uploader_id <> v_uid
    and a.deleted_at is null and a.upload_state = 'ready' and a.purpose = 'general'
    and a.media_type = 'image' and a.preview_path is not null
  for update;
  if not found or v_venue is distinct from private.effective_manager_venue_id(v_uid) then
    raise exception 'album_photo_not_found' using errcode = 'P0002';
  end if;
  if private.staff_album_removed(p_asset_id) then
    if p_action = 'remove' then return; end if;
    raise exception 'album_photo_removed' using errcode = 'P0001';
  end if;
  if p_action = 'label' then
    select o.name into v_label from private.staff_album_label_options(v_venue) o
    where o.kind = p_label_kind and o.id = p_label_id;
    if not found then
      raise exception 'album_label_not_found' using errcode = '22023';
    end if;
  end if;
  insert into public.staff_album_feedback (asset_id, manager_id, action, note, label_kind, label_id, label_name)
    values (p_asset_id, v_uid, p_action, v_note, p_label_kind, p_label_id, v_label);
end;
$$;

revoke all on function public.staff_album_posts(uuid, text, uuid, timestamptz, uuid, integer),
  public.staff_album_can_view(uuid), public.staff_album_own_states(uuid[]),
  public.staff_album_review_options(), public.staff_album_moderate(uuid, text, text, text, uuid)
  from public, anon, service_role;
grant execute on function public.staff_album_posts(uuid, text, uuid, timestamptz, uuid, integer),
  public.staff_album_can_view(uuid), public.staff_album_own_states(uuid[]),
  public.staff_album_review_options(), public.staff_album_moderate(uuid, text, text, text, uuid)
  to authenticated;

-- One current thumbnail per folder in the venue, independent of coverage.
create function public.staff_album_folder_covers()
returns table(kind text, slot_id uuid, asset_id uuid)
language sql stable security definer set search_path = '' as $$
  select distinct on (l.kind, l.id) l.kind, l.id, a.id
  from public.media_assets a
  join public.profiles p on p.id = a.uploader_id and p.active
  cross join lateral private.staff_album_labels(a.id) l
  where a.venue_id = (select private.uploadable_venue_id())
    and a.upload_state = 'ready' and a.deleted_at is null and a.media_type = 'image'
    and a.purpose = 'general' and a.thumbnail_path is not null
    and not private.staff_album_removed(a.id)
  order by l.kind, l.id, a.created_at desc, a.id desc;
$$;

revoke all on function public.staff_album_folder_covers() from public, anon, service_role;
grant execute on function public.staff_album_folder_covers() to authenticated;
