-- B02-a, part 1: reads for coherent staff and manager work
-- (docs/knowledge/b02-design.md R1, R3, R4, R5, R6, R7, R8, R9 and §7.1).
--
-- * New reads, each one STABLE statement (B01 T9b): my_label_work (R1),
--   manager_triage_summary (R3), my_contributions_feed (R5, with R6 task
--   revisions and R7 menuUseAccepted), my_venue_capabilities (R8) and
--   my_asset_delete_impact (R9, with private.asset_removal_effects).
-- * Re-created (§7.1): public.knowledge_to_confirm gains waitingSince on every
--   item and is ordered by it. Every other key keeps its B01 meaning.
-- * Nothing else existing is re-created. The reads call or restate the
--   existing predicates: the credit-input trigger
--   media_assets_amenity_evidence_lost, media_assets_knowledge_evidence_withdrawn,
--   save_media_labels_as, the coverage manager-deny triggers, the menu-photo
--   queue and overview and venue_coverage_summary are untouched.
-- * No function here writes. No credit input changes.
-- * One additive index for the R5 task-send branch.
--
-- Rollback: the UI switches off homeLayout, managerTriage and myContributions;
-- drop the new functions and the index; a forward migration restores the B01
-- body of knowledge_to_confirm (20261109145934_knowledge_b01_functions.sql),
-- whose keys are a subset of this one. Nothing here rewrites or deletes data.

-- ---------------------------------------------------------------------------
-- Venue for a manager read
-- ---------------------------------------------------------------------------

