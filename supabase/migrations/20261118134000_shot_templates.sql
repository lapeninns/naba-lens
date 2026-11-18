-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S5-TEMPLATES: shot templates (FA-52; spec §8 A7 "Settings
-- manage shot templates", §5.2 step 2 "one short shot instruction ... and an
-- optional approved example", §11 "a clear, truthful photograph of the
-- normal serving or space"; checklist A7-shot-templates).
--
--   Table     public.shot_templates: one default instruction per category
--             (food, drinks, spaces, facilities, other), one line of 1 to 140
--             characters (the album brief limit), and an optional example
--             photo from the Library. Seeded below in plain words.
--   Example   private.shot_template_example_eligible(asset): a ready, not
--             deleted image, not withdrawn in the Library, whose use is not
--             withdrawn, and accepted at the public level on some slot (a
--             dish, a place, a facility; the legacy checklist counts as
--             public, as private.library_review_state). The same rule picks
--             (shot_template_set), lists (shot_template_example_choices) and
--             shows (shot_templates, slot_briefs, the thumbnail check): an
--             example that stops qualifying is no longer shown anywhere, and
--             stays stored so Settings can say so.
--   Writes    public.shot_template_set: active admins on an aal2 session only
--             (private.is_active_admin). Optimistic revision; a repeat with
--             the same values changes nothing. Every change is written to
--             the activity log (private.record_activity, organisation-wide,
--             action shot_template_set, before and after).
--   Reads     public.shot_templates: every active signed-in person (staff
--             read the instruction beside a slot); admins also see who
--             changed it and whether a stored example stopped qualifying.
--             public.shot_template_example_choices: admins, the Library's
--             public-level images, newest first, by venue.
--             public.shot_template_example_can_open(asset): whether the
--             signed-in person may see this example's thumbnail (any active
--             person, only while it is a current, eligible example).
--   Brief     public.slot_briefs(venue, include_requests): every slot's
--             brief at the venue, resolved in one place, in order (FA-52):
--               1 the brief of an open request on the slot (the caller's own
--                 first, then by priority, date and age, as my_media_requests)
--               2 the manager's brief: the dish's own, then its section's
--                 (album_briefs, AL-4)
--               3 the amenity catalogue's capture brief (a facility question)
--               4 the category's shot template
--             with an example: the request's reference photo when the brief
--             is the request's and the caller may see it, else the
--             category template's example. Staff, managers and admins of the
--             venue (private.knowledge_place_venue). A template never
--             rewrites a manager's brief; it is only the fallback.
--
-- Nothing here changes coverage, review, credit or request rules.
--
-- Rollback: roll back the app (Settings › Shot templates, slot_briefs
-- readers) first, then revoke execute on the five public functions. The
-- table stays.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.shot_templates (
  category text primary key
    check (category in ('food', 'drinks', 'spaces', 'facilities', 'other')),
  instruction text not null check (
    length(instruction) between 1 and 140 and instruction = btrim(instruction)
    and instruction !~ '[[:cntrl:]]'
  ),
  -- A hard delete of the photo clears the example rather than blocking it.
  example_asset_id uuid references public.media_assets (id) on delete set null,
  revision integer not null default 1 check (revision >= 1),
  -- NULL for the seeded defaults.
  updated_by uuid references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now()
);

comment on table public.shot_templates is
  'S5-TEMPLATES (FA-52): one default shot instruction per category, with an optional example photo. The last fallback of public.slot_briefs. Changes are in activity_events (shot_template_set).';

alter table public.shot_templates enable row level security;
revoke all on table public.shot_templates from public, anon, authenticated, service_role;
grant select on table public.shot_templates to service_role;

insert into public.shot_templates (category, instruction) values
  ('food', 'The dish as it is normally served, on its usual plate, in good light. A clear, true photo of what guests get.'),
  ('drinks', 'The drink as it is normally served, in its usual glass, in good light. A clear, true photo of what guests get.'),
  ('spaces', 'The space as guests normally see it, tidy and in good light. A clear, true photo with no one in focus.'),
  ('facilities', 'The facility as guests would find it, in good light. A clear, true photo that shows what it is.'),
  ('other', 'The subject as guests would normally see it, in good light. A clear, true photo, nothing staged.');

-- ---------------------------------------------------------------------------
-- The example rule
-- ---------------------------------------------------------------------------

