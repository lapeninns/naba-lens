-- PR 34 review follow-ups (photo review, import and needed-by findings).
--
-- These changes were first written as edits to migrations that production
-- had already applied on 19 Nov 2026, so they are restated here as a forward
-- migration. Each body is the latest definition with the fix:
--
--   private.lock_media_duplicate     new: the per-venue, per-hash advisory lock
--                                    the upload trigger and legacy import share
--   private.media_assets_duplicate_serialise  uses the shared lock (108200)
--   public.legacy_import_complete    takes the duplicate lock before its
--                                    exact-duplicate check (138000)
--   private.ops_venue_backlog        counts pending amenity photos (106300)
--   private.notify_on_amenity_photo_decision + trigger
--                                    new: a manager's "needs another photo" on
--                                    amenity evidence notifies the uploader
--                                    (106200)
--   private.menu_item_needed_by_live, public.set_menu_item_needed_by
--                                    only a public approval fulfils the
--                                    public-photo requirement; running
--                                    specials count as offerings (138200)
--
-- Rollback: re-apply the bodies from 20261118106300, 20261118108200,
-- 20261118138000, 20261116150000 and 20261118138200; drop trigger
-- amenity_photo_decisions_notify and its function. Keep
-- private.lock_media_duplicate until neither caller uses it.

set lock_timeout = '5s';

create or replace function private.lock_media_duplicate(p_venue_id uuid, p_content_sha256 text)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_advisory_xact_lock(
    hashtextextended('nabalens_dup:' || p_venue_id::text || ':' || p_content_sha256, 0));
$$;

revoke all on function private.lock_media_duplicate(uuid, text) from public, anon, authenticated, service_role;

create or replace function private.media_assets_duplicate_serialise()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_duplicate uuid;
begin
  perform private.lock_media_duplicate(new.venue_id, new.content_sha256);
  if new.duplicate_of_asset_id is null then
    select d.id into v_duplicate
    from public.media_assets d
    where d.venue_id = new.venue_id
      and d.content_sha256 = new.content_sha256
      and d.id <> new.id
      and d.deleted_at is null
      and d.upload_state = 'ready'
    order by d.created_at, d.id
    limit 1;
    new.duplicate_of_asset_id := v_duplicate;
  end if;
  return new;
end;
$$;

