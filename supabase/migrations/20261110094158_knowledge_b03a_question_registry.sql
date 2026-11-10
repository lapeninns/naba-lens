-- B03-a: the versioned question registry (docs/knowledge/b03-design.md §3,
-- §12 batch B03-a, §14 A14).
--
-- * public.knowledge_questions: one row per catalogue key (family, subject
--   type, owner role). Never deleted; the key never changes.
-- * public.knowledge_question_versions: append-only, one row per key and
--   version (value schema, guidance, evidence and confirmation rule,
--   sensitivity, freshness, publishable and material fields, zones rule,
--   lifecycle).
-- * Version 1 of every key restates today exactly, read from
--   amenity_catalogue and knowledge_question_rules at migration time:
--   wording, brief, evidence rule and catalogue_version from the catalogue;
--   confirmation and self-confirmation from the B01 rule where one exists,
--   otherwise none (what the B01 functions read for a key without a rule);
--   value schema presence (connectivity.wifi for guest_wifi); lifecycle
--   supported; no freshness policy; nothing publishable. The proposals in
--   §3.4 (families, sensitivities, lifecycles) are owner decisions and are
--   not applied here.
-- * private.knowledge_validate_value: the value validator for the schemas
--   version 1 uses (presence and connectivity.wifi). Later batches add
--   schemas by re-creating it.
-- * Reads: public.knowledge_question (any active user) and
--   public.knowledge_registry (admins).
-- * Nothing existing is re-created and nothing reads the registry yet, so
--   behaviour is unchanged. No credit input is touched.
--
-- Rollback: drop the two reads and the validator; the tables are additive
-- and stay (version rows are never deleted).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.knowledge_questions (
  key text primary key references public.amenity_catalogue (key) on delete restrict,
  family text not null check (family in (
    'presence', 'facility', 'accessibility', 'policy', 'service', 'schedule_event', 'connectivity'
  )),
  subject_type text not null default 'venue' check (subject_type in ('venue')),
  owner_role text not null default 'venue_manager' check (owner_role in ('venue_manager', 'admin')),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete restrict
);

comment on table public.knowledge_questions is
  'One row per question key (B03-01). Changed only by migration; never deleted; the key never changes.';

create table public.knowledge_question_versions (
  key text not null references public.knowledge_questions (key) on delete restrict,
  version integer not null check (version >= 1),
  catalogue_version integer not null check (catalogue_version >= 1),
  rule_version integer check (rule_version is null or rule_version >= 1),
  value_schema text not null check (value_schema in (
    'presence', 'facility', 'accessibility', 'policy', 'service', 'schedule_event', 'connectivity.wifi'
  )),
  value_schema_version integer not null check (value_schema_version >= 1),
  guidance jsonb not null check (jsonb_typeof(guidance) = 'object'),
  evidence_rule text not null check (evidence_rule in ('photo', 'video', 'either', 'both', 'none')),
  confirmation text not null check (confirmation in ('none', 'venue_manager', 'admin', 'policy_authority')),
  self_confirmation_allowed boolean not null default false,
  sensitivity text not null check (sensitivity in ('ordinary', 'sensitive_claim', 'restricted_detail')),
  freshness jsonb not null default '{"internal": null, "public": null}'::jsonb
    check (jsonb_typeof(freshness) = 'object'),
  publishable_fields text[] not null default '{}',
  material_fields text[] not null default '{headline}',
  requires_zones boolean not null default false,
  lifecycle text not null check (lifecycle in ('supported', 'presence_only', 'unsupported', 'superseded', 'retired')),
  superseded_by text[],
  effective_from timestamptz,
  change_kind text not null check (change_kind in ('initial', 'wording', 'rule', 'schema', 'lifecycle')),
  change_note text check (change_note is null or length(change_note) between 1 and 1000),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete restrict,
  primary key (key, version),
  constraint knowledge_question_versions_superseded check ((lifecycle = 'superseded') = (superseded_by is not null)),
  constraint knowledge_question_versions_self check (confirmation <> 'none' or not self_confirmation_allowed)
);

comment on table public.knowledge_question_versions is
  'Append-only versions of each question (B03-01): what it asks, its value schema and rules. Added only by migration.';

-- Questions: never deleted or truncated, and the key never changes.
create function private.knowledge_questions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or new.key is distinct from old.key then
    raise exception 'knowledge_question_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger knowledge_questions_guard
  before update or delete on public.knowledge_questions
  for each row execute function private.knowledge_questions_guard();
create trigger knowledge_questions_no_truncate
  before truncate on public.knowledge_questions
  for each statement execute function private.append_only_guard();
create trigger knowledge_question_versions_append_only
  before update or delete on public.knowledge_question_versions
  for each row execute function private.append_only_guard();
create trigger knowledge_question_versions_no_truncate
  before truncate on public.knowledge_question_versions
  for each statement execute function private.append_only_guard();

revoke all on function private.knowledge_questions_guard() from public, anon, authenticated;

revoke all on public.knowledge_questions, public.knowledge_question_versions
from public, anon, authenticated, service_role;
grant select on public.knowledge_questions, public.knowledge_question_versions to service_role;
alter table public.knowledge_questions enable row level security;
alter table public.knowledge_question_versions enable row level security;

