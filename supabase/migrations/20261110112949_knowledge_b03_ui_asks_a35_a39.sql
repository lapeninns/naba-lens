-- B03 UI asks A35 to A39 (docs/knowledge/b03-design.md §14), after B03-g.
--
-- * A35: public.my_venue_capabilities (B03-g body) gains canStatePolicy
--   (manager, staff holding a grant, or admin at the venue), canStateOrgPolicy
--   (admin) and policyBasis ('venue_manager', 'admin' or null).
-- * A36: no change. An incomplete policy is accepted when sent, decided by
--   its rule, and reads not_confirmed / policy_incomplete with policyMissing
--   until complete.
-- * A37: private.knowledge_detail_venue_problems_for (M1 body) checks a
--   policy's authority against the sender: staff may not send an authority,
--   authority.basis must be the sender's own basis, and only an admin may set
--   policyScope 'organisation'. Refusals are invalid_value field paths.
-- * A38: public.knowledge_value_list (B03-c body) also returns retired items,
--   under 'retired', so an old answer can name them; 'items' is unchanged.
-- * A39: private.amenity_check_rows_presented (B03-d body) presents an
--   incomplete policy answer like a qualified one: needs_recheck, its own
--   recheck_reason and qualification 'policy_incomplete'. The stored row is
--   unchanged; Reopen and the staff task list follow qualification (B03-c).
-- * Not touched: the credit trigger, the evidence-withdrawn trigger, the
--   credit functions, the resolver, amenity_my_checks.
--
-- Rollback: a forward migration restores the earlier bodies.

create or replace function private.knowledge_detail_venue_problems_for(
  p_venue_id uuid, p_key text, p_schema text, p_features jsonb, p_headline text, p_detail jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_ref record;
  v_entrances uuid[];
  v_listed jsonb;
  v_basis text;
  v_key text;
  v_i integer;
begin
  -- Presence and Wi-Fi carry no places or entrances: nothing to check.
  if p_schema is null or p_schema not in ('facility', 'accessibility', 'policy') then
    return v_out;
  end if;
  if p_detail is null or jsonb_typeof(p_detail) <> 'object' then
    p_detail := '{}'::jsonb;
  end if;
  v_listed := private.knowledge_json_array(p_detail -> 'entrances');
  -- A37: a policy's authority and scope must be the sender's own: staff
  -- observe (no authority), a venue manager states as venue_manager, an
  -- admin as admin; only an admin states a policy for every venue.
  if p_schema = 'policy' then
    v_basis := private.knowledge_basis(p_venue_id);
    if p_detail ? 'authority' and coalesce(v_basis, 'staff') not in ('venue_manager', 'admin') then
      v_out := v_out || jsonb_build_object('path', 'detail.authority', 'problem', 'not_allowed');
    elsif jsonb_typeof(p_detail -> 'authority') = 'object' and p_detail -> 'authority' ? 'basis'
          and p_detail -> 'authority' ->> 'basis' is distinct from v_basis then
      v_out := v_out || jsonb_build_object('path', 'detail.authority.basis', 'problem', 'not_allowed');
    end if;
    if p_detail ->> 'policyScope' = 'organisation' and v_basis is distinct from 'admin' then
      v_out := v_out || jsonb_build_object('path', 'detail.policyScope', 'problem', 'not_allowed');
    end if;
  end if;
  if p_schema = 'accessibility' then
    if jsonb_typeof(p_detail -> 'features') = 'object' then
      for v_key in select k from jsonb_object_keys(p_detail -> 'features') k order by k collate "C" loop
        if not exists (select 1 from jsonb_array_elements(private.knowledge_json_array(p_features)) f where f ->> 'key' = v_key) then
          v_out := v_out || jsonb_build_object('path', 'detail.features.' || v_key, 'problem', 'not_allowed');
        end if;
      end loop;
    end if;
    for v_i in 0 .. jsonb_array_length(private.knowledge_json_array(p_detail -> 'measurements')) - 1 loop
      if jsonb_typeof(p_detail -> 'measurements' -> v_i -> 'feature') = 'string' and not exists (
        select 1 from jsonb_array_elements(private.knowledge_json_array(p_features)) f
        where f ->> 'key' = p_detail -> 'measurements' -> v_i ->> 'feature' and (f ->> 'measurable')::boolean
      ) then
        v_out := v_out || jsonb_build_object('path', format('detail.measurements[%s].feature', v_i), 'problem', 'not_allowed');
      end if;
    end loop;
  end if;
  for v_ref in
    select format('detail.locations[%s]', o - 1) as path, e ->> 'subjectId' as id
    from jsonb_array_elements(private.knowledge_json_array(p_detail -> 'locations')) with ordinality as l(e, o)
    where jsonb_typeof(e) = 'object' and e ? 'subjectId'
    union all
    select 'detail.scope', p_detail -> 'scope' ->> 'subjectId'
    where jsonb_typeof(p_detail -> 'scope') = 'object' and p_detail -> 'scope' ? 'subjectId'
    union all
    select format('detail.entrances[%s]', o - 1), e ->> 'subjectId'
    from jsonb_array_elements(v_listed) with ordinality as l(e, o)
    where jsonb_typeof(e) = 'object'
    union all
    select format('detail.zones[%s]', o - 1), e ->> 'subjectId'
    from jsonb_array_elements(private.knowledge_json_array(p_detail -> 'zones')) with ordinality as l(e, o)
    where jsonb_typeof(e) = 'object' and e ? 'subjectId'
  loop
    if not exists (
      select 1 from public.knowledge_subjects s
      where s.id::text = v_ref.id and s.venue_id = p_venue_id and s.retired_at is null
    ) then
      v_out := v_out || jsonb_build_object('path', v_ref.path, 'problem', 'unknown_subject');
    end if;
  end loop;

  -- The step-free rule (§4.3, A18) applies only to an accessibility answer.
  if p_schema = 'accessibility' and p_key = 'step_free_entrance' and p_headline in ('yes', 'no') then
    v_entrances := array(
      select s.id from public.knowledge_subjects s
      where s.venue_id = p_venue_id and s.kind = 'entrance' and s.retired_at is null
    );
    if p_headline = 'yes' and not exists (
      select 1 from jsonb_array_elements(v_listed) e where e ->> 'stepFree' = 'yes'
    ) then
      v_out := v_out || jsonb_build_object('path', 'detail.entrances', 'problem', 'required');
    elsif p_headline = 'no' and cardinality(v_entrances) = 0 then
      v_out := v_out || jsonb_build_object('path', 'detail.entrances', 'problem', 'no_entrances_listed');
    elsif p_headline = 'no' and exists (
      select 1 from unnest(v_entrances) id
      where not exists (
        select 1 from jsonb_array_elements(v_listed) e
        where e ->> 'subjectId' = id::text and e ->> 'stepFree' = 'no'
      )
    ) then
      v_out := v_out || jsonb_build_object('path', 'detail.entrances', 'problem', 'required');
    end if;
  end if;
  return v_out;
end;
$$;

create or replace function public.my_venue_capabilities(p_venue_id uuid default null)
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
    'canLabel', coalesce(v_role in ('staff', 'admin') or (v_role = 'manager' and v_grant = v_venue), false),
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
    'canManagePlaces', v_manage,
    -- B03-g (A1, §9.1, OD-18): a manager account or an admin, never a staff
    -- account holding a legacy grant (credit participants).
    'canCorrect', v_manage and (v_admin or v_role = 'manager'),
    'canWithdraw', v_manage and (v_admin or v_role = 'manager'),
    'canReadHistory', coalesce(v_basis in ('venue_manager', 'admin'), false),
    -- A35: who may state a policy with authority, and on which basis (a staff
    -- account holding a legacy grant states as venue_manager); only an admin
    -- states one for every venue.
    'canStatePolicy', coalesce(v_basis in ('venue_manager', 'admin'), false),
    'canStateOrgPolicy', v_admin,
    'policyBasis', case when v_basis in ('venue_manager', 'admin') then v_basis end,
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

create or replace function public.knowledge_value_list(p_list text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.amenity_assert_active_user();
  if p_list is null or p_list not in ('policy_condition_types', 'policy_exception_types', 'broadcasters') then
    raise exception 'invalid_value_list' using errcode = '22023';
  end if;
  return jsonb_build_object('list', p_list, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('code', i.code, 'label', i.label,
        'needsValue', i.needs_value, 'valueKind', i.value_kind)
      order by i.position, i.code)
    from public.knowledge_value_list_items i
    where i.list = p_list and i.retired_at is null
  ), '[]'::jsonb),
  -- A38: retired items, never offered, so old answers can still name them.
  'retired', coalesce((
    select jsonb_agg(jsonb_build_object('code', i.code, 'label', i.label,
        'needsValue', i.needs_value, 'valueKind', i.value_kind, 'retiredAt', i.retired_at)
      order by i.position, i.code)
    from public.knowledge_value_list_items i
    where i.list = p_list and i.retired_at is not null
  ), '[]'::jsonb));
