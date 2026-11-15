-- Retake notes, G-3 (docs/plans/goals-not-tasks.md, decisions 4 and 14).
--
-- A retake note is a "Needs another photo" decision shown to the photo's
-- author. It has two sources, read here as one list:
--   * menu: a menu_item_photos row in state better_photo_requested;
--   * coverage: a coverage_submission_items row in state needs_another_photo,
--     not archived (month sends and task sends).
--
-- my_retake_notes() decides on the server, for the caller only, whether each
-- note is open, cleared, retaken or set aside, and whether it can be retaken
-- now. Home and Me read it. Precedence: cleared, then retaken, then set aside,
-- then open.
--   * menu cleared (decision 4): any menu_item_photo_events row with action
--     'accepted' for the same item (variants ignored) after the note was
--     written, whoever took or reviewed the photo. 'carried' and 'primary_set'
--     do not count. A later withdrawal or recheck of that photo does not bring
--     the note back (events are append-only).
--   * menu retaken: a newer ready own image labelled with the same item that
--     has no menu decision yet for that item.
--   * coverage cleared: a replacement was decided (accepted or asked again);
--     coverage retaken: a replacement is waiting for review.
--   * set aside: the author chose Later for this note (menu: this revision).
--
-- Later is stored in public.retake_note_set_asides: insert-only, written only
-- by set_retake_note_aside(). A set-aside is read by nothing else, so it
-- changes no count and no manager queue. Read-through: no existing row,
-- function or grant changes.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.retake_note_set_asides (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles (id) on delete restrict,
  photo_id uuid references public.menu_item_photos (id) on delete restrict,
  photo_revision integer check (photo_revision is null or photo_revision >= 1),
  submission_item_id uuid references public.coverage_submission_items (id) on delete restrict,
  set_aside_at timestamptz not null default now(),
  constraint retake_note_set_asides_one_note check (
    (photo_id is null) <> (submission_item_id is null)
  ),
  constraint retake_note_set_asides_revision_pair check (
    (photo_id is null) = (photo_revision is null)
  ),
  constraint retake_note_set_asides_photo_key unique (photo_id, photo_revision),
  constraint retake_note_set_asides_item_key unique (submission_item_id)
);

create index retake_note_set_asides_staff_idx on public.retake_note_set_asides (staff_id);

comment on table public.retake_note_set_asides is
  'A retake note its author set aside ("Later"). Insert-only; hides the note from Home, never from Me.';

create trigger retake_note_set_asides_append_only
  before update or delete on public.retake_note_set_asides
  for each row execute function private.append_only_guard();
create trigger retake_note_set_asides_no_truncate
  before truncate on public.retake_note_set_asides
  for each statement execute function private.append_only_guard();

revoke all on public.retake_note_set_asides from public, anon, authenticated, service_role;
grant select on public.retake_note_set_asides to authenticated, service_role;

alter table public.retake_note_set_asides enable row level security;

-- Own rows only, for an active staff account. Writes go through the RPC.
create policy retake_note_set_asides_select on public.retake_note_set_asides
  for select to authenticated
  using (staff_id = (select auth.uid()) and (select private.is_active_staff()));

-- ---------------------------------------------------------------------------
-- Rows (one place for the read and the write)
-- ---------------------------------------------------------------------------