-- An image the Library treats as approved for public use and still usable.
-- The public-level sources are those of private.library_review_state (which
-- is admin-gated, so it cannot be reused for staff reads); keep them in step.
create function private.shot_template_example_eligible(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_asset_id is not null and exists (
    select 1
    from public.media_assets a
    where a.id = p_asset_id
      and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null
      and a.thumbnail_path is not null
      and not exists (select 1 from public.media_asset_withdrawals w where w.asset_id = a.id)
      and private.media_asset_use_state(a.id, now()) is distinct from 'withdrawn'
      and coalesce((
        select not bool_or(private.media_use_grant_state(g, now()) = 'in_force')
          and bool_or(private.media_use_grant_state(g, now()) = 'withdrawn')
        from public.media_use_grants g where g.asset_id = a.id and g.audience = 'public'
      ), false) = false
      and (
        exists (
          select 1 from public.menu_item_photos m
          where m.asset_id = a.id and m.state = 'accepted' and m.review_level = 'public')
        or exists (
          select 1 from public.coverage_submission_items ci
          where ci.asset_id = a.id and ci.state = 'accepted')
        or exists (
          select 1 from public.media_area_labels l
          cross join lateral (
            select x.action, x.review_level from public.area_photo_decisions x
            where x.label_id = l.id order by x.id desc limit 1) d
          where l.asset_id = a.id and l.removed_at is null
            and d.action = 'accepted' and d.review_level = 'public')
        or exists (
          select 1 from (
            select distinct on (x.check_id) x.action, x.review_level
            from public.amenity_photo_decisions x where x.asset_id = a.id
            order by x.check_id, x.id desc) d
          where d.action = 'accepted' and d.review_level = 'public')
      )
  );
$$;

revoke all on function private.shot_template_example_eligible(uuid) from public, anon, authenticated, service_role;

-- The categories' templates with the example only while it qualifies.
create function private.shot_template_rows()
returns table (category text, instruction text, example_asset_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select t.category, t.instruction,
    case when private.shot_template_example_eligible(t.example_asset_id) then t.example_asset_id end
  from public.shot_templates t;
$$;

revoke all on function private.shot_template_rows() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

create function public.shot_templates()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin boolean;
begin
  perform private.amenity_assert_active_user();
  v_admin := coalesce(private.is_active_admin(), false);
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'category', t.category,
        'instruction', t.instruction,
        'exampleAssetId', case when private.shot_template_example_eligible(t.example_asset_id)
          then t.example_asset_id end,
        'revision', t.revision)
      || case when v_admin then jsonb_build_object(
          'exampleUnavailable', t.example_asset_id is not null
            and not private.shot_template_example_eligible(t.example_asset_id),
          'updatedAt', t.updated_at,
          'updatedBy', (select p.display_name from public.profiles p where p.id = t.updated_by))
        else '{}'::jsonb end
      order by array_position(array['food', 'drinks', 'spaces', 'facilities', 'other'], t.category))
    from public.shot_templates t
  ), '[]'::jsonb);
end;
$$;

-- Images an admin may choose as an example: the Library's public-level
-- photos, newest upload first, optionally one venue. p_before is the
-- previous page's nextCursor {at, id}.
create function public.shot_template_example_choices(
  p_venue_id uuid default null,
  p_before jsonb default null,
  p_limit integer default 24
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 24), 1), 60);
  v_at timestamptz;
  v_id uuid;
  v_rows jsonb;
  v_count integer;
