-- B02-c follow-up: a manager account's own-media reads leave out its
-- staff-era uploads (default 13; docs/knowledge/b02-design.md W3, W4). Found
-- by the UI: my_contributions_feed's photo branch filtered only on uploader,
-- purpose and deletion, so a manager account saw its staff-era photos there.
--
-- Rule, as the B02-c policies already state it: for a manager account
-- (private.is_active_manager()), an own upload counts only when
-- uploader_role = 'manager'. Staff, staff holding a grant and admins are
-- unchanged.
--
-- * public.my_contributions_feed (20261110010123 body): the photo branch
--   leaves out a manager account's staff-era uploads. Task sends, findings and
--   closed assignments are records of work, not media lists, and are
--   unchanged.
-- * private.feed_photo_json (20261110085648 body): photo rows gain
--   uploaderRole (the stored uploader_role; null on rows before B02-c).
-- * public.my_label_work (20261110090145 body): needs_attention now follows
--   the same rule as needs_labels.
-- * private.viewer_sees_asset (20261110013723 body): the own-upload arm
--   follows the rule, so contribution_groups_for_assets and contribution_group
--   no longer show a manager account its staff-era uploads. The other arms
--   (community, menu, task and amenity evidence gates) are unchanged.
-- * public.contribution_group_add (20261110013723 body): a manager account's
--   staff-era upload is refused as not_own, so it cannot enter a group.
-- * Not touched: the credit trigger media_assets_amenity_evidence_lost,
--   media_assets_knowledge_evidence_withdrawn, the credit functions, and
--   my_asset_delete_impact (already staff only). Pending label drafts already
--   follow the rule (20261110091603 policies).
--
-- Rollback: a forward migration restores the bodies named above.

create or replace function private.feed_photo_json(p_asset_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'assetId', a.id,
    'venueId', a.venue_id,
    'venueName', v.name,
    'mediaType', a.media_type,
    'uploadState', a.upload_state,
    'uploaderRole', a.uploader_role,
    'sentAt', a.created_at,
    'labels', jsonb_build_object(
      'hasLabels', coalesce(l.has_labels, false),
      'needsLabels', private.asset_needs_labels(a.id),
      'needsAttention', exists (
        select 1 from public.media_pending_labels pl
        where pl.asset_id = a.id and pl.status = 'needs_attention'
      )
    ),
    'menuDecisions', coalesce((
      select jsonb_agg(d.row order by d.waiting, d.decided_at desc, d.photo_id desc, d.item_name, d.label_id)
      from (
        select jsonb_build_object(
            'photoId', m.id, 'itemId', m.item_id, 'itemName', m.item_name,
            'variantName', m.variant_name, 'state', m.state, 'reason', m.reason,
            'decidedAt', m.decided_at) as row,
          false as waiting, m.decided_at, m.id as photo_id, null::text as item_name, null::uuid as label_id
        from public.menu_item_photos m
        where m.asset_id = a.id and m.state not in ('withdrawn', 'invalidated')
        union all
        select jsonb_build_object(
            'photoId', null, 'itemId', t.item_id, 'itemName', e.name,
            'variantName', coalesce(ev.name, li.variant_name), 'state', 'waiting',
            'reason', null, 'decidedAt', null),
          true, null::timestamptz, null::uuid, e.name, t.label_id
        from private.menu_photo_pending_tuples(a.venue_id, false, true) t
        join public.menu_entries e on e.id = t.entry_id
        join public.media_label_items li on li.id = t.label_id
        left join public.menu_entry_variants ev on ev.entry_id = t.entry_id and ev.variant_id = t.variant_id
        where t.asset_id = a.id and t.live_photo_id is null
      ) d
    ), '[]'::jsonb),
    'menuUseAccepted', exists (
      select 1 from public.menu_item_photos m where m.asset_id = a.id and m.state = 'accepted'
    )
  )
  from public.media_assets a
  join public.venues v on v.id = a.venue_id
  left join public.media_labels l on l.asset_id = a.id
  where a.id = p_asset_id;
$$;

-- The caller's own records across venues, newest first by creation (send)
-- time, which never changes, so rows never move between pages (OD-4). The
-- cursor is the previous page's nextCursor, "<UTC instant>|<key>"; keys are
-- p: photo, t: task send, and B01's c:, s:, e:. Each branch is cut to
-- p_limit + 1 rows before the union, and only the page's rows are built.
create or replace function public.my_contributions_feed(p_cursor text, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_manager boolean := private.is_active_manager();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 20);
  v_before_at timestamptz;
  v_before_key text collate "C";
  v_items jsonb;
  v_next text;
