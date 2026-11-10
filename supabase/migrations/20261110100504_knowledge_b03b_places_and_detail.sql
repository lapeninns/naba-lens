-- B03-b: places (subjects) and structured detail on contributions
-- (docs/knowledge/b03-design.md §4, §12 batch B03-b, §14 A1, A2, A10, A18).
--
-- * public.knowledge_subjects: a venue's entrances, routes, areas, rooms and
--   facility points, added and retired by its manager or an admin, never
--   deleted. Reads: public.knowledge_subjects. Writes:
--   knowledge_subject_add and knowledge_subject_retire, keyed through the new
--   append-only public.knowledge_write_commands (B02 R10's replay rule).
-- * public.knowledge_contribution_details: append-only structured detail and
--   observation date per contribution. A new knowledge_submit overload (19
--   arguments) validates them and calls the existing 16-argument
--   knowledge_submit unchanged, in the same transaction; the old signatures
--   stay.
-- * private.knowledge_validate_value (B03-a) is re-created with the facility
--   and accessibility shapes. Temporarily unavailable stays refused until
--   B03-c re-creates the consumers (§3.8 gate).
-- * private.knowledge_detail_venue_problems: subjects must be the venue's
--   active places; the step-free headline rule (§4.3, A18) is checked at send.
-- * Re-created with additive keys only: private.knowledge_slot_json
--   (answerInUse.detail, detailRecorded and observedOn; freshness reading
--   unrated), public.knowledge_check
--   (pending findings' detail and observation date) and
--   public.my_venue_capabilities (canManagePlaces).
-- * Inert: every key is still on registry version 1 (presence or
--   connectivity.wifi), which allows no detail, so any detail is refused
--   until OD-12 adds detail versions. The resolver, the v1 reader and every
--   credit input are untouched.
--
-- Rollback: clients call the old knowledge_submit signatures; a forward
-- migration restores the B01 knowledge_slot_json, the B02 knowledge_check
-- and my_venue_capabilities bodies and the B03-a validator. Tables stay.

-- ---------------------------------------------------------------------------
-- Places
-- ---------------------------------------------------------------------------

create table public.knowledge_subjects (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  kind text not null check (kind in ('entrance', 'route', 'area', 'room', 'facility_point')),
  label text not null check (length(label) between 1 and 80 and label = btrim(label)),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  retired_by uuid references public.profiles (id) on delete restrict,
  retire_reason text check (retire_reason is null or length(retire_reason) between 1 and 500),
  constraint knowledge_subjects_retired check ((retired_at is null) = (retired_by is null)),
  constraint knowledge_subjects_id_venue_key unique (id, venue_id)
);

create unique index knowledge_subjects_active_label
  on public.knowledge_subjects (venue_id, kind, lower(label)) where retired_at is null;

-- Never deleted; only the retire columns change, once.
create function private.knowledge_subjects_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     or old.retired_at is not null
     or new.id is distinct from old.id or new.venue_id is distinct from old.venue_id
     or new.kind is distinct from old.kind or new.label is distinct from old.label
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
     or new.retired_at is null then
    raise exception 'knowledge_subject_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger knowledge_subjects_guard
  before update or delete on public.knowledge_subjects
  for each row execute function private.knowledge_subjects_guard();
create trigger knowledge_subjects_no_truncate
  before truncate on public.knowledge_subjects
  for each statement execute function private.append_only_guard();

-- ---------------------------------------------------------------------------
-- Keyed B03 writes (§14.1)
-- ---------------------------------------------------------------------------

create table public.knowledge_write_commands (
  idempotency_key uuid primary key,
  actor_id uuid not null references public.profiles (id) on delete restrict,
  command text not null check (command in ('place_add', 'place_retire')),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  venue_id uuid not null references public.venues (id) on delete restrict,
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now()
);

create trigger knowledge_write_commands_append_only
  before update or delete on public.knowledge_write_commands
  for each row execute function private.append_only_guard();
create trigger knowledge_write_commands_no_truncate
  before truncate on public.knowledge_write_commands
  for each statement execute function private.append_only_guard();

create function private.knowledge_write_replay(p_key uuid, p_actor uuid, p_command text, p_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prior public.knowledge_write_commands;
begin
  if p_key is null then
    raise exception 'invalid_idempotency_key' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('nabalens_knowledge_write:' || p_key::text, 0));
  select k.* into v_prior from public.knowledge_write_commands k where k.idempotency_key = p_key;
  if not found then
    return null;
  end if;
  if v_prior.actor_id <> p_actor or v_prior.command <> p_command or v_prior.request_hash <> p_hash then
    raise exception 'idempotency_key_reused' using errcode = 'P0001';
  end if;
  return v_prior.result || jsonb_build_object('replayed', true);
end;
$$;

create function private.knowledge_write_record(
  p_key uuid, p_actor uuid, p_command text, p_hash text, p_venue_id uuid, p_result jsonb
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.knowledge_write_commands (idempotency_key, actor_id, command, request_hash, venue_id, result)
  values (p_key, p_actor, p_command, p_hash, p_venue_id, p_result);
$$;

-- The venue a place read is for: staff their own; a manager its grant venue
-- (another id is wrong_venue); an admin must name one.
create function private.knowledge_place_venue(p_venue_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_own uuid := coalesce(private.my_manager_venue_id(), private.active_staff_venue_id());
begin
  perform private.amenity_assert_active_user();
  if private.is_active_admin() then
    if p_venue_id is null then
      raise exception 'venue_required' using errcode = '22023';
    end if;
    return p_venue_id;
  end if;
  if v_own is null then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  if p_venue_id is not null and p_venue_id <> v_own then
    raise exception 'wrong_venue' using errcode = '42501';
  end if;
  return v_own;
end;
$$;

-- Staff see the venue's active places (kind and label) for the capture form;
-- managers and admins also see retired ones and who added each (a first name
-- for managers, the full name for admins).
create function public.knowledge_subjects(p_venue_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue uuid := private.knowledge_place_venue(p_venue_id);
  v_admin boolean := private.is_active_admin();
  v_manage boolean := private.can_manage_venue(v_venue);
begin
  return jsonb_build_object('venueId', v_venue, 'items', coalesce((
    select jsonb_agg(
      jsonb_build_object('subjectId', s.id, 'kind', s.kind, 'label', s.label,
        'active', s.retired_at is null)
      || case when v_manage then jsonb_build_object(
        'addedOn', s.created_at,
        'addedBy', case when v_admin then p.display_name else split_part(p.display_name, ' ', 1) end,
        'retiredOn', s.retired_at) else '{}'::jsonb end
      order by s.kind, lower(s.label), s.id)
    from public.knowledge_subjects s
    join public.profiles p on p.id = s.created_by
    where s.venue_id = v_venue and (v_manage or s.retired_at is null)
  ), '[]'::jsonb));
end;
$$;

create function public.knowledge_subject_add(
  p_venue_id uuid, p_kind text, p_label text, p_idempotency_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.knowledge_lock_actor();
  v_venue uuid := coalesce(p_venue_id, private.my_manager_venue_id());
  v_label text := private.clean_text(p_label, 80, 'invalid_label');
  v_hash text := private.knowledge_hash(jsonb_build_object('venueId', v_venue, 'kind', p_kind, 'label', v_label));
  v_prior jsonb;
  v_existing uuid;
  v_id uuid;
  v_result jsonb;
begin
  v_prior := private.knowledge_write_replay(p_idempotency_key, v_uid, 'place_add', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  perform private.assert_can_manage_venue(v_venue);
  perform private.amenity_assert_venue_active(v_venue);
  if p_kind is null or p_kind not in ('entrance', 'route', 'area', 'room', 'facility_point') then
    raise exception 'invalid_place_kind' using errcode = '22023';
  end if;
  if v_label is null then
    raise exception 'invalid_label' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('nabalens_knowledge_place:' || v_venue::text, 0));
  select s.id into v_existing from public.knowledge_subjects s
  where s.venue_id = v_venue and s.kind = p_kind and lower(s.label) = lower(v_label) and s.retired_at is null;
  if found then
    raise exception 'place_exists' using errcode = 'NLK13',
      detail = jsonb_build_object('subjectId', v_existing)::text;
  end if;
  insert into public.knowledge_subjects (venue_id, kind, label, created_by)
  values (v_venue, p_kind, v_label, v_uid)
  returning id into v_id;
  v_result := jsonb_build_object('subjectId', v_id, 'replayed', false);
  perform private.knowledge_write_record(p_idempotency_key, v_uid, 'place_add', v_hash, v_venue, v_result);
  return v_result;
end;
$$;

create function public.knowledge_subject_retire(p_subject_id uuid, p_reason text, p_idempotency_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.knowledge_lock_actor();
  v_reason text := private.clean_text(p_reason, 500, 'invalid_reason');
  v_hash text := private.knowledge_hash(jsonb_build_object('subjectId', p_subject_id, 'reason', v_reason));
  v_prior jsonb;
  v_subject public.knowledge_subjects;
  v_result jsonb;
begin
  v_prior := private.knowledge_write_replay(p_idempotency_key, v_uid, 'place_retire', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  select s.* into v_subject from public.knowledge_subjects s where s.id = p_subject_id for update;
  if not found or not private.can_manage_venue(v_subject.venue_id) then
    raise exception 'knowledge_subject_not_found' using errcode = 'P0002';
  end if;
  if v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  if v_subject.retired_at is null then
    update public.knowledge_subjects s
    set retired_at = now(), retired_by = v_uid, retire_reason = v_reason
    where s.id = v_subject.id;
  end if;
  v_result := jsonb_build_object('subjectId', v_subject.id, 'retired', true, 'replayed', false);
  perform private.knowledge_write_record(p_idempotency_key, v_uid, 'place_retire', v_hash,
    v_subject.venue_id, v_result);
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Contribution detail
-- ---------------------------------------------------------------------------

create table public.knowledge_contribution_details (
  contribution_id uuid primary key references public.knowledge_contributions (id) on delete restrict,
  venue_id uuid not null references public.venues (id) on delete restrict,
  question_version integer not null check (question_version >= 1),
  value_schema text not null,
  value_schema_version integer not null check (value_schema_version >= 1),
  detail jsonb check (detail is null or jsonb_typeof(detail) = 'object'),
  observed_on date,
  observed_on_source text check (observed_on_source in ('form_default', 'chosen')),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint knowledge_contribution_details_observed check ((observed_on is null) = (observed_on_source is null))
);

create trigger knowledge_contribution_details_append_only
  before update or delete on public.knowledge_contribution_details
  for each row execute function private.append_only_guard();
create trigger knowledge_contribution_details_no_truncate
  before truncate on public.knowledge_contribution_details
  for each statement execute function private.append_only_guard();

revoke all on public.knowledge_subjects, public.knowledge_write_commands, public.knowledge_contribution_details
from public, anon, authenticated, service_role;
grant select on public.knowledge_subjects, public.knowledge_write_commands, public.knowledge_contribution_details
to service_role;
alter table public.knowledge_subjects enable row level security;
alter table public.knowledge_write_commands enable row level security;
alter table public.knowledge_contribution_details enable row level security;

-- ---------------------------------------------------------------------------
-- Registry: family, subject type and owner role become version fields
-- (review of B03-a: everything changes by version)
-- ---------------------------------------------------------------------------

alter table public.knowledge_question_versions
  add column family text,
  add column subject_type text,
  add column owner_role text;

-- One-off backfill of the version 1 rows from the B03-a columns, inside this
-- migration only: the append-only guard is lifted for the statement and put
-- back at once. No other row changes.
alter table public.knowledge_question_versions disable trigger knowledge_question_versions_append_only;
update public.knowledge_question_versions v
set family = q.family, subject_type = q.subject_type, owner_role = q.owner_role
from public.knowledge_questions q
where q.key = v.key;
alter table public.knowledge_question_versions enable trigger knowledge_question_versions_append_only;

alter table public.knowledge_question_versions
  alter column family set not null,
  alter column subject_type set not null,
  alter column owner_role set not null,
  add constraint knowledge_question_versions_family check (family in (
    'presence', 'facility', 'accessibility', 'policy', 'service', 'schedule_event', 'connectivity'
  )),
  add constraint knowledge_question_versions_subject_type check (subject_type in ('venue')),
  add constraint knowledge_question_versions_owner_role check (owner_role in ('venue_manager', 'admin'));

alter table public.knowledge_questions
  drop column family,
  drop column subject_type,
  drop column owner_role;

-- A question row is now only its key: no update at all, no delete.
create or replace function private.knowledge_questions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'knowledge_question_immutable' using errcode = '42501';
end;
$$;

-- B03-a body, reading family, subject type and owner role from the version.
create or replace function private.knowledge_question_json(p_key text, p_version integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'key', v.key,
    'family', v.family,
    'subjectType', v.subject_type,
    'ownerRole', v.owner_role,
    'version', v.version,
    'latestVersion', (select max(x.version) from public.knowledge_question_versions x where x.key = v.key),
    'catalogueVersion', v.catalogue_version,
    'ruleVersion', v.rule_version,
    'valueSchema', jsonb_build_object('name', v.value_schema, 'version', v.value_schema_version),
    'guidance', v.guidance,
    'evidenceRule', v.evidence_rule,
    'confirmation', v.confirmation,
    'selfConfirmationAllowed', v.self_confirmation_allowed,
    'sensitivity', v.sensitivity,
    'freshness', v.freshness,
    'publishableFields', to_jsonb(v.publishable_fields),
    'materialFields', to_jsonb(v.material_fields),
    'requiresZones', v.requires_zones,
    'lifecycle', v.lifecycle,
    'supersededBy', to_jsonb(v.superseded_by),
    'effectiveFrom', v.effective_from,
    'changeKind', v.change_kind,
    'changeNote', v.change_note
  )
  from public.knowledge_question_versions v
  where v.key = p_key
    and v.version = coalesce(p_version, (
      select max(x.version) from public.knowledge_question_versions x where x.key = p_key));
$$;

-- ---------------------------------------------------------------------------
-- Value validation: facility and accessibility shapes (§3.3, §4.2, §4.3)
-- ---------------------------------------------------------------------------

-- A calendar date written YYYY-MM-DD, or null (never a cast error).
create function private.knowledge_safe_date(p_value text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or p_value !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  return p_value::date;
exception when others then
  return null;
end;
$$;

-- A place reference: exactly one of subjectId (a uuid) or label (1..80).
create function private.knowledge_place_ref_problem(p_ref jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_ref) <> 'object' then 'invalid'
    when (select count(*) from jsonb_object_keys(p_ref) k where k not in ('subjectId', 'label')) > 0 then 'invalid'
    when (p_ref ? 'subjectId') = (p_ref ? 'label') then 'invalid'
    when p_ref ? 'subjectId' then case
      when jsonb_typeof(p_ref -> 'subjectId') = 'string'
        and p_ref ->> 'subjectId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then null else 'invalid' end
    when jsonb_typeof(p_ref -> 'label') <> 'string' then 'invalid'
    when length(btrim(p_ref ->> 'label')) = 0 then 'required'
    when length(btrim(p_ref ->> 'label')) > 80 then 'too_long'
    else null
  end;
$$;

-- Shape problems of a facility or accessibility detail, as [{ path, problem }].
create function private.knowledge_detail_problems(p_schema text, p_detail jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_allowed text[] := array['locations', 'availability', 'fees', 'limitations', 'howToRequest'];
  v_key text;
  v_item jsonb;
  v_i integer;
  v_problem text;
  v_value jsonb;
  v_path text;
begin
  if jsonb_typeof(p_detail) <> 'object' then
    return jsonb_build_array(jsonb_build_object('path', 'detail', 'problem', 'invalid'));
  end if;
  if p_schema = 'accessibility' then
    v_allowed := v_allowed || array['scope', 'features', 'measurements', 'entrances'];
  end if;
  for v_key in select k from jsonb_object_keys(p_detail) k order by k collate "C" loop
    if not (v_key = any(v_allowed)) then
      v_out := v_out || jsonb_build_object('path', 'detail.' || v_key, 'problem', 'not_allowed');
    end if;
  end loop;

  if p_detail ? 'locations' then
    if jsonb_typeof(p_detail -> 'locations') <> 'array' or jsonb_array_length(p_detail -> 'locations') > 20 then
      v_out := v_out || jsonb_build_object('path', 'detail.locations', 'problem', 'invalid');
    else
      for v_i in 0 .. jsonb_array_length(p_detail -> 'locations') - 1 loop
        v_problem := private.knowledge_place_ref_problem(p_detail -> 'locations' -> v_i);
        if v_problem is not null then
          v_out := v_out || jsonb_build_object('path', format('detail.locations[%s]', v_i), 'problem', v_problem);
        end if;
      end loop;
    end if;
  end if;

  if p_detail ? 'availability' then
    v_value := p_detail -> 'availability';
    if jsonb_typeof(v_value) <> 'object'
       or (select count(*) from jsonb_object_keys(v_value) k where k not in ('state', 'until', 'note')) > 0 then
      v_out := v_out || jsonb_build_object('path', 'detail.availability', 'problem', 'invalid');
    else
      if not (v_value ? 'state') then
        v_out := v_out || jsonb_build_object('path', 'detail.availability.state', 'problem', 'required');
      elsif v_value ->> 'state' = 'temporarily_unavailable' then
        -- Refused until the consumers show it as qualified (§3.8 gate, B03-c).
        v_out := v_out || jsonb_build_object('path', 'detail.availability.state', 'problem', 'not_allowed');
      elsif jsonb_typeof(v_value -> 'state') <> 'string'
            or v_value ->> 'state' not in ('available', 'on_request', 'seasonal') then
        v_out := v_out || jsonb_build_object('path', 'detail.availability.state', 'problem', 'invalid');
      end if;
      if v_value ? 'until' and (jsonb_typeof(v_value -> 'until') <> 'string'
         or private.knowledge_safe_date(v_value ->> 'until') is null) then
        v_out := v_out || jsonb_build_object('path', 'detail.availability.until', 'problem', 'invalid');
      end if;
      if v_value ? 'note' and (jsonb_typeof(v_value -> 'note') <> 'string') then
        v_out := v_out || jsonb_build_object('path', 'detail.availability.note', 'problem', 'invalid');
      elsif length(v_value ->> 'note') > 500 then
        v_out := v_out || jsonb_build_object('path', 'detail.availability.note', 'problem', 'too_long');
      end if;
    end if;
  end if;

  if p_detail ? 'fees' then
    v_value := p_detail -> 'fees';
    if jsonb_typeof(v_value) <> 'object'
       or (select count(*) from jsonb_object_keys(v_value) k where k not in ('kind', 'amount', 'unit')) > 0 then
      v_out := v_out || jsonb_build_object('path', 'detail.fees', 'problem', 'invalid');
    else
      if not (v_value ? 'kind') then
        v_out := v_out || jsonb_build_object('path', 'detail.fees.kind', 'problem', 'required');
      elsif jsonb_typeof(v_value -> 'kind') <> 'string'
            or v_value ->> 'kind' not in ('free', 'charged', 'not_recorded') then
        v_out := v_out || jsonb_build_object('path', 'detail.fees.kind', 'problem', 'invalid');
      end if;
      if v_value ? 'amount' then
        if v_value ->> 'kind' is distinct from 'charged' then
          v_out := v_out || jsonb_build_object('path', 'detail.fees.amount', 'problem', 'not_allowed');
        elsif jsonb_typeof(v_value -> 'amount') <> 'object'
              or (select count(*) from jsonb_object_keys(v_value -> 'amount') k where k not in ('value', 'currency')) > 0
              or jsonb_typeof(v_value -> 'amount' -> 'value') is distinct from 'number'
              or v_value -> 'amount' ->> 'currency' is distinct from 'GBP' then
          v_out := v_out || jsonb_build_object('path', 'detail.fees.amount', 'problem', 'invalid');
        elsif (v_value -> 'amount' ->> 'value')::numeric not between 0 and 100000 then
          v_out := v_out || jsonb_build_object('path', 'detail.fees.amount', 'problem', 'out_of_range');
        end if;
      end if;
      if v_value ? 'unit' and jsonb_typeof(v_value -> 'unit') <> 'string' then
        v_out := v_out || jsonb_build_object('path', 'detail.fees.unit', 'problem', 'invalid');
      elsif length(v_value ->> 'unit') > 40 then
        v_out := v_out || jsonb_build_object('path', 'detail.fees.unit', 'problem', 'too_long');
      end if;
    end if;
  end if;

  foreach v_key in array array['limitations', 'howToRequest'] loop
    if p_detail ? v_key then
      if jsonb_typeof(p_detail -> v_key) <> 'string' then
        v_out := v_out || jsonb_build_object('path', 'detail.' || v_key, 'problem', 'invalid');
      elsif length(p_detail ->> v_key) > (case v_key when 'limitations' then 2000 else 500 end) then
        v_out := v_out || jsonb_build_object('path', 'detail.' || v_key, 'problem', 'too_long');
      end if;
    end if;
  end loop;

  if p_schema = 'accessibility' then
    if p_detail ? 'scope' then
      v_problem := private.knowledge_place_ref_problem(p_detail -> 'scope');
      if v_problem is not null then
        v_out := v_out || jsonb_build_object('path', 'detail.scope', 'problem', v_problem);
      end if;
    end if;
    if p_detail ? 'features' then
      if jsonb_typeof(p_detail -> 'features') <> 'object' then
        v_out := v_out || jsonb_build_object('path', 'detail.features', 'problem', 'invalid');
      else
        for v_key in select k from jsonb_object_keys(p_detail -> 'features') k order by k collate "C" loop
          if v_key !~ '^[a-z_]{1,40}$'
             or jsonb_typeof(p_detail -> 'features' -> v_key) <> 'string'
             or p_detail -> 'features' ->> v_key not in ('yes', 'no', 'not_checked') then
            v_out := v_out || jsonb_build_object('path', 'detail.features.' || v_key, 'problem', 'invalid');
          end if;
        end loop;
      end if;
    end if;
    if p_detail ? 'measurements' then
      if jsonb_typeof(p_detail -> 'measurements') <> 'array' or jsonb_array_length(p_detail -> 'measurements') > 20 then
        v_out := v_out || jsonb_build_object('path', 'detail.measurements', 'problem', 'invalid');
      else
        for v_i in 0 .. jsonb_array_length(p_detail -> 'measurements') - 1 loop
          v_item := p_detail -> 'measurements' -> v_i;
          v_path := format('detail.measurements[%s]', v_i);
          if jsonb_typeof(v_item) <> 'object'
             or (select count(*) from jsonb_object_keys(v_item) k
                 where k not in ('feature', 'value', 'unit', 'measuredOn', 'method')) > 0 then
            v_out := v_out || jsonb_build_object('path', v_path, 'problem', 'invalid');
            continue;
          end if;
          foreach v_key in array array['feature', 'value', 'unit', 'measuredOn', 'method'] loop
            if not (v_item ? v_key) then
              v_out := v_out || jsonb_build_object('path', v_path || '.' || v_key, 'problem', 'required');
            end if;
          end loop;
          if v_item ? 'feature' and (jsonb_typeof(v_item -> 'feature') <> 'string'
             or v_item ->> 'feature' !~ '^[a-z_]{1,40}$') then
            v_out := v_out || jsonb_build_object('path', v_path || '.feature', 'problem', 'invalid');
          end if;
          if v_item ? 'value' then
            if jsonb_typeof(v_item -> 'value') <> 'number' then
              v_out := v_out || jsonb_build_object('path', v_path || '.value', 'problem', 'invalid');
            elsif (v_item ->> 'value')::numeric not between 0 and 100000 then
              v_out := v_out || jsonb_build_object('path', v_path || '.value', 'problem', 'out_of_range');
            end if;
          end if;
          if v_item ? 'unit' and (jsonb_typeof(v_item -> 'unit') <> 'string'
             or v_item ->> 'unit' not in ('mm', 'cm', 'degrees')) then
            v_out := v_out || jsonb_build_object('path', v_path || '.unit', 'problem', 'invalid');
          end if;
          if v_item ? 'method' and (jsonb_typeof(v_item -> 'method') <> 'string'
             or v_item ->> 'method' not in ('tape', 'gauge', 'other')) then
            v_out := v_out || jsonb_build_object('path', v_path || '.method', 'problem', 'invalid');
          end if;
          if v_item ? 'measuredOn' then
            if jsonb_typeof(v_item -> 'measuredOn') <> 'string'
               or private.knowledge_safe_date(v_item ->> 'measuredOn') is null then
              v_out := v_out || jsonb_build_object('path', v_path || '.measuredOn', 'problem', 'invalid');
            elsif private.knowledge_safe_date(v_item ->> 'measuredOn') > private.london_today() then
              v_out := v_out || jsonb_build_object('path', v_path || '.measuredOn', 'problem', 'out_of_range');
            end if;
          end if;
        end loop;
      end if;
    end if;
    if p_detail ? 'entrances' then
      if jsonb_typeof(p_detail -> 'entrances') <> 'array' or jsonb_array_length(p_detail -> 'entrances') > 20 then
        v_out := v_out || jsonb_build_object('path', 'detail.entrances', 'problem', 'invalid');
      else
        for v_i in 0 .. jsonb_array_length(p_detail -> 'entrances') - 1 loop
          v_item := p_detail -> 'entrances' -> v_i;
          v_path := format('detail.entrances[%s]', v_i);
          if jsonb_typeof(v_item) <> 'object'
             or (select count(*) from jsonb_object_keys(v_item) k where k not in ('subjectId', 'stepFree')) > 0
             or jsonb_typeof(v_item -> 'subjectId') is distinct from 'string'
             or v_item ->> 'subjectId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
            v_out := v_out || jsonb_build_object('path', v_path, 'problem', 'invalid');
          elsif jsonb_typeof(v_item -> 'stepFree') is distinct from 'string'
                or v_item ->> 'stepFree' not in ('yes', 'no', 'not_checked') then
            v_out := v_out || jsonb_build_object('path', v_path || '.stepFree', 'problem', 'invalid');
          end if;
        end loop;
      end if;
    end if;
  end if;
  return v_out;
end;
$$;

-- B03-a body plus the facility and accessibility shapes, and jsonb null read
-- as no detail (review of B03-a). An accessibility value other than Unknown
-- needs a scope (§4.3).
create or replace function private.knowledge_validate_value(
  p_schema text, p_version integer, p_headline text, p_detail jsonb
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_fields jsonb := '[]'::jsonb;
  v_detail jsonb := null;
  v_given jsonb := case when p_detail is null or p_detail = 'null'::jsonb or p_detail = '{}'::jsonb
    then null else p_detail end;
begin
  if p_schema is null or p_version is null
     or (p_schema, p_version) not in (('presence', 1), ('connectivity.wifi', 1),
                                      ('facility', 1), ('accessibility', 1)) then
    raise exception 'unknown_value_schema' using errcode = '22023',
      detail = jsonb_build_object('schema', p_schema, 'version', p_version)::text;
  end if;

  if p_headline is null then
    v_fields := v_fields || jsonb_build_object('path', 'headline', 'problem', 'required');
  elsif p_headline not in ('yes', 'no', 'not_applicable', 'unknown') then
    v_fields := v_fields || jsonb_build_object('path', 'headline', 'problem', 'not_allowed');
  end if;

  if v_given is not null then
    if p_schema = 'presence' then
      v_fields := v_fields || jsonb_build_object('path', 'detail', 'problem', 'not_allowed');
    elsif p_schema = 'connectivity.wifi' then
      begin
        v_detail := private.amenity_wifi_metadata(v_given);
      exception when others then
        v_fields := v_fields || jsonb_build_object('path', 'detail', 'problem', 'invalid');
      end;
    else
      v_fields := v_fields || private.knowledge_detail_problems(p_schema, v_given);
      v_detail := v_given;
    end if;
  end if;

  if p_schema = 'accessibility' and p_headline is distinct from 'unknown'
     and (v_given is null or not (v_given ? 'scope')) then
    v_fields := v_fields || jsonb_build_object('path', 'detail.scope', 'problem', 'required');
  end if;

  if jsonb_array_length(v_fields) > 0 then
    raise exception 'invalid_value' using errcode = '22023',
      detail = jsonb_build_object('fields', v_fields)::text;
  end if;
  return jsonb_build_object('headline', p_headline, 'detail', v_detail);
end;
$$;

-- Problems that need the venue: places must be its active subjects, and the
-- step-free headline is checked against its entrances (§4.3, A18).
create function private.knowledge_detail_venue_problems(
  p_venue_id uuid, p_key text, p_headline text, p_detail jsonb
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
begin
  if p_detail is null or jsonb_typeof(p_detail) <> 'object' then
    p_detail := '{}'::jsonb;
  end if;
  for v_ref in
    select format('detail.locations[%s]', o - 1) as path, e ->> 'subjectId' as id
    from jsonb_array_elements(coalesce(p_detail -> 'locations', '[]'::jsonb)) with ordinality as l(e, o)
    where e ? 'subjectId'
    union all
    select 'detail.scope', p_detail -> 'scope' ->> 'subjectId' where p_detail -> 'scope' ? 'subjectId'
    union all
    select format('detail.entrances[%s]', o - 1), e ->> 'subjectId'
    from jsonb_array_elements(coalesce(p_detail -> 'entrances', '[]'::jsonb)) with ordinality as l(e, o)
  loop
    if not exists (
      select 1 from public.knowledge_subjects s
      where s.id::text = v_ref.id and s.venue_id = p_venue_id and s.retired_at is null
    ) then
      v_out := v_out || jsonb_build_object('path', v_ref.path, 'problem', 'unknown_subject');
    end if;
  end loop;

  if p_key = 'step_free_entrance' and p_headline in ('yes', 'no') then
    v_listed := coalesce(p_detail -> 'entrances', '[]'::jsonb);
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

-- ---------------------------------------------------------------------------
-- knowledge_submit with detail and observation date (§4.4, §7.2, A20)
-- ---------------------------------------------------------------------------

-- Validates the detail against the question's latest registry version and
-- the venue, and the observation date, then calls the unchanged 16-argument
-- knowledge_submit in the same transaction and stores the detail row. A
-- replay with the same key must carry the same detail and date. Wi-Fi test
-- notes stay in p_internal_metadata (B01); Wi-Fi takes no detail here.
create function public.knowledge_submit(
  p_check_id uuid,
  p_slot_revision bigint,
  p_idempotency_key uuid,
  p_kind text,
  p_answer text,
  p_finding text,
  p_limitations text,
  p_reason text,
  p_unknown_preset text,
  p_tried_text text,
  p_change_reason text,
  p_responds_to uuid,
  p_asset_ids uuid[],
  p_internal_metadata jsonb,
  p_redaction_confirmed boolean,
  p_confirm_own boolean,
  p_detail jsonb,
  p_observed_on date,
  p_observed_on_source text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.knowledge_lock_actor();
  v_check public.venue_amenity_checks;
  v_version public.knowledge_question_versions;
  v_detail jsonb := case when p_detail is null or p_detail = 'null'::jsonb or p_detail = '{}'::jsonb
    then null else p_detail end;
  v_fields jsonb := '[]'::jsonb;
  v_message text;
  v_error_detail text;
  v_hash text;
  v_result jsonb;
  v_prior public.knowledge_contribution_details;
  v_contribution uuid;
begin
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id;
  if not found or private.knowledge_basis(v_check.venue_id) is null then
    raise exception 'amenity_check_not_found' using errcode = 'P0002';
  end if;
  select v.* into v_version from public.knowledge_question_versions v
  where v.key = v_check.template_key
  order by v.version desc
  limit 1;

  -- An invalid answer is left to knowledge_submit (invalid_answer), as today.
  if p_answer in ('yes', 'no', 'not_applicable', 'unknown') then
    if v_version.value_schema = 'connectivity.wifi' then
      if v_detail is not null then
        v_fields := v_fields || jsonb_build_object('path', 'detail', 'problem', 'not_allowed');
      end if;
    else
      begin
        perform private.knowledge_validate_value(v_version.value_schema, v_version.value_schema_version,
          p_answer, v_detail);
      exception when others then
        get stacked diagnostics v_message = message_text, v_error_detail = pg_exception_detail;
        if v_message <> 'invalid_value' then
          raise;
        end if;
        v_fields := v_fields || (v_error_detail::jsonb -> 'fields');
      end;
      v_fields := v_fields || private.knowledge_detail_venue_problems(v_check.venue_id,
        v_check.template_key, p_answer, v_detail);
    end if;
  end if;

  if p_observed_on is null and p_observed_on_source is not null then
    v_fields := v_fields || jsonb_build_object('path', 'observedOn', 'problem', 'required');
  elsif p_observed_on is not null and p_observed_on_source is null then
    v_fields := v_fields || jsonb_build_object('path', 'observedOnSource', 'problem', 'required');
  end if;
  if p_observed_on_source is not null and p_observed_on_source not in ('form_default', 'chosen') then
    v_fields := v_fields || jsonb_build_object('path', 'observedOnSource', 'problem', 'invalid');
  end if;
  -- Today or up to 30 days back (OD-15 default).
  if p_observed_on is not null
     and (p_observed_on > private.london_today() or p_observed_on < private.london_today() - 30) then
    v_fields := v_fields || jsonb_build_object('path', 'observedOn', 'problem', 'out_of_range');
  end if;
  if jsonb_array_length(v_fields) > 0 then
    raise exception 'invalid_value' using errcode = '22023',
      detail = jsonb_build_object('fields', v_fields)::text;
  end if;

  v_hash := private.knowledge_hash(jsonb_build_object('detail', v_detail, 'observedOn', p_observed_on,
    'observedOnSource', p_observed_on_source));
  v_result := public.knowledge_submit(p_check_id, p_slot_revision, p_idempotency_key, p_kind, p_answer,
    p_finding, p_limitations, p_reason, p_unknown_preset, p_tried_text, p_change_reason, p_responds_to,
    p_asset_ids, p_internal_metadata, p_redaction_confirmed, p_confirm_own);
  v_contribution := (v_result ->> 'contributionId')::uuid;
  select d.* into v_prior from public.knowledge_contribution_details d where d.contribution_id = v_contribution;

  if (v_result ->> 'replayed')::boolean then
    if (found and v_prior.request_hash <> v_hash)
       or (not found and (v_detail is not null or p_observed_on is not null)) then
      raise exception 'idempotency_key_reused' using errcode = 'P0001';
    end if;
  elsif v_detail is not null or p_observed_on is not null then
    insert into public.knowledge_contribution_details (
      contribution_id, venue_id, question_version, value_schema, value_schema_version,
      detail, observed_on, observed_on_source, request_hash
    )
    values (
      v_contribution, v_check.venue_id, v_version.version, v_version.value_schema,
      v_version.value_schema_version, v_detail, p_observed_on, p_observed_on_source, v_hash
    );
  end if;
  -- rechecksClosed stays empty until B03-e (A24).
  return v_result || jsonb_build_object('detail', v_detail, 'observedOn', p_observed_on,
    'rechecksClosed', '[]'::jsonb);
end;
$$;
-- ---------------------------------------------------------------------------
-- Re-created reads: additive keys only
-- ---------------------------------------------------------------------------

-- B01 body plus answerInUse.detail, detailRecorded and observedOn (the slot's
-- own top-level 'detail' text is B01's and unchanged), and per-use freshness
-- (unrated until B03-e).
create or replace function private.knowledge_slot_json(
  p_check public.venue_amenity_checks,
  p_viewer uuid,
  p_basis text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'checkId', p_check.id,
    'venueId', p_check.venue_id,
    'questionKey', p_check.template_key,
    'question', t.question,
    'category', t.category,
    'evidenceRule', t.evidence_rule,
    'captureBrief', t.capture_brief,
    'inScope', st.in_scope,
    'slotRevision', st.revision,
    'status', st.status,
    'reason', st.reason,
    'detail', st.detail,
    'progress', p_check.progress,
    'checkStatus', p_check.status,
    'answerInUse', case when st.current_answer is not null and p_check.progress = 'complete' then jsonb_build_object(
      'value', st.current_answer, 'available', st.status = 'available', 'reason', st.reason,
      'savedAt', st.saved_at, 'sentAt', st.sent_at, 'lastCheckedAt', null,
      'confirmed', st.confirmation_state = 'confirmed', 'confirmationState', st.confirmation_state,
      'evidenceState', st.evidence_state,
      -- B03-b: the answer's structured detail and observation date.
      'detail', kd.detail, 'detailRecorded', kd.contribution_id is not null, 'observedOn', kd.observed_on)
      -- Who confirmed it, for the people who decide (null until confirmed).
      || case when p_basis in ('venue_manager', 'admin') then jsonb_build_object(
        'confirmedByFirstName', case when st.confirmation_state = 'confirmed' then (
          select split_part(cp.display_name, ' ', 1)
          from public.knowledge_decisions d
          join public.profiles cp on cp.id = d.decided_by
          where d.submission_id = st.current_submission_id and d.decision = 'confirmed'
          order by d.created_at desc, d.id desc limit 1) end,
        'confirmedAt', st.confirmation_saved_at,
        'confirmedSelf', st.confirmation_self) else '{}'::jsonb end end,
    'previousAnswer', case when p_check.progress = 'needs_recheck' then st.current_answer end,
    'requiresConfirmation', st.confirmation_required,
    'latestAttempt', case when st.last_unknown_at is not null then jsonb_build_object(
      'outcome', 'unknown', 'preset', st.last_unknown_preset, 'at', st.last_unknown_at) end,
    -- Staff see the assignee's first name only (D3); managers also get the id.
    'assignee', case when p_check.assignee_user_id is not null then jsonb_build_object(
      'firstName', split_part(ap.display_name, ' ', 1),
      'isMe', p_check.assignee_user_id = p_viewer)
      || case when p_basis in ('venue_manager', 'admin')
        then jsonb_build_object('id', p_check.assignee_user_id) else '{}'::jsonb end end,
    'mode', case
      when not st.in_scope or p_basis is null or p_check.status <> 'active' then 'none'
      when p_basis in ('venue_manager', 'admin') then
        case when p_check.progress = 'needs_recheck' then 'recheck' else 'answer' end
      when p_check.progress = 'complete' then 'change'
      when p_check.assignee_user_id is not null and p_check.assignee_user_id <> p_viewer then 'add'
      when p_check.progress = 'needs_recheck' then 'recheck'
      else 'answer'
    end,
    'othersPending', (
      select count(*) from public.knowledge_contributions x
      where x.check_id = p_check.id and x.contributed_by <> p_viewer
        and not private.knowledge_is_terminal(x.id)
    ),
    'myLatest', (
      select private.knowledge_contribution_view(x.id) from public.knowledge_contributions x
      where x.check_id = p_check.id and x.contributed_by = p_viewer
      order by x.created_at desc, x.id desc limit 1
    ),
    'myDraft', (
      select jsonb_build_object('savedAt', d.updated_at, 'draftRevision', d.draft_revision)
      from public.knowledge_drafts d
      where d.user_id = p_viewer and d.check_id = p_check.id and d.updated_at >= now() - interval '90 days'
    ),
    'closedAssignment', (
      select jsonb_build_object('eventId', e.id, 'answeredBy', bp.display_name, 'at', e.created_at)
      from public.knowledge_events e
      left join public.profiles bp on bp.id = (e.detail ->> 'answeredBy')::uuid
      where e.check_id = p_check.id and e.kind = 'assignment_closed_by_other'
        and e.detail ->> 'assigneeId' = p_viewer::text
        and e.created_at >= now() - interval '14 days'
        and not exists (
          select 1 from public.knowledge_outcome_dismissals od where od.user_id = p_viewer and od.event_id = e.id
        )
      order by e.id desc limit 1
    )
  )
  || jsonb_build_object(
    -- Per use (A10); read as unrated until B03-e adds freshness policies.
    'freshness', jsonb_build_array(
      jsonb_build_object('use', 'internal', 'state', 'unrated', 'nextCheckDue', null, 'basis', null, 'basisDate', null),
      jsonb_build_object('use', 'public', 'state', 'unrated', 'nextCheckDue', null, 'basis', null, 'basisDate', null))
  )
  from private.knowledge_slot_state(p_check.venue_id, array[p_check.template_key]) st
  join public.amenity_catalogue t on t.key = p_check.template_key
  left join public.knowledge_contribution_details kd on kd.contribution_id = st.current_contribution_id
  left join public.profiles ap on ap.id = p_check.assignee_user_id;
$$;

-- B02 body plus each pending finding's detail and observation date.
create or replace function public.knowledge_check(p_check_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_check public.venue_amenity_checks;
  v_basis text;
  v_manager boolean;
  v_rule public.knowledge_question_rules;
  v_slot jsonb;
begin
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id;
  if not found then
    raise exception 'amenity_check_not_found' using errcode = 'P0002';
  end if;
  v_basis := private.knowledge_basis(v_check.venue_id);
  if v_basis is null then
    raise exception 'amenity_check_not_found' using errcode = 'P0002';
  end if;
  v_manager := v_basis in ('venue_manager', 'admin');
  v_rule := private.knowledge_rule(v_check.template_key);
  v_slot := private.knowledge_slot_json(v_check, v_uid, v_basis);
  return v_slot || jsonb_build_object(
    'mySentAt', private.knowledge_latest_send(v_uid, v_check.id),
    'permissions', jsonb_build_object(
      'canContribute', (v_slot ->> 'mode') <> 'none',
      'canReportChange', not v_manager and (v_slot ->> 'mode') = 'change',
      'canConfirm', v_manager and (v_slot ->> 'inScope')::boolean,
      'canSelfConfirm', v_manager and (coalesce(v_rule.confirmation, 'none') = 'none' or coalesce(v_rule.self_confirmation_allowed, false)),
      'canRequestDetail', v_manager,
      'canDecline', v_manager
    ),
    'pending', coalesce((
      select jsonb_agg(jsonb_build_object(
        'findingRef', jsonb_build_object('type', 'contribution', 'id', x.id),
        'kind', x.kind,
        'answer', x.answer,
        'finding', x.finding,
        'limitations', x.limitations,
        'reason', x.reason,
        'unknownPreset', x.unknown_preset,
        'triedText', x.tried_text,
        'changeReason', x.change_reason,
        'sentAt', x.created_at,
        'senderId', x.contributed_by,
        'senderName', p.display_name,
        'senderAssigned', x.contributed_by = v_check.assignee_user_id,
        'isMine', x.contributed_by = v_uid,
        'detailRequested', exists (
          select 1 from public.knowledge_decisions d
          where d.contribution_id = x.id and d.decision = 'detail_requested'
        ),
        'detailRequest', case when v_manager then (
          select jsonb_build_object('decisionId', d.id, 'note', d.note, 'requestedAt', d.created_at)
          from public.knowledge_decisions d
          where d.contribution_id = x.id and d.decision = 'detail_requested'
          order by d.created_at desc, d.id desc limit 1) end,
        'wifi', case when v_manager or x.contributed_by = v_uid then x.internal_metadata end,
        'detail', (select kd.detail from public.knowledge_contribution_details kd where kd.contribution_id = x.id),
        'observedOn', (select kd.observed_on from public.knowledge_contribution_details kd where kd.contribution_id = x.id),
        'evidence', coalesce((
          select jsonb_agg(jsonb_build_object(
            'assetId', ca.asset_id, 'kind', ca.evidence_kind,
            'available', a.deleted_at is null and a.upload_state = 'ready')
            order by ca.evidence_kind, ca.asset_id)
          from public.knowledge_contribution_assets ca
          join public.media_assets a on a.id = ca.asset_id
          where ca.contribution_id = x.id
        ), '[]'::jsonb)
      ) order by x.created_at, x.id)
      from public.knowledge_contributions x
      join public.profiles p on p.id = x.contributed_by
      where x.check_id = v_check.id
        and not private.knowledge_is_terminal(x.id)
        and (v_manager or x.contributed_by = v_uid)
    ), '[]'::jsonb)
  );
end;
$$;

-- B02-c body (20261110090145) plus canManagePlaces (A1).
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
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.knowledge_subjects_guard(),
  private.knowledge_write_replay(uuid, uuid, text, text),
  private.knowledge_write_record(uuid, uuid, text, text, uuid, jsonb),
  private.knowledge_place_venue(uuid),
  private.knowledge_safe_date(text),
  private.knowledge_place_ref_problem(jsonb),
  private.knowledge_detail_problems(text, jsonb),
  private.knowledge_detail_venue_problems(uuid, text, text, jsonb),
  private.knowledge_validate_value(text, integer, text, jsonb),
  private.knowledge_question_json(text, integer)
from public, anon, authenticated;

revoke all on function
  public.knowledge_subjects(uuid),
  public.knowledge_subject_add(uuid, text, text, uuid),
  public.knowledge_subject_retire(uuid, text, uuid),
  public.knowledge_submit(uuid, bigint, uuid, text, text, text, text, text, text, text, text, uuid, uuid[], jsonb, boolean, boolean, jsonb, date, text),
  public.knowledge_check(uuid),
  public.my_venue_capabilities(uuid)
from public, anon, service_role;

grant execute on function
  public.knowledge_subjects(uuid),
  public.knowledge_subject_add(uuid, text, text, uuid),
  public.knowledge_subject_retire(uuid, text, uuid),
  public.knowledge_submit(uuid, bigint, uuid, text, text, text, text, text, text, text, text, uuid, uuid[], jsonb, boolean, boolean, jsonb, date, text),
  public.knowledge_check(uuid),
  public.my_venue_capabilities(uuid)
to authenticated;
