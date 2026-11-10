-- B08-a (S1): scoring policy registry, effective-dated policy assignment,
-- closed-month protection, and month-close snapshots with a drift read.
--
-- Nothing here changes a count, a progress read or a credit function. No
-- venue is enrolled, no existing row is rewritten and no v2 policy exists.
-- An absent row in force, or a row in force with a NULL target_count, is still
-- the accepted-photo basis, whatever the new identity columns default to.
-- Rollback: revoke public.scoring_assign_policy; the additive columns keep
-- their defaults and the snapshots stay.

-- ---------------------------------------------------------------------------
-- Policy registry
-- ---------------------------------------------------------------------------

-- The flag set a policy must record in full, so the registry states today's
-- behaviour explicitly rather than by omission.
create function private.scoring_rules_valid(p_policy_key text, p_rules jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_rules is null or jsonb_typeof(p_rules) <> 'object' then false
    when p_policy_key = 'combined' then
      array(select k from jsonb_object_keys(p_rules) k order by k collate "C") = array[
        'archive_keeps', 'credit_month', 'first_completer_keeps', 'grace_days',
        'photo_scores_once', 'require_gap_or_refresh', 'self_review_scores',
        'system_recheck_keeps', 'unit_scope']
      and p_rules ->> 'unit_scope' in ('author', 'subject')
      and jsonb_typeof(p_rules -> 'require_gap_or_refresh') = 'boolean'
      and jsonb_typeof(p_rules -> 'first_completer_keeps') = 'boolean'
      and jsonb_typeof(p_rules -> 'system_recheck_keeps') = 'boolean'
      and jsonb_typeof(p_rules -> 'photo_scores_once') = 'boolean'
      and jsonb_typeof(p_rules -> 'self_review_scores') = 'boolean'
      and jsonb_typeof(p_rules -> 'archive_keeps') = 'boolean'
      and p_rules ->> 'credit_month' in ('decision', 'send_with_grace')
      and jsonb_typeof(p_rules -> 'grace_days') = 'number'
      and (p_rules ->> 'grace_days') ~ '^[0-9]{1,2}$'
      and ((p_rules ->> 'credit_month') = 'send_with_grace') = ((p_rules ->> 'grace_days')::integer > 0)
    when p_policy_key = 'accepted_photos' then
      array(select k from jsonb_object_keys(p_rules) k order by k collate "C") = array[
        'credit_month', 'late_acceptance_changes_closed_month', 'target_scope', 'unit']
      and p_rules ->> 'unit' = 'accepted_photo_asset'
      and p_rules ->> 'target_scope' = 'person'
      and p_rules ->> 'credit_month' = 'upload_and_submit_month'
      and jsonb_typeof(p_rules -> 'late_acceptance_changes_closed_month') = 'boolean'
    else false
  end;
$$;

create table private.scoring_policies (
  policy_key text not null check (policy_key in ('combined', 'accepted_photos')),
  version integer not null check (version >= 1),
  rules jsonb not null,
  description text not null check (description = btrim(description) and length(description) between 1 and 500),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (policy_key, version),
  constraint scoring_policies_rules_valid check (private.scoring_rules_valid(policy_key, rules)),
  constraint scoring_policies_approval_pair check ((approved_by is null) = (approved_at is null))
);

alter table private.scoring_policies enable row level security;
revoke all on table private.scoring_policies from public, anon, authenticated, service_role;

comment on table private.scoring_policies is
  'Versioned scoring rule sets. A policy referenced by an assignment, approval or snapshot never changes; a new rule set is a new version. No direct client access.';

-- Today's two bases, with every flag stated. No v2 row: the owner selects it later.
insert into private.scoring_policies (policy_key, version, rules, description) values
  ('combined', 1, jsonb_build_object(
      'unit_scope', 'author',
      'require_gap_or_refresh', false,
      'first_completer_keeps', false,
      'system_recheck_keeps', false,
      'photo_scores_once', false,
      'self_review_scores', true,
      'archive_keeps', false,
      'credit_month', 'decision',
      'grace_days', 0),
    'Distinct accepted menu items plus completed amenity checks per person, as private.monthly_venue_completion_counts computes them.'),
  ('accepted_photos', 1, jsonb_build_object(
      'unit', 'accepted_photo_asset',
      'target_scope', 'person',
      'credit_month', 'upload_and_submit_month',
      'late_acceptance_changes_closed_month', true),
    'Legacy per-person photo target: distinct accepted own photos uploaded and submitted in the month, as private.monthly_credit_items selects them.');

-- ---------------------------------------------------------------------------
-- Assignment identity on the existing venue target table
-- ---------------------------------------------------------------------------

-- The defaults describe a row with a target. A NULL target_count still means
-- the accepted-photo basis (private.scoring_policy_in_force); no row changes
-- meaning and none is rewritten.
alter table private.venue_monthly_completion_targets
  add column policy_key text not null default 'combined',
  add column policy_version integer not null default 1,
  add column approved_by uuid,
  add column reason text,
  add column assigned_by uuid,
  add column request_key text,
  add constraint venue_monthly_completion_targets_policy_fkey
    foreign key (policy_key, policy_version) references private.scoring_policies (policy_key, version)
    on update restrict on delete restrict,
  add constraint venue_monthly_completion_targets_request_key_key unique (request_key),
  add constraint venue_monthly_completion_targets_request_key_check
    check (request_key is null or request_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  add constraint venue_monthly_completion_targets_reason_check
    check (reason is null or (reason = btrim(reason) and length(reason) between 1 and 500)),
  add constraint venue_monthly_completion_targets_legacy_target_check
    check (policy_key <> 'accepted_photos' or target_count is null);

comment on table private.venue_monthly_completion_targets is
  'Venue scoring policy effective from a London month (latest starts_on <= month). New rows come from public.scoring_assign_policy. NULL target_count is the accepted-photo basis. Months with a close snapshot cannot change. No direct client access.';
comment on column private.venue_monthly_completion_targets.approved_by is
  'Who approved the assignment: the admin for a future month, or the owner named in the first-enrolment approval record. No foreign key, so attribution survives a profile deletion.';
comment on column private.venue_monthly_completion_targets.request_key is
  'Request key of the assigning command; NULL for rows written before the command existed or by fixtures.';

-- ---------------------------------------------------------------------------
-- First-enrolment approvals (the E33 current-month exception)
-- ---------------------------------------------------------------------------

-- Written only through a privileged provisioning path that records the
-- accountable owner's decision. No role, RPC, seed or caller flag writes it,
-- and an admin session cannot read or write it.
create table private.scoring_first_enrolment_approvals (
  request_key text primary key check (request_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  venue_id uuid not null references public.venues (id) on delete restrict,
  starts_on date not null check (extract(day from starts_on) = 1),
  policy_key text not null check (policy_key = 'combined'),
  policy_version integer not null,
  target_count integer not null check (target_count between 1 and 500),
  reason text not null check (reason = btrim(reason) and length(reason) between 1 and 500),
  approved_by uuid not null,
  approved_at timestamptz not null,
  approval_ref text not null check (approval_ref ~ '^[A-Za-z0-9._:/#-]{1,200}$'),
  recorded_by text not null default current_user,
  recorded_at timestamptz not null default now(),
  foreign key (policy_key, policy_version) references private.scoring_policies (policy_key, version)
    on update restrict on delete restrict
);

alter table private.scoring_first_enrolment_approvals enable row level security;
revoke all on table private.scoring_first_enrolment_approvals
  from public, anon, authenticated, service_role;

create trigger scoring_first_enrolment_approvals_append_only
  before update or delete on private.scoring_first_enrolment_approvals
  for each row execute function private.append_only_guard();
create trigger scoring_first_enrolment_approvals_no_truncate
  before truncate on private.scoring_first_enrolment_approvals
  for each statement execute function private.append_only_guard();

comment on table private.scoring_first_enrolment_approvals is
  'Owner approvals for a first current-month combined enrolment, keyed by the command request key. Append-only; privileged provisioning only; approval_ref is an opaque, non-secret receipt reference.';

-- ---------------------------------------------------------------------------
-- Month snapshots
-- ---------------------------------------------------------------------------

create table private.scoring_month_snapshots (
  id bigint generated always as identity primary key,
  venue_id uuid not null references public.venues (id) on delete restrict,
  -- No foreign key: deleting a profile never changes a recorded month (K8).
  staff_id uuid not null,
  period_month date not null check (extract(day from period_month) = 1),
  kind text not null check (kind in ('close', 'baseline')),
  policy_key text not null,
  policy_version integer not null,
  target_basis text not null check (target_basis in ('menu_items_and_amenities', 'accepted_photos')),
  menu_units integer not null check (menu_units >= 0),
  amenity_units integer not null check (amenity_units >= 0),
  photo_units integer not null check (photo_units >= 0),
  late_photo_units integer not null,
  corrections integer not null default 0,
  total integer not null,
  target_count integer check (target_count >= 1),
  function_hash text not null check (function_hash ~ '^[0-9a-f]{32}$'),
  computed_at timestamptz not null,
  recorded_by text not null default current_user,
  foreign key (policy_key, policy_version) references private.scoring_policies (policy_key, version)
    on update restrict on delete restrict,
  constraint scoring_month_snapshots_identity unique (venue_id, staff_id, period_month, kind),
  constraint scoring_month_snapshots_late_check check (late_photo_units between 0 and photo_units),
  constraint scoring_month_snapshots_basis_check
    check ((policy_key = 'accepted_photos') = (target_basis = 'accepted_photos')),
  constraint scoring_month_snapshots_total_check check (total = corrections + case
    when target_basis = 'accepted_photos' then photo_units else menu_units + amenity_units end)
);

create index scoring_month_snapshots_venue_kind_month_idx
  on private.scoring_month_snapshots (venue_id, kind, period_month);
create index scoring_month_snapshots_month_idx
  on private.scoring_month_snapshots (period_month, venue_id);

alter table private.scoring_month_snapshots enable row level security;
revoke all on table private.scoring_month_snapshots from public, anon, authenticated, service_role;

create trigger scoring_month_snapshots_append_only
  before update or delete on private.scoring_month_snapshots
  for each row execute function private.append_only_guard();
create trigger scoring_month_snapshots_no_truncate
  before truncate on private.scoring_month_snapshots
  for each statement execute function private.append_only_guard();

comment on table private.scoring_month_snapshots is
  'Per participant monthly results. kind close: written by private.scoring_close_month after the London month ended. kind baseline: recorded when B08-a was installed for months already over; never a close. Append-only.';

-- ---------------------------------------------------------------------------
-- Policy immutability
-- ---------------------------------------------------------------------------

create function private.scoring_policies_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'scoring_policy_referenced' using errcode = '42501',
      detail = 'Scoring policies cannot be truncated.';
  end if;
  if exists (
      select 1 from private.venue_monthly_completion_targets t
      where t.policy_key = old.policy_key and t.policy_version = old.version)
    or exists (
      select 1 from private.scoring_month_snapshots s
      where s.policy_key = old.policy_key and s.policy_version = old.version)
    or exists (
      select 1 from private.scoring_first_enrolment_approvals a
      where a.policy_key = old.policy_key and a.policy_version = old.version) then
    raise exception 'scoring_policy_referenced' using errcode = '42501',
      detail = format('%s v%s is in use; create a new version instead.', old.policy_key, old.version);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger scoring_policies_immutable
  before update or delete on private.scoring_policies
  for each row execute function private.scoring_policies_guard();
create trigger scoring_policies_no_truncate
  before truncate on private.scoring_policies
  for each statement execute function private.scoring_policies_guard();

-- ---------------------------------------------------------------------------
-- Shared reads
-- ---------------------------------------------------------------------------

-- The policy in force for a venue and London month, with the target lookup of
-- private.venue_monthly_completion_target. No row, or a NULL target, is
-- accepted_photos v1.
create function private.scoring_policy_in_force(p_venue_id uuid, p_period_month date)
returns table (policy_key text, policy_version integer, target_count integer)
language sql
stable
set search_path = ''
as $$
  select case when t.target_count is null then 'accepted_photos' else t.policy_key end,
    case when t.target_count is null then 1 else t.policy_version end,
    t.target_count
  from (select 1) one
  left join lateral (
    select p.policy_key, p.policy_version, p.target_count
    from private.venue_monthly_completion_targets p
    where p.venue_id = p_venue_id and p.starts_on <= p_period_month
    order by p.starts_on desc
    limit 1
  ) t on true;
$$;

-- Participants for a London month, as coverage_staff_progress_v2 counts them:
-- a recorded staff membership overlapping the month, or a legacy monthly
-- target created within the month. Managers and admins never participate.
create function private.scoring_month_roster(p_period_month date)
returns table (venue_id uuid, staff_id uuid)
language sql
stable
set search_path = ''
as $$
  select m.venue_id, m.staff_id
  from private.completion_staff_venue_memberships m
  where m.started_at < private.london_month_end(p_period_month)
    and (m.ended_at is null or m.ended_at > private.london_month_start(p_period_month))
  union
  select t.venue_id, t.staff_id
  from public.monthly_targets t
  where t.period_month = p_period_month
    and t.created_at >= private.london_month_start(p_period_month)
    and t.created_at < private.london_month_end(p_period_month);
$$;

-- One participant's result under the month's policy, through the unchanged
-- v1 functions. Combined: private.monthly_venue_completion_counts and the
-- venue target. Legacy: distinct accepted assets from
-- private.monthly_credit_items and the person's monthly target, as today's
-- progress shows them (accepted_count; not the RPC's completion_count).
create function private.scoring_participant_result(
  p_venue_id uuid, p_staff_id uuid, p_period_month date
)
returns table (
  policy_key text,
  policy_version integer,
  target_basis text,
  menu_units integer,
  amenity_units integer,
  photo_units integer,
  late_photo_units integer,
  total integer,
  target_count integer,
  function_hash text
)
language sql
stable
set search_path = ''
as $$
  with policy as (
    select * from private.scoring_policy_in_force(p_venue_id, p_period_month)
  ),
  combined as (
    select coalesce(sum(c.menu_items_completed), 0)::integer as menu,
      coalesce(sum(c.amenity_checks_completed), 0)::integer as amenity
    from policy p
    cross join lateral private.monthly_venue_completion_counts(p_venue_id, p_staff_id, p_period_month) c
    where p.target_count is not null
  ),
  photos as (
    select count(distinct c.asset_id)::integer as accepted,
      (count(distinct c.asset_id)
        filter (where c.decided_at >= private.london_month_end(p_period_month)))::integer as late
    from policy p
    cross join lateral private.monthly_credit_items(p_period_month) c
    where p.target_count is null and c.venue_id = p_venue_id and c.author_id = p_staff_id
  )
  select p.policy_key, p.policy_version,
    case when p.target_count is null then 'accepted_photos' else 'menu_items_and_amenities' end,
    c.menu, c.amenity, ph.accepted, ph.late,
    case when p.target_count is null then ph.accepted else c.menu + c.amenity end,
    case when p.target_count is null then (
      select t.target_count from public.monthly_targets t
      where t.staff_id = p_staff_id and t.venue_id = p_venue_id and t.period_month = p_period_month
    ) else p.target_count end,
    md5(pg_get_functiondef((case when p.target_count is null
      then 'private.monthly_credit_items(date)'
      else 'private.monthly_venue_completion_counts(uuid,uuid,date)' end)::regprocedure))
  from policy p cross join combined c cross join photos ph;
$$;

-- Serialises assignment writes and month close for one venue.
create function private.lock_scoring_venue(p_venue_id uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('nabalens_scoring_venue:' || p_venue_id::text, 0));
$$;

-- The venue lock orders a close and an assignment only if each statement
-- reads after the other commits. A REPEATABLE READ or SERIALIZABLE snapshot
-- taken before the lock could miss a concurrent close, so those are refused.
create function private.assert_scoring_read_committed()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'scoring_requires_read_committed' using errcode = '0A000';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Closed-month protection
-- ---------------------------------------------------------------------------

-- Refuses any write that would change the policy or target in force for a
-- month with a close snapshot for that venue, for every role, including an
-- edit to a row that took effect before that month. Baselines never protect.
create function private.scoring_targets_closed_month_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_venue uuid;
  v_old_start date;
  v_new_venue uuid;
  v_new_start date;
  v_new_key text;
  v_new_version integer;
  v_new_target integer;
  v_venue uuid;
  v_month date;
  v_before record;
  v_after record;
begin
  if tg_op = 'TRUNCATE' then
    if exists (select 1 from private.scoring_month_snapshots s where s.kind = 'close') then
      raise exception 'scoring_month_closed' using errcode = '42501',
        detail = 'Closed months exist; their assignments cannot be truncated.';
    end if;
    return null;
  end if;

  perform private.assert_scoring_read_committed();
  if tg_op in ('UPDATE', 'DELETE') then
    v_old_venue := old.venue_id;
    v_old_start := old.starts_on;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new_venue := new.venue_id;
    v_new_start := new.starts_on;
    v_new_key := new.policy_key;
    v_new_version := new.policy_version;
    v_new_target := new.target_count;
  end if;

  for v_venue in
    select distinct u.v from unnest(array[v_old_venue, v_new_venue]) u(v)
    where u.v is not null order by u.v
  loop
    perform private.lock_scoring_venue(v_venue);
    for v_month in
      select distinct s.period_month
      from private.scoring_month_snapshots s
      where s.venue_id = v_venue and s.kind = 'close'
      order by 1
    loop
      select * into v_before from private.scoring_policy_in_force(v_venue, v_month);
      select case when x.target_count is null then 'accepted_photos' else x.policy_key end as policy_key,
          case when x.target_count is null then 1 else x.policy_version end as policy_version,
          x.target_count
        into v_after
      from (select 1) one
      left join lateral (
        select r.policy_key, r.policy_version, r.target_count
        from (
          select t.starts_on, t.policy_key, t.policy_version, t.target_count
          from private.venue_monthly_completion_targets t
          where t.venue_id = v_venue and t.starts_on <= v_month
            and not (v_old_venue is not null
              and t.venue_id = v_old_venue and t.starts_on = v_old_start)
          union all
          select v_new_start, v_new_key, v_new_version, v_new_target
          where v_new_venue = v_venue and v_new_start <= v_month
        ) r
        order by r.starts_on desc
        limit 1
      ) x on true;
      if (v_before.policy_key, v_before.policy_version, v_before.target_count)
          is distinct from (v_after.policy_key, v_after.policy_version, v_after.target_count) then
        raise exception 'scoring_month_closed' using errcode = '42501',
          detail = format('Venue %s, %s is closed; its policy and target are fixed.', v_venue, v_month);
      end if;
    end loop;
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger venue_monthly_completion_targets_closed_month
  before insert or update or delete on private.venue_monthly_completion_targets
  for each row execute function private.scoring_targets_closed_month_guard();
create trigger venue_monthly_completion_targets_closed_month_truncate
  before truncate on private.venue_monthly_completion_targets
  for each statement execute function private.scoring_targets_closed_month_guard();

-- ---------------------------------------------------------------------------
-- Admin command
-- ---------------------------------------------------------------------------

-- Assigns a registered policy to a venue from a London month: insert only.
-- Ordinary assignments start on the first day of the next London month or
-- later. The current month is allowed only for a venue's first combined v1
-- enrolment with a matching owner approval record (E33). A retry with the same
-- key and input returns the recorded result.
create function public.scoring_assign_policy(
  p_venue uuid,
  p_starts_on date,
  p_policy_key text,
  p_version integer,
  p_target_count integer,
  p_reason text,
  p_request_key text
)
returns table (
  venue_id uuid,
  starts_on date,
  policy_key text,
  policy_version integer,
  target_count integer,
  reason text,
  approved_by uuid,
  approved_at timestamptz,
  first_enrolment boolean,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := private.assert_active_admin();
  v_reason text;
  v_row private.venue_monthly_completion_targets;
  v_approval private.scoring_first_enrolment_approvals;
  v_current date;
  v_first boolean := false;
  v_approved_by uuid;
  v_approved_at timestamptz;
begin
  perform private.assert_request_key(p_request_key);
  perform pg_advisory_xact_lock(hashtextextended('nabalens_scoring_request:' || p_request_key, 0));
  v_reason := private.require_reason(p_reason);
  if p_starts_on is null or extract(day from p_starts_on) <> 1 then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  if p_policy_key is null or p_version is null then
    raise exception 'scoring_policy_not_found' using errcode = 'P0002';
  end if;

  select t.* into v_row
  from private.venue_monthly_completion_targets t
  where t.request_key = p_request_key;
  if found then
    if v_row.venue_id is distinct from p_venue or v_row.starts_on is distinct from p_starts_on
       or v_row.policy_key is distinct from p_policy_key
       or v_row.policy_version is distinct from p_version
       or v_row.target_count is distinct from p_target_count
       or v_row.reason is distinct from v_reason then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    v_first := v_row.starts_on = private.london_month(v_row.created_at);
    select a.approved_at into v_approved_at
    from private.scoring_first_enrolment_approvals a
    where v_first and a.request_key = p_request_key;
    return query select v_row.venue_id, v_row.starts_on, v_row.policy_key, v_row.policy_version,
      v_row.target_count, v_row.reason, v_row.approved_by,
      case when v_first then v_approved_at else v_row.created_at end, v_first, true;
    return;
  end if;

  if not exists (select 1 from public.venues v where v.id = p_venue) then
    raise exception 'venue_not_found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from private.scoring_policies sp
    where sp.policy_key = p_policy_key and sp.version = p_version
  ) then
    raise exception 'scoring_policy_not_found' using errcode = 'P0002';
  end if;
  if (p_policy_key = 'combined' and (p_target_count is null or p_target_count not between 1 and 500))
     or (p_policy_key = 'accepted_photos' and p_target_count is not null) then
    raise exception 'invalid_target_count' using errcode = '22023';
  end if;

  v_current := private.current_london_month();
  if p_starts_on < v_current then
    raise exception 'scoring_month_not_assignable' using errcode = '22023',
      detail = 'A policy cannot start in a past month.';
  end if;

  perform private.lock_scoring_venue(p_venue);
  if exists (
    select 1 from private.venue_monthly_completion_targets t
    where t.venue_id = p_venue and t.starts_on = p_starts_on
  ) then
    raise exception 'scoring_assignment_exists' using errcode = '23505';
  end if;

  if p_starts_on = v_current then
    -- E33: only a first combined v1 enrolment of a venue on the legacy basis.
    if p_policy_key <> 'combined' or p_version <> 1
       or private.venue_monthly_completion_target(p_venue, v_current) is not null
       or exists (
         select 1 from private.venue_monthly_completion_targets t
         where t.venue_id = p_venue and t.target_count is not null
       ) then
      raise exception 'scoring_month_not_assignable' using errcode = '22023',
        detail = 'Only a first combined v1 enrolment can start in the current month.';
    end if;
    select a.* into v_approval
    from private.scoring_first_enrolment_approvals a
    where a.request_key = p_request_key;
    if not found then
      raise exception 'scoring_approval_required' using errcode = '42501';
    end if;
    if v_approval.venue_id is distinct from p_venue
       or v_approval.starts_on is distinct from p_starts_on
       or v_approval.policy_key is distinct from p_policy_key
       or v_approval.policy_version is distinct from p_version
       or v_approval.target_count is distinct from p_target_count
       or v_approval.reason is distinct from v_reason then
      raise exception 'scoring_approval_mismatch' using errcode = '42501';
    end if;
    v_first := true;
    v_approved_by := v_approval.approved_by;
    v_approved_at := v_approval.approved_at;
  else
    v_approved_by := v_uid;
  end if;

  insert into private.venue_monthly_completion_targets as t
    (venue_id, starts_on, target_count, policy_key, policy_version,
      approved_by, reason, assigned_by, request_key)
  values (p_venue, p_starts_on, p_target_count, p_policy_key, p_version,
    v_approved_by, v_reason, v_uid, p_request_key)
  returning t.* into v_row;

  return query select v_row.venue_id, v_row.starts_on, v_row.policy_key, v_row.policy_version,
    v_row.target_count, v_row.reason, v_row.approved_by,
    case when v_first then v_approved_at else v_row.created_at end, v_first, false;
end;
$$;

revoke all on function public.scoring_assign_policy(uuid, date, text, integer, integer, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.scoring_assign_policy(uuid, date, text, integer, integer, text, text)
  to authenticated;

comment on function public.scoring_assign_policy(uuid, date, text, integer, integer, text, text) is
  'Admin: assign a registered scoring policy to a venue from the next London month or later. A first combined v1 enrolment may start this month only with a matching owner approval record.';

-- ---------------------------------------------------------------------------
-- Month close and drift (private; no application role executes them)
-- ---------------------------------------------------------------------------

-- Writes one close snapshot per participant for each venue with participants
-- in a completed London month. Idempotent per venue: a venue already closed
-- for the month gets no new row. A venue month with a baseline is reported
-- and left as it is; a baseline never becomes a close.
create function private.scoring_close_month(p_month date)
returns table (venue_id uuid, outcome text, participants integer)
language plpgsql
volatile
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_venue uuid;
  v_n integer;
begin
  perform private.assert_scoring_read_committed();
  if p_month is null or extract(day from p_month) <> 1 then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  if private.london_month_end(p_month) > now() then
    raise exception 'scoring_month_not_complete' using errcode = '22023';
  end if;

  for v_venue in
    select r.venue_id from private.scoring_month_roster(p_month) r
    union
    select s.venue_id from private.scoring_month_snapshots s where s.period_month = p_month
    order by 1
  loop
    perform private.lock_scoring_venue(v_venue);
    venue_id := v_venue;
    select count(*)::integer into v_n
    from private.scoring_month_snapshots s
    where s.venue_id = v_venue and s.period_month = p_month and s.kind = 'close';
    if v_n > 0 then
      outcome := 'already_closed';
    else
      select count(*)::integer into v_n
      from private.scoring_month_snapshots s
      where s.venue_id = v_venue and s.period_month = p_month and s.kind = 'baseline';
      if v_n > 0 then
        outcome := 'baseline_only';
      else
        insert into private.scoring_month_snapshots
          (venue_id, staff_id, period_month, kind, policy_key, policy_version, target_basis,
            menu_units, amenity_units, photo_units, late_photo_units, total, target_count,
            function_hash, computed_at)
        select v_venue, r.staff_id, p_month, 'close', x.policy_key, x.policy_version, x.target_basis,
          x.menu_units, x.amenity_units, x.photo_units, x.late_photo_units, x.total, x.target_count,
          x.function_hash, clock_timestamp()
        from (
          select distinct r.staff_id
          from private.scoring_month_roster(p_month) r
          where r.venue_id = v_venue
        ) r
        cross join lateral private.scoring_participant_result(v_venue, r.staff_id, p_month) x
        on conflict on constraint scoring_month_snapshots_identity do nothing;
        get diagnostics v_n = row_count;
        outcome := 'closed';
      end if;
    end if;
    participants := v_n;
    return next;
  end loop;
end;
$$;

-- Compares live results with the recorded snapshot of each venue for the
-- month (the close if there is one, otherwise the baseline). Reports one row
-- per differing participant with the evidence; writes nothing.
create function private.scoring_month_drift(p_month date)
returns table (
  venue_id uuid,
  staff_id uuid,
  period_month date,
  snapshot_kind text,
  reason text,
  expected boolean,
  snapshot_policy_key text,
  snapshot_policy_version integer,
  live_policy_key text,
  live_policy_version integer,
  snapshot_total integer,
  live_total integer,
  snapshot_target integer,
  live_target integer,
  late_since_snapshot integer,
  computed_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  with venue_kind as (
    select s.venue_id,
      case when bool_or(s.kind = 'close') then 'close' else 'baseline' end as kind
    from private.scoring_month_snapshots s
    where s.period_month = p_month
    group by s.venue_id
  ),
  recorded as (
    select s.*
    from private.scoring_month_snapshots s
    join venue_kind k on k.venue_id = s.venue_id and k.kind = s.kind
    where s.period_month = p_month
  ),
  roster as (
    select distinct r.venue_id, r.staff_id
    from private.scoring_month_roster(p_month) r
    join venue_kind k on k.venue_id = r.venue_id
  ),
  pairs as (
    select s.venue_id, s.staff_id from recorded s
    union
    select r.venue_id, r.staff_id from roster r
  ),
  compared as (
    select x.venue_id, x.staff_id, k.kind, s.id as snapshot_id,
      s.policy_key as s_key, s.policy_version as s_version, s.total as s_total,
      s.target_count as s_target, s.computed_at as s_at,
      l.policy_key as l_key, l.policy_version as l_version, l.total as l_total,
      l.target_count as l_target,
      (r.staff_id is not null) as in_roster,
      exists (select 1 from public.profiles p where p.id = x.staff_id) as has_profile,
      case when s.target_basis = 'accepted_photos' and l.target_basis = 'accepted_photos' then (
        select count(distinct c.asset_id)::integer
        from private.monthly_credit_items(p_month) c
        where c.venue_id = x.venue_id and c.author_id = x.staff_id and c.decided_at > s.computed_at
      ) else 0 end as late_since
    from pairs x
    join venue_kind k on k.venue_id = x.venue_id
    left join recorded s on s.venue_id = x.venue_id and s.staff_id = x.staff_id
    left join roster r on r.venue_id = x.venue_id and r.staff_id = x.staff_id
    cross join lateral private.scoring_participant_result(x.venue_id, x.staff_id, p_month) l
  ),
  classified as (
    select c.*,
      case
        when c.snapshot_id is null then 'participant_added'
        when not c.in_roster and not c.has_profile then 'profile_deleted'
        when not c.in_roster then 'participant_removed'
        when (c.s_key, c.s_version) is distinct from (c.l_key, c.l_version) then 'policy_changed'
        when c.s_target is distinct from c.l_target then 'target_changed'
        when c.s_total <> c.l_total and c.s_key = 'accepted_photos' and c.late_since > 0
          and c.l_total - c.s_total = c.late_since then 'legacy_late_acceptance'
        when c.s_total <> c.l_total then 'count_changed'
      end as reason
    from compared c
  )
  select c.venue_id, c.staff_id, p_month, c.kind, c.reason, c.reason = 'legacy_late_acceptance',
    c.s_key, c.s_version, c.l_key, c.l_version, c.s_total, c.l_total, c.s_target, c.l_target,
    c.late_since, c.s_at
  from classified c
  where c.reason is not null
  order by c.venue_id, c.staff_id;
$$;

revoke all on function
  private.scoring_rules_valid(text, jsonb),
  private.scoring_policies_guard(),
  private.scoring_policy_in_force(uuid, date),
  private.scoring_month_roster(date),
  private.scoring_participant_result(uuid, uuid, date),
  private.lock_scoring_venue(uuid),
  private.assert_scoring_read_committed(),
  private.scoring_targets_closed_month_guard(),
  private.scoring_close_month(date),
  private.scoring_month_drift(date)
from public, anon, authenticated, service_role;

comment on function private.scoring_close_month(date) is
  'Writes close snapshots for a completed London month, idempotently per venue. Privileged invocation only.';
comment on function private.scoring_month_drift(date) is
  'Read-only comparison of live results with each venue''s recorded snapshot for a month, with the cause. Never changes a count or a snapshot.';

-- ---------------------------------------------------------------------------
-- Baselines for months that ended before this migration
-- ---------------------------------------------------------------------------

-- Membership history starts on 9 November 2026, so only completed months from
-- November 2026 have a supported roster. Labelled baseline with the actual
-- computation time; never a close, and never protection for a month.
insert into private.scoring_month_snapshots
  (venue_id, staff_id, period_month, kind, policy_key, policy_version, target_basis,
    menu_units, amenity_units, photo_units, late_photo_units, total, target_count,
    function_hash, computed_at)
select r.venue_id, r.staff_id, m.month, 'baseline', x.policy_key, x.policy_version, x.target_basis,
  x.menu_units, x.amenity_units, x.photo_units, x.late_photo_units, x.total, x.target_count,
  x.function_hash, clock_timestamp()
from (
  select g::date as month
  from generate_series('2026-11-01'::timestamp,
    (private.current_london_month() - interval '1 month')::timestamp, interval '1 month') g
) m
cross join lateral (
  select distinct r.venue_id, r.staff_id from private.scoring_month_roster(m.month) r
) r
cross join lateral private.scoring_participant_result(r.venue_id, r.staff_id, m.month) x;