end;
$$;

create or replace view private.amenity_check_rows_presented as
  select r.id, r.venue_id, r.template_key, r.category, r.question, r.capture_brief, r.evidence_rule,
    r.is_core, r.position, r.catalogue_version, r.status,
    case when q.qualification is null then r.progress else 'needs_recheck' end as progress,
    r.answer, r.current_submission_id, r.assignee_user_id, r.assignee_name,
    r.answered_by, r.answered_by_name, r.answered_at,
    case q.qualification
      when 'conditional' then 'The answer in use has conditions. Open the check to see them.'
      when 'temporarily_unavailable' then 'The answer in use is temporarily unavailable. Open the check to see until when.'
      when 'policy_incomplete' then 'The policy in use is not complete yet. Open the check to see what it still needs.'
      else r.recheck_reason
    end as recheck_reason,
    r.notes, r.revision, r.updated_at, q.qualification
  from private.amenity_check_rows r
  left join public.amenity_submissions s on s.id = r.current_submission_id
  left join public.knowledge_contribution_details kd on kd.contribution_id = s.source_contribution_id
  -- A39: an incomplete policy answer first (the resolver's precedence),
  -- then a qualified one.
  cross join lateral (
    select case
      when r.progress <> 'complete' then null
      when kd.value_schema = 'policy'
        and jsonb_array_length(coalesce(private.knowledge_policy_complete(r.id), '[]'::jsonb)) > 0
        then 'policy_incomplete'
      else private.knowledge_qualifier(kd.value_schema, r.answer, kd.detail)
    end as qualification
  ) q;

revoke all on private.amenity_check_rows_presented from public, anon, authenticated;
revoke all on function private.knowledge_detail_venue_problems_for(uuid, text, text, jsonb, text, jsonb)
from public, anon, authenticated;
revoke all on function public.my_venue_capabilities(uuid), public.knowledge_value_list(text)
from public, anon, service_role;
grant execute on function public.my_venue_capabilities(uuid), public.knowledge_value_list(text) to authenticated;
