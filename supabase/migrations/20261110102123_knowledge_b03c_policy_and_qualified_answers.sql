-- B03-c: policy answers, qualified answers and their existing consumers, and
-- the admin confirmation rule (docs/knowledge/b03-design.md §3.2, §3.8, §5,
-- §12 batch B03-c, §14 A4, A5, A19, A22, A28, A30).
--
-- FLAG for WS5 and the reviewer: this migration changes v1 reader output
-- (§3.8) and re-creates knowledge_decide and knowledge_resolve_conflict.
--
-- * Value lists (A4, A9): public.knowledge_value_list_items, seeded EMPTY
--   (the owner supplies items, OD-14 and OD-16), read by
--   public.knowledge_value_list. Retired items stay readable on old answers.
-- * knowledge_question_rules.confirmation gains 'admin' (§3.2). No rule uses
--   it; knowledge_decide and knowledge_resolve_conflict are re-created so a
--   non-admin confirmation is refused (not_active_admin, 42501) where the rule
--   names an admin or a policy answer has organisation scope (§5.4).
--   knowledge_submit is unchanged: an admin rule never allows
--   self-confirmation (knowledge_question_rules_self).
-- * policy.v1 joins the validator (§5.1); condition and exception types must
--   be active value-list items, so with the lists empty no condition can be
--   recorded yet. The §3.8 gate is lifted: Conditional and Temporarily
--   unavailable are accepted, because the consumers are re-created here.
-- * The resolver's view (§3.8, §5.2, A22): private.knowledge_slot_state_b03
--   wraps the unchanged B01 private.knowledge_slot_state. Only an available
--   slot changes: an incomplete policy reads not_confirmed / policy_incomplete,
--   otherwise a qualified answer reads stale / qualified_answer, with value
--   null. Every other reason keeps precedence. It adds qualifier,
--   qualified_detail, value_schema and policy_missing.
-- * Re-created to read it: public.knowledge_reader_answers_v1 (same columns;
--   a qualified or incomplete answer is withheld), private.knowledge_slot_json
--   (answerInUse.qualified, answerInUse.policyMissing on policy keys),
--   public.knowledge_check (pending policyMissing) and
--   public.knowledge_to_confirm (policyMissing, B02 body otherwise).
-- * Legacy check reads (A19, A21): a new view
--   private.amenity_check_rows_presented shows a qualified answer as
--   needs_recheck with a per-qualifier reason and a qualification column;
--   public.amenity_checks_for_venue, public.amenity_check and
--   public.amenity_check_submissions are dropped and re-created with the added
--   qualification column. private.amenity_check_rows and amenity_my_checks are
--   unchanged, so a qualified answer never becomes a staff task. Stored rows
--   never change.
-- * private.knowledge_detail_venue_problems is re-created to check policy
--   zones and to read only arrays (a malformed list was a database error).
-- * K3 (A30): knowledge_question_versions.public_media, default 'never';
--   A33: knowledge_question_versions.features, default empty (OD-12);
--   private.knowledge_question_json returns publicMedia and features.
-- * A34: an accessibility scope may be left out when entrances are listed.
-- * K1 (A28): private.knowledge_evidence_for_assets, shape only (freshness
--   unrated until B03-e). private.knowledge_policy_complete (§5.2) for K2.
-- * Inert: every key is on registry version 1 (presence or connectivity), no
--   rule names an admin and the value lists are empty, so nothing reads
--   differently today. Not touched: the credit trigger
--   media_assets_amenity_evidence_lost, media_assets_knowledge_evidence_withdrawn,
--   the credit functions, private.knowledge_slot_state and knowledge_submit.
--
-- Rollback: a forward migration restores the B01 reader, decide and resolve
-- bodies, the B03-b slot JSON, check and validator, the B02 to-confirm body,
-- and the 20261107120000 legacy reads; the rule check, the value-list table
-- and the public_media column stay (unused).

-- ---------------------------------------------------------------------------
-- Value lists (A4, A9)
-- ---------------------------------------------------------------------------

create table public.knowledge_value_list_items (
  list text not null check (list in ('policy_condition_types', 'policy_exception_types', 'broadcasters')),
  code text not null check (code ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null check (length(label) between 1 and 80 and label = btrim(label)),
  needs_value boolean not null default false,
  value_kind text check (value_kind in ('number', 'text', 'time')),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  primary key (list, code),
  constraint knowledge_value_list_items_value check (needs_value = (value_kind is not null))
);

comment on table public.knowledge_value_list_items is
  'Closed lists of policy condition and exception types and broadcasters (b03-design A4, A9). Added by migration after the owner supplies them; never deleted, only retired.';

-- Never deleted; only retired_at is set, once.
create function private.knowledge_value_list_items_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or old.retired_at is not null or new.retired_at is null
     or (to_jsonb(new) - 'retired_at') is distinct from (to_jsonb(old) - 'retired_at') then
    raise exception 'knowledge_value_list_item_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger knowledge_value_list_items_guard
  before update or delete on public.knowledge_value_list_items
  for each row execute function private.knowledge_value_list_items_guard();
create trigger knowledge_value_list_items_no_truncate
  before truncate on public.knowledge_value_list_items
  for each statement execute function private.append_only_guard();

revoke all on public.knowledge_value_list_items from public, anon, authenticated, service_role;
grant select on public.knowledge_value_list_items to service_role;
alter table public.knowledge_value_list_items enable row level security;

create function private.knowledge_value_list_codes(p_list text)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(i.code order by i.code), '{}'::text[])
  from public.knowledge_value_list_items i
  where i.list = p_list and i.retired_at is null;
$$;

-- Any active account: the active items of one list, in the owner's order.
create function public.knowledge_value_list(p_list text)
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
  ), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Rules and registry fields
-- ---------------------------------------------------------------------------

alter table public.knowledge_question_rules
  drop constraint knowledge_question_rules_confirmation_check;
alter table public.knowledge_question_rules
  add constraint knowledge_question_rules_confirmation_check
  check (confirmation in ('none', 'venue_manager', 'admin'));

-- A33: the accessibility features a version asks about, [{ key, label,
-- measurable }]. Owner-supplied under OD-12, so every version 1 is empty.
create function private.knowledge_features_valid(p_features jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_features) = 'array'
    and jsonb_array_length(p_features) <= 40
    and not exists (
      select 1 from jsonb_array_elements(p_features) f
      where jsonb_typeof(f) <> 'object'
        or (select count(*) from jsonb_object_keys(f) k where k not in ('key', 'label', 'measurable')) > 0
        or jsonb_typeof(f -> 'key') is distinct from 'string' or f ->> 'key' !~ '^[a-z_]{1,40}$'
        or jsonb_typeof(f -> 'label') is distinct from 'string' or length(f ->> 'label') not between 1 and 80
        or jsonb_typeof(f -> 'measurable') is distinct from 'boolean'
    )
    and (select count(distinct f ->> 'key') from jsonb_array_elements(p_features) f) = jsonb_array_length(p_features);
