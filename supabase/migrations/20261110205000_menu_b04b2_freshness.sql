-- B04-b2 (b04-design A1-2, A1-3, A1-4, A1-6, A1-8, §19.2 S3; part of task
-- B04-02): menu freshness bindings, the freshness of confirmed trading
-- values, freshness recheck tasks and the binding preview.
--
-- Bindings (A1-3). public.menu_freshness_bindings, append-only, names the
-- B03-e policy (public.knowledge_freshness_policies, exact id and version)
-- for a field and use, per venue or for the estate (venue_id null). The
-- latest binding in force at an instant wins: the venue's, else the
-- estate's. A binding with no policy unbinds from its effective time (the
-- field reads unrated again). No binding means unrated: today's behaviour,
-- and the default. A policy must have basis stated_on (A1-2) and suit the
-- field (price: offering; availability: offering or schedule; the others:
-- any class but event). public.menu_freshness_binding_add (admin) writes
-- one, never retroactively. Bindings for temporary_unavailability, dietary
-- and allergens are stored but not applied in b2 (a passed `until` already
-- governs temporary unavailability; statements arrive with B04-c).
--
-- Freshness (A1-2, A1-6). The basis is the confirming decision's stated_on,
-- never a capture, snapshot or save time. private.menu_trading_freshness
-- applies B03's private.knowledge_freshness_entry per use: due at local
-- midnight of stated_on plus max_age; due_soon from due minus the lead;
-- expired from due; basis_missing when a bound value has no stated_on (only
-- values confirmed before A1-2; S2 always records one). Reads (line and
-- history) keep S2's output when nothing is bound. When bound, a confirmed
-- price or availability carries `freshness` [internal, public]; when its
-- internal entry is expired or basis_missing it reads unavailable / stale
-- (price) or unknown / stale (availability), with the value still shown to
-- admins and managers (`staleValue`), never to staff. Withdrawn, disputed
-- and unknown come first (A1-6 precedence). An availability that follows a
-- linked B03 service gets no menu binding (A1-4).
--
-- Rechecks (A1-4). menu_trading_recheck_tasks gains `field` (the subject's
-- field; null for b1's temporary_until_passed rows) in its once-only key, so
-- a line's price and availability tasks never collide.
-- private.menu_open_rechecks also opens due_soon and expired (due at the
-- entry's nextCheckDue) and basis_missing (due at the binding's
-- effective_from) per bound field and use, idempotently, under the same
-- locks; private.menu_close_rechecks closes them only when that field reads
-- current again for the task's use (a re-statement), never on a pending,
-- declined or withdrawn value. Time never moves a photo (A1-1, C-B04-4).
--
-- Preview (A1-3). public.menu_freshness_preview(p_venue, p_field, p_policy)
-- (admin, STABLE, no write) counts, per use, how the live lines' confirmed
-- values would read under the named policies now.
--
-- Rollback: revoke the new functions, re-create the S2 bodies of
-- private.menu_trading_line_json, public.menu_trading_history,
-- private.menu_open_rechecks and private.menu_close_rechecks; the tables and
-- the task column stay.

-- ---------------------------------------------------------------------------
-- Recheck tasks: the subject's field
-- ---------------------------------------------------------------------------

alter table public.menu_trading_recheck_tasks
  add column field text check (field is null or field in ('price', 'availability', 'temporary_unavailability'));
alter table public.menu_trading_recheck_tasks drop constraint menu_trading_recheck_tasks_once;
alter table public.menu_trading_recheck_tasks add constraint menu_trading_recheck_tasks_once
  unique nulls not distinct (line_id, statement_id, field, cause, due_at, use);
alter table public.menu_trading_recheck_tasks add constraint menu_trading_recheck_tasks_freshness_field
  check (cause not in ('due_soon', 'expired', 'basis_missing') or field in ('price', 'availability'));

-- ---------------------------------------------------------------------------
-- Bindings
-- ---------------------------------------------------------------------------

create table public.menu_freshness_bindings (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid references public.venues (id) on delete restrict,
  field text not null check (field in ('price', 'availability', 'temporary_unavailability', 'dietary', 'allergens')),
  use text not null check (use in ('internal', 'public')),
  policy_id text,
  policy_version integer,
  approved_by uuid not null references public.profiles (id) on delete restrict,
  effective_from timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint menu_freshness_bindings_policy_fkey foreign key (policy_id, policy_version)
    references public.knowledge_freshness_policies (id, version) on delete restrict,
  constraint menu_freshness_bindings_policy_pair check ((policy_id is null) = (policy_version is null)),
  constraint menu_freshness_bindings_once unique nulls not distinct (venue_id, field, use, effective_from)
);

create index menu_freshness_bindings_lookup
  on public.menu_freshness_bindings (field, use, venue_id, effective_from desc);

comment on table public.menu_freshness_bindings is
  'Append-only: which B03 freshness policy (exact version) applies to a trading field and use, per venue or for the estate (A1-3). No binding, or a binding with no policy, reads unrated.';

-- A policy must have basis stated_on (A1-2) and suit the field (A1-3).
create function private.menu_freshness_bindings_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_policy public.knowledge_freshness_policies;
begin
  if new.policy_id is null then
    return new;
  end if;
  select p.* into v_policy from public.knowledge_freshness_policies p
  where p.id = new.policy_id and p.version = new.policy_version;
  if v_policy.use is distinct from new.use or v_policy.basis is distinct from 'stated_on'
     or not (case new.field
       when 'price' then v_policy.claim_class = 'offering'
       when 'availability' then v_policy.claim_class in ('offering', 'schedule')
       else v_policy.claim_class <> 'event' end) then
    raise exception 'freshness_policy_unsuitable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger menu_freshness_bindings_guard
  before insert on public.menu_freshness_bindings
  for each row execute function private.menu_freshness_bindings_guard();
create trigger menu_freshness_bindings_append_only
  before update or delete on public.menu_freshness_bindings
  for each row execute function private.append_only_guard();
create trigger menu_freshness_bindings_no_truncate
  before truncate on public.menu_freshness_bindings
  for each statement execute function private.append_only_guard();

revoke all on public.menu_freshness_bindings from public, anon, authenticated, service_role;
grant select on public.menu_freshness_bindings to service_role;
alter table public.menu_freshness_bindings enable row level security;

-- The policy (exact version) bound to a venue's field and use at p_at: the
-- venue's latest binding in force, else the estate's; null when none, or
-- when the binding in force names no policy.
create function private.menu_freshness_policy_at(p_venue_id uuid, p_field text, p_use text, p_at timestamptz)
returns public.knowledge_freshness_policies
language sql
stable
security definer
set search_path = ''
as $$
  select p.*
  from (
    select b.policy_id, b.policy_version
    from public.menu_freshness_bindings b
    where b.field = p_field and b.use = p_use and b.effective_from <= p_at
      and (b.venue_id = p_venue_id or b.venue_id is null)
    order by (b.venue_id is null), b.effective_from desc, b.created_at desc
    limit 1
  ) b
  join public.knowledge_freshness_policies p on p.id = b.policy_id and p.version = b.policy_version;
$$;

-- Whether any binding row (with or without a policy) concerns the venue's
-- field: an unbound field keeps S2's read unchanged.
create function private.menu_freshness_bound(p_venue_id uuid, p_field text, p_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.menu_freshness_bindings b
    where b.field = p_field and b.effective_from <= p_at
      and (b.venue_id = p_venue_id or b.venue_id is null));
$$;

-- [internal, public] freshness entries of a confirmed field state at p_at
-- (B03's entry: use, state, nextCheckDue, basis, basisDate; plus policyId
-- and policyVersion), or null when the state is not a confirmed value or no
-- binding concerns the field. The basis date is the state's statedOn.
create function private.menu_trading_freshness(p_venue_id uuid, p_field text, p_state jsonb, p_at timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_use text;
  v_policy public.knowledge_freshness_policies;
  v_date date;
begin
  if p_state ->> 'status' is distinct from 'available' or not private.menu_freshness_bound(p_venue_id, p_field, p_at) then
    return null;
  end if;
  v_date := case when p_state ->> 'statedOn' ~ '^\d{4}-\d{2}-\d{2}$' then (p_state ->> 'statedOn')::date end;
  foreach v_use in array array['internal', 'public'] loop
    v_policy := private.menu_freshness_policy_at(p_venue_id, p_field, v_use, p_at);
    v_out := v_out || (private.knowledge_freshness_entry(v_use, v_policy.max_age, v_policy.recheck_lead,
        v_policy.basis, v_date, null, p_at, private.venue_timezone(p_venue_id))
      || jsonb_build_object('policyId', v_policy.id, 'policyVersion', v_policy.version));
  end loop;
  return v_out;
end;
$$;

-- The price of a line as read by p_role at p_at (A1-6): S2's field state,
-- with freshness when bound; stale when its internal entry is expired or
-- basis_missing (the value shown to admins and managers only).
create function private.menu_trading_read_price(p_line public.menu_trading_lines, p_role text, p_at timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_state jsonb := private.menu_trading_field_state(p_line.id, 'price', p_at);
  v_fresh jsonb := private.menu_trading_freshness(p_line.venue_id, 'price', v_state, p_at);
begin
  if v_fresh is null then
    return v_state;
  end if;
  if v_fresh #>> '{0,state}' in ('expired', 'basis_missing') then
    return jsonb_build_object('status', 'unavailable', 'reason', 'stale', 'detail', v_fresh #>> '{0,state}',
        'nextCheckDue', v_fresh #> '{0,nextCheckDue}', 'freshness', v_fresh)
      || case when p_role in ('admin', 'manager') then jsonb_build_object('staleValue', v_state) else '{}'::jsonb end;
  end if;
  return v_state || jsonb_build_object('freshness', v_fresh);
end;
$$;

-- The availability of a line as read by p_role at p_at (A1-6): S2's state,
-- with the confirmed availability's freshness when bound; unknown / stale
-- when its internal entry is expired or basis_missing. Temporary
-- unavailability and a linked B03 service are left as S2 reads them.
create function private.menu_trading_read_availability(
  p_line public.menu_trading_lines, p_role text, p_at timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_read jsonb := private.menu_trading_availability(p_line.id, p_at);
  v_state jsonb;
  v_fresh jsonb;
begin
  if v_read ->> 'state' in ('temporarily_unavailable', 'needs_checking') then
    return v_read;
  end if;
  v_state := private.menu_trading_field_state(p_line.id, 'availability', p_at);
  if v_state #>> '{value,state}' = 'scheduled' and exists (
       select 1 from public.menu_availability_schedules s
       where s.id = (v_state #>> '{value,scheduleId}')::uuid and s.knowledge_check_id is not null) then
    return v_read;
  end if;
  v_fresh := private.menu_trading_freshness(p_line.venue_id, 'availability', v_state, p_at);
  if v_fresh is null then
    return v_read;
  end if;
  if v_fresh #>> '{0,state}' in ('expired', 'basis_missing') then
    return jsonb_build_object('state', 'unknown', 'reason', 'stale', 'detail', v_fresh #>> '{0,state}',
        'nextCheckDue', v_fresh #> '{0,nextCheckDue}', 'freshness', v_fresh)
      || case when p_role in ('admin', 'manager') then jsonb_build_object('staleValue', v_read) else '{}'::jsonb end;
  end if;
  return v_read || jsonb_build_object('freshness', v_fresh);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads: S2's bodies, with the freshness-aware price and availability
-- ---------------------------------------------------------------------------

create or replace function private.menu_trading_line_json(p_line public.menu_trading_lines, p_role text, p_at timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'lineId', p_line.id,
    'revision', p_line.revision,
    'itemId', p_line.item_id,
    'variantId', p_line.variant_id,
    'portion', case when p_line.portion_label is null then null else jsonb_strip_nulls(jsonb_build_object(
      'label', p_line.portion_label, 'quantity', p_line.portion_quantity, 'unit', p_line.portion_unit)) end,
    'channel', p_line.channel,
    'retiredAt', p_line.retired_at,
    'price', private.menu_trading_read_price(p_line, p_role, p_at),
    'availability', private.menu_trading_read_availability(p_line, p_role, p_at))
  || case when p_role in ('admin', 'manager') then jsonb_build_object(
    'pending', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'assertionId', a.id, 'field', a.field, 'value', a.value, 'basis', a.basis,
          'effectiveFrom', a.effective_from, 'effectiveTo', a.effective_to, 'observedOn', a.observed_on,
          'statedAt', a.stated_at, 'statedBy', a.stated_by, 'reason', a.reason, 'supersedes', a.supersedes)
        || case when p_role = 'admin' then jsonb_build_object(
          'snapshotId', a.snapshot_id, 'sourceLocator', a.source_locator, 'rawText', a.raw_text)
          else '{}'::jsonb end
        order by a.seq)
      from public.menu_trading_assertions a
      where a.line_id = p_line.id
        and not exists (select 1 from public.menu_trading_decisions d where d.assertion_id = a.id)), '[]'::jsonb),
    'rechecks', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('taskId', t.id, 'cause', t.cause, 'use', t.use,
          'field', t.field, 'dueAt', t.due_at, 'createdAt', t.created_at)) order by t.due_at, t.id)
      from public.menu_trading_recheck_tasks t
      where t.line_id = p_line.id and t.state = 'open'), '[]'::jsonb))
  else jsonb_build_object(
    'myPending', coalesce((
      select jsonb_agg(jsonb_build_object('assertionId', a.id, 'field', a.field, 'value', a.value,
          'statedAt', a.stated_at) order by a.seq)
      from public.menu_trading_assertions a
      where a.line_id = p_line.id and a.stated_by = auth.uid()
        and not exists (select 1 from public.menu_trading_decisions d where d.assertion_id = a.id)), '[]'::jsonb))
  end;