begin
  if auth.uid() is null or not private.is_active_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  if p_before is not null then
    begin
      v_at := (p_before ->> 'at')::timestamptz;
      v_id := (p_before ->> 'id')::uuid;
    exception when others then
      raise exception 'invalid_cursor' using errcode = '22023';
    end;
    if v_at is null or v_id is null then
      raise exception 'invalid_cursor' using errcode = '22023';
    end if;
  end if;

  with candidates as (
    select m.asset_id from public.menu_item_photos m
    where m.state = 'accepted' and m.review_level = 'public'
    union
    select ci.asset_id from public.coverage_submission_items ci where ci.state = 'accepted'
    union
    select d.asset_id from public.area_photo_decisions d
    where d.action = 'accepted' and d.review_level = 'public'
    union
    select d.asset_id from public.amenity_photo_decisions d
    where d.action = 'accepted' and d.review_level = 'public'
  ),
  page as (
    select a.id, a.venue_id, a.created_at, v.name as venue_name
    from candidates c
    join public.media_assets a on a.id = c.asset_id
    join public.venues v on v.id = a.venue_id
    where (p_venue_id is null or a.venue_id = p_venue_id)
      and (v_at is null or (a.created_at, a.id) < (v_at, v_id))
      and private.shot_template_example_eligible(a.id)
    order by a.created_at desc, a.id desc
    limit v_limit + 1
  )
  select jsonb_agg(jsonb_build_object(
      'assetId', p.id, 'venueId', p.venue_id, 'venueName', p.venue_name, 'uploadedAt', p.created_at)
      order by p.created_at desc, p.id desc),
    count(*)
  into v_rows, v_count
  from page p;

  v_rows := coalesce(v_rows, '[]'::jsonb);
  return jsonb_build_object(
    'items', case when v_count > v_limit
      then (select jsonb_agg(e order by n) from jsonb_array_elements(v_rows) with ordinality x(e, n) where n <= v_limit)
      else v_rows end,
    'nextCursor', case when v_count > v_limit then jsonb_build_object(
      'at', v_rows -> (v_limit - 1) ->> 'uploadedAt', 'id', v_rows -> (v_limit - 1) ->> 'assetId') end);
end;
$$;

-- Whether the signed-in, active person may see this photo as a shot
-- template example (the thumbnail route asks before signing a URL).
create function public.shot_template_example_can_open(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.active)
    and exists (select 1 from public.shot_templates t where t.example_asset_id = p_asset_id)
    and private.shot_template_example_eligible(p_asset_id);
$$;

-- ---------------------------------------------------------------------------
-- Write
-- ---------------------------------------------------------------------------

