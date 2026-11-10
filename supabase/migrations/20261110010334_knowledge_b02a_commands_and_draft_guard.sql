-- B02-a, part 2: request keys on legacy check writes (R10) and the draft-save
-- guard (R11) (docs/knowledge/b02-design.md R10, R11 and §7.1).
--
-- * R10: public.amenity_commands (append-only, RLS on, no client policies) and
--   six keyed overloads of the legacy check writes. Each runs the active-account
--   check, takes the key's advisory lock and replays a prior result for the
--   same actor, command and request before calling the unchanged existing
--   function, so a retry after a lost reply replays instead of meeting its own
--   change as a stale revision. The old signatures are not touched.
-- * R11: private.knowledge_latest_send (the caller's latest send on a check:
--   own contributions and own legacy answers; an adoption's submission is not
--   a send) and private.knowledge_draft_guard, which raises draft_already_sent
--   (NLK09) with detail {reason, sentAt}. A new knowledge_save_draft overload
--   takes p_base_sent_at and checks key_sent and newer_send before the draft
--   revision check.
-- * Re-created with the same signatures, owner and grants (§7.1):
--   - knowledge_save_draft (5 args): adds only the key_sent test;
--   - knowledge_submit: adds sentAt (the contribution's created_at) to its
--     result, on a replay too;
--   - knowledge_check: adds the caller's own mySentAt.
--   Each body is otherwise the B01 body of 20261109145934.
-- * No credit input is written here.
--
-- Rollback: clients call the old signatures again (they never left); a forward
-- migration restores the B01 bodies of the three re-created functions from
-- 20261109145934_knowledge_b01_functions.sql and drops the new overloads and
-- helpers. amenity_commands keeps its rows (keys only matter for retries).

-- ---------------------------------------------------------------------------
-- R10. Request keys on legacy check writes
-- ---------------------------------------------------------------------------

create table public.amenity_commands (
  idempotency_key uuid primary key,
  actor_id uuid not null references public.profiles (id) on delete restrict,
  command text not null check (command in ('assign', 'set_notes', 'reopen', 'archive', 'restore', 'add_checks')),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  venue_id uuid not null references public.venues (id) on delete restrict,
  check_id uuid,
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  constraint amenity_commands_check_id check ((command = 'add_checks') = (check_id is null))
);

create trigger amenity_commands_append_only
  before update or delete on public.amenity_commands
  for each row execute function private.append_only_guard();
create trigger amenity_commands_no_truncate
  before truncate on public.amenity_commands
  for each statement execute function private.append_only_guard();

revoke all on public.amenity_commands from public, anon, authenticated, service_role;
grant select on public.amenity_commands to service_role;
alter table public.amenity_commands enable row level security;

-- The key's advisory lock, then the replay lookup (B01 knowledge_replay, on
-- this table and its own lock namespace).
create function private.amenity_command_replay(p_key uuid, p_actor uuid, p_command text, p_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prior public.amenity_commands;
begin
  if p_key is null then
    raise exception 'invalid_idempotency_key' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('nabalens_amenity_command:' || p_key::text, 0));
  select k.* into v_prior from public.amenity_commands k where k.idempotency_key = p_key;
  if not found then
    return null;
  end if;
  if v_prior.actor_id <> p_actor or v_prior.command <> p_command or v_prior.request_hash <> p_hash then
    raise exception 'idempotency_key_reused' using errcode = 'P0001';
  end if;
  return v_prior.result || jsonb_build_object('replayed', true);
end;
$$;