$$;

create or replace function public.menu_trading_history(p_line uuid, p_at timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_line public.menu_trading_lines;
  v_role text;
  v_at timestamptz := coalesce(p_at, now());
begin
  if auth.uid() is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  select l.* into v_line from public.menu_trading_lines l where l.id = p_line;
  if not found then
    raise exception 'menu_trading_line_not_found' using errcode = 'P0002';
  end if;
  v_role := private.menu_trading_role(v_line.venue_id, false);
  if v_role is null or v_role not in ('admin', 'manager') then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'lineId', v_line.id,
    'itemId', v_line.item_id,
    'variantId', v_line.variant_id,
    'portion', case when v_line.portion_label is null then null else jsonb_strip_nulls(jsonb_build_object(
      'label', v_line.portion_label, 'quantity', v_line.portion_quantity, 'unit', v_line.portion_unit)) end,
    'channel', v_line.channel,
    'view', v_role,
    'at', v_at,
    'price', private.menu_trading_read_price(v_line, v_role, v_at),
    'availability', private.menu_trading_read_availability(v_line, v_role, v_at),
    'temporaryUnavailability', private.menu_trading_field_state(v_line.id, 'temporary_unavailability', v_at),
    'assertions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'assertionId', a.id, 'field', a.field, 'value', a.value, 'basis', a.basis,
          'effectiveFrom', a.effective_from, 'effectiveTo', a.effective_to, 'observedOn', a.observed_on,
          'statedAt', a.stated_at, 'statedBy', a.stated_by, 'reason', a.reason, 'supersedes', a.supersedes,
          'resolution', private.menu_trading_resolution(a.id, v_at),
          'decisions', coalesce((
            select jsonb_agg(jsonb_build_object(
                'decisionId', d.id, 'decision', d.decision, 'decidedAt', d.decided_at,
                'decidedBy', d.decided_by, 'reason', d.reason, 'statedOn', d.stated_on,
                'statedOnSource', d.stated_on_source, 'selfConfirmed', d.self_confirmed,
                'ruleVersion', d.rule_version) order by d.seq)
            from public.menu_trading_decisions d
            where d.assertion_id = a.id and d.decided_at <= v_at), '[]'::jsonb))
        || case when v_role = 'admin' then jsonb_build_object(
          'snapshotId', a.snapshot_id, 'sourceLocator', a.source_locator, 'rawText', a.raw_text)
          else '{}'::jsonb end
        order by a.seq)
      from public.menu_trading_assertions a
      where a.line_id = v_line.id and a.stated_at <= v_at), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Rechecks: S2's bodies plus the freshness causes