-- A manager account or a staff grant holder reads its grant venue (any other
-- id is wrong_venue); an admin names one. Anyone else is not_venue_manager.
create function private.manager_read_venue(p_venue_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_grant uuid;
begin
  perform private.amenity_assert_active_user();
  if private.is_active_admin() then
    if p_venue_id is null then
      raise exception 'venue_required' using errcode = '22023';
    end if;
    if not exists (select 1 from public.venues v where v.id = p_venue_id) then
      raise exception 'venue_not_found' using errcode = 'P0002';
    end if;
    return p_venue_id;
  end if;
  v_grant := private.my_manager_venue_id();
  if v_grant is null then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  if p_venue_id is not null and p_venue_id <> v_grant then
    raise exception 'wrong_venue' using errcode = '42501';
  end if;
  return v_grant;
end;
$$;

-- ---------------------------------------------------------------------------
-- R1. Labels-needed count
-- ---------------------------------------------------------------------------

-- Me's rule (D-12), once: a ready own photo needs labels while its labels have
-- no menu item and no content type (media_labels.has_labels). A note or a
-- missing-item report alone still needs labels. Amenity evidence is never
-- labelled.
create function private.asset_needs_labels(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.media_assets a
    where a.id = p_asset_id
      and a.deleted_at is null
      and a.upload_state = 'ready'
      and a.purpose = 'general'
      and not exists (
        select 1 from public.media_labels l where l.asset_id = a.id and l.has_labels
      )
  );
$$;

-- Labelling is staff (own uploads) and admin only today, and an admin has no
-- own label work, so only active staff get counts; anyone else gets zeros.
create function public.my_label_work()
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
  if not private.is_active_staff() then
    return query select 0, 0;
    return;
  end if;
  return query
  select
    (select count(*)::integer from public.media_assets a
     where a.uploader_id = v_uid and private.asset_needs_labels(a.id)),
    (select count(*)::integer
     from public.media_pending_labels pl
     join public.media_assets a on a.id = pl.asset_id
     where pl.uploader_id = v_uid and pl.status = 'needs_attention' and a.deleted_at is null);
end;
$$;

-- ---------------------------------------------------------------------------
-- R4. To confirm: waitingSince on every item, ordered by it (re-created)
-- ---------------------------------------------------------------------------

-- B01 body (20261109145934) plus waitingSince: a finding's send time, an
-- answer's send time, or for evidence_withdrawn and confirmation_revoked rows
-- the time of that event. Ordering by it moves those two kinds to their event
-- time; findings keep their order.
create or replace function public.knowledge_to_confirm(p_venue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue uuid := coalesce(p_venue_id, private.my_manager_venue_id());
  v_items jsonb;
begin
  perform private.amenity_assert_active_user();
  perform private.assert_can_manage_venue(v_venue);
  select coalesce(jsonb_agg(q.i order by q.waiting, q.i ->> 'checkId', q.i -> 'findingRef' ->> 'id'), '[]'::jsonb)
  into v_items
  from (
    select jsonb_build_object(
      'checkId', c.id, 'questionKey', c.template_key, 'question', t.question,
      'findingRef', jsonb_build_object('type', 'contribution', 'id', x.id),
      'kind', x.kind, 'answer', x.answer, 'senderName', p.display_name, 'sentAt', x.created_at,
      'waitingSince', x.created_at,
      'slotRevision', st.revision,
      'conflict', (
        select count(*) from public.knowledge_contributions y
        where y.check_id = c.id and y.answer <> 'unknown' and not private.knowledge_is_terminal(y.id)
      ) > 1 or (st.current_answer is not null and c.progress = 'complete' and x.answer is distinct from st.current_answer),
      -- The resolver's dispute test for this one finding (Couldn't establish included).
      'disputes', st.current_submission_id is not null and c.progress = 'complete'
        and x.answer is distinct from st.current_answer
    ) as i,
    x.created_at as waiting
    from public.venue_amenity_checks c
    join public.amenity_catalogue t on t.key = c.template_key
    join public.knowledge_contributions x on x.check_id = c.id
    join public.profiles p on p.id = x.contributed_by
    cross join lateral private.knowledge_slot_state(c.venue_id, array[c.template_key]) st
    where c.venue_id = v_venue and st.in_scope and not private.knowledge_is_terminal(x.id)
    union all
    select jsonb_build_object(
      'checkId', c.id, 'questionKey', c.template_key, 'question', t.question,
      'findingRef', jsonb_build_object('type', 'submission', 'id', st.current_submission_id),
      'kind', case when st.detail = 'evidence_withdrawn' then 'evidence_withdrawn' else 'answer_awaiting_confirmation' end,
      'answer', st.current_answer, 'senderName', p.display_name, 'sentAt', st.sent_at,
      'waitingSince', w.at,
      'slotRevision', st.revision, 'conflict', false, 'disputes', false
    ),
    w.at
    from public.venue_amenity_checks c
    join public.amenity_catalogue t on t.key = c.template_key
    cross join lateral private.knowledge_slot_state(c.venue_id, array[c.template_key]) st
    left join public.profiles p on p.id = c.answered_by
    cross join lateral (
      select coalesce(case st.detail
        when 'evidence_withdrawn' then (
          select max(e.created_at) from public.knowledge_events e
          where e.check_id = c.id and e.kind = 'evidence_withdrawn'
            and e.submission_id = st.current_submission_id)
        when 'confirmation_revoked' then (
          select max(d.created_at) from public.knowledge_decisions d
          where d.submission_id = st.current_submission_id and d.decision = 'revoked')
      end, st.sent_at) as at
    ) w
    where c.venue_id = v_venue and st.in_scope and c.progress = 'complete'
      and (st.detail in ('pending', 'evidence_withdrawn', 'confirmation_revoked'))
  ) q;
  return jsonb_build_object('count', jsonb_array_length(v_items), 'items', v_items);
end;
$$;

-- ---------------------------------------------------------------------------
-- R3. Manager triage: one row per queue, never summed
-- ---------------------------------------------------------------------------

-- Each queue's numbers come from the existing read for it, called only when
-- the caller can act on that queue, so a refusal inside it never reaches the
-- caller. All three reads are STABLE, so the rows share this call's snapshot.
create function public.manager_triage_summary(p_venue_id uuid default null)
returns table (
  queue text,
  available boolean,
  waiting integer,
  oldest_waiting_at timestamptz,
  own_waiting integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_venue uuid := private.manager_read_venue(p_venue_id);
  v_basis text := private.knowledge_basis(v_venue);
  v_confirm jsonb;
begin
  if private.can_manage_venue(v_venue) then
    return query
    select 'menu_photos'::text, true, o.pending_photos, o.oldest_pending_at, o.own_waiting_photos
    from public.manager_menu_photo_overview(v_venue) o;
  else
    return query select 'menu_photos'::text, false, null::integer, null::timestamptz, null::integer;
  end if;

  if v_basis in ('venue_manager', 'admin') then
    v_confirm := public.knowledge_to_confirm(v_venue);
    return query
    select 'findings'::text, true, (v_confirm ->> 'count')::integer,
      (select min((i ->> 'waitingSince')::timestamptz) from jsonb_array_elements(v_confirm -> 'items') i),
      null::integer;
  else
    return query select 'findings'::text, false, null::integer, null::timestamptz, null::integer;
  end if;

  -- Checklist review is closed to manager accounts (the coverage manager-deny
  -- triggers). The oldest time uses the pending predicate of
  -- venue_coverage_summary, which has no oldest column.
  if private.can_manage_venue(v_venue) and not private.is_active_manager() then
    return query
    select 'checklist'::text, true, s.pending_review_count, (
        select min(i.submitted_at)
        from public.coverage_submission_items i
        join public.media_assets a on a.id = i.asset_id
        where i.venue_id = v_venue and i.state = 'submitted'
          and a.upload_state = 'ready' and a.deleted_at is null
      ), null::integer
    from public.venue_coverage_summary(v_venue) s;
  else
    return query select 'checklist'::text, false, null::integer, null::timestamptz, null::integer;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- R5. My contributions: one cursor over photos, task sends and findings
-- ---------------------------------------------------------------------------

-- One own photo (R5 photo row; R7 menuUseAccepted). Live menu decisions only:
-- withdrawn and invalidated rows are history. The row's revision counter is an
-- optimistic lock, never a version, so it is not returned (R6).
create function private.feed_photo_json(p_asset_id uuid)
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
      select jsonb_agg(jsonb_build_object(
          'photoId', m.id, 'itemId', m.item_id, 'itemName', m.item_name,
          'variantName', m.variant_name, 'state', m.state, 'reason', m.reason,
          'decidedAt', m.decided_at)
        order by m.decided_at desc, m.id desc)
      from public.menu_item_photos m
      where m.asset_id = a.id and m.state not in ('withdrawn', 'invalidated')
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

-- One own task send (R5 task_send row). revision is the item's position in
-- its replacement chain (R6): 1 for an original. Each item is replaced at
-- most once (its trigger), so the walk is a line; it is bounded anyway.
create function private.feed_task_send_json(p_item_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with recursive chain (id, replaces, depth) as (
    select i.id, i.replaces_item_id, 1
    from public.coverage_submission_items i where i.id = p_item_id
    union all
    select p.id, p.replaces_item_id, ch.depth + 1
    from chain ch
    join public.coverage_submission_items p on p.id = ch.replaces
    where ch.depth < 100
  )
  select jsonb_build_object(
    'itemId', i.id,
    'submissionId', i.submission_id,
    'requirementId', i.requirement_id,
    'requirementTitle', r.title,
    'venueId', i.venue_id,
    'venueName', v.name,
    'assetId', i.asset_id,
    'assetAvailable', a.deleted_at is null and a.upload_state = 'ready',
    'state', i.state,
    'reason', i.decision_reason,
    'decidedAt', i.decided_at,
    'archived', i.archived_at is not null,
    'sentAt', i.submitted_at,
    'replacesItemId', i.replaces_item_id,
    'replacesSentAt', prev.submitted_at,
    'revision', (select max(ch.depth) from chain ch)
  )
  from public.coverage_submission_items i
  join public.venues v on v.id = i.venue_id
  join public.media_assets a on a.id = i.asset_id
  left join public.coverage_requirements r on r.id = i.requirement_id
  left join public.coverage_submission_items prev on prev.id = i.replaces_item_id
  where i.id = p_item_id;
$$;

-- A pre-B01 answer, exactly as knowledge_my_contributions shows it.
create function private.feed_legacy_finding_json(p_submission_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'findingRef', jsonb_build_object('type', 'submission', 'id', s.id),
    'checkId', s.check_id, 'venueId', s.venue_id, 'venueName', v.name,
    'questionKey', c.template_key, 'question', t.question, 'kind', 'finding',
    'answer', s.answer, 'sentAt', s.created_at,
    'state', case when c.current_submission_id = s.id and c.progress = 'complete' and c.status = 'active'
      then 'current' else 'no_longer_used' end,
    'recognition', private.knowledge_submission_scored(s.id)
  )
  from public.amenity_submissions s
  join public.venue_amenity_checks c on c.id = s.check_id
  join public.venues v on v.id = s.venue_id
  join public.amenity_catalogue t on t.key = c.template_key
  where s.id = p_submission_id;
$$;

-- A closed assignment, exactly as knowledge_my_contributions shows it.
create function private.feed_closed_assignment_json(p_event_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'kind', 'assignment_closed', 'state', 'assignment_closed', 'checkId', e.check_id,
    'venueId', e.venue_id, 'questionKey', e.question_key, 'question', t.question,
    'answeredBy', bp.display_name, 'sentAt', e.created_at)
  from public.knowledge_events e
  join public.amenity_catalogue t on t.key = e.question_key
  left join public.profiles bp on bp.id = (e.detail ->> 'answeredBy')::uuid
  where e.id = p_event_id;
$$;

-- The caller's own records across venues, newest first by creation (send)
-- time, which never changes, so rows never move between pages (OD-4). The
-- cursor is the previous page's nextCursor, "<UTC instant>|<key>"; keys are
-- p: photo, t: task send, and B01's c:, s:, e:. Each branch is cut to
-- p_limit + 1 rows before the union, and only the page's rows are built.
create function public.my_contributions_feed(p_cursor text, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
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

-- The task-send branch reads the caller's sends newest first.
create index coverage_submission_items_submitter_idx
  on public.coverage_submission_items (submitted_by, submitted_at desc, id desc)
  where origin = 'submitted';

-- ---------------------------------------------------------------------------
-- R8. What the caller may do at a venue
-- ---------------------------------------------------------------------------

-- Reports what the write gates allow; no gate consults it, so a wrong value
-- can hide a choice but never grant one. Named predicates are called. Two
-- rules exist only inline and are restated here: the label role allow-list
-- of private.save_media_labels_as (staff and admin) and the coverage
-- manager-deny triggers (no manager account). The R8 equivalence tests run
-- the real writes, so a gate change fails them until this read follows.
create function public.my_venue_capabilities(p_venue_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_role text;
  v_admin boolean := private.is_active_admin();
  v_grant uuid := private.my_manager_venue_id();
  v_kind text;
  v_venue uuid;
  v_basis text;
  v_manage boolean;
begin
  select p.role::text into v_role from public.profiles p where p.id = v_uid;
  v_kind := case
    when v_admin then 'admin'
    when v_role = 'manager' then 'manager'
    when v_grant is not null then 'staff_with_grant'
    else 'staff'
  end;
  if v_admin then
    if p_venue_id is null then
      raise exception 'venue_required' using errcode = '22023';
    end if;
    if not exists (select 1 from public.venues v where v.id = p_venue_id) then
      raise exception 'venue_not_found' using errcode = 'P0002';
    end if;
    v_venue := p_venue_id;
  else
    v_venue := coalesce(v_grant, private.active_staff_venue_id());
    if p_venue_id is not null and p_venue_id is distinct from v_venue then
      raise exception 'wrong_venue' using errcode = '42501';
    end if;
  end if;
  v_basis := private.knowledge_basis(v_venue);
  v_manage := coalesce(private.can_manage_venue(v_venue), false);
  return jsonb_build_object(
    'accountKind', v_kind,
    'venueId', v_venue,
    'canUpload', v_venue is not null and coalesce(private.uploadable_venue_id() = v_venue, false),
    'canLabel', coalesce(v_role in ('staff', 'admin'), false),
    'canSendFindings', v_basis is not null and exists (
      select 1 from public.knowledge_working_list w where w.venue_id = v_venue and w.disabled_at is null
    ),
    'canConfirmFindings', coalesce(v_basis in ('venue_manager', 'admin'), false),
    'canSelfConfirm', coalesce((
      select jsonb_object_agg(w.question_key,
        coalesce(v_basis in ('venue_manager', 'admin'), false)
        and (coalesce(r.confirmation, 'none') = 'none' or coalesce(r.self_confirmation_allowed, false)))
      from public.knowledge_working_list w
      left join lateral (select x.* from private.knowledge_rule(w.question_key) x) r on true
      where w.venue_id = v_venue and w.disabled_at is null
    ), '{}'::jsonb),
    'canReviewMenuPhotos', v_manage,
    'canDecideOwnMenuPhoto', v_manage
      and private.menu_photo_reviewable_uploader(v_uid, v_admin)
      and not private.menu_photo_self_blocked(v_uid),
    'canReviewChecklist', v_manage and not private.is_active_manager(),
    'canBeAssigned', v_venue is not null and exists (
      select 1 from public.profiles p
      where p.id = v_uid and p.active and p.role = 'staff' and p.venue_id = v_venue
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- R9. What deleting a photo would do
-- ---------------------------------------------------------------------------

-- Predicts, with the triggers' own predicates, what removing the asset does:
-- * answer_in_use: each check whose current submission uses the asset. The
--   legacy evidence-lost trigger (a credit input) moves a complete Yes whose
--   remaining ready evidence misses the submission's rule to needs_recheck,
--   on or off the working list; otherwise the B01 trigger records
--   evidence_withdrawn for a working-list slot; otherwise nothing changes.
-- * pending_finding: each undecided contribution using it (anyone's).
-- * earlier_answer: the viewer's own non-current submissions using it.
-- Neither trigger is re-created; the predict-then-delete tests guard drift.
create function private.asset_removal_effects(p_asset_id uuid, p_viewer uuid)
returns table (
  kind text,
  effect text,
  venue_id uuid,
  check_id uuid,
  question_key text,
  yours boolean,
  contribution_id uuid,
  submission_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select 'answer_in_use'::text,
    case
      when c.progress = 'complete' and c.answer = 'yes' and not private.amenity_rule_met(s.evidence_rule, array(
          select x.evidence_kind
          from public.amenity_submission_assets x
          join public.media_assets a on a.id = x.asset_id
          where x.submission_id = c.current_submission_id
            and a.id <> p_asset_id and a.deleted_at is null and a.upload_state = 'ready'))
        then 'needs_recheck'
      when private.knowledge_in_scope(c.venue_id, c.template_key) then 'withdrawn'
      else 'none'
    end,
    c.venue_id, c.id, c.template_key, s.submitted_by = p_viewer, null::uuid, s.id
  from public.amenity_submission_assets sa
  join public.venue_amenity_checks c on c.current_submission_id = sa.submission_id
  join public.amenity_submissions s on s.id = sa.submission_id
  where sa.asset_id = p_asset_id
  union all
  select 'pending_finding', 'pending_loses_evidence', x.venue_id, x.check_id, x.question_key,
    x.contributed_by = p_viewer, x.id, null::uuid
  from public.knowledge_contribution_assets ka
  join public.knowledge_contributions x on x.id = ka.contribution_id
  where ka.asset_id = p_asset_id and not private.knowledge_is_terminal(x.id)
  union all
  select 'earlier_answer', 'none', s.venue_id, s.check_id, c.template_key, true, null::uuid, s.id
  from public.amenity_submission_assets sa
  join public.amenity_submissions s on s.id = sa.submission_id
  join public.venue_amenity_checks c on c.id = s.check_id
  where sa.asset_id = p_asset_id and s.submitted_by = p_viewer
    and c.current_submission_id is distinct from s.id;
$$;

-- The uploader only, while active staff (the staff rule of delete_media_asset);
-- anyone else, and an unknown or deleted asset, get media_asset_not_found.
-- Items name the venue and the catalogue question, never a person, answer
-- value, finding text or note. Advisory: a manager may act before the delete.
create function public.my_asset_delete_impact(p_asset_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
begin
  if not private.is_active_staff() or not exists (
    select 1 from public.media_assets a
    where a.id = p_asset_id and a.uploader_id = v_uid and a.deleted_at is null
  ) then
    raise exception 'media_asset_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'assetId', p_asset_id,
    'impacts', coalesce((
      select jsonb_agg(jsonb_build_object(
          'kind', e.kind, 'effect', e.effect, 'venueId', e.venue_id, 'venueName', v.name,
          'checkId', e.check_id, 'questionKey', e.question_key, 'question', t.question,
          'yours', e.yours)
          || case when e.kind = 'pending_finding' and e.yours then jsonb_build_object(
            'findingRef', jsonb_build_object('type', 'contribution', 'id', e.contribution_id))
            else '{}'::jsonb end
        order by array_position(array['answer_in_use', 'pending_finding', 'earlier_answer'], e.kind),
          v.name, t.question, e.check_id, coalesce(e.contribution_id, e.submission_id))
      from private.asset_removal_effects(p_asset_id, v_uid) e
      join public.venues v on v.id = e.venue_id
      join public.amenity_catalogue t on t.key = e.question_key
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.manager_read_venue(uuid),
  private.asset_needs_labels(uuid),
  private.feed_photo_json(uuid),
  private.feed_task_send_json(uuid),
  private.feed_legacy_finding_json(uuid),
  private.feed_closed_assignment_json(bigint),
  private.asset_removal_effects(uuid, uuid)
from public, anon, authenticated;

revoke all on function
  public.my_label_work(),
  public.knowledge_to_confirm(uuid),
  public.manager_triage_summary(uuid),
  public.my_contributions_feed(text, integer),
  public.my_venue_capabilities(uuid),
  public.my_asset_delete_impact(uuid)
from public, anon, service_role;

grant execute on function
  public.my_label_work(),
  public.knowledge_to_confirm(uuid),
  public.manager_triage_summary(uuid),
  public.my_contributions_feed(text, integer),
  public.my_venue_capabilities(uuid),
  public.my_asset_delete_impact(uuid)
to authenticated;