-- ---------------------------------------------------------------------------
-- Version 1: today's catalogue and rules, restated
-- ---------------------------------------------------------------------------

insert into public.knowledge_questions (key, family)
select c.key, case when c.key = 'guest_wifi' then 'connectivity' else 'presence' end
from public.amenity_catalogue c;

insert into public.knowledge_question_versions (
  key, version, catalogue_version, rule_version, value_schema, value_schema_version, guidance,
  evidence_rule, confirmation, self_confirmation_allowed, sensitivity, lifecycle, change_kind, change_note
)
select c.key, 1, c.catalogue_version, r.rule_version,
  case when c.key = 'guest_wifi' then 'connectivity.wifi' else 'presence' end, 1,
  jsonb_build_object('question', c.question, 'captureBrief', c.capture_brief,
    'staffHelp', null, 'publicLabel', null),
  c.evidence_rule,
  coalesce(r.confirmation, 'none'),
  coalesce(r.self_confirmation_allowed, false),
  -- Today's access rules already keep Wi-Fi test notes internal (access-and-rights §4).
  case when c.key = 'guest_wifi' then 'restricted_detail' else 'ordinary' end,
  'supported', 'initial',
  'Restates amenity_catalogue and knowledge_question_rules as they stood before B03.'
from public.amenity_catalogue c
left join lateral (
  select x.* from public.knowledge_question_rules x
  where x.question_key = c.key
  order by x.rule_version desc
  limit 1
) r on true;

-- ---------------------------------------------------------------------------
-- Value validation (§3.3)
-- ---------------------------------------------------------------------------

-- Checks a headline and detail against a value schema and returns them
-- normalised as { headline, detail }. Refusals: unknown_value_schema, or
-- invalid_value with { fields: [{ path, problem }] }. Version 1 schemas only:
-- presence (no detail) and connectivity.wifi (the B01 internal test notes).
create function private.knowledge_validate_value(
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
begin
  if p_schema is null or p_version is null
     or (p_schema, p_version) not in (('presence', 1), ('connectivity.wifi', 1)) then
    raise exception 'unknown_value_schema' using errcode = '22023',
      detail = jsonb_build_object('schema', p_schema, 'version', p_version)::text;
  end if;

  if p_headline is null then
    v_fields := v_fields || jsonb_build_object('path', 'headline', 'problem', 'required');
  elsif p_headline not in ('yes', 'no', 'not_applicable', 'unknown') then
    v_fields := v_fields || jsonb_build_object('path', 'headline', 'problem', 'not_allowed');
  end if;

  if p_detail is not null and p_detail <> '{}'::jsonb then
    if p_schema = 'presence' then
      v_fields := v_fields || jsonb_build_object('path', 'detail', 'problem', 'not_allowed');
    else
      begin
        v_detail := private.amenity_wifi_metadata(p_detail);
      exception when others then
        v_fields := v_fields || jsonb_build_object('path', 'detail', 'problem', 'invalid');
      end;
    end if;
  end if;

  if jsonb_array_length(v_fields) > 0 then
    raise exception 'invalid_value' using errcode = '22023',
      detail = jsonb_build_object('fields', v_fields)::text;
  end if;
  return jsonb_build_object('headline', p_headline, 'detail', v_detail);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

create function private.knowledge_question_json(p_key text, p_version integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'key', q.key,
    'family', q.family,
    'subjectType', q.subject_type,
    'ownerRole', q.owner_role,
    'version', v.version,
    'latestVersion', (select max(x.version) from public.knowledge_question_versions x where x.key = q.key),
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
  from public.knowledge_questions q
  join public.knowledge_question_versions v on v.key = q.key
  where q.key = p_key
    and v.version = coalesce(p_version, (
      select max(x.version) from public.knowledge_question_versions x where x.key = q.key));
$$;

-- One question version (latest by default) for any active user: guidance and
-- rules only, never who changed it.
create function public.knowledge_question(p_key text, p_version integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_question jsonb;
begin
  perform private.amenity_assert_active_user();
  v_question := private.knowledge_question_json(p_key, p_version);
  if v_question is null then
    raise exception 'knowledge_question_not_found' using errcode = 'P0002';
  end if;
  return v_question;
end;
$$;

-- Every question with its latest version, in catalogue order; admins only.
create function public.knowledge_registry(p_lifecycle text[] default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.amenity_assert_active_user();
  perform private.assert_active_admin();
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(j order by c.position, c.key)
    from public.amenity_catalogue c
    cross join lateral (select private.knowledge_question_json(c.key, null) as j) x
    where x.j is not null
      and (p_lifecycle is null or x.j ->> 'lifecycle' = any(p_lifecycle))
  ), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.knowledge_validate_value(text, integer, text, jsonb),
  private.knowledge_question_json(text, integer)
from public, anon, authenticated;

revoke all on function
  public.knowledge_question(text, integer),
  public.knowledge_registry(text[])
from public, anon, service_role;

grant execute on function
  public.knowledge_question(text, integer),
  public.knowledge_registry(text[])
to authenticated;