create function private.retake_note_rows(p_staff_id uuid)
returns table (
  kind text,
  note_id uuid,
  note_revision integer,
  asset_id uuid,
  item_id uuid,
  variant_id uuid,
  item_name text,
  variant_name text,
  requirement_id uuid,
  requirement_title text,
  requirement_kind text,
  reason text,
  asked_by_name text,
  asked_at timestamptz,
  status text,
  can_retake boolean,
  set_aside_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select p.venue_id,
      (select v.id from public.venues v where v.id = p.venue_id and v.active) as active_venue_id
    from public.profiles p
    where p.id = p_staff_id
  ),
  menu_notes as (
    select m.*,
      exists (
        select 1 from public.menu_item_photo_events e
        where e.item_id = m.item_id and e.venue_id = m.venue_id
          and e.action = 'accepted' and e.created_at > m.decided_at
      ) as cleared,
      exists (
        select 1
        from public.media_label_items l
        join public.media_assets a on a.id = l.asset_id
        where l.item_id = m.item_id and l.venue_id = m.venue_id
          and a.uploader_id = p_staff_id and a.id <> m.asset_id
          and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null
          and a.created_at > m.decided_at
          and not exists (
            select 1 from public.menu_item_photos d
            where d.asset_id = a.id and d.item_id = m.item_id
          )
      ) as retaken,
      (
        select s.set_aside_at from public.retake_note_set_asides s
        where s.photo_id = m.id and s.photo_revision = m.revision and s.staff_id = p_staff_id
      ) as aside_at,
      exists (
        select 1
        from me
        join public.menu_versions mv on mv.venue_id = me.active_venue_id and mv.status = 'active'
        join public.menu_entries me2 on me2.version_id = mv.id and me2.item_id = m.item_id
        join public.menu_sections ms on ms.id = me2.section_id and ms.kind in ('food', 'drinks')
        join public.menu_items mi on mi.id = me2.item_id and mi.archived_at is null
        where m.variant_id is null
          or exists (
            select 1 from public.menu_entry_variants ev
            where ev.entry_id = me2.id and ev.variant_id = m.variant_id
          )
      ) as on_menu
    from public.menu_item_photos m
    join public.media_assets a on a.id = m.asset_id and a.deleted_at is null
    where m.author_id = p_staff_id and m.state = 'better_photo_requested'
  ),
  coverage_notes as (
    select i.*, r.title as r_title, r.kind as r_kind,
      exists (
        select 1 from public.coverage_submission_items n
        where n.replaces_item_id = i.id and n.state in ('accepted', 'needs_another_photo')
      ) as cleared,
      exists (
        select 1 from public.coverage_submission_items n
        where n.replaces_item_id = i.id and n.state = 'submitted' and n.archived_at is null
      ) as retaken,
      (
        select s.set_aside_at from public.retake_note_set_asides s
        where s.submission_item_id = i.id and s.staff_id = p_staff_id
      ) as aside_at,
      exists (
        select 1 from me
        where me.active_venue_id = i.venue_id
          and (
            i.requirement_id is null
            or (
              private.requirement_is_current(i.requirement_id)
              and exists (
                select 1 from public.coverage_requirement_assignees x
                where x.requirement_id = i.requirement_id and x.staff_id = p_staff_id
                  and x.ended_at is null
              )
            )
          )
      ) as open_to_me
    from public.coverage_submission_items i
    join public.media_assets a on a.id = i.asset_id and a.deleted_at is null
    left join public.coverage_requirements r on r.id = i.requirement_id
    where i.author_id = p_staff_id and i.state = 'needs_another_photo' and i.archived_at is null
  )
  select 'menu'::text, n.id, n.revision, n.asset_id, n.item_id, n.variant_id, n.item_name,
    n.variant_name, null::uuid, null::text, null::text, n.reason, pd.display_name, n.decided_at,
    case
      when n.cleared then 'cleared'
      when n.retaken then 'retaken'
      when n.aside_at is not null then 'set_aside'
      else 'open'
    end,
    n.on_menu and not n.cleared,
    n.aside_at
  from menu_notes n
  left join public.profiles pd on pd.id = n.decided_by
  union all
  select 'coverage'::text, c.id, c.revision, c.asset_id, null::uuid, null::uuid, null::text,
    null::text, c.requirement_id, c.r_title, c.r_kind, c.decision_reason, pd.display_name,
    c.decided_at,
    case
      when c.cleared then 'cleared'
      when c.retaken then 'retaken'
      when c.aside_at is not null then 'set_aside'
      else 'open'
    end,
    c.open_to_me and not c.cleared,
    c.aside_at
  from coverage_notes c
  left join public.profiles pd on pd.id = c.decided_by;