begin
  if p_cursor is not null then
    if p_cursor !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z\|[ptcse]:[0-9a-f-]{1,36}$' then
      raise exception 'invalid_cursor' using errcode = '22023';
    end if;
    v_before_at := split_part(p_cursor, '|', 1)::timestamptz;
    v_before_key := split_part(p_cursor, '|', 2);
  end if;
  with branches as (
    (select a.created_at as at, ('p:' || a.id::text) collate "C" as k, 'photo'::text as t,
        a.id as id, null::bigint as eid
      from public.media_assets a
      where a.uploader_id = v_uid and a.purpose = 'general' and a.deleted_at is null
        and (not v_manager or a.uploader_role = 'manager')
        and (v_before_at is null or (a.created_at, ('p:' || a.id::text) collate "C") < (v_before_at, v_before_key))
      order by 1 desc, 2 desc
      limit v_limit + 1)
    union all
    (select i.submitted_at, ('t:' || i.id::text) collate "C", 'task_send', i.id, null::bigint
      from public.coverage_submission_items i
      where i.submitted_by = v_uid and i.origin = 'submitted'
        and (v_before_at is null or (i.submitted_at, ('t:' || i.id::text) collate "C") < (v_before_at, v_before_key))
      order by 1 desc, 2 desc
      limit v_limit + 1)
    union all
    (select x.created_at, ('c:' || x.id::text) collate "C", 'finding', x.id, null::bigint
      from public.knowledge_contributions x
      where x.contributed_by = v_uid
        and (v_before_at is null or (x.created_at, ('c:' || x.id::text) collate "C") < (v_before_at, v_before_key))
      order by 1 desc, 2 desc
      limit v_limit + 1)
    union all
    (select s.created_at, ('s:' || s.id::text) collate "C", 'finding', s.id, null::bigint
      from public.amenity_submissions s
      where s.submitted_by = v_uid and s.source_contribution_id is null
        and (v_before_at is null or (s.created_at, ('s:' || s.id::text) collate "C") < (v_before_at, v_before_key))
      order by 1 desc, 2 desc
      limit v_limit + 1)
    union all
    (select e.created_at, ('e:' || lpad(e.id::text, 19, '0')) collate "C", 'assignment_closed', null::uuid, e.id
      from public.knowledge_events e
      where e.kind = 'assignment_closed_by_other' and e.detail ->> 'assigneeId' = v_uid::text
        and (v_before_at is null
          or (e.created_at, ('e:' || lpad(e.id::text, 19, '0')) collate "C") < (v_before_at, v_before_key))
      order by 1 desc, 2 desc
      limit v_limit + 1)
  ),
  page as (
    select b.*, row_number() over (order by b.at desc, b.k desc) as rn
    from branches b
    order by b.at desc, b.k desc
    limit v_limit + 1
  )
  -- When there is one more row, the next page starts after the last shown.
  select coalesce(jsonb_agg(
      case z.t
        when 'photo' then private.feed_photo_json(z.id)
        when 'task_send' then private.feed_task_send_json(z.id)
        when 'assignment_closed' then private.feed_closed_assignment_json(z.eid)
        else case when left(z.k, 1) = 'c' then private.knowledge_contribution_view(z.id)
          else private.feed_legacy_finding_json(z.id) end
      end || jsonb_build_object('type', z.t, 'key', z.k, 'at', z.at)
      order by z.at desc, z.k desc) filter (where z.rn <= v_limit), '[]'::jsonb),
    case when count(*) > v_limit then max(
      (to_char(z.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || z.k) collate "C"
    ) filter (where z.rn = v_limit) end
  into v_items, v_next
  from page z;
  return jsonb_build_object('items', v_items, 'nextCursor', v_next);
end;
$$;

-- R1: a manager account counts its own manager-era uploads, as staff count
-- theirs; anyone else still gets zeros.
create or replace function public.my_label_work()
returns table (needs_labels integer, needs_attention integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := private.amenity_assert_active_user();
begin
  if not (private.is_active_staff() or private.is_active_manager()) then
    return query select 0, 0;
    return;
  end if;
  return query
  select
    (select count(*)::integer from public.media_assets a
     where a.uploader_id = v_uid and private.asset_needs_labels(a.id)
       and (a.uploader_role = 'manager' or not private.is_active_manager())),
    (select count(*)::integer
     from public.media_pending_labels pl
     join public.media_assets a on a.id = pl.asset_id
     where pl.uploader_id = v_uid and pl.status = 'needs_attention' and a.deleted_at is null
       and (a.uploader_role = 'manager' or not private.is_active_manager()));
end;
$$;

-- The caller may already see this asset through an existing gate. A group
-- read shows a member only when this holds, so groups never widen visibility.
create or replace function private.viewer_sees_asset(p_asset_id uuid)
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
        and (
          (a.uploader_id = (select auth.uid())
            and (a.uploader_role = 'manager' or not private.is_active_manager()))
          or private.is_active_admin()
        )
    )
    or exists (select 1 from public.community_readable_assets(array[p_asset_id]))
    or exists (select 1 from public.menu_item_photo_asset(p_asset_id))
    or exists (select 1 from public.task_evidence_asset(p_asset_id))
    or exists (select 1 from public.amenity_evidence_asset(p_asset_id))
  );
$$;

-- Adds the caller's own assets (any upload state, not deleted, at the group's
-- venue) in the order given. An asset already in this group is skipped; one
-- in another group is asset_in_other_group. Returns the group's member count.
create or replace function public.contribution_group_add(p_group_id uuid, p_asset_ids uuid[])
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
    if v_asset.uploader_id <> v_uid
       or (private.is_active_manager() and v_asset.uploader_role is distinct from 'manager') then
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

-- create or replace keeps privileges; restated.
revoke all on function
  private.feed_photo_json(uuid),
  private.viewer_sees_asset(uuid)
from public, anon, authenticated;
revoke all on function
  public.my_contributions_feed(text, integer),
  public.my_label_work(),
  public.contribution_group_add(uuid, uuid[])
from public, anon, service_role;
grant execute on function
  public.my_contributions_feed(text, integer),
  public.my_label_work(),
  public.contribution_group_add(uuid, uuid[])
to authenticated;