$$;

alter table public.knowledge_question_versions
  add column features jsonb not null default '[]'::jsonb
  constraint knowledge_question_versions_features check (private.knowledge_features_valid(features));

-- K3 (A30): whether an answer may be illustrated publicly. Adding the column
-- fills the default on existing rows; no row is updated.
alter table public.knowledge_question_versions
  add column public_media text not null default 'never'
  check (public_media in ('never', 'with_grant'));

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
    'publicMedia', v.public_media,
    'features', v.features,
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
-- Validation: policy.v1 (§5.1), and the §3.8 gate lifted
-- ---------------------------------------------------------------------------

-- A jsonb array, or an empty one: list readers never fail on a malformed value.
create function private.knowledge_json_array(p_value jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_value) = 'array' then p_value else '[]'::jsonb end;
$$;

-- Shape problems of a policy detail, as [{ path, problem }]. The stance must
-- agree with the headline (Allowed and Conditional are yes, Not allowed is
-- no). Condition and exception types must be active value-list items.
create function private.knowledge_policy_problems(p_headline text, p_detail jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_key text;
  v_list text;
  v_codes text[];
  v_item jsonb;
  v_value jsonb;
  v_i integer;
  v_path text;
  v_problem text;
  v_date date;
begin
  if jsonb_typeof(p_detail) <> 'object' then
    return jsonb_build_array(jsonb_build_object('path', 'detail', 'problem', 'invalid'));
  end if;
  for v_key in select k from jsonb_object_keys(p_detail) k order by k collate "C" loop
    if not (v_key = any(array['stance', 'zones', 'conditions', 'exceptions', 'policyScope', 'authority'])) then
      v_out := v_out || jsonb_build_object('path', 'detail.' || v_key, 'problem', 'not_allowed');
    end if;
  end loop;

  if p_detail ? 'stance' then
    if jsonb_typeof(p_detail -> 'stance') <> 'string'
       or p_detail ->> 'stance' not in ('allowed', 'not_allowed', 'conditional', 'not_applicable', 'unknown') then
      v_out := v_out || jsonb_build_object('path', 'detail.stance', 'problem', 'invalid');
    elsif p_headline in ('yes', 'no', 'not_applicable', 'unknown')
          and (case p_detail ->> 'stance' when 'allowed' then 'yes' when 'conditional' then 'yes'
               when 'not_allowed' then 'no' else p_detail ->> 'stance' end) <> p_headline then
      v_out := v_out || jsonb_build_object('path', 'detail.stance', 'problem', 'invalid');
    end if;
  end if;

  if p_detail ? 'zones' then
    if jsonb_typeof(p_detail -> 'zones') <> 'array' or jsonb_array_length(p_detail -> 'zones') > 20 then
      v_out := v_out || jsonb_build_object('path', 'detail.zones', 'problem', 'invalid');
    else
      for v_i in 0 .. jsonb_array_length(p_detail -> 'zones') - 1 loop
        v_item := p_detail -> 'zones' -> v_i;
        v_path := format('detail.zones[%s]', v_i);
        if jsonb_typeof(v_item) <> 'object' then
          v_out := v_out || jsonb_build_object('path', v_path, 'problem', 'invalid');
          continue;
        end if;
        v_problem := private.knowledge_place_ref_problem(v_item - 'stance');
        if v_problem is not null then
          v_out := v_out || jsonb_build_object('path', v_path, 'problem', v_problem);
        end if;
        if not (v_item ? 'stance') then
          v_out := v_out || jsonb_build_object('path', v_path || '.stance', 'problem', 'required');
        elsif jsonb_typeof(v_item -> 'stance') <> 'string'
              or v_item ->> 'stance' not in ('allowed', 'not_allowed', 'conditional') then
          v_out := v_out || jsonb_build_object('path', v_path || '.stance', 'problem', 'invalid');
        end if;
      end loop;
    end if;
  end if;

  foreach v_key in array array['conditions', 'exceptions'] loop
    if p_detail ? v_key then
      v_list := case v_key when 'conditions' then 'policy_condition_types' else 'policy_exception_types' end;
      v_codes := private.knowledge_value_list_codes(v_list);
      if jsonb_typeof(p_detail -> v_key) <> 'array' or jsonb_array_length(p_detail -> v_key) > 20 then
        v_out := v_out || jsonb_build_object('path', 'detail.' || v_key, 'problem', 'invalid');
      else
        for v_i in 0 .. jsonb_array_length(p_detail -> v_key) - 1 loop
          v_item := p_detail -> v_key -> v_i;
          v_path := format('detail.%s[%s]', v_key, v_i);
          if jsonb_typeof(v_item) <> 'object'
             or (select count(*) from jsonb_object_keys(v_item) k
                 where k not in ('type', 'note') and not (v_key = 'conditions' and k = 'value')) > 0 then
            v_out := v_out || jsonb_build_object('path', v_path, 'problem', 'invalid');
            continue;
          end if;
          if not (v_item ? 'type') then
            v_out := v_out || jsonb_build_object('path', v_path || '.type', 'problem', 'required');
          elsif jsonb_typeof(v_item -> 'type') <> 'string' or not (v_item ->> 'type' = any(v_codes)) then
            v_out := v_out || jsonb_build_object('path', v_path || '.type', 'problem', 'invalid');
          end if;
          if v_item ? 'value' and jsonb_typeof(v_item -> 'value') not in ('string', 'number') then
            v_out := v_out || jsonb_build_object('path', v_path || '.value', 'problem', 'invalid');
          elsif jsonb_typeof(v_item -> 'value') = 'string' and length(v_item ->> 'value') > 200 then
            v_out := v_out || jsonb_build_object('path', v_path || '.value', 'problem', 'too_long');
          end if;
          if v_item ? 'note' and jsonb_typeof(v_item -> 'note') <> 'string' then
            v_out := v_out || jsonb_build_object('path', v_path || '.note', 'problem', 'invalid');
          elsif length(v_item ->> 'note') > 500 then
            v_out := v_out || jsonb_build_object('path', v_path || '.note', 'problem', 'too_long');
          end if;
        end loop;
      end if;
    end if;
  end loop;

  if p_detail ? 'policyScope' and (jsonb_typeof(p_detail -> 'policyScope') <> 'string'
     or p_detail ->> 'policyScope' not in ('venue', 'organisation')) then
    v_out := v_out || jsonb_build_object('path', 'detail.policyScope', 'problem', 'invalid');
  end if;

  if p_detail ? 'authority' then
    v_value := p_detail -> 'authority';
    if jsonb_typeof(v_value) <> 'object'
       or (select count(*) from jsonb_object_keys(v_value) k
           where k not in ('basis', 'statedOn', 'source', 'reference')) > 0 then
      v_out := v_out || jsonb_build_object('path', 'detail.authority', 'problem', 'invalid');
    else
      if v_value ? 'basis' and (jsonb_typeof(v_value -> 'basis') <> 'string'
         or v_value ->> 'basis' not in ('venue_manager', 'admin')) then
        v_out := v_out || jsonb_build_object('path', 'detail.authority.basis', 'problem', 'invalid');
      end if;
      if v_value ? 'statedOn' then
        v_date := case when jsonb_typeof(v_value -> 'statedOn') = 'string'
          then private.knowledge_safe_date(v_value ->> 'statedOn') end;
        if v_date is null then
          v_out := v_out || jsonb_build_object('path', 'detail.authority.statedOn', 'problem', 'invalid');
        elsif v_date > private.london_today() then
          v_out := v_out || jsonb_build_object('path', 'detail.authority.statedOn', 'problem', 'out_of_range');
        end if;
      end if;
      if v_value ? 'source' and (jsonb_typeof(v_value -> 'source') <> 'string'
         or v_value ->> 'source' not in ('in_person', 'written_policy')) then
        v_out := v_out || jsonb_build_object('path', 'detail.authority.source', 'problem', 'invalid');
      end if;
      if v_value ? 'reference' and jsonb_typeof(v_value -> 'reference') <> 'string' then
        v_out := v_out || jsonb_build_object('path', 'detail.authority.reference', 'problem', 'invalid');
      elsif length(v_value ->> 'reference') > 200 then
        v_out := v_out || jsonb_build_object('path', 'detail.authority.reference', 'problem', 'too_long');
      end if;
    end if;
  end if;
  return v_out;
end;
$$;

-- B03-b body, with Temporarily unavailable accepted (the §3.8 gate is lifted
-- with the consumers below).
create or replace function private.knowledge_detail_problems(p_schema text, p_detail jsonb)
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
      elsif jsonb_typeof(v_value -> 'state') <> 'string'
            or v_value ->> 'state' not in ('available', 'on_request', 'seasonal', 'temporarily_unavailable') then
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

-- B03-b body plus policy.v1.
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
                                      ('facility', 1), ('accessibility', 1), ('policy', 1)) then
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
    elsif p_schema = 'policy' then
      v_fields := v_fields || private.knowledge_policy_problems(p_headline, v_given);
      v_detail := v_given;
    else
      v_fields := v_fields || private.knowledge_detail_problems(p_schema, v_given);
      v_detail := v_given;
    end if;
  end if;

  -- A34: the scope may be left out when entrances are listed; the answer then
  -- covers the listed entrances.
  if p_schema = 'accessibility' and p_headline is distinct from 'unknown'
     and (v_given is null or not (v_given ? 'scope'))
     and jsonb_array_length(private.knowledge_json_array(v_given -> 'entrances')) = 0 then
    v_fields := v_fields || jsonb_build_object('path', 'detail.scope', 'problem', 'required');
  end if;

  if jsonb_array_length(v_fields) > 0 then
    raise exception 'invalid_value' using errcode = '22023',
      detail = jsonb_build_object('fields', v_fields)::text;
  end if;
  return jsonb_build_object('headline', p_headline, 'detail', v_detail);