create or replace function public.legacy_import_complete(
  p_admin uuid,
  p_asset_id uuid,
  p_line_no integer,
  p_file_path text,
  p_validated_mime_type text,
  p_size_bytes bigint,
  p_content_sha256 text,
  p_captured_source text,
  p_captured_at timestamptz default null,
  p_width integer default null,
  p_height integer default null,
  p_duration_seconds numeric default null,
  p_preview_path text default null,
  p_thumbnail_path text default null,
  p_contributor_email text default null,
  p_contributor_id uuid default null,
  p_manifest_captured_at timestamptz default null,
  p_legacy_label text default null,
  p_legacy_folder text default null,
  p_staged_kind text default null,
  p_staged_id uuid default null
)
returns table (outcome text, asset_id uuid, staged_kind text, staged_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_asset public.media_assets;
  v_duplicate uuid;
  v_ready boolean;
  v_note text;
  v_kind text := p_staged_kind;
  v_staged uuid := p_staged_id;
  v_subject public.knowledge_subjects;
  v_label text := left(nullif(btrim(p_legacy_label), ''), 200);
begin
  perform private.legacy_import_admin(p_admin);
  if p_content_sha256 is null or p_content_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_content_hash' using errcode = '22023';
  end if;
  if p_captured_source is null or p_captured_source not in ('supplied', 'metadata', 'unknown')
     or ((p_captured_source = 'unknown') <> (p_captured_at is null)) then
    raise exception 'invalid_captured_at' using errcode = '22023';
  end if;
  if (v_kind is null) <> (v_staged is null)
     or (v_kind is not null and v_kind not in ('dish', 'place', 'amenity')) then
    raise exception 'invalid_staged_label' using errcode = '22023';
  end if;

  select a.* into v_asset
  from public.media_assets a
  where a.id = p_asset_id and a.provenance = 'legacy_import' and a.deleted_at is null
  for update;
  if not found then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  if v_asset.upload_state = 'ready' then
    -- Already done by an earlier run: the item was recorded with it.
    return query
      select i.outcome, i.asset_id, i.staged_kind, i.staged_id
      from public.media_import_items i
      where i.batch_id = v_asset.import_batch_id and i.line_no = p_line_no;
    return;
  end if;

  -- Exact duplicate (FA-35, AC21): same venue, same bytes, live and ready.
  perform private.lock_media_duplicate(v_asset.venue_id, p_content_sha256);
  select d.id into v_duplicate
  from public.media_assets d
  where d.venue_id = v_asset.venue_id
    and d.content_sha256 = p_content_sha256
    and d.id <> v_asset.id
    and d.deleted_at is null
    and d.upload_state = 'ready'
  order by d.created_at, d.id
  limit 1;

  if v_duplicate is not null then
    -- The reservation never becomes ready; cleanup removes its objects.
    update public.media_assets a
    set upload_state = 'failed', deleted_at = now()
    where a.id = p_asset_id;
    insert into public.media_import_items (
      batch_id, line_no, file_path, venue_id, content_sha256, contributor_email,
      contributor_id, manifest_captured_at, legacy_label, legacy_folder, outcome, asset_id
    )
    values (
      v_asset.import_batch_id, p_line_no, left(p_file_path, 1000), v_asset.venue_id,
      p_content_sha256, nullif(btrim(p_contributor_email), ''), p_contributor_id,
      p_manifest_captured_at, v_label, left(nullif(btrim(p_legacy_folder), ''), 500),
      'duplicate', v_duplicate
    )
    on conflict (batch_id, line_no) do nothing;
    return query select 'duplicate'::text, v_duplicate, null::text, null::uuid;
    return;
  end if;

  update public.media_assets a
  set upload_state = 'processing',
      content_sha256 = p_content_sha256,
      captured_at = p_captured_at,
      captured_at_source = p_captured_source,
      captured_at_set_by = (select p_admin where p_captured_source = 'supplied')
  where a.id = p_asset_id;

  select c.became_ready into v_ready
  from private.complete_media_finalise_core(
    p_asset_id, p_validated_mime_type, p_size_bytes, p_width, p_height,
    p_duration_seconds, p_preview_path, p_thumbnail_path
  ) c;
  if not coalesce(v_ready, false) then
    raise exception 'import_not_ready' using errcode = 'P0001';
  end if;

  v_note := left('Imported' || coalesce('. Legacy label: ' || v_label, ''), 280);

  -- Stage the matched label as staff would have saved it. Anything that no
  -- longer fits (dish left the menu, place retired) leaves the photo
  -- unlabelled with its legacy label as the note instead.
  begin
    if v_kind = 'dish' then
      perform private.save_media_labels_as(
        p_admin, p_asset_id, 0, array['dish'], v_note,
        jsonb_build_array(jsonb_build_object('itemId', v_staged, 'variantId', null)),
        null, private.active_menu_version_id(v_asset.venue_id));
    elsif v_kind = 'place' then
      if v_asset.media_type <> 'image' then
        raise exception 'area_label_image_only' using errcode = '22023';
      end if;
      select s.* into v_subject from public.knowledge_subjects s
      where s.id = v_staged and s.venue_id = v_asset.venue_id and s.retired_at is null;
      if not found then
        raise exception 'area_unavailable' using errcode = 'P0001';
      end if;
      insert into public.media_area_labels (asset_id, venue_id, subject_id, subject_kind, subject_label, added_by)
      values (p_asset_id, v_asset.venue_id, v_subject.id, v_subject.kind, v_subject.label, v_asset.uploader_id);
    elsif v_kind = 'amenity' then
      if v_asset.media_type <> 'image' or not exists (
        select 1 from public.venue_amenity_checks c
        where c.id = v_staged and c.venue_id = v_asset.venue_id and c.status = 'active'
          -- S5-R3 (Y5): only a check on the working list has a queue.
          and private.knowledge_in_scope(c.venue_id, c.template_key)
      ) then
        raise exception 'amenity_unavailable' using errcode = 'P0001';
      end if;
    end if;
  exception when others then
    v_kind := null;
    v_staged := null;
  end;

  if v_kind is null or v_kind = 'amenity' or v_kind = 'place' then
    -- The note keeps the legacy label (spec §20 step 2: ambiguous legacy
    -- labels are identified, not guessed).
    perform private.save_media_labels_as(
      p_admin, p_asset_id,
      coalesce((select l.revision from public.media_labels l where l.asset_id = p_asset_id), 0),
      '{}', v_note, '[]'::jsonb, null, null);
  end if;

  insert into public.media_import_items (
    batch_id, line_no, file_path, venue_id, content_sha256, contributor_email,
    contributor_id, manifest_captured_at, legacy_label, legacy_folder, outcome, asset_id,
    staged_kind, staged_id
  )
  values (
    v_asset.import_batch_id, p_line_no, left(p_file_path, 1000), v_asset.venue_id,
    p_content_sha256, nullif(btrim(p_contributor_email), ''), p_contributor_id,
    p_manifest_captured_at, v_label, left(nullif(btrim(p_legacy_folder), ''), 500),
    'imported', p_asset_id, v_kind, v_staged
  );

  return query select 'imported'::text, p_asset_id, v_kind, v_staged;
end;
$$;

create or replace function private.ops_venue_backlog(p_venue_id uuid, p_now timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_menu integer;
  v_menu_oldest timestamptz;
  v_area integer;
  v_area_oldest timestamptz;
  v_list integer;
  v_list_oldest timestamptz;
  v_amenity integer;
  v_amenity_oldest timestamptz;
  v_overdue integer;
begin
  select count(*)::integer, min(coalesce(t.labelled_at, t.created_at))
  into v_menu, v_menu_oldest
  from private.menu_photo_pending_tuples(p_venue_id, true) t;

  select count(*)::integer, min(l.added_at) into v_area, v_area_oldest
  from public.media_area_labels l
  join public.media_assets a on a.id = l.asset_id
  where l.venue_id = p_venue_id and l.removed_at is null
    and a.deleted_at is null and a.upload_state = 'ready'
    and not exists (select 1 from public.area_photo_decisions d where d.label_id = l.id);

  select count(*)::integer, min(i.submitted_at) into v_list, v_list_oldest
  from public.coverage_submission_items i
  join public.media_assets a on a.id = i.asset_id
  where i.venue_id = p_venue_id and i.state = 'submitted'
    and a.upload_state = 'ready' and a.deleted_at is null;

  select count(*)::integer, min(r.uploaded_at) into v_amenity, v_amenity_oldest
  from private.amenity_photo_rows(p_venue_id) r
  where r.state = 'pending';

  select count(*)::integer into v_overdue
  from private.knowledge_venue_open_rechecks(p_venue_id) t
  where t.due_at < v_now;

  return jsonb_build_object(
    'waiting', v_menu + v_area + v_list + v_amenity,
    'menuPhotos', v_menu, 'areaPhotos', v_area, 'checklistPhotos', v_list,
    'amenityPhotos', v_amenity,
    'oldestWaitingAt', least(v_menu_oldest, v_area_oldest, v_list_oldest, v_amenity_oldest),
    'overdueChecks', v_overdue);
end;
$$;

create or replace function private.notify_on_amenity_photo_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uploader uuid;
  v_question text;
begin
  select a.uploader_id into v_uploader from public.media_assets a where a.id = new.asset_id;
  if v_uploader is distinct from new.decided_by then
    select t.question into v_question
    from public.venue_amenity_checks c
    join public.amenity_catalogue t on t.key = c.template_key
    where c.id = new.check_id;
    perform private.notify(v_uploader, new.venue_id, 'retake_requested', 'amenity_check',
      new.check_id::text, format('retake:amenity:%s', new.id),
      jsonb_strip_nulls(jsonb_build_object('source', 'amenity', 'checkId', new.check_id,
        'question', v_question, 'reason', new.reason)), new.decided_at);
  end if;
  return null;
end;
$$;

revoke all on function private.notify_on_amenity_photo_decision() from public, anon, authenticated, service_role;

drop trigger if exists amenity_photo_decisions_notify on public.amenity_photo_decisions;
create trigger amenity_photo_decisions_notify
  after insert on public.amenity_photo_decisions
  for each row when (new.action = 'needs_another_photo')
  execute function private.notify_on_amenity_photo_decision();

create or replace function private.menu_item_needed_by_live(p_venue_id uuid)
returns table (item_id uuid, needed_by date)
language sql
stable
security definer
set search_path = ''
as $$
  select n.item_id, n.needed_by
  from public.menu_item_needed_by n
  where n.venue_id = p_venue_id
    and n.cleared_at is null
    and not exists (
      select 1 from public.menu_item_photo_events ev
      where ev.venue_id = n.venue_id and ev.item_id = n.item_id
        and ev.created_at >= n.set_at
        and (
          (ev.action = 'level_set' and ev.detail ->> 'level' = 'public')
          or (
            ev.action = 'accepted' and not exists (
              -- A reference approval writes accepted and the next revision's
              -- level_set together, at the same transaction timestamp.
              select 1 from public.menu_item_photo_events ref
              where ref.photo_id = ev.photo_id
                and ref.revision = ev.revision + 1
                and ref.created_at = ev.created_at
                and ref.action = 'level_set'
                and ref.detail ->> 'level' = 'reference'
            )
          )
        )
    );
$$;

create or replace function public.set_menu_item_needed_by(
  p_item_id uuid,
  p_needed_by date,
  p_venue_id uuid default null
)
returns table (item_id uuid, venue_id uuid, needed_by date, set_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_venue uuid := coalesce(p_venue_id, private.my_manager_venue_id());
  v_role text;
  v_today date := private.london_today();
  v_at timestamptz := now();
begin
  perform private.assert_can_manage_venue(v_venue);
  v_role := case when private.is_active_admin() then 'admin' else 'manager' end;
  if p_item_id is null
     or not exists (select 1 from public.menu_items i where i.id = p_item_id and i.venue_id = v_venue) then
    raise exception 'menu_item_not_found' using errcode = 'P0002';
  end if;
  if p_needed_by is null or p_needed_by < v_today or p_needed_by > v_today + 366 then
    raise exception 'invalid_needed_by' using errcode = '22023';
  end if;
  -- Same lock as reviews and menu changes: the menu and the dish's photos
  -- cannot change under this check.
  perform private.lock_venue_menu(v_venue, true);
  -- A current food or drinks dish: an active-menu entry or a running special
  -- (private.is_current_photo_item, 20261118103100).
  if not private.is_current_photo_item(v_venue, p_item_id) then
    raise exception 'menu_item_unavailable' using errcode = '55000';
  end if;
  if exists (
    select 1
    from public.menu_item_photos p
    join public.media_assets a on a.id = p.asset_id
    where p.item_id = p_item_id and p.state = 'accepted' and p.review_level = 'public'
      and a.upload_state = 'ready' and a.deleted_at is null and a.media_type = 'image'
  ) then
    raise exception 'menu_item_has_photo' using errcode = '55000';
  end if;

  insert into public.menu_item_needed_by as n
    (item_id, venue_id, needed_by, set_by, set_by_role, set_at)
  values (p_item_id, v_venue, p_needed_by, v_uid, v_role, v_at)
  on conflict on constraint menu_item_needed_by_pkey do update
  set needed_by = excluded.needed_by, set_by = excluded.set_by,
    set_by_role = excluded.set_by_role, set_at = excluded.set_at,
    cleared_at = null, cleared_by = null, cleared_by_role = null;
  insert into public.menu_item_needed_by_events (item_id, venue_id, action, needed_by, actor_id, actor_role, created_at)
  values (p_item_id, v_venue, 'set', p_needed_by, v_uid, v_role, v_at);

  item_id := p_item_id;
  venue_id := v_venue;
  needed_by := p_needed_by;
  set_at := v_at;
  return next;
end;
$$;