-- ---------------------------------------------------------------------------

-- S2's temporary_until_passed rule, unchanged; plus a due_soon, expired or
-- basis_missing task closes when its field reads current for the task's use
-- at p_now (a confirmed value, re-stated within the policy). Callers hold
-- the venue menu lock (shared) and the line row lock.
create or replace function private.menu_close_rechecks(p_line_id uuid, p_now timestamptz)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_task public.menu_trading_recheck_tasks;
  v_state jsonb;
  v_current boolean;
  v_fresh jsonb;
  v_venue uuid;
  v_closed integer := 0;
begin
  if not exists (select 1 from public.menu_trading_recheck_tasks t where t.line_id = p_line_id and t.state = 'open') then
    return 0;
  end if;
  v_state := private.menu_trading_field_state(p_line_id, 'temporary_unavailability', p_now);
  v_current := v_state ->> 'status' = 'available' and (
    v_state #>> '{value,state}' = 'back_in_service'
    or (v_state #>> '{value,state}' = 'temporarily_unavailable'
        and (jsonb_typeof(v_state #> '{value,until}') = 'null'
             or (v_state #>> '{value,until}')::timestamptz > p_now)));
  select l.venue_id into v_venue from public.menu_trading_lines l where l.id = p_line_id;
  for v_task in
    select t.* from public.menu_trading_recheck_tasks t
    where t.line_id = p_line_id and t.state = 'open'
      and t.cause in ('temporary_until_passed', 'due_soon', 'expired', 'basis_missing')
    order by t.created_at, t.id
    for update
  loop
    if v_task.cause = 'temporary_until_passed' then
      if not (v_task.use = 'internal'
              and coalesce(v_current and (v_state ->> 'assertionId')::uuid is distinct from v_task.assertion_id, false)) then
        continue;
      end if;
    else
      v_fresh := private.menu_trading_freshness(v_venue, v_task.field,
        private.menu_trading_field_state(p_line_id, v_task.field, p_now), p_now);
      if v_fresh is null or not exists (
           select 1 from jsonb_array_elements(v_fresh) e
           where e ->> 'use' = v_task.use and e ->> 'state' = 'current') then
        continue;
      end if;
    end if;
    update public.menu_trading_recheck_tasks t
    set state = 'done', closed_at = now(),
        closed_by = (select p.id from public.profiles p where p.id = auth.uid())
    where t.id = v_task.id;
    v_closed := v_closed + 1;
  end loop;
  return v_closed;
end;
$$;

-- S2's job, unchanged for temporary_until_passed; plus, for each eligible
-- line of a venue with a binding in force, each bound field's confirmed
-- value and use: due_soon or expired (due at nextCheckDue) and
-- basis_missing (due at the binding's effective_from), once per subject,
-- field, cause, due time and use.
create or replace function private.menu_open_rechecks(p_now timestamptz, p_venue_ids uuid[] default null)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_venue uuid;
  v_line public.menu_trading_lines;
  v_state jsonb;
  v_count integer;
  v_opened integer := 0;
  v_bound boolean;
  v_field text;
  v_fresh jsonb;
  v_entry jsonb;
  v_due timestamptz;
begin
  if p_now is null then
    raise exception 'invalid_recheck_instant' using errcode = '22023';
  end if;
  for v_venue in
    select distinct l.venue_id from public.menu_trading_lines l
    where p_venue_ids is null or l.venue_id = any (p_venue_ids)
    order by 1
  loop
    perform private.lock_venue_menu(v_venue, true);
    v_bound := private.menu_freshness_bound(v_venue, 'price', p_now)
      or private.menu_freshness_bound(v_venue, 'availability', p_now);
    for v_line in
      select l.* from public.menu_trading_lines l
      where l.venue_id = v_venue
        and (v_bound
             or exists (select 1 from public.menu_trading_assertions a
                        where a.line_id = l.id and a.field = 'temporary_unavailability')
             or exists (select 1 from public.menu_trading_recheck_tasks t
                        where t.line_id = l.id and t.state = 'open'))
      order by l.id
      for update
    loop
      if v_line.retired_at is null and private.menu_trading_item_active(v_line.item_id, v_line.variant_id) then
        v_state := private.menu_trading_temporary_state(v_line.id, p_now);
        if v_state ->> 'state' = 'needs_checking' then
          insert into public.menu_trading_recheck_tasks (venue_id, line_id, assertion_id, cause, use, due_at)
          values (v_line.venue_id, v_line.id, (v_state ->> 'assertionId')::uuid, 'temporary_until_passed',
            'internal', (v_state ->> 'until')::timestamptz)
          on conflict on constraint menu_trading_recheck_tasks_once do nothing;
          get diagnostics v_count = row_count;
          v_opened := v_opened + v_count;
        end if;
        if v_bound then
          foreach v_field in array array['price', 'availability'] loop
            v_state := private.menu_trading_field_state(v_line.id, v_field, p_now);
            if v_field = 'availability' and v_state #>> '{value,state}' = 'scheduled' and exists (
                 select 1 from public.menu_availability_schedules s
                 where s.id = (v_state #>> '{value,scheduleId}')::uuid and s.knowledge_check_id is not null) then
              continue;
            end if;
            v_fresh := private.menu_trading_freshness(v_venue, v_field, v_state, p_now);
            continue when v_fresh is null;
            for v_entry in select e from jsonb_array_elements(v_fresh) e loop
              continue when v_entry ->> 'state' not in ('due_soon', 'expired', 'basis_missing');
              v_due := case when v_entry ->> 'state' = 'basis_missing' then (
                  select b.effective_from from public.menu_freshness_bindings b
                  where b.field = v_field and b.use = v_entry ->> 'use' and b.effective_from <= p_now
                    and (b.venue_id = v_venue or b.venue_id is null)
                  order by (b.venue_id is null), b.effective_from desc, b.created_at desc limit 1)
                else (v_entry ->> 'nextCheckDue')::timestamptz end;
              insert into public.menu_trading_recheck_tasks (venue_id, line_id, assertion_id, field, cause, use, due_at)
              values (v_line.venue_id, v_line.id, (v_state ->> 'assertionId')::uuid, v_field, v_entry ->> 'state',
                v_entry ->> 'use', v_due)
              on conflict on constraint menu_trading_recheck_tasks_once do nothing;
              get diagnostics v_count = row_count;
              v_opened := v_opened + v_count;
            end loop;
          end loop;
        end if;
      end if;
      perform private.menu_close_rechecks(v_line.id, p_now);
    end loop;
  end loop;
  return v_opened;
end;
$$;

-- ---------------------------------------------------------------------------
-- Commands and the preview
-- ---------------------------------------------------------------------------

-- Bind a field and use to a policy version (admin), for a venue or for the
-- estate (p_venue null), from p_effective_from (null: now; never earlier).
-- p_policy_id null unbinds. Returns { bindingId, venueId, field, use,
-- policyId, policyVersion, effectiveFrom }.
create function public.menu_freshness_binding_add(
  p_venue uuid,
  p_field text,
  p_use text,
  p_policy_id text,
  p_policy_version integer,
  p_effective_from timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v_row public.menu_freshness_bindings;
begin
  if p_field is null or p_field not in ('price', 'availability', 'temporary_unavailability', 'dietary', 'allergens')
     or p_use is null or p_use not in ('internal', 'public')
     or (p_policy_id is null) <> (p_policy_version is null) then
    raise exception 'invalid_freshness_binding' using errcode = '22023';
  end if;
  if p_effective_from is not null and p_effective_from < now() then
    raise exception 'invalid_effective_from' using errcode = '22023';
  end if;
  if p_venue is not null and not exists (select 1 from public.venues v where v.id = p_venue) then
    raise exception 'venue_not_found' using errcode = 'P0002';
  end if;
  if p_policy_id is not null and not exists (
       select 1 from public.knowledge_freshness_policies p where p.id = p_policy_id and p.version = p_policy_version) then
    raise exception 'freshness_policy_not_found' using errcode = 'P0002';
  end if;
  if p_venue is not null then
    perform private.lock_venue_menu(p_venue, false);
  end if;
  insert into public.menu_freshness_bindings (venue_id, field, use, policy_id, policy_version, approved_by, effective_from)
  values (p_venue, p_field, p_use, p_policy_id, p_policy_version, v_uid, coalesce(p_effective_from, now()))
  returning * into v_row;
  return jsonb_build_object('bindingId', v_row.id, 'venueId', v_row.venue_id, 'field', v_row.field,
    'use', v_row.use, 'policyId', v_row.policy_id, 'policyVersion', v_row.policy_version,
    'effectiveFrom', v_row.effective_from);
end;
$$;

-- Admin, no write (A1-3, as B03 §7.3): how naming p_policy ({ internal?,
-- public? } policy ids, latest version each) for p_field would read the
-- confirmed values of the live lines on the active menu of p_venue (null:
-- every venue) now. Returns { field, venueId, policy, lines, counts:
-- { internal|public: { current, due_soon, expired, basis_missing } } }.
create function public.menu_freshness_preview(p_venue uuid, p_field text, p_policy jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_use text;
  v_counts jsonb := '{}'::jsonb;
  v_lines integer;
begin
  perform private.assert_active_admin();
  if p_field is null or p_field not in ('price', 'availability')
     or jsonb_typeof(p_policy) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_policy) k where k not in ('internal', 'public')) then
    raise exception 'invalid_freshness_binding' using errcode = '22023';
  end if;
  foreach v_use in array array['internal', 'public'] loop
    if p_policy ->> v_use is not null and not exists (
         select 1 from public.knowledge_freshness_policies p
         where p.id = p_policy ->> v_use and p.use = v_use and p.basis = 'stated_on') then
      raise exception 'freshness_policy_not_found' using errcode = 'P0002';
    end if;
  end loop;

  with lines as (
    select l.id, l.venue_id, private.menu_trading_field_state(l.id, p_field, now()) as state
    from public.menu_trading_lines l
    where (p_venue is null or l.venue_id = p_venue) and l.retired_at is null
      and private.menu_trading_item_active(l.item_id, l.variant_id)
  ),
  entries as (
    select u.use, private.knowledge_freshness_entry(u.use, p.max_age, p.recheck_lead, p.basis,
        case when s.state ->> 'statedOn' ~ '^\d{4}-\d{2}-\d{2}$' then (s.state ->> 'statedOn')::date end,
        null, now(), private.venue_timezone(s.venue_id)) ->> 'state' as state
    from lines s
    cross join (values ('internal'), ('public')) u(use)
    join lateral (
      select p.* from public.knowledge_freshness_policies p
      where p.id = p_policy ->> u.use and p.use = u.use order by p.version desc limit 1
    ) p on true
    where s.state ->> 'status' = 'available'
  )
  select coalesce(jsonb_object_agg(x.use, x.counts), '{}'::jsonb) into v_counts
  from (
    select e.use, jsonb_build_object(
        'current', count(*) filter (where e.state = 'current'),
        'due_soon', count(*) filter (where e.state = 'due_soon'),
        'expired', count(*) filter (where e.state = 'expired'),
        'basis_missing', count(*) filter (where e.state = 'basis_missing')) as counts
    from entries e group by e.use
  ) x;
  select count(*) into v_lines
  from public.menu_trading_lines l
  where (p_venue is null or l.venue_id = p_venue) and l.retired_at is null
    and private.menu_trading_item_active(l.item_id, l.variant_id);
  return jsonb_build_object('field', p_field, 'venueId', p_venue, 'policy', p_policy, 'lines', v_lines,
    'counts', v_counts);
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.menu_freshness_bindings_guard(),
  private.menu_freshness_policy_at(uuid, text, text, timestamptz),
  private.menu_freshness_bound(uuid, text, timestamptz),
  private.menu_trading_freshness(uuid, text, jsonb, timestamptz),
  private.menu_trading_read_price(public.menu_trading_lines, text, timestamptz),
  private.menu_trading_read_availability(public.menu_trading_lines, text, timestamptz)
from public, anon, authenticated;

revoke all on function
  public.menu_freshness_binding_add(uuid, text, text, text, integer, timestamptz),
  public.menu_freshness_preview(uuid, text, jsonb)
from public, anon, service_role;

grant execute on function
  public.menu_freshness_binding_add(uuid, text, text, text, integer, timestamptz),
  public.menu_freshness_preview(uuid, text, jsonb)
to authenticated;