end;
$$;

-- B03-b checks, reading only arrays, plus policy zones and (A33) the features
-- the question's latest version lists: an unlisted feature, or a measurement
-- of one not marked measurable, is not_allowed.
create or replace function private.knowledge_detail_venue_problems(
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
  v_version public.knowledge_question_versions;
  v_key text;
  v_i integer;
begin
  if p_detail is null or jsonb_typeof(p_detail) <> 'object' then
    p_detail := '{}'::jsonb;
  end if;
  v_listed := private.knowledge_json_array(p_detail -> 'entrances');
  select v.* into v_version from public.knowledge_question_versions v
  where v.key = p_key order by v.version desc limit 1;
  if v_version.value_schema = 'accessibility' then
    if jsonb_typeof(p_detail -> 'features') = 'object' then
      for v_key in select k from jsonb_object_keys(p_detail -> 'features') k order by k collate "C" loop
        if not exists (select 1 from jsonb_array_elements(v_version.features) f where f ->> 'key' = v_key) then
          v_out := v_out || jsonb_build_object('path', 'detail.features.' || v_key, 'problem', 'not_allowed');
        end if;
      end loop;
    end if;
    for v_i in 0 .. jsonb_array_length(private.knowledge_json_array(p_detail -> 'measurements')) - 1 loop
      if jsonb_typeof(p_detail -> 'measurements' -> v_i -> 'feature') = 'string' and not exists (
        select 1 from jsonb_array_elements(v_version.features) f
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

  if p_key = 'step_free_entrance' and p_headline in ('yes', 'no') then
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
-- Qualified answers and policy completeness (§3.8, §5.2)
-- ---------------------------------------------------------------------------

-- conditional, temporarily_unavailable, or null. Only a Yes is qualified.
create function private.knowledge_qualifier(p_value_schema text, p_answer text, p_detail jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_answer is distinct from 'yes' or jsonb_typeof(p_detail) is distinct from 'object' then null
    when p_value_schema = 'policy' and p_detail ->> 'stance' = 'conditional' then 'conditional'
    when p_value_schema in ('facility', 'accessibility', 'service')
         and jsonb_typeof(p_detail -> 'availability') = 'object'
         and p_detail -> 'availability' ->> 'state' = 'temporarily_unavailable' then 'temporarily_unavailable'
  end;
$$;

-- What a policy answer still needs (A5), in a fixed order: stance,
-- conditions, zones, authority, stated_on. With p_check_confirmation the
-- confirmation must be by the authority the answer names: an admin for
-- organisation scope, else a venue manager or an admin.
create function private.knowledge_policy_missing(
  p_answer text, p_detail jsonb, p_requires_zones boolean, p_confirmed_basis text, p_check_confirmation boolean
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with v as (
    select case when jsonb_typeof(p_detail) = 'object' then p_detail else '{}'::jsonb end as d
  ),
  s as (
    select v.d,
      coalesce(case when jsonb_typeof(v.d -> 'stance') = 'string' then v.d ->> 'stance' end,
        case p_answer when 'yes' then 'allowed' when 'no' then 'not_allowed'
          when 'not_applicable' then 'not_applicable' end) as stance,
      case when jsonb_typeof(v.d -> 'authority') = 'object' then v.d -> 'authority' else '{}'::jsonb end as auth,
      coalesce(v.d ->> 'policyScope' = 'organisation', false) as organisation
    from v
  )
  select to_jsonb(array_remove(array[
    case when s.stance is null or s.stance = 'unknown' then 'stance' end,
    case when s.stance = 'conditional'
      and jsonb_array_length(private.knowledge_json_array(s.d -> 'conditions')) = 0 then 'conditions' end,
    case when coalesce(p_requires_zones, false)
      and jsonb_array_length(private.knowledge_json_array(s.d -> 'zones')) = 0 then 'zones' end,
    case when not (s.auth ? 'basis' and s.auth ? 'source')
      or (coalesce(p_check_confirmation, false) and (
        p_confirmed_basis is null
        or p_confirmed_basis not in ('venue_manager', 'admin')
        or (s.organisation and p_confirmed_basis <> 'admin'))) then 'authority' end,
    case when not (s.auth ? 'statedOn') then 'stated_on' end
  ], null))
  from s;
$$;

-- A contribution's policy gaps, or null when it carries no policy detail.
create function private.knowledge_policy_missing_for(
  p_contribution_id uuid, p_confirmed_basis text, p_check_confirmation boolean
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.knowledge_policy_missing(x.answer, kd.detail, coalesce(qv.requires_zones, false),
    p_confirmed_basis, p_check_confirmation)
  from public.knowledge_contributions x
  join public.knowledge_contribution_details kd on kd.contribution_id = x.id and kd.value_schema = 'policy'
  join public.venue_amenity_checks c on c.id = x.check_id
  left join public.knowledge_question_versions qv on qv.key = c.template_key and qv.version = kd.question_version
  where x.id = p_contribution_id;
$$;

-- An admin rule, or a policy answer with organisation scope (§3.2, §5.4).
create function private.knowledge_needs_admin(p_rule public.knowledge_question_rules, p_contribution_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_rule.confirmation, 'none') = 'admin'
    or exists (
      select 1 from public.knowledge_contribution_details kd
      where kd.contribution_id = p_contribution_id and kd.value_schema = 'policy'
        and kd.detail ->> 'policyScope' = 'organisation'
    );
$$;

-- ---------------------------------------------------------------------------
-- The resolver's view (§3.8, §5.2, A22)
-- ---------------------------------------------------------------------------

-- The B01 resolver's rows, unchanged except for an available slot: an
-- incomplete policy reads not_confirmed / policy_incomplete, otherwise a
-- qualified answer reads stale / qualified_answer; the value is withheld.
-- Every other reason already takes precedence. qualifier is reported for the
-- answer in use whatever the reason (A22).
create function private.knowledge_slot_state_b03(p_venue_id uuid, p_keys text[])
returns table (
  venue_id uuid,
  question_key text,
  check_id uuid,
  in_scope boolean,
  status text,
  reason text,
  detail text,
  revision bigint,
  question_version integer,
  value text,
  current_answer text,
  current_submission_id uuid,
  current_contribution_id uuid,
  contribution_kind text,
  source_basis text,
  finding text,
  limitations text,
  reason_text text,
  confirmation_required boolean,
  confirmation_state text,
  confirmation_basis text,
  confirmation_self boolean,
  confirmation_saved_at timestamptz,
  evidence_photos integer,
  evidence_videos integer,
  evidence_state text,
  redaction_proof text,
  saved_at timestamptz,
  sent_at timestamptz,
  observed_at timestamptz,
  next_check_due timestamptz,
  freshness_state text,
  pending_count integer,
  open_dispute boolean,
  last_unknown_at timestamptz,
  last_unknown_preset text,
  rule_version integer,
  check_status text,
  check_progress text,
  qualifier text,
  qualified_detail jsonb,
  value_schema text,
  policy_missing jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.venue_id,
    s.question_key,
    s.check_id,
    s.in_scope,
    case when o.reason is null then s.status else 'unavailable' end,
    coalesce(o.reason, s.reason),
    coalesce(o.detail, s.detail),
    s.revision,
    s.question_version,
    case when o.reason is null then s.value end,
    s.current_answer,
    s.current_submission_id,
    s.current_contribution_id,
    s.contribution_kind,
    s.source_basis,
    s.finding,
    s.limitations,
    s.reason_text,
    s.confirmation_required,
    s.confirmation_state,
    s.confirmation_basis,
    s.confirmation_self,
    s.confirmation_saved_at,
    s.evidence_photos,
    s.evidence_videos,
    s.evidence_state,
    s.redaction_proof,
    s.saved_at,
    s.sent_at,
    s.observed_at,
    s.next_check_due,
    s.freshness_state,
    s.pending_count,
    s.open_dispute,
    s.last_unknown_at,
    s.last_unknown_preset,
    s.rule_version,
    s.check_status,
    s.check_progress,
    q.qualifier,
    case when q.qualifier is not null then kd.detail end,
    kd.value_schema,
    q.missing
  from private.knowledge_slot_state(p_venue_id, p_keys) s
  left join public.knowledge_contribution_details kd on kd.contribution_id = s.current_contribution_id
  cross join lateral (
    select private.knowledge_qualifier(kd.value_schema, s.current_answer, kd.detail) as qualifier,
      case when kd.value_schema = 'policy'
        then private.knowledge_policy_missing_for(s.current_contribution_id, s.confirmation_basis, true)
      end as missing
  ) q
  cross join lateral (
    select
      case
        when s.status <> 'available' then null
        when jsonb_array_length(coalesce(q.missing, '[]'::jsonb)) > 0 then 'not_confirmed'
        when q.qualifier is not null then 'stale'
      end as reason,
      case
        when s.status <> 'available' then null
        when jsonb_array_length(coalesce(q.missing, '[]'::jsonb)) > 0 then 'policy_incomplete'
        when q.qualifier is not null then 'qualified_answer'
      end as detail
  ) o;
$$;

-- §5.2: what the answer in use still needs, or null on a non-policy answer.
create function private.knowledge_policy_complete(p_check_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select st.policy_missing
  from public.venue_amenity_checks c
  cross join lateral private.knowledge_slot_state_b03(c.venue_id, array[c.template_key]) st
  where c.id = p_check_id;
$$;

-- B01 body (20261109145934) reading the resolver's view: a qualified or
-- incomplete answer is withheld (unavailable, no value or detail fields).
create or replace function public.knowledge_reader_answers_v1(p_venue_id uuid, p_keys text[])
returns table (
  question_key text,
  status text,
  reason text,
  detail text,
  revision bigint,
  question_version integer,
  value text,
  finding text,
  limitations text,
  reason_text text,
  source_basis text,
  current_contribution_id uuid,
  current_submission_id uuid,
  contribution_kind text,
  confirmation_required boolean,
  confirmation_state text,
  confirmation_basis text,
  confirmation_self boolean,
  confirmation_saved_at timestamptz,
  evidence_photos integer,
  evidence_videos integer,
  redaction_proof text,
  saved_at timestamptz,
  observed_at timestamptz,
  next_check_due timestamptz,
  freshness_state text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_keys text[] := coalesce(p_keys, '{}'::text[]);
begin
  if p_venue_id is null
     or not exists (select 1 from public.venues v where v.id = p_venue_id and v.active)
     or not exists (
       select 1 from public.knowledge_working_list w
       where w.venue_id = p_venue_id and w.disabled_at is null
     ) then
    raise exception 'knowledge_venue_not_found' using errcode = 'NLK06';
  end if;
  if cardinality(v_keys) > 50 then
    raise exception 'invalid_key_list' using errcode = '22023';
  end if;
  -- Unavailable answers carry their state and revision only.
  return query
    select s.question_key, s.status, s.reason, s.detail, s.revision, s.question_version,
      s.value,
      case when s.status = 'available' then s.finding end,
      case when s.status = 'available' then s.limitations end,
      case when s.status = 'available' then s.reason_text end,
      case when s.status = 'available' then s.source_basis end,
      case when s.status = 'available' then s.current_contribution_id end,
      case when s.status = 'available' then s.current_submission_id end,
      case when s.status = 'available' then s.contribution_kind end,
      s.confirmation_required,
      case when s.status = 'available' then s.confirmation_state end,
      case when s.status = 'available' then s.confirmation_basis end,
      case when s.status = 'available' then s.confirmation_self end,
      case when s.status = 'available' then s.confirmation_saved_at end,
      case when s.status = 'available' then s.evidence_photos end,
      case when s.status = 'available' then s.evidence_videos end,
      case when s.status = 'available' then s.redaction_proof end,
      case when s.status = 'available' then s.saved_at end,
      s.observed_at,
      s.next_check_due,
      case when s.status = 'available' then s.freshness_state end
    from private.knowledge_slot_state_b03(p_venue_id, v_keys) s
    order by array_position(v_keys, s.question_key);
end;
$$;

-- B03-b body reading the resolver's view, plus answerInUse.qualified and
-- answerInUse.policyMissing.
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
      'detail', kd.detail, 'detailRecorded', kd.contribution_id is not null, 'observedOn', kd.observed_on,
      -- B03-c (§3.8): a qualified answer's real value, for B03-aware screens.
      'qualified', case when st.qualifier is not null then
        jsonb_build_object('qualifier', st.qualifier, 'detail', st.qualified_detail) end)
      -- B03-c (A5): what a policy answer still needs; absent on other keys.
      || case when st.policy_missing is not null
        then jsonb_build_object('policyMissing', st.policy_missing) else '{}'::jsonb end
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
  from private.knowledge_slot_state_b03(p_check.venue_id, array[p_check.template_key]) st
  join public.amenity_catalogue t on t.key = p_check.template_key
  left join public.knowledge_contribution_details kd on kd.contribution_id = st.current_contribution_id
  left join public.profiles ap on ap.id = p_check.assignee_user_id;
$$;

-- B03-b body plus each pending policy finding's policyMissing.
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
      )
      -- B03-c (A5): what a policy finding would still need once adopted.
      || coalesce((select jsonb_build_object('policyMissing', m.missing)
      from (select private.knowledge_policy_missing_for(x.id, null, false) as missing) m
      where m.missing is not null), '{}'::jsonb)
      order by x.created_at, x.id)
      from public.knowledge_contributions x
      join public.profiles p on p.id = x.contributed_by
      where x.check_id = v_check.id
        and not private.knowledge_is_terminal(x.id)
        and (v_manager or x.contributed_by = v_uid)
    ), '[]'::jsonb)
  );
end;
$$;

-- B02 body (20261110010123) plus policyMissing on policy items.
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
    )
    -- B03-c (A5): what a policy finding would still need once adopted.
    || coalesce((select jsonb_build_object('policyMissing', m.missing)
      from (select private.knowledge_policy_missing_for(x.id, null, false) as missing) m
      where m.missing is not null), '{}'::jsonb) as i,
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
    )
    || coalesce((select jsonb_build_object('policyMissing', m.missing)
      from (select private.knowledge_policy_missing_for(st.current_contribution_id, st.confirmation_basis, true) as missing) m
      where m.missing is not null), '{}'::jsonb),
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
-- Decisions: the admin rule value (§3.2, §5.4)
-- ---------------------------------------------------------------------------