create function private.amenity_command_record(
  p_key uuid, p_actor uuid, p_command text, p_hash text, p_venue_id uuid, p_check_id uuid, p_result jsonb
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.amenity_commands
    (idempotency_key, actor_id, command, request_hash, venue_id, check_id, result)
  values (p_key, p_actor, p_command, p_hash, p_venue_id, p_check_id, p_result);
$$;

-- One keyed check write: replay, else the unchanged existing write (its
-- authorisation, venue, revision check, locks and event), then record. A
-- refused write raises before anything is recorded, so its retry runs again.
create function private.amenity_keyed_check_write(
  p_key uuid, p_command text, p_check_id uuid, p_request jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_hash text := private.knowledge_hash(p_request);
  v_prior jsonb;
  v_revision integer;
  v_result jsonb;
begin
  v_prior := private.amenity_command_replay(p_key, v_uid, p_command, v_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  v_revision := case p_command
    when 'assign' then public.amenity_assign_check(
      p_check_id, (p_request ->> 'assigneeId')::uuid, (p_request ->> 'revision')::integer)
    when 'set_notes' then public.amenity_set_check_notes(
      p_check_id, p_request ->> 'notes', (p_request ->> 'revision')::integer)
    when 'reopen' then public.amenity_reopen_check(
      p_check_id, (p_request ->> 'revision')::integer, p_request ->> 'preset', p_request ->> 'reason')
    when 'archive' then public.amenity_archive_check(p_check_id, (p_request ->> 'revision')::integer)
    when 'restore' then public.amenity_restore_check(p_check_id, (p_request ->> 'revision')::integer)
  end;
  if v_revision is null then
    raise exception 'invalid_command' using errcode = 'P0001';
  end if;
  v_result := jsonb_build_object('revision', v_revision, 'replayed', false);
  perform private.amenity_command_record(p_key, v_uid, p_command, v_hash,
    (select c.venue_id from public.venue_amenity_checks c where c.id = p_check_id), p_check_id, v_result);
  return v_result;
end;
$$;

create function public.amenity_assign_check(
  p_check_id uuid, p_assignee_id uuid, p_revision integer, p_idempotency_key uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.amenity_keyed_check_write(p_idempotency_key, 'assign', p_check_id,
    jsonb_build_object('checkId', p_check_id, 'assigneeId', p_assignee_id, 'revision', p_revision));
$$;

create function public.amenity_set_check_notes(
  p_check_id uuid, p_notes text, p_revision integer, p_idempotency_key uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.amenity_keyed_check_write(p_idempotency_key, 'set_notes', p_check_id,
    jsonb_build_object('checkId', p_check_id, 'notes', p_notes, 'revision', p_revision));
$$;

create function public.amenity_reopen_check(
  p_check_id uuid, p_revision integer, p_preset text, p_reason text, p_idempotency_key uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.amenity_keyed_check_write(p_idempotency_key, 'reopen', p_check_id,
    jsonb_build_object('checkId', p_check_id, 'revision', p_revision, 'preset', p_preset, 'reason', p_reason));
$$;

create function public.amenity_archive_check(p_check_id uuid, p_revision integer, p_idempotency_key uuid)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.amenity_keyed_check_write(p_idempotency_key, 'archive', p_check_id,
    jsonb_build_object('checkId', p_check_id, 'revision', p_revision));
$$;

create function public.amenity_restore_check(p_check_id uuid, p_revision integer, p_idempotency_key uuid)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.amenity_keyed_check_write(p_idempotency_key, 'restore', p_check_id,
    jsonb_build_object('checkId', p_check_id, 'revision', p_revision));
$$;

-- The same ids in input order on a replay (keys are part of the request).
create function public.amenity_add_checks(p_venue_id uuid, p_keys text[], p_idempotency_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_hash text := private.knowledge_hash(jsonb_build_object('venueId', p_venue_id, 'keys', to_jsonb(p_keys)));
  v_prior jsonb;
  v_result jsonb;
begin
  v_prior := private.amenity_command_replay(p_idempotency_key, v_uid, 'add_checks', v_hash);
  if v_prior is not null then
    return v_prior;
  end if;
  v_result := jsonb_build_object('checkIds', to_jsonb(public.amenity_add_checks(p_venue_id, p_keys)), 'replayed', false);
  perform private.amenity_command_record(p_idempotency_key, v_uid, 'add_checks', v_hash, p_venue_id, null, v_result);
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- R11. My latest send, and the draft-save guard
-- ---------------------------------------------------------------------------

-- The newest of the person's own contributions on the check and their own
-- legacy answers to it. An adoption inserts a submission under the
-- contributor's name with source_contribution_id set: not a send.
create function private.knowledge_latest_send(p_user uuid, p_check_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select max(q.at) from (
    select x.created_at as at from public.knowledge_contributions x
    where x.check_id = p_check_id and x.contributed_by = p_user
    union all
    select s.created_at from public.amenity_submissions s
    where s.check_id = p_check_id and s.submitted_by = p_user and s.source_contribution_id is null
  ) q;
$$;

-- key_sent: the save carries the key of a send already recorded for this
-- person. newer_send (only with p_check_base): the person's latest send on the
-- check is later than the base the form loaded, or exists when the base is
-- null. Equal times are not newer. Both times are the database's own.
create function private.knowledge_draft_guard(
  p_user uuid, p_check_id uuid, p_key uuid, p_base timestamptz, p_check_base boolean
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sent timestamptz;
begin
  if p_key is not null then
    select x.created_at into v_sent
    from public.knowledge_commands k
    join public.knowledge_contributions x on x.id = (k.result ->> 'contributionId')::uuid
    where k.idempotency_key = p_key and k.actor_id = p_user and k.command = 'submit';
    if found then
      raise exception 'draft_already_sent' using errcode = 'NLK09',
        detail = jsonb_build_object('reason', 'key_sent', 'sentAt', v_sent)::text;
    end if;
  end if;
  if p_check_base then
    v_sent := private.knowledge_latest_send(p_user, p_check_id);
    if v_sent is not null and (p_base is null or v_sent > p_base) then
      raise exception 'draft_already_sent' using errcode = 'NLK09',
        detail = jsonb_build_object('reason', 'newer_send', 'sentAt', v_sent)::text;
    end if;
  end if;
end;
$$;
-- Draft saves (B01 S4) with the guard. The new overload's body is the B01
-- body plus the check lock and both tests; the old one adds only key_sent.
create function public.knowledge_save_draft(
  p_check_id uuid,
  p_draft_revision integer,
  p_payload jsonb,
  p_asset_ids uuid[],
  p_idempotency_key uuid,
  p_base_sent_at timestamptz
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
  v_existing public.knowledge_drafts;
  v_revision integer;
  v_saved timestamptz;
begin
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id;
  if not found or private.knowledge_basis(v_check.venue_id) is null then
    raise exception 'amenity_check_not_found' using errcode = 'P0002';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text) > 16384 then
    raise exception 'invalid_draft' using errcode = 'P0001';
  end if;
  if cardinality(coalesce(p_asset_ids, '{}')) > 10 then
    raise exception 'invalid_asset_list' using errcode = 'P0001';
  end if;
  -- A send locks the check FOR UPDATE before it deletes the draft, so a save
  -- waits for a concurrent send and then sees it.
  perform 1 from public.venue_amenity_checks c where c.id = p_check_id for share;
  perform private.knowledge_draft_guard(v_uid, p_check_id, p_idempotency_key, p_base_sent_at, true);
  delete from public.knowledge_drafts d
  where d.user_id = v_uid and d.updated_at < now() - interval '90 days';
  select d.* into v_existing from public.knowledge_drafts d
  where d.user_id = v_uid and d.check_id = p_check_id
  for update;
  if found then
    if p_draft_revision is distinct from v_existing.draft_revision then
      raise exception 'draft_conflict' using errcode = 'NLK05',
        detail = jsonb_build_object('draftRevision', v_existing.draft_revision)::text;
    end if;
    update public.knowledge_drafts d
    set payload = p_payload, asset_ids = coalesce(p_asset_ids, '{}'), idempotency_key = p_idempotency_key,
        draft_revision = d.draft_revision + 1, updated_at = now()
    where d.user_id = v_uid and d.check_id = p_check_id
    returning d.draft_revision, d.updated_at into v_revision, v_saved;
  else
    if p_draft_revision is not null then
      raise exception 'draft_conflict' using errcode = 'NLK05',
        detail = jsonb_build_object('draftRevision', null)::text;
    end if;
    insert into public.knowledge_drafts (user_id, check_id, venue_id, draft_revision, payload, asset_ids, idempotency_key)
    values (v_uid, p_check_id, v_check.venue_id, 1, p_payload, coalesce(p_asset_ids, '{}'), p_idempotency_key)
    returning draft_revision, updated_at into v_revision, v_saved;
  end if;
  return jsonb_build_object('draftRevision', v_revision, 'savedAt', v_saved);
end;
$$;


create or replace function public.knowledge_save_draft(
  p_check_id uuid,
  p_draft_revision integer,
  p_payload jsonb,
  p_asset_ids uuid[],
  p_idempotency_key uuid
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
  v_existing public.knowledge_drafts;
  v_revision integer;
  v_saved timestamptz;
begin
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id;
  if not found or private.knowledge_basis(v_check.venue_id) is null then
    raise exception 'amenity_check_not_found' using errcode = 'P0002';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text) > 16384 then
    raise exception 'invalid_draft' using errcode = 'P0001';
  end if;
  if cardinality(coalesce(p_asset_ids, '{}')) > 10 then
    raise exception 'invalid_asset_list' using errcode = 'P0001';
  end if;
  perform private.knowledge_draft_guard(v_uid, p_check_id, p_idempotency_key, null, false);
  delete from public.knowledge_drafts d
  where d.user_id = v_uid and d.updated_at < now() - interval '90 days';
  select d.* into v_existing from public.knowledge_drafts d
  where d.user_id = v_uid and d.check_id = p_check_id
  for update;
  if found then
    if p_draft_revision is distinct from v_existing.draft_revision then
      raise exception 'draft_conflict' using errcode = 'NLK05',
        detail = jsonb_build_object('draftRevision', v_existing.draft_revision)::text;
    end if;
    update public.knowledge_drafts d
    set payload = p_payload, asset_ids = coalesce(p_asset_ids, '{}'), idempotency_key = p_idempotency_key,
        draft_revision = d.draft_revision + 1, updated_at = now()
    where d.user_id = v_uid and d.check_id = p_check_id
    returning d.draft_revision, d.updated_at into v_revision, v_saved;
  else
    if p_draft_revision is not null then
      raise exception 'draft_conflict' using errcode = 'NLK05',
        detail = jsonb_build_object('draftRevision', null)::text;
    end if;
    insert into public.knowledge_drafts (user_id, check_id, venue_id, draft_revision, payload, asset_ids, idempotency_key)
    values (v_uid, p_check_id, v_check.venue_id, 1, p_payload, coalesce(p_asset_ids, '{}'), p_idempotency_key)
    returning draft_revision, updated_at into v_revision, v_saved;
  end if;
  return jsonb_build_object('draftRevision', v_revision, 'savedAt', v_saved);
end;
$$;


-- ---------------------------------------------------------------------------
-- Re-created B01 reads and send: additive keys only
-- ---------------------------------------------------------------------------

-- B01 S2 plus mySentAt: the caller's own latest send on this check, the base
-- for p_base_sent_at. Never another person's time.
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


-- B01 S3 plus sentAt, the contribution's created_at, so a form that stays open
-- after sending can use it as its next draft base.
create or replace function public.knowledge_submit(
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
  p_confirm_own boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.knowledge_lock_actor();
  v_kind text := coalesce(p_kind, 'finding');
  v_confirm_own boolean := coalesce(p_confirm_own, false);
  v_assets uuid[] := coalesce(p_asset_ids, '{}');
  v_hash text;
  v_prior jsonb;
  v_check public.venue_amenity_checks;
  v_rule public.knowledge_question_rules;
  v_template public.amenity_catalogue;
  v_basis text;
  v_manager boolean;
  v_revision bigint;
  v_finding text;
  v_limitations text;
  v_reason text;
  v_tried text;
  v_change text;
  v_preset text;
  v_asset uuid;
  v_why text;
  v_kinds text[];
  v_metadata jsonb;
  v_others boolean;
  v_outcome text;
  v_contribution public.knowledge_contributions;
  v_old record;
  v_replaced_at timestamptz;
  v_replaced uuid;
  v_submission uuid;
  v_responds public.knowledge_decisions;
  v_result jsonb;
begin
  if p_idempotency_key is null then
    raise exception 'invalid_idempotency_key' using errcode = '22023';
  end if;
  if v_kind not in ('finding', 'change_report', 'detail') then
    raise exception 'invalid_kind' using errcode = 'P0001';
  end if;
  if p_answer is null or p_answer not in ('yes', 'no', 'not_applicable', 'unknown') then
    raise exception 'invalid_answer' using errcode = 'P0001';
  end if;

  v_hash := private.knowledge_hash(jsonb_build_object(
    'checkId', p_check_id, 'slotRevision', p_slot_revision, 'kind', v_kind, 'answer', p_answer,
    'finding', p_finding, 'limitations', p_limitations, 'reason', p_reason,
    'unknownPreset', p_unknown_preset, 'triedText', p_tried_text, 'changeReason', p_change_reason,
    'respondsTo', p_responds_to,
    'assetIds', (select coalesce(jsonb_agg(a order by a), '[]'::jsonb) from unnest(v_assets) a),
    'internalMetadata', p_internal_metadata, 'redactionConfirmed', p_redaction_confirmed,
    'confirmOwn', v_confirm_own
  ));
  v_prior := private.knowledge_replay(p_idempotency_key, v_uid, 'submit', v_hash);
  if v_prior is not null then
    return v_prior || jsonb_build_object('recognition',
      private.knowledge_contribution_view((v_prior ->> 'contributionId')::uuid) -> 'recognition',
      'sentAt', (select x.created_at from public.knowledge_contributions x
        where x.id = (v_prior ->> 'contributionId')::uuid));
  end if;

  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id;
  if not found then
    raise exception 'amenity_check_not_found' using errcode = 'P0002';
  end if;
  v_basis := private.knowledge_basis(v_check.venue_id);
  if v_basis is null then
    raise exception 'amenity_check_not_found' using errcode = 'P0002';
  end if;
  if not private.knowledge_in_scope(v_check.venue_id, v_check.template_key) then
    raise exception 'knowledge_slot_out_of_scope' using errcode = 'NLK02';
  end if;
  v_rule := private.knowledge_rule(v_check.template_key);
  v_manager := v_basis in ('venue_manager', 'admin');
  if v_confirm_own and not v_manager then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  if v_confirm_own and v_rule.confirmation <> 'none' and not v_rule.self_confirmation_allowed then
    raise exception 'self_confirmation_not_permitted' using errcode = 'NLK04';
  end if;

  if cardinality(v_assets) > 10
     or array_position(v_assets, null) is not null
     or (select count(distinct a) from unnest(v_assets) a) <> cardinality(v_assets) then
    raise exception 'invalid_asset_list' using errcode = 'P0001';
  end if;

  -- Lock order (§4.4): profile (above), key (above), assets, then the check.
  perform 1 from public.media_assets a
  where a.id = any(v_assets) and a.venue_id = v_check.venue_id
  order by a.id
  for share;
  select c.* into v_check from public.venue_amenity_checks c where c.id = p_check_id for update;
  perform private.amenity_assert_venue_active(v_check.venue_id);
  if v_check.status = 'archived' then
    raise exception 'amenity_check_archived' using errcode = 'P0001';
  end if;
  v_revision := private.knowledge_slot_revision(v_check.venue_id, v_check.template_key);
  if p_slot_revision is distinct from v_revision then
    raise exception 'amenity_conflict' using errcode = 'P0001',
      detail = jsonb_build_object('revision', v_revision)::text;
  end if;

  v_finding := private.clean_text(p_finding, 2000, 'invalid_finding');
  v_limitations := private.clean_text(p_limitations, 2000, 'invalid_limitations');
  v_reason := private.clean_text(p_reason, 500, 'invalid_reason');
  v_change := private.clean_text(p_change_reason, 500, 'invalid_change_reason');
  if p_answer in ('no', 'not_applicable') and v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  if p_answer = 'unknown' then
    v_preset := p_unknown_preset;
    if v_preset is null or v_preset not in ('no_one_sure', 'could_not_access', 'needs_access', 'other') then
      raise exception 'invalid_unknown_preset' using errcode = 'P0001';
    end if;
    v_tried := private.clean_text(p_tried_text, 500, 'invalid_tried_text');
    if v_tried is null then
      raise exception 'tried_text_required' using errcode = 'P0001';
    end if;
  end if;
  if v_kind = 'change_report' and v_change is null then
    raise exception 'change_reason_required' using errcode = 'P0001';
  end if;
  if v_kind = 'detail' then
    select d.* into v_responds from public.knowledge_decisions d
    join public.knowledge_contributions x on x.id = d.contribution_id
    where d.id = p_responds_to and d.decision = 'detail_requested'
      and x.check_id = v_check.id and x.contributed_by = v_uid;
    if not found or private.knowledge_is_terminal(v_responds.contribution_id) then
      raise exception 'invalid_responds_to' using errcode = 'P0001';
    end if;
  end if;

  foreach v_asset in array v_assets loop
    v_why := private.amenity_asset_ineligibility(v_check, v_asset);
    if v_why is not null then
      raise exception 'evidence_not_eligible' using errcode = 'P0001',
        detail = jsonb_build_object('assetId', v_asset, 'reason', v_why)::text;
    end if;
  end loop;
  select t.* into v_template from public.amenity_catalogue t where t.key = v_check.template_key;
  v_kinds := array(
    select case a.media_type when 'image' then 'photo' else 'video' end
    from public.media_assets a where a.id = any(v_assets)
  );
  if p_answer = 'yes' and not private.amenity_rule_met(v_template.evidence_rule, v_kinds) then
    raise exception 'evidence_rule_unmet' using errcode = 'P0001', detail = v_template.evidence_rule;
  end if;
  if v_check.template_key = 'guest_wifi' then
    if p_answer = 'yes' or p_internal_metadata is not null then
      v_metadata := private.amenity_wifi_metadata(p_internal_metadata);
    end if;
    if (p_answer = 'yes' or 'photo' = any(v_kinds)) and p_redaction_confirmed is distinct from true then
      raise exception 'redaction_not_confirmed' using errcode = 'P0001';
    end if;
  elsif p_internal_metadata is not null then
    raise exception 'invalid_wifi_metadata' using errcode = 'P0001';
  end if;

  v_others := exists (
    select 1 from public.knowledge_contributions x
    where x.check_id = v_check.id and x.contributed_by <> v_uid and x.answer <> 'unknown'
      and not private.knowledge_is_terminal(x.id)
  );
  if p_answer = 'unknown' then
    v_outcome := 'recorded';
  elsif v_manager then
    v_outcome := case
      when v_rule.confirmation = 'none' or v_confirm_own then 'current'
      else 'awaiting_confirmation'
    end;
  elsif v_rule.confirmation = 'none' and v_rule.unassigned_auto_complete
        and v_check.progress in ('needs_capture', 'needs_recheck')
        and (v_check.assignee_user_id is null or v_check.assignee_user_id = v_uid)
        and not v_others then
    v_outcome := 'current';
  else
    v_outcome := 'awaiting_confirmation';
  end if;

  -- At most one undecided finding per person and question (§9.3).
  for v_old in
    select x.id, x.created_at from public.knowledge_contributions x
    where x.check_id = v_check.id and x.contributed_by = v_uid
      and not private.knowledge_is_terminal(x.id)
    order by x.created_at
  loop
    perform private.knowledge_decision(v_check, v_old.id, null, 'replaced', v_uid, 'self',
      false, v_rule.rule_version, null, v_revision, null);
    v_replaced := v_old.id;
    v_replaced_at := v_old.created_at;
  end loop;

  insert into public.knowledge_contributions (
    venue_id, check_id, question_key, contributed_by, contributor_basis, kind, answer,
    finding, limitations, reason, unknown_preset, tried_text, change_reason, responds_to_decision_id,
    based_on_slot_revision, based_on_submission_id, rule_version, template_version, evidence_rule,
    internal_metadata, redaction_confirmed, confirm_own, initial_outcome, idempotency_key, request_hash
  )
  values (
    v_check.venue_id, v_check.id, v_check.template_key, v_uid, v_basis, v_kind, p_answer,
    v_finding, v_limitations, case when p_answer in ('no', 'not_applicable') then v_reason end,
    v_preset, v_tried, v_change, case when v_kind = 'detail' then p_responds_to end,
    v_revision, v_check.current_submission_id, v_rule.rule_version, v_template.catalogue_version,
    v_template.evidence_rule, v_metadata, p_redaction_confirmed, v_confirm_own, v_outcome,
    p_idempotency_key, v_hash
  )
  returning * into v_contribution;

  insert into public.knowledge_contribution_assets (contribution_id, venue_id, asset_id, evidence_kind)
  select v_contribution.id, v_check.venue_id, a.id, case a.media_type when 'image' then 'photo' else 'video' end
  from public.media_assets a where a.id = any(v_assets);

  perform private.knowledge_event(v_check.venue_id, v_check.template_key, v_check.id,
    'contribution_recorded', v_contribution.id, null, null,
    jsonb_build_object('kind', v_kind, 'answer', p_answer, 'outcome', v_outcome));

  if v_outcome = 'current' then
    v_submission := private.knowledge_adopt(
      v_contribution, v_check,
      case when v_manager then v_uid end,
      case when v_manager then v_basis else 'rule' end,
      v_rule.confirmation <> 'none', v_rule.confirmation <> 'none',
      v_revision, v_rule.rule_version
    );
  end if;

  -- The send settles the caller's work on this question, so their draft goes
  -- whatever key it carried: the form may mint a new key before sending.
  delete from public.knowledge_drafts d
  where d.user_id = v_uid and d.check_id = v_check.id;

  v_result := jsonb_build_object(
    'contributionId', v_contribution.id,
    'submissionId', v_submission,
    'outcome', v_outcome,
    'replacedOwn', v_replaced,
    'replacedOwnSentAt', v_replaced_at,
    'slotRevision', private.knowledge_slot_revision(v_check.venue_id, v_check.template_key),
    'replayed', false
  );
  perform private.knowledge_record_command(p_idempotency_key, v_uid, 'submit', v_hash,
    v_check.venue_id, v_check.template_key, v_result);
  -- Recognition is read now, not stored: a later decision can change it.
  return v_result || jsonb_build_object('recognition',
    private.knowledge_contribution_view(v_contribution.id) -> 'recognition',
    'sentAt', v_contribution.created_at);
end;
$$;


-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.amenity_command_replay(uuid, uuid, text, text),
  private.amenity_command_record(uuid, uuid, text, text, uuid, uuid, jsonb),
  private.amenity_keyed_check_write(uuid, text, uuid, jsonb),
  private.knowledge_latest_send(uuid, uuid),
  private.knowledge_draft_guard(uuid, uuid, uuid, timestamptz, boolean)
from public, anon, authenticated;

revoke all on function
  public.amenity_assign_check(uuid, uuid, integer, uuid),
  public.amenity_set_check_notes(uuid, text, integer, uuid),
  public.amenity_reopen_check(uuid, integer, text, text, uuid),
  public.amenity_archive_check(uuid, integer, uuid),
  public.amenity_restore_check(uuid, integer, uuid),
  public.amenity_add_checks(uuid, text[], uuid),
  public.knowledge_save_draft(uuid, integer, jsonb, uuid[], uuid, timestamptz),
  public.knowledge_save_draft(uuid, integer, jsonb, uuid[], uuid),
  public.knowledge_submit(uuid, bigint, uuid, text, text, text, text, text, text, text, text, uuid, uuid[], jsonb, boolean, boolean),
  public.knowledge_check(uuid)
from public, anon, service_role;

grant execute on function
  public.amenity_assign_check(uuid, uuid, integer, uuid),
  public.amenity_set_check_notes(uuid, text, integer, uuid),
  public.amenity_reopen_check(uuid, integer, text, text, uuid),
  public.amenity_archive_check(uuid, integer, uuid),
  public.amenity_restore_check(uuid, integer, uuid),
  public.amenity_add_checks(uuid, text[], uuid),
  public.knowledge_save_draft(uuid, integer, jsonb, uuid[], uuid, timestamptz),
  public.knowledge_save_draft(uuid, integer, jsonb, uuid[], uuid),
  public.knowledge_submit(uuid, bigint, uuid, text, text, text, text, text, text, text, text, uuid, uuid[], jsonb, boolean, boolean),
  public.knowledge_check(uuid)
to authenticated;