-- Sets one category's instruction and example (null clears the example).
-- p_expected_revision guards against overwriting someone else's change.
create function public.shot_template_set(
  p_category text,
  p_instruction text,
  p_example_asset_id uuid,
  p_expected_revision integer,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_current public.shot_templates;
  v_instruction text;
  v_reason text;
begin
  if v_uid is null or not private.is_active_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  -- Input is checked only once the caller may write.
  if p_category is null or p_category not in ('food', 'drinks', 'spaces', 'facilities', 'other') then
    raise exception 'invalid_category' using errcode = '22023';
  end if;
  v_instruction := private.clean_text(p_instruction, 140, 'invalid_instruction');
  if v_instruction is null then
    raise exception 'instruction_required' using errcode = '22023';
  end if;
  if v_instruction ~ '[[:cntrl:]]' then
    raise exception 'invalid_instruction' using errcode = '22023';
  end if;
  v_reason := private.clean_text(p_reason, 500, 'invalid_reason');

  select t.* into v_current from public.shot_templates t
  where t.category = p_category for update;
  if not found then
    raise exception 'invalid_category' using errcode = '22023';
  end if;
  if p_expected_revision is null or p_expected_revision <> v_current.revision then
    raise exception 'stale_revision' using errcode = '40001';
  end if;

  if v_current.instruction = v_instruction
     and v_current.example_asset_id is not distinct from p_example_asset_id then
    return jsonb_build_object('category', p_category, 'revision', v_current.revision, 'changed', false);
  end if;

  -- A new or changed example must qualify now; keeping a stored example that
  -- has since stopped qualifying is allowed (Settings says it is not shown).
  if p_example_asset_id is not null
     and p_example_asset_id is distinct from v_current.example_asset_id
     and not private.shot_template_example_eligible(p_example_asset_id) then
    raise exception 'invalid_example' using errcode = '22023';
  end if;

  update public.shot_templates
  set instruction = v_instruction, example_asset_id = p_example_asset_id,
    revision = v_current.revision + 1, updated_by = v_uid, updated_at = now()
  where category = p_category;

  perform private.record_activity(
    null, 'shot_template_set', 'shot_template', p_category,
    v_current.revision, v_current.revision + 1, v_reason,
    jsonb_build_object('instruction', v_current.instruction, 'exampleAssetId', v_current.example_asset_id),
    jsonb_build_object('instruction', v_instruction, 'exampleAssetId', p_example_asset_id));

  return jsonb_build_object('category', p_category, 'revision', v_current.revision + 1, 'changed', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Every slot's brief, resolved in one place
-- ---------------------------------------------------------------------------

create function public.slot_briefs(
  p_venue_id uuid default null,
  p_include_requests boolean default true
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue uuid := private.knowledge_place_venue(p_venue_id);
  v_uid uuid := auth.uid();
begin
  return jsonb_build_object('venueId', v_venue, 'items', coalesce((
    with templates as (
      select * from private.shot_template_rows()
    ),
    -- A dish on the active menu, in its first section (the category is the
    -- section's kind, as private.coverage_slot_rows).
    dish as (
      select distinct on (i.id) i.id as slot_id, s.kind as category, s.slug
      from public.menu_versions mv
      join public.menu_sections s on s.version_id = mv.id and s.venue_id = mv.venue_id
      join public.menu_entries e on e.version_id = mv.id and e.section_id = s.id
      join public.menu_items i on i.id = e.item_id and i.venue_id = mv.venue_id
      where mv.venue_id = v_venue and mv.status = 'active' and i.archived_at is null
      order by i.id, s.position, e.position
    ),
    slots as (
      select 'dish'::text as kind, d.slot_id, d.category,
        coalesce(
          (select b.brief from public.album_briefs b
            where b.venue_id = v_venue and b.source = 'menu_item' and b.source_key = d.slot_id::text),
          (select b.brief from public.album_briefs b
            where b.venue_id = v_venue and b.source = 'menu_section' and b.source_key = d.slug)
        ) as manager_brief,
        null::text as catalogue_brief
      from dish d
      union all
      select 'amenity', c.id, 'facilities', null, nullif(btrim(t.capture_brief), '')
      from public.venue_amenity_checks c
      join public.amenity_catalogue t on t.key = c.template_key
      where c.venue_id = v_venue and c.status = 'active'
      union all
      select 'area', s.id, 'spaces', null, null
      from public.knowledge_subjects s
      where s.venue_id = v_venue and s.retired_at is null
    ),
    requests as (
      select distinct on (m.slot_kind, m.slot_id)
        m.slot_kind, m.slot_id, m.brief,
        case when m.reference_asset_id is not null
          and private.media_visible_to_caller(m.reference_asset_id)
          then m.reference_asset_id end as reference_asset_id
      from public.media_requests m
      where p_include_requests and m.venue_id = v_venue and m.closed_state is null
        and m.slot_id is not null and m.request_type <> 'fact_confirmation'
      order by m.slot_kind, m.slot_id,
        coalesce(m.assignee_id = v_uid, false) desc,
        case m.priority when 'high' then 0 when 'normal' then 1 else 2 end,
        m.due_on nulls last, m.created_at
    ),
    resolved as (
      select s.kind, s.slot_id, s.category,
        case
          when r.brief is not null then 'request'
          when s.manager_brief is not null then 'manager'
          when s.catalogue_brief is not null then 'catalogue'
          when t.instruction is not null then 'template'
        end as source,
        coalesce(r.brief, s.manager_brief, s.catalogue_brief, t.instruction) as brief,
        case when r.brief is not null and r.reference_asset_id is not null
          then r.reference_asset_id else t.example_asset_id end as example_asset_id
      from slots s
      left join requests r on r.slot_kind = s.kind and r.slot_id = s.slot_id
      left join templates t on t.category = s.category
    )
    select jsonb_agg(jsonb_build_object(
        'kind', x.kind, 'slotId', x.slot_id, 'category', x.category,
        'brief', x.brief, 'source', x.source, 'exampleAssetId', x.example_asset_id)
      order by x.kind, x.slot_id)
    from resolved x
  ), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function public.shot_templates() from public, anon, service_role;
revoke all on function public.shot_template_example_choices(uuid, jsonb, integer) from public, anon, service_role;
revoke all on function public.shot_template_example_can_open(uuid) from public, anon, service_role;
revoke all on function public.shot_template_set(text, text, uuid, integer, text) from public, anon, service_role;
revoke all on function public.slot_briefs(uuid, boolean) from public, anon, service_role;
grant execute on function public.shot_templates() to authenticated;
grant execute on function public.shot_template_example_choices(uuid, jsonb, integer) to authenticated;
grant execute on function public.shot_template_example_can_open(uuid) to authenticated;
grant execute on function public.shot_template_set(text, text, uuid, integer, text) to authenticated;
grant execute on function public.slot_briefs(uuid, boolean) to authenticated;