-- B01 body (20261109145934) plus the admin check on both confirm paths.
create or replace function public.knowledge_decide(
  p_target_type text,
  p_target_id uuid,
  p_decision text,
  p_slot_revision bigint,
  p_idempotency_key uuid,
  p_note text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.knowledge_lock_actor();
  v_hash text;
  v_prior jsonb;
  v_contribution public.knowledge_contributions;
  v_submission public.amenity_submissions;
  v_check public.venue_amenity_checks;
  v_rule public.knowledge_question_rules;
  v_basis text;
  v_revision bigint;
  v_note text;
  v_required boolean;
  v_latest text;
  v_decision uuid;
  v_new_submission uuid;
  v_replaced text;
  v_result jsonb;
begin
  if p_target_type is null or p_target_type not in ('contribution', 'submission')
     or p_decision is null
     or p_decision not in ('confirm', 'reaffirm', 'request_detail', 'decline', 'seen', 'revoke') then
    raise exception 'invalid_decision' using errcode = 'P0001';
  end if;
  v_hash := private.knowledge_hash(jsonb_build_object(
    'targetType', p_target_type, 'targetId', p_target_id, 'decision', p_decision,
    'slotRevision', p_slot_revision, 'note', p_note));
  v_prior := private.knowledge_replay(p_idempotency_key, v_uid, 'decide', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;

  if p_target_type = 'contribution' then
    select x.* into v_contribution from public.knowledge_contributions x where x.id = p_target_id;
    if not found then
      raise exception 'knowledge_finding_not_found' using errcode = 'P0002';
    end if;
    select c.* into v_check from public.venue_amenity_checks c where c.id = v_contribution.check_id;
  else
    select s.* into v_submission from public.amenity_submissions s where s.id = p_target_id;
    if not found then
      raise exception 'knowledge_finding_not_found' using errcode = 'P0002';
    end if;
    select c.* into v_check from public.venue_amenity_checks c where c.id = v_submission.check_id;
  end if;
  v_basis := private.knowledge_basis(v_check.venue_id);
  if v_basis is null then
    raise exception 'knowledge_finding_not_found' using errcode = 'P0002';
  end if;
  if v_basis = 'staff' then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;

  if p_target_type = 'contribution' and p_decision = 'confirm' then
    perform 1 from public.media_assets a
    where a.id in (select ca.asset_id from public.knowledge_contribution_assets ca where ca.contribution_id = v_contribution.id)
    order by a.id
    for share;
  end if;
  select c.* into v_check from public.venue_amenity_checks c where c.id = v_check.id for update;
  v_revision := private.knowledge_slot_revision(v_check.venue_id, v_check.template_key);
  if p_slot_revision is distinct from v_revision then
    raise exception 'amenity_conflict' using errcode = 'P0001',
      detail = jsonb_build_object('revision', v_revision)::text;
  end if;
  v_rule := private.knowledge_rule(v_check.template_key);
  v_required := coalesce(v_rule.confirmation, 'none') <> 'none';
  v_note := private.clean_text(p_note, 500, 'invalid_note');

  if p_target_type = 'contribution' then
    if private.knowledge_is_terminal(v_contribution.id) then
      raise exception 'already_decided' using errcode = 'NLK03';
    end if;
    if p_decision = 'confirm' then
      if v_contribution.answer = 'unknown' then
        raise exception 'knowledge_not_adoptable' using errcode = 'NLK07';
      end if;
      if not private.knowledge_in_scope(v_check.venue_id, v_check.template_key) then
        raise exception 'knowledge_slot_out_of_scope' using errcode = 'NLK02';
      end if;
      if v_required and v_contribution.contributed_by = v_uid and not v_rule.self_confirmation_allowed then
        raise exception 'self_confirmation_not_permitted' using errcode = 'NLK04';
      end if;
      -- B03-c: an admin rule or an organisation-scope policy needs an admin (§3.2, §5.4).
      if private.knowledge_needs_admin(v_rule, v_contribution.id) and v_basis <> 'admin' then
        raise exception 'not_active_admin' using errcode = '42501';
      end if;
      if v_check.progress = 'complete' then
        v_replaced := v_check.answer;
      end if;
      v_new_submission := private.knowledge_adopt(v_contribution, v_check, v_uid, v_basis,
        v_required, v_contribution.contributed_by = v_uid, v_revision, v_rule.rule_version);
    elsif p_decision in ('decline', 'request_detail') then
      if v_note is null then
        raise exception 'reason_required' using errcode = 'P0001';
      end if;
      v_decision := private.knowledge_decision(v_check, v_contribution.id, null,
        case p_decision when 'decline' then 'declined' else 'detail_requested' end,
        v_uid, v_basis, false, v_rule.rule_version, v_note, v_revision, null);
    elsif p_decision = 'seen' then
      if v_contribution.answer <> 'unknown' then
        raise exception 'invalid_decision' using errcode = 'P0001';
      end if;
      v_decision := private.knowledge_decision(v_check, v_contribution.id, null, 'seen',
        v_uid, v_basis, false, v_rule.rule_version, v_note, v_revision, null);
    else
      raise exception 'invalid_decision' using errcode = 'P0001';
    end if;
  else
    -- Like the legacy reopen: an archived check's answer takes no decisions.
    if v_check.status <> 'active' then
      raise exception 'amenity_check_archived' using errcode = 'P0001';
    end if;
    if v_check.current_submission_id is distinct from v_submission.id or v_check.progress <> 'complete' then
      raise exception 'knowledge_not_current' using errcode = 'NLK08';
    end if;
    select d.decision into v_latest from public.knowledge_decisions d
    where d.submission_id = v_submission.id and d.decision in ('confirmed', 'revoked')
    order by d.created_at desc, d.id desc limit 1;
    if p_decision = 'confirm' then
      if not v_required then
        raise exception 'invalid_decision' using errcode = 'P0001';
      end if;
      if v_latest = 'confirmed' then
        raise exception 'already_decided' using errcode = 'NLK03';
      end if;
      if v_submission.submitted_by = v_uid and not v_rule.self_confirmation_allowed then
        raise exception 'self_confirmation_not_permitted' using errcode = 'NLK04';
      end if;
      if private.knowledge_needs_admin(v_rule, v_submission.source_contribution_id) and v_basis <> 'admin' then
        raise exception 'not_active_admin' using errcode = '42501';
      end if;
      v_decision := private.knowledge_decision(v_check, null, v_submission.id, 'confirmed', v_uid, v_basis,
        v_submission.submitted_by = v_uid, v_rule.rule_version, v_note, v_revision, null);
    elsif p_decision = 'revoke' then
      if v_latest is distinct from 'confirmed' then
        raise exception 'invalid_decision' using errcode = 'P0001';
      end if;
      if v_note is null then
        raise exception 'reason_required' using errcode = 'P0001';
      end if;
      v_decision := private.knowledge_decision(v_check, null, v_submission.id, 'revoked', v_uid, v_basis,
        false, v_rule.rule_version, v_note, v_revision, null);
    elsif p_decision = 'reaffirm' then
      v_decision := private.knowledge_decision(v_check, null, v_submission.id, 'reaffirmed', v_uid, v_basis,
        false, v_rule.rule_version, v_note, v_revision, null);
    elsif p_decision = 'decline' then
      if not v_required or v_latest = 'confirmed' then
        raise exception 'invalid_decision' using errcode = 'P0001';
      end if;
      if v_note is null then
        raise exception 'reason_required' using errcode = 'P0001';
      end if;
      perform private.knowledge_reopen(v_check, v_note);
      v_decision := private.knowledge_decision(v_check, null, v_submission.id, 'declined', v_uid, v_basis,
        false, v_rule.rule_version, v_note, v_revision, null);
    else
      raise exception 'invalid_decision' using errcode = 'P0001';
    end if;
  end if;

  v_result := jsonb_build_object(
    'decisionId', v_decision,
    'submissionId', v_new_submission,
    'replacedAnswer', v_replaced,
    'slotRevision', private.knowledge_slot_revision(v_check.venue_id, v_check.template_key),
    'replayed', false
  );
  perform private.knowledge_record_command(p_idempotency_key, v_uid, 'decide', v_hash,
    v_check.venue_id, v_check.template_key, v_result);
  return v_result;
end;
$$;

-- B01 body (20261109145934) plus the admin check on the chosen finding.
create or replace function public.knowledge_resolve_conflict(
  p_check_id uuid,
  p_slot_revision bigint,
  p_idempotency_key uuid,
  p_choose uuid,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.knowledge_lock_actor();
  v_hash text;
  v_prior jsonb;
  v_check public.venue_amenity_checks;
  v_rule public.knowledge_question_rules;
  v_chosen public.knowledge_contributions;
  v_basis text;
  v_revision bigint;
  v_reason text;
  v_required boolean;
  v_submission uuid;
  v_other record;
  v_settled integer := 0;
  v_result jsonb;
begin
  v_hash := private.knowledge_hash(jsonb_build_object(
    'checkId', p_check_id, 'slotRevision', p_slot_revision, 'choose', p_choose, 'reason', p_reason));
  v_prior := private.knowledge_replay(p_idempotency_key, v_uid, 'resolve_conflict', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;

  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id;
  if not found then
    raise exception 'amenity_check_not_found' using errcode = 'P0002';
  end if;
  v_basis := private.knowledge_basis(v_check.venue_id);
  if v_basis is null then
    raise exception 'amenity_check_not_found' using errcode = 'P0002';
  end if;
  if v_basis = 'staff' then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  if p_choose is not null then
    select x.* into v_chosen from public.knowledge_contributions x
    where x.id = p_choose and x.check_id = v_check.id;
    if not found then
      raise exception 'knowledge_finding_not_found' using errcode = 'P0002';
    end if;
    perform 1 from public.media_assets a
    where a.id in (select ca.asset_id from public.knowledge_contribution_assets ca where ca.contribution_id = v_chosen.id)
    order by a.id
    for share;
  end if;
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id for update;
  v_revision := private.knowledge_slot_revision(v_check.venue_id, v_check.template_key);
  if p_slot_revision is distinct from v_revision then
    raise exception 'amenity_conflict' using errcode = 'P0001',
      detail = jsonb_build_object('revision', v_revision)::text;
  end if;
  v_reason := private.clean_text(p_reason, 500, 'invalid_reason');
  if v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  v_rule := private.knowledge_rule(v_check.template_key);
  v_required := coalesce(v_rule.confirmation, 'none') <> 'none';

  if p_choose is null then
    if v_check.progress <> 'complete' then
      raise exception 'invalid_decision' using errcode = 'P0001';
    end if;
  else
    if private.knowledge_is_terminal(v_chosen.id) then
      raise exception 'already_decided' using errcode = 'NLK03';
    end if;
    if v_chosen.answer = 'unknown' then
      raise exception 'knowledge_not_adoptable' using errcode = 'NLK07';
    end if;
    if not private.knowledge_in_scope(v_check.venue_id, v_check.template_key) then
      raise exception 'knowledge_slot_out_of_scope' using errcode = 'NLK02';
    end if;
    if v_required and v_chosen.contributed_by = v_uid and not v_rule.self_confirmation_allowed then
      raise exception 'self_confirmation_not_permitted' using errcode = 'NLK04';
    end if;
    -- B03-c: an admin rule or an organisation-scope policy needs an admin (§3.2, §5.4).
    if private.knowledge_needs_admin(v_rule, v_chosen.id) and v_basis <> 'admin' then
      raise exception 'not_active_admin' using errcode = '42501';
    end if;
  end if;

  -- Settle every other listed finding first, against the locked check.
  for v_other in
    select x.id, x.answer from public.knowledge_contributions x
    where x.check_id = v_check.id and x.id is distinct from p_choose
      and not private.knowledge_is_terminal(x.id)
    order by x.created_at, x.id
  loop
    perform private.knowledge_decision(v_check, v_other.id, null,
      case when v_other.answer = 'unknown' then 'seen' else 'declined' end,
      v_uid, v_basis, false, v_rule.rule_version, v_reason, v_revision, null);
    v_settled := v_settled + 1;
  end loop;

  if p_choose is not null then
    v_submission := private.knowledge_adopt(v_chosen, v_check, v_uid, v_basis,
      v_required, v_chosen.contributed_by = v_uid, v_revision, v_rule.rule_version);
    v_settled := v_settled + 1;
  end if;

  v_result := jsonb_build_object(
    'submissionId', v_submission,
    'settled', v_settled,
    'slotRevision', private.knowledge_slot_revision(v_check.venue_id, v_check.template_key),
    'replayed', false
  );
  perform private.knowledge_record_command(p_idempotency_key, v_uid, 'resolve_conflict', v_hash,
    v_check.venue_id, v_check.template_key, v_result);
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Legacy check reads (§3.8, A19, A21)
-- ---------------------------------------------------------------------------

-- private.amenity_check_rows as presented to the legacy screens: a qualified
-- answer (stored complete) shows as needs_recheck with a reason per
-- qualifier. The stored row and private.amenity_check_rows are unchanged.
create view private.amenity_check_rows_presented as
  select r.id, r.venue_id, r.template_key, r.category, r.question, r.capture_brief, r.evidence_rule,
    r.is_core, r.position, r.catalogue_version, r.status,
    case when q.qualification is null then r.progress else 'needs_recheck' end as progress,
    r.answer, r.current_submission_id, r.assignee_user_id, r.assignee_name,
    r.answered_by, r.answered_by_name, r.answered_at,
    case q.qualification
      when 'conditional' then 'This answer has conditions. Check them before relying on it.'
      when 'temporarily_unavailable' then 'Temporarily unavailable. Check whether it is back.'
      else r.recheck_reason
    end as recheck_reason,
    r.notes, r.revision, r.updated_at, q.qualification
  from private.amenity_check_rows r
  left join public.amenity_submissions s on s.id = r.current_submission_id
  left join public.knowledge_contribution_details kd on kd.contribution_id = s.source_contribution_id
  cross join lateral (
    select case when r.progress = 'complete'
      then private.knowledge_qualifier(kd.value_schema, r.answer, kd.detail) end as qualification
  ) q;

revoke all on private.amenity_check_rows_presented from public, anon, authenticated;

drop function public.amenity_checks_for_venue(uuid, boolean);
create function public.amenity_checks_for_venue(p_venue_id uuid, p_include_archived boolean)
returns table (
  id uuid, venue_id uuid, template_key text, category text, question text, capture_brief text,
  evidence_rule text, is_core boolean, "position" integer, catalogue_version integer, status text,
  progress text, answer text, current_submission_id uuid, assignee_user_id uuid, assignee_name text,
  answered_by uuid, answered_by_name text, answered_at timestamptz, recheck_reason text, notes text,
  revision integer, updated_at timestamptz, qualification text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.amenity_assert_active_user();
  perform private.assert_can_manage_venue(p_venue_id);
  return query
    select r.* from private.amenity_check_rows_presented r
    where r.venue_id = p_venue_id
      and (coalesce(p_include_archived, false) or r.status = 'active')
    order by r.position, r.template_key;
end;
$$;

drop function public.amenity_check(uuid);
create function public.amenity_check(p_check_id uuid)
returns table (
  id uuid, venue_id uuid, template_key text, category text, question text, capture_brief text,
  evidence_rule text, is_core boolean, "position" integer, catalogue_version integer, status text,
  progress text, answer text, current_submission_id uuid, assignee_user_id uuid, assignee_name text,
  answered_by uuid, answered_by_name text, answered_at timestamptz, recheck_reason text, notes text,
  revision integer, updated_at timestamptz, qualification text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.amenity_readable_check(p_check_id);
  return query select r.* from private.amenity_check_rows_presented r where r.id = p_check_id;
end;
$$;

-- Each submission's qualification (from the finding it was adopted from).
drop function public.amenity_check_submissions(uuid);
create function public.amenity_check_submissions(p_check_id uuid)
returns table (
  id uuid, check_id uuid, answer text, finding text, limitations text, reason text,
  submitted_by uuid, submitted_by_name text, created_at timestamptz, template_version integer,
  evidence_rule text, internal_metadata jsonb, qualification text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_check public.venue_amenity_checks := private.amenity_readable_check(p_check_id);
  v_manager boolean := private.can_manage_venue(v_check.venue_id);
  v_uid uuid := auth.uid();
begin
  return query
    select s.id, s.check_id, s.answer, s.finding, s.limitations, s.reason, s.submitted_by,
      p.display_name, s.created_at, s.template_version, s.evidence_rule,
      case when v_manager or s.submitted_by = v_uid then s.internal_metadata end,
      private.knowledge_qualifier(kd.value_schema, s.answer, kd.detail)
    from public.amenity_submissions s
    left join public.profiles p on p.id = s.submitted_by
    left join public.knowledge_contribution_details kd on kd.contribution_id = s.source_contribution_id
    where s.check_id = v_check.id
    order by s.created_at desc, s.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- K1 (A28): evidence role per asset, for WS4's definer reads
-- ---------------------------------------------------------------------------

-- R9's roles (private.asset_removal_effects) for any submitter, with the slot's
-- status and per-use freshness (unrated until B03-e). No names, values or
-- notes. Callers gate first.
create function private.knowledge_evidence_for_assets(p_asset_ids uuid[], p_now timestamptz)
returns table (
  asset_id uuid, venue_id uuid, check_id uuid, question_key text, role text,
  slot_status text, slot_reason text, freshness jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_asset_ids is null or cardinality(p_asset_ids) > 100 then
    raise exception 'invalid_asset_list' using errcode = 'P0001';
  end if;
  return query
    with e as (
      select sa.asset_id, c.venue_id, c.id as check_id, c.template_key as question_key, 'current_answer'::text as role
      from public.amenity_submission_assets sa
      join public.venue_amenity_checks c on c.current_submission_id = sa.submission_id
      where sa.asset_id = any(p_asset_ids)
      union
      select ka.asset_id, x.venue_id, x.check_id, x.question_key, 'pending_finding'
      from public.knowledge_contribution_assets ka
      join public.knowledge_contributions x on x.id = ka.contribution_id
      where ka.asset_id = any(p_asset_ids) and not private.knowledge_is_terminal(x.id)
      union
      select sa.asset_id, s.venue_id, s.check_id, c.template_key, 'earlier_answer'
      from public.amenity_submission_assets sa
      join public.amenity_submissions s on s.id = sa.submission_id
      join public.venue_amenity_checks c on c.id = s.check_id
      where sa.asset_id = any(p_asset_ids) and c.current_submission_id is distinct from s.id
    )
    select e.asset_id, e.venue_id, e.check_id, e.question_key, e.role, st.status, st.reason,
      jsonb_build_array(
        jsonb_build_object('use', 'internal', 'state', 'unrated', 'nextCheckDue', null, 'basis', null, 'basisDate', null),
        jsonb_build_object('use', 'public', 'state', 'unrated', 'nextCheckDue', null, 'basis', null, 'basisDate', null))
    from e
    cross join lateral private.knowledge_slot_state_b03(e.venue_id, array[e.question_key]) st
    order by e.asset_id, array_position(array['current_answer', 'pending_finding', 'earlier_answer'], e.role), e.check_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.knowledge_features_valid(jsonb),
  private.knowledge_value_list_items_guard(),
  private.knowledge_value_list_codes(text),
  private.knowledge_question_json(text, integer),
  private.knowledge_json_array(jsonb),
  private.knowledge_policy_problems(text, jsonb),
  private.knowledge_detail_problems(text, jsonb),
  private.knowledge_validate_value(text, integer, text, jsonb),
  private.knowledge_detail_venue_problems(uuid, text, text, jsonb),
  private.knowledge_qualifier(text, text, jsonb),
  private.knowledge_policy_missing(text, jsonb, boolean, text, boolean),
  private.knowledge_policy_missing_for(uuid, text, boolean),
  private.knowledge_needs_admin(public.knowledge_question_rules, uuid),
  private.knowledge_slot_state_b03(uuid, text[]),
  private.knowledge_policy_complete(uuid),
  private.knowledge_evidence_for_assets(uuid[], timestamptz)
from public, anon, authenticated;

revoke all on function
  public.knowledge_value_list(text),
  public.knowledge_check(uuid),
  public.knowledge_to_confirm(uuid),
  public.knowledge_decide(text, uuid, text, bigint, uuid, text),
  public.knowledge_resolve_conflict(uuid, bigint, uuid, uuid, text),
  public.amenity_checks_for_venue(uuid, boolean),
  public.amenity_check(uuid),
  public.amenity_check_submissions(uuid)
from public, anon, service_role;

grant execute on function
  public.knowledge_value_list(text),
  public.knowledge_check(uuid),
  public.knowledge_to_confirm(uuid),
  public.knowledge_decide(text, uuid, text, bigint, uuid, text),
  public.knowledge_resolve_conflict(uuid, bigint, uuid, uuid, text),
  public.amenity_checks_for_venue(uuid, boolean),
  public.amenity_check(uuid),
  public.amenity_check_submissions(uuid)
to authenticated;