$$;

revoke all on function private.retake_note_rows(uuid) from public, anon, authenticated;
grant execute on function private.retake_note_rows(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Read
-- ---------------------------------------------------------------------------

-- The caller's own retake notes, newest first. Active staff only.
create function public.my_retake_notes()
returns table (
  kind text,
  note_id uuid,
  note_revision integer,
  asset_id uuid,
  item_id uuid,
  variant_id uuid,
  item_name text,
  variant_name text,
  requirement_id uuid,
  requirement_title text,
  requirement_kind text,
  reason text,
  asked_by_name text,
  asked_at timestamptz,
  status text,
  can_retake boolean,
  set_aside_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_work_profile_owner();
begin
  return query
  select r.kind, r.note_id, r.note_revision, r.asset_id, r.item_id, r.variant_id, r.item_name,
    r.variant_name, r.requirement_id, r.requirement_title, r.requirement_kind, r.reason,
    r.asked_by_name, r.asked_at, r.status, r.can_retake, r.set_aside_at
  from private.retake_note_rows(v_uid) r
  order by r.asked_at desc, r.note_id
  limit 200;
end;
$$;

-- ---------------------------------------------------------------------------
-- Write
-- ---------------------------------------------------------------------------

-- Later on one of the caller's own notes: exactly one of a menu photo id or a
-- coverage submission item id. A note that is missing or someone else's gives
-- the same error. Only an open note (or one already set aside: a replay) can
-- be set aside. A menu note is set aside at its current revision, so a new
-- revision of the same note shows again.
create function public.set_retake_note_aside(
  p_photo_id uuid default null,
  p_submission_item_id uuid default null
)
returns table (set_aside_at timestamptz, replayed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := private.assert_work_profile_owner();
  v_note record;
  v_at timestamptz;
begin
  if (p_photo_id is null) = (p_submission_item_id is null) then
    raise exception 'invalid_retake_note' using errcode = '22023',
      detail = 'Name exactly one note.';
  end if;

  -- Serialise Later on one note (a repeat call is a replay, never a second row).
  perform pg_advisory_xact_lock(hashtextextended(
    'nabalens_retake_note:' || coalesce(p_photo_id, p_submission_item_id)::text, 0));

  if p_photo_id is not null then
    perform 1 from public.menu_item_photos m
    where m.id = p_photo_id and m.author_id = v_uid;
  else
    perform 1 from public.coverage_submission_items i
    where i.id = p_submission_item_id and i.author_id = v_uid;
  end if;
  if not found then
    raise exception 'retake_note_not_found' using errcode = 'P0002';
  end if;

  select r.note_revision, r.status, r.set_aside_at into v_note
  from private.retake_note_rows(v_uid) r
  where r.note_id = coalesce(p_photo_id, p_submission_item_id)
    and r.kind = case when p_photo_id is not null then 'menu' else 'coverage' end;
  if not found or v_note.status not in ('open', 'set_aside') then
    raise exception 'retake_note_not_open' using errcode = 'P0001';
  end if;
  if v_note.status = 'set_aside' then
    set_aside_at := v_note.set_aside_at;
    replayed := true;
    return next;
    return;
  end if;

  insert into public.retake_note_set_asides (staff_id, photo_id, photo_revision, submission_item_id)
  values (
    v_uid,
    p_photo_id,
    case when p_photo_id is not null then v_note.note_revision end,
    p_submission_item_id
  )
  returning retake_note_set_asides.set_aside_at into v_at;

  set_aside_at := v_at;
  replayed := false;
  return next;
end;
$$;

revoke all on function public.my_retake_notes() from public, anon;
revoke all on function public.set_retake_note_aside(uuid, uuid) from public, anon;
grant execute on function public.my_retake_notes() to authenticated, service_role;
grant execute on function public.set_retake_note_aside(uuid, uuid) to authenticated, service_role;
