-- B04-c1 (b04-design §6, §7.2, §12 OD-B4-7/8, §18 L3, §19.2 S5, A1-7; task
-- B04-03): modifiers, dietary claims, allergen statements, the uncertainty
-- message, and revocation by material change. Everything is inert by
-- default: no venue can have a confirmed dietary or allergen fact until the
-- owner names an authority (OD-B4-7, OD-B4-8) through a reviewed migration.
--
-- Split (lane b04-menus, coordinator question Q1). WS4's evidence_documents
-- (B05-m6) is not on this base. c1 builds menu_allergen_evidence with
-- authority_statement rows only; c2, after B05-m6 shares a base, adds the
-- (document_id, venue_id) foreign key to evidence_documents, the document
-- kinds and the ready/not-deleted check (B05-m6 hand-off H1). The attach
-- command already refuses a media asset (photo_not_allergen_evidence) before
-- any document lookup, and any other document id is document_not_found.
--
-- Modifiers (§6.1 B04-03a). public.menu_modifier_groups / _options per venue,
-- attached to items with dates (public.menu_item_modifier_groups). An
-- option's price delta is a trading line with modifier_option_id (the S2
-- reserved column, now a composite foreign key), priced through the S2
-- propose/decide commands. Manager or admin write them (§6.4: structure, no
-- safety claim).
--
-- Dietary (§6.1 B04-03b, OD-B4-8 default vocabulary vegetarian, vegan).
-- public.menu_dietary_claims (append-only) and public.menu_dietary_decisions.
-- Managers and admins propose and decline; only the venue's named dietary
-- authority confirms or revokes (dietary_authority_missing until named).
--
-- Allergens (§6.1 B04-03c, OD-B4-7 default vocabulary the UK 14).
-- public.menu_allergen_statements (append-only; { code: contains |
-- may_contain }, complete) bound to the item's recipe anchor (the latest
-- recipe declaration of an activated version for the item or its variant,
-- §7.3), public.menu_allergen_decisions (confirmed | declined | revoked) and
-- public.menu_allergen_evidence. Managers and admins propose, attach evidence
-- and decline; staff cannot propose (§6.4). Only the venue's named allergen
-- authority confirms or revokes; an admin cannot bypass it
-- (allergen_authority_missing when the venue has none, not_allergen_authority
-- otherwise). A confirmation needs at least one evidence row, a complete or
-- partial statement over the closed list, and the current recipe anchor.
--
-- Authorities. private.menu_safety_authorities (venue, profile, scope
-- allergens | dietary) ships empty with no client or command write path.
-- Naming a person is an owner decision applied by a reviewed migration.
--
-- Message (§6.1 B04-03d, §6.2 #2). public.menu_public_messages, append-only
-- versions of the owner's wording, ships empty with no write path: the owner decides the
-- wording (OD-B4-7). Until then every allergen outcome without a current
-- statement carries message null and messageStatus awaiting_decision.
--
-- Read. public.menu_item_safety(p_item): the item's (and each listed
-- variant's) allergen outcome, its dietary claims, and for managers and
-- admins the pending statements and claims (evidence kinds and counts only:
-- no document id, filename or path anywhere, V11). A missing allergen means
-- not declared, never free from, unless the confirmed statement is complete
-- (§6.2 #3). Photos never establish ingredient, dietary or allergen facts
-- (§6.1 B04-03e): nothing here reads photos.
--
-- Revocation (§6.2 #6, §7.2, L3, A1-7). menu_versions_revoke_statements, at
-- activation, writes a revoked decision (by the activating account, reason
-- material_change:<kind>) on each confirmed statement or claim whose item
-- has a recipe or portion declaration (item-wide or for its variant), whose
-- variant has a variant_meaning declaration, or whose variant the version no
-- longer lists. A catalogue or trading rollback writes no decision, and a
-- statement is current only while its latest decision is confirmed and its
-- recipe anchor is the item's current one, so nothing revoked comes back
-- except through a new statement confirmed by the authority (L3 (d)).
--
-- Statement recheck tasks (A1-4 statement subject) are deferred to c2 with
-- the evidence documents: no statement can be confirmed before OD-B4-7.
--
-- Rollback: drop the trigger, revoke the new functions; tables stay.
-- menu_trading_lines keeps the modifier foreign key (no line can name an
-- option without these tables).

-- ---------------------------------------------------------------------------
-- Vocabularies (owner to confirm: OD-B4-7, OD-B4-8)
-- ---------------------------------------------------------------------------

create function private.menu_allergen_codes()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['celery', 'cereals_gluten', 'crustaceans', 'eggs', 'fish', 'lupin', 'milk', 'molluscs',
    'mustard', 'tree_nuts', 'peanuts', 'sesame', 'soya', 'sulphites'];
$$;

create function private.menu_dietary_claims_vocabulary()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['vegetarian', 'vegan'];
$$;

-- Problems with an allergen map ({ code: contains | may_contain } over the
-- closed list), as an array of { path, problem }; empty when valid.
create function private.menu_allergen_problems(p_allergens jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_allergens) is distinct from 'object' then
      jsonb_build_array(jsonb_build_object('path', 'allergens', 'problem', 'invalid'))
    else coalesce((
      select jsonb_agg(jsonb_build_object('path', 'allergens.' || e.key,
          'problem', case when not (e.key = any (private.menu_allergen_codes())) then 'not_allowed' else 'invalid' end)
        order by e.key collate "C")
      from jsonb_each(p_allergens) e
      where not (e.key = any (private.menu_allergen_codes()))
         or jsonb_typeof(e.value) is distinct from 'string'
         or e.value #>> '{}' not in ('contains', 'may_contain')), '[]'::jsonb)
  end;
$$;

-- ---------------------------------------------------------------------------
-- Modifiers (B04-03a)
-- ---------------------------------------------------------------------------

create table public.menu_modifier_groups (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  name text not null check (length(name) between 1 and 80 and name = btrim(name)),
  selection text not null check (selection in ('single', 'multiple')),
  min_select integer not null default 0 check (min_select >= 0),
  max_select integer check (max_select is null or max_select >= 1),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  retired_by uuid references public.profiles (id) on delete restrict,
  constraint menu_modifier_groups_id_venue_key unique (id, venue_id),
  constraint menu_modifier_groups_bounds check (
    (max_select is null or min_select <= max_select)
    and (selection <> 'single' or (max_select = 1 and min_select <= 1))
  ),
  constraint menu_modifier_groups_retired check ((retired_at is null) = (retired_by is null))
);

create table public.menu_modifier_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null,
  venue_id uuid not null,
  name text not null check (length(name) between 1 and 80 and name = btrim(name)),
  position integer not null default 0 check (position >= 0),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  retired_by uuid references public.profiles (id) on delete restrict,
  constraint menu_modifier_options_id_venue_key unique (id, venue_id),
  constraint menu_modifier_options_group_fkey foreign key (group_id, venue_id)
    references public.menu_modifier_groups (id, venue_id) on delete restrict,
  constraint menu_modifier_options_retired check ((retired_at is null) = (retired_by is null))
);

create index menu_modifier_options_group_idx on public.menu_modifier_options (group_id, position);

create table public.menu_item_modifier_groups (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null,
  group_id uuid not null,
  venue_id uuid not null,
  effective_from date not null,
  effective_to date check (effective_to is null or effective_to >= effective_from),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint menu_item_modifier_groups_item_fkey foreign key (item_id, venue_id)
    references public.menu_items (id, venue_id) on delete restrict,
  constraint menu_item_modifier_groups_group_fkey foreign key (group_id, venue_id)
    references public.menu_modifier_groups (id, venue_id) on delete restrict,
  constraint menu_item_modifier_groups_once unique (item_id, group_id, effective_from)
);

create index menu_item_modifier_groups_item_idx on public.menu_item_modifier_groups (item_id);

comment on table public.menu_modifier_groups is
  'Modifier groups per venue (B04-03a): structure only, no safety claim. Retired, never deleted.';
comment on table public.menu_modifier_options is
  'Modifier options of a group (B04-03a). A price delta is a menu_trading_lines row naming the option.';
comment on table public.menu_item_modifier_groups is
  'Append-only: a modifier group offered with an item over local dates (B04-03a).';

-- The S2 reserved column becomes the option's price-delta line (§5.3).
alter table public.menu_trading_lines drop constraint menu_trading_lines_modifier_reserved;
alter table public.menu_trading_lines add constraint menu_trading_lines_modifier_fkey
  foreign key (modifier_option_id, venue_id) references public.menu_modifier_options (id, venue_id)
  on delete restrict;

-- Groups and options change only by retirement (once); attachments never.
create function private.menu_modifier_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or old.retired_at is not null
     or (to_jsonb(new) - array['retired_at', 'retired_by']) is distinct from (to_jsonb(old) - array['retired_at', 'retired_by']) then
    raise exception 'menu_modifier_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger menu_modifier_groups_guard
  before update or delete on public.menu_modifier_groups
  for each row execute function private.menu_modifier_guard();
create trigger menu_modifier_options_guard
  before update or delete on public.menu_modifier_options
  for each row execute function private.menu_modifier_guard();

-- ---------------------------------------------------------------------------
-- Authorities, messages, dietary claims, allergen statements (B04-03b–d)
-- ---------------------------------------------------------------------------

create table private.menu_safety_authorities (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  profile_id uuid not null references public.profiles (id) on delete restrict,
  scope text not null check (scope in ('allergens', 'dietary')),
  named_at timestamptz not null default now(),
  revoked_at timestamptz,
  note text check (note is null or length(note) between 1 and 280),
  constraint menu_safety_authorities_once unique (venue_id, profile_id, scope, named_at)
);

comment on table private.menu_safety_authorities is
  'Who may confirm or revoke allergen or dietary statements per venue (OD-B4-7, OD-B4-8). Ships empty; rows only through a reviewed migration recording the owner''s decision.';

create table public.menu_public_messages (
  key text not null check (key ~ '^[a-z][a-z0-9_]{2,63}$'),
  version integer not null check (version >= 1),
  text text not null check (length(text) between 1 and 600 and text = btrim(text)),
  audience text not null check (audience in ('internal', 'public')),
  decided_by uuid not null references public.profiles (id) on delete restrict,
  decided_at timestamptz not null default now(),
  primary key (key, version)
);

comment on table public.menu_public_messages is
  'Append-only owner-decided message versions (B04-03d), e.g. allergen_unconfirmed. Ships empty: the owner decides the wording (OD-B4-7).';

create table public.menu_dietary_claims (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  venue_id uuid not null,
  item_id uuid not null,
  variant_id uuid,
  claim text not null,
  value text not null check (value in ('yes', 'no')),
  recipe_declaration_id uuid references public.menu_change_declarations (id) on delete restrict,
  reason text check (reason is null or (length(reason) between 1 and 500 and reason = btrim(reason))),
  stated_by uuid not null references public.profiles (id) on delete restrict,
  stated_at timestamptz not null default now(),
  command_key uuid not null,
  constraint menu_dietary_claims_id_venue_key unique (id, venue_id),
  constraint menu_dietary_claims_item_fkey foreign key (item_id, venue_id)
    references public.menu_items (id, venue_id) on delete restrict,
  constraint menu_dietary_claims_variant_fkey foreign key (variant_id, item_id)
    references public.menu_variants (id, item_id) on delete restrict,
  constraint menu_dietary_claims_claim check (claim = any (private.menu_dietary_claims_vocabulary()))
);

create index menu_dietary_claims_item_idx on public.menu_dietary_claims (item_id, seq);

create table public.menu_dietary_decisions (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  claim_id uuid not null,
  venue_id uuid not null,
  decision text not null check (decision in ('confirmed', 'declined', 'revoked')),
  decided_by uuid not null references public.profiles (id) on delete restrict,
  decided_at timestamptz not null default now(),
  reason text check (reason is null or (length(reason) between 1 and 500 and reason = btrim(reason))),
  command_key uuid,
  constraint menu_dietary_decisions_claim_fkey foreign key (claim_id, venue_id)
    references public.menu_dietary_claims (id, venue_id) on delete restrict
);

create index menu_dietary_decisions_claim_idx on public.menu_dietary_decisions (claim_id, seq);
create unique index menu_dietary_decisions_one_each on public.menu_dietary_decisions (claim_id, decision);

create table public.menu_allergen_statements (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  venue_id uuid not null,
  item_id uuid not null,
  variant_id uuid,
  recipe_declaration_id uuid references public.menu_change_declarations (id) on delete restrict,
  allergens jsonb not null check (jsonb_array_length(private.menu_allergen_problems(allergens)) = 0),
  complete boolean not null,
  rule_version integer not null default 1 check (rule_version >= 1),
  reason text check (reason is null or (length(reason) between 1 and 500 and reason = btrim(reason))),
  stated_by uuid not null references public.profiles (id) on delete restrict,
  stated_at timestamptz not null default now(),
  command_key uuid not null,
  constraint menu_allergen_statements_id_venue_key unique (id, venue_id),
  constraint menu_allergen_statements_item_fkey foreign key (item_id, venue_id)
    references public.menu_items (id, venue_id) on delete restrict,
  constraint menu_allergen_statements_variant_fkey foreign key (variant_id, item_id)
    references public.menu_variants (id, item_id) on delete restrict
);

create index menu_allergen_statements_item_idx on public.menu_allergen_statements (item_id, seq);

create table public.menu_allergen_decisions (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  statement_id uuid not null,
  venue_id uuid not null,
  decision text not null check (decision in ('confirmed', 'declined', 'revoked')),
  decided_by uuid not null references public.profiles (id) on delete restrict,
  decided_at timestamptz not null default now(),
  reason text check (reason is null or (length(reason) between 1 and 500 and reason = btrim(reason))),
  command_key uuid,
  constraint menu_allergen_decisions_statement_fkey foreign key (statement_id, venue_id)
    references public.menu_allergen_statements (id, venue_id) on delete restrict
);

create index menu_allergen_decisions_statement_idx on public.menu_allergen_decisions (statement_id, seq);
create unique index menu_allergen_decisions_one_each on public.menu_allergen_decisions (statement_id, decision);

-- c1: authority statements only; c2 adds the evidence_documents foreign key
-- and the document kinds (b05-design §2A, H1).
create table public.menu_allergen_evidence (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null,
  venue_id uuid not null,
  kind text not null check (kind in ('recipe_specification', 'supplier_specification', 'allergen_matrix',
    'authority_statement')),
  document_id uuid,
  note text check (note is null or (length(note) between 1 and 500 and note = btrim(note))),
  attached_by uuid not null references public.profiles (id) on delete restrict,
  attached_at timestamptz not null default now(),
  command_key uuid not null,
  constraint menu_allergen_evidence_statement_fkey foreign key (statement_id, venue_id)
    references public.menu_allergen_statements (id, venue_id) on delete restrict,
  constraint menu_allergen_evidence_document check ((kind = 'authority_statement') = (document_id is null)),
  constraint menu_allergen_evidence_c1_authority_only check (kind = 'authority_statement')
);

create index menu_allergen_evidence_statement_idx on public.menu_allergen_evidence (statement_id);

comment on table public.menu_dietary_claims is
  'Append-only dietary claims (B04-03b) over the closed vocabulary; current only through the named dietary authority''s confirmation.';
comment on table public.menu_allergen_statements is
  'Append-only allergen statements (B04-03c) bound to a recipe anchor; current only through the named allergen authority''s confirmation. A missing allergen is not declared, not free from, unless complete.';
comment on table public.menu_allergen_evidence is
  'Append-only evidence for an allergen statement. Internal: no read output carries a document id, filename or path. Photos are never evidence.';

do $$
declare
  t text;
begin
  foreach t in array array[
    'menu_item_modifier_groups', 'menu_public_messages', 'menu_dietary_claims', 'menu_dietary_decisions',
    'menu_allergen_statements', 'menu_allergen_decisions', 'menu_allergen_evidence'
  ] loop
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function private.append_only_guard()',
      t || '_append_only', t);
    execute format(
      'create trigger %I before truncate on public.%I for each statement execute function private.append_only_guard()',
      t || '_no_truncate', t);
  end loop;
end;
$$;

create trigger menu_modifier_groups_no_truncate
  before truncate on public.menu_modifier_groups
  for each statement execute function private.append_only_guard();
create trigger menu_modifier_options_no_truncate
  before truncate on public.menu_modifier_options
  for each statement execute function private.append_only_guard();

revoke all on
  public.menu_modifier_groups, public.menu_modifier_options, public.menu_item_modifier_groups,
  public.menu_public_messages, public.menu_dietary_claims, public.menu_dietary_decisions,
  public.menu_allergen_statements, public.menu_allergen_decisions, public.menu_allergen_evidence
from public, anon, authenticated, service_role;
grant select on
  public.menu_modifier_groups, public.menu_modifier_options, public.menu_item_modifier_groups,
  public.menu_public_messages, public.menu_dietary_claims, public.menu_dietary_decisions,
  public.menu_allergen_statements, public.menu_allergen_decisions
to service_role;
revoke all on private.menu_safety_authorities from public, anon, authenticated, service_role;

alter table public.menu_modifier_groups enable row level security;
alter table public.menu_modifier_options enable row level security;
alter table public.menu_item_modifier_groups enable row level security;
alter table public.menu_public_messages enable row level security;
alter table public.menu_dietary_claims enable row level security;
alter table public.menu_dietary_decisions enable row level security;
alter table public.menu_allergen_statements enable row level security;
alter table public.menu_allergen_decisions enable row level security;
alter table public.menu_allergen_evidence enable row level security;

-- New command names for the shared request-key table.
alter table public.menu_trading_commands drop constraint menu_trading_commands_command_check;
alter table public.menu_trading_commands add constraint menu_trading_commands_command_check check (command in (
  'propose', 'decide', 'set_temporarily_unavailable', 'schedule_add', 'schedule_exception_add',
  'modifier_group_add', 'modifier_option_add', 'modifier_attach', 'modifier_retire', 'modifier_line',
  'dietary_propose', 'dietary_decide', 'allergen_propose', 'allergen_evidence', 'allergen_decide'
));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The recipe anchor of an item (or its variant), §7.3: the latest recipe
-- declaration of an activated version, item-wide or for that variant; null
-- when none. A version without one keeps the previous anchor.
create function private.menu_recipe_anchor(p_item_id uuid, p_variant_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.id
  from public.menu_change_declarations d
  join public.menu_versions v on v.id = d.version_id
  where d.item_id = p_item_id and d.kind = 'recipe' and v.activated_at is not null
    and (d.variant_id is null or d.variant_id is not distinct from p_variant_id)
  order by v.activated_at desc, d.declared_at desc, d.id desc
  limit 1;
$$;

-- Whether the caller is the venue's named authority for p_scope now.
create function private.menu_is_safety_authority(p_venue_id uuid, p_scope text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and private.is_active_user() and exists (
    select 1 from private.menu_safety_authorities a
    where a.venue_id = p_venue_id and a.scope = p_scope and a.profile_id = auth.uid() and a.revoked_at is null);
$$;

-- Refuses a confirmation or revocation unless the caller is the authority:
-- <scope>_authority_missing while the venue names none, else
-- not_<scope>_authority. Admins have no bypass (§6.4).
create function private.menu_assert_safety_authority(p_venue_id uuid, p_scope text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from private.menu_safety_authorities a
                 where a.venue_id = p_venue_id and a.scope = p_scope and a.revoked_at is null) then
    raise exception '%', case p_scope when 'allergens' then 'allergen_authority_missing'
      else 'dietary_authority_missing' end using errcode = '42501';
  end if;
  if not private.menu_is_safety_authority(p_venue_id, p_scope) then
    raise exception '%', case p_scope when 'allergens' then 'not_allergen_authority'
      else 'not_dietary_authority' end using errcode = '42501';
  end if;
end;
$$;

-- The current allergen statement for (item, variant) exactly: its latest
-- decision is confirmed and its recipe anchor is the current one; the newest
-- such confirmation wins. Null when none.
create function private.menu_allergen_current(p_item_id uuid, p_variant_id uuid)
returns public.menu_allergen_statements
language sql
stable
security definer
set search_path = ''
as $$
  select s.*
  from public.menu_allergen_statements s
  join lateral (
    select d.decision, d.seq from public.menu_allergen_decisions d
    where d.statement_id = s.id order by d.seq desc limit 1
  ) last on true
  where s.item_id = p_item_id and s.variant_id is not distinct from p_variant_id
    and last.decision = 'confirmed'
    and s.recipe_declaration_id is not distinct from private.menu_recipe_anchor(s.item_id, s.variant_id)
  order by last.seq desc
  limit 1;
$$;

-- The same for a dietary claim (item, variant, claim).
create function private.menu_dietary_current(p_item_id uuid, p_variant_id uuid, p_claim text)
returns public.menu_dietary_claims
language sql
stable
security definer
set search_path = ''
as $$
  select c.*
  from public.menu_dietary_claims c
  join lateral (
    select d.decision, d.seq from public.menu_dietary_decisions d
    where d.claim_id = c.id order by d.seq desc limit 1
  ) last on true
  where c.item_id = p_item_id and c.variant_id is not distinct from p_variant_id and c.claim = p_claim
    and last.decision = 'confirmed'
    and c.recipe_declaration_id is not distinct from private.menu_recipe_anchor(c.item_id, c.variant_id)
  order by last.seq desc
  limit 1;
$$;

-- The uncertainty outcome (§6.2 #2): the latest owner-decided version of the
-- message for the audience, or null with messageStatus awaiting_decision.
create function private.menu_allergen_unconfirmed(p_audience text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('status', 'unavailable', 'reason', 'not_confirmed',
      'messageKey', 'allergen_unconfirmed', 'message', m.text,
      'messageVersion', m.version,
      'messageStatus', case when m.text is null then 'awaiting_decision' else 'decided' end)
  from (select null::int as nothing) x
  left join lateral (
    select p.text, p.version from public.menu_public_messages p
    where p.key = 'allergen_unconfirmed' and p.audience = p_audience
    order by p.version desc limit 1
  ) m on true;
$$;

-- The allergen outcome for (item, variant): the variant's current statement,
-- else the item's; else the uncertainty outcome (internal audience). An
-- incomplete statement never yields free_from (§6.2 #3).
create function private.menu_allergen_outcome(p_item_id uuid, p_variant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_s public.menu_allergen_statements;
begin
  if p_variant_id is not null then
    v_s := private.menu_allergen_current(p_item_id, p_variant_id);
  end if;
  if v_s.id is null then
    v_s := private.menu_allergen_current(p_item_id, null);
  end if;
  if v_s.id is null then
    return private.menu_allergen_unconfirmed('internal');
  end if;
  return jsonb_build_object(
    'status', 'available',
    'statementId', v_s.id,
    'scope', case when v_s.variant_id is null then 'item' else 'variant' end,
    'complete', v_s.complete,
    'contains', coalesce((select jsonb_agg(e.key order by e.key) from jsonb_each_text(v_s.allergens) e
                          where e.value = 'contains'), '[]'::jsonb),
    'mayContain', coalesce((select jsonb_agg(e.key order by e.key) from jsonb_each_text(v_s.allergens) e
                            where e.value = 'may_contain'), '[]'::jsonb),
    'freeFrom', case when v_s.complete then coalesce((
        select jsonb_agg(c order by c) from unnest(private.menu_allergen_codes()) c
        where not (v_s.allergens ? c)), '[]'::jsonb) else '[]'::jsonb end,
    'confirmedAt', (select max(d.decided_at) from public.menu_allergen_decisions d
                    where d.statement_id = v_s.id and d.decision = 'confirmed'));
end;
$$;

-- The dietary claims for (item, variant): one entry per vocabulary claim,
-- confirmed (value yes or no) or not_confirmed. A variant falls back to the
-- item's claim.
create function private.menu_dietary_outcome(p_item_id uuid, p_variant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claim text;
  v_c public.menu_dietary_claims;
  v_out jsonb := '[]'::jsonb;
begin
  foreach v_claim in array private.menu_dietary_claims_vocabulary() loop
    v_c := null;
    if p_variant_id is not null then
      v_c := private.menu_dietary_current(p_item_id, p_variant_id, v_claim);
    end if;
    if v_c.id is null then
      v_c := private.menu_dietary_current(p_item_id, null, v_claim);
    end if;
    v_out := v_out || case when v_c.id is null
      then jsonb_build_object('claim', v_claim, 'status', 'not_confirmed')
      else jsonb_build_object('claim', v_claim, 'status', 'confirmed', 'value', v_c.value, 'claimId', v_c.id) end;
  end loop;
  return v_out;
end;
$$;

-- Common command opening: active user, actor and venue menu locks, the
-- caller's role (admin or manager, or the venue's authority for
-- p_authority_scope when given). Returns the role ('admin', 'manager' or
-- 'authority').
create function private.menu_safety_open(p_venue_id uuid, p_authority_scope text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  perform private.menu_trading_lock_actor(v_uid);
  perform private.lock_venue_menu(p_venue_id, true);
  v_role := private.menu_trading_role(p_venue_id, true);
  if coalesce(v_role, 'none') not in ('admin', 'manager') then
    if p_authority_scope is not null and private.menu_is_safety_authority(p_venue_id, p_authority_scope) then
      return 'authority';
    end if;
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  return v_role;
end;
$$;

-- The re-read after a wait: the same role must still hold.
create function private.menu_safety_reassert(p_venue_id uuid, p_role text, p_authority_scope text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_role = 'authority' then
    if not private.menu_is_safety_authority(p_venue_id, p_authority_scope) then
      raise exception 'not_venue_manager' using errcode = '42501';
    end if;
  else
    perform private.menu_trading_assert_role(p_venue_id, p_role, 'not_venue_manager');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Modifier commands and read (manager or admin; §6.4)
-- ---------------------------------------------------------------------------

-- A modifier group for a venue. Single selection is min 0..1, max 1.
create function public.menu_modifier_group_add(
  p_venue uuid, p_name text, p_selection text, p_min integer, p_max integer, p_request_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_name text := btrim(p_name);
  v_hash text;
  v_prior jsonb;
  v_row public.menu_modifier_groups;
begin
  if p_venue is null or not exists (select 1 from public.venues v where v.id = p_venue) then
    raise exception 'venue_not_found' using errcode = 'P0002';
  end if;
  v_role := private.menu_safety_open(p_venue, null);
  v_hash := private.menu_source_request_hash(jsonb_build_object('venue', p_venue, 'name', v_name,
    'selection', p_selection, 'min', p_min, 'max', p_max));
  v_prior := private.menu_trading_replay(p_request_key, v_uid, 'modifier_group_add', v_hash);
  perform private.menu_safety_reassert(p_venue, v_role, null);
  if v_prior is not null then
    return v_prior;
  end if;
  if v_name is null or length(v_name) not between 1 and 80 or p_selection is null
     or p_selection not in ('single', 'multiple') or coalesce(p_min, 0) < 0
     or (p_max is not null and (p_max < 1 or p_max < coalesce(p_min, 0)))
     or (p_selection = 'single' and (coalesce(p_max, 1) <> 1 or coalesce(p_min, 0) > 1)) then
    raise exception 'invalid_modifier' using errcode = '22023';
  end if;
  insert into public.menu_modifier_groups (venue_id, name, selection, min_select, max_select, created_by)
  values (p_venue, v_name, p_selection, coalesce(p_min, 0),
    case when p_selection = 'single' then 1 else p_max end, v_uid)
  returning * into v_row;
  return private.menu_trading_record(p_request_key, v_uid, 'modifier_group_add', v_hash, p_venue,
    jsonb_build_object('groupId', v_row.id, 'name', v_row.name, 'selection', v_row.selection,
      'minSelect', v_row.min_select, 'maxSelect', v_row.max_select, 'replayed', false));
end;
$$;

-- An option of a live group.
create function public.menu_modifier_option_add(p_group uuid, p_name text, p_position integer, p_request_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_group public.menu_modifier_groups;
  v_role text;
  v_name text := btrim(p_name);
  v_hash text;
  v_prior jsonb;
  v_row public.menu_modifier_options;
begin
  select g.* into v_group from public.menu_modifier_groups g where g.id = p_group;
  if not found then
    raise exception 'menu_modifier_not_found' using errcode = 'P0002';
  end if;
  v_role := private.menu_safety_open(v_group.venue_id, null);
  v_hash := private.menu_source_request_hash(jsonb_build_object('group', p_group, 'name', v_name,
    'position', p_position));
  v_prior := private.menu_trading_replay(p_request_key, v_uid, 'modifier_option_add', v_hash);
  perform private.menu_safety_reassert(v_group.venue_id, v_role, null);
  if v_prior is not null then
    return v_prior;
  end if;
  if v_name is null or length(v_name) not between 1 and 80 or coalesce(p_position, 0) < 0 then
    raise exception 'invalid_modifier' using errcode = '22023';
  end if;
  select g.* into v_group from public.menu_modifier_groups g where g.id = p_group for share;
  if v_group.retired_at is not null then
    raise exception 'menu_modifier_retired' using errcode = 'P0001';
  end if;
  insert into public.menu_modifier_options (group_id, venue_id, name, position, created_by)
  values (v_group.id, v_group.venue_id, v_name, coalesce(p_position, 0), v_uid)
  returning * into v_row;
  return private.menu_trading_record(p_request_key, v_uid, 'modifier_option_add', v_hash, v_group.venue_id,
    jsonb_build_object('optionId', v_row.id, 'groupId', v_row.group_id, 'name', v_row.name,
      'position', v_row.position, 'replayed', false));
end;
$$;

-- Offer a live group with an item of the same venue from a local date (null:
-- today; never earlier) to an optional end date.
create function public.menu_item_modifier_group_attach(
  p_item uuid, p_group uuid, p_effective_from date, p_effective_to date, p_request_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_item public.menu_items;
  v_group public.menu_modifier_groups;
  v_role text;
  v_from date;
  v_hash text;
  v_prior jsonb;
  v_id uuid;
begin
  select i.* into v_item from public.menu_items i where i.id = p_item;
  if not found then
    raise exception 'menu_item_not_found' using errcode = 'P0002';
  end if;
  v_role := private.menu_safety_open(v_item.venue_id, null);
  v_hash := private.menu_source_request_hash(jsonb_build_object('item', p_item, 'group', p_group,
    'from', p_effective_from, 'to', p_effective_to));
  v_prior := private.menu_trading_replay(p_request_key, v_uid, 'modifier_attach', v_hash);
  perform private.menu_safety_reassert(v_item.venue_id, v_role, null);
  if v_prior is not null then
    return v_prior;
  end if;
  -- Another venue's group reads as not found (no existence oracle).
  select g.* into v_group from public.menu_modifier_groups g
  where g.id = p_group and g.venue_id = v_item.venue_id for share;
  if not found then
    raise exception 'menu_modifier_not_found' using errcode = 'P0002';
  end if;
  if v_group.retired_at is not null then
    raise exception 'menu_modifier_retired' using errcode = 'P0001';
  end if;
  if not private.menu_trading_item_active(p_item, null) then
    raise exception 'menu_item_not_on_active_menu' using errcode = 'P0001';
  end if;
  v_from := coalesce(p_effective_from, private.menu_venue_date(v_item.venue_id, now()));
  if v_from < private.menu_venue_date(v_item.venue_id, now())
     or (p_effective_to is not null and p_effective_to < v_from) then
    raise exception 'invalid_effective_dates' using errcode = '22023';
  end if;
  insert into public.menu_item_modifier_groups (item_id, group_id, venue_id, effective_from, effective_to, created_by)
  values (p_item, v_group.id, v_item.venue_id, v_from, p_effective_to, v_uid)
  on conflict on constraint menu_item_modifier_groups_once do nothing
  returning id into v_id;
  if v_id is null then
    raise exception 'menu_modifier_already_attached' using errcode = 'P0001';
  end if;
  return private.menu_trading_record(p_request_key, v_uid, 'modifier_attach', v_hash, v_item.venue_id,
    jsonb_build_object('attachmentId', v_id, 'itemId', p_item, 'groupId', v_group.id,
      'effectiveFrom', v_from, 'effectiveTo', p_effective_to, 'replayed', false));
end;
$$;

-- Retire exactly one group or option (once). A retired option's lines stay
-- with their history; a retired group is no longer offered.
create function public.menu_modifier_retire(p_group uuid, p_option uuid, p_request_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_venue uuid;
  v_role text;
  v_hash text;
  v_prior jsonb;
  v_done boolean;
begin
  if (p_group is null) = (p_option is null) then
    raise exception 'invalid_modifier' using errcode = '22023';
  end if;
  select coalesce((select g.venue_id from public.menu_modifier_groups g where g.id = p_group),
    (select o.venue_id from public.menu_modifier_options o where o.id = p_option)) into v_venue;
  if v_venue is null then
    raise exception 'menu_modifier_not_found' using errcode = 'P0002';
  end if;
  v_role := private.menu_safety_open(v_venue, null);
  v_hash := private.menu_source_request_hash(jsonb_build_object('group', p_group, 'option', p_option));
  v_prior := private.menu_trading_replay(p_request_key, v_uid, 'modifier_retire', v_hash);
  perform private.menu_safety_reassert(v_venue, v_role, null);
  if v_prior is not null then
    return v_prior;
  end if;
  if p_group is not null then
    update public.menu_modifier_groups g set retired_at = now(), retired_by = v_uid
    where g.id = p_group and g.retired_at is null returning true into v_done;
  else
    update public.menu_modifier_options o set retired_at = now(), retired_by = v_uid
    where o.id = p_option and o.retired_at is null returning true into v_done;
  end if;
  if v_done is null then
    raise exception 'menu_modifier_retired' using errcode = 'P0001';
  end if;
  return private.menu_trading_record(p_request_key, v_uid, 'modifier_retire', v_hash, v_venue,
    jsonb_build_object('groupId', p_group, 'optionId', p_option, 'retired', true, 'replayed', false));
end;
$$;

-- The price-delta line of an option for an item (§5.3: a trading line with
-- modifier_option_id), created when missing. The option's group must be
-- offered with the item today and neither retired; the item active. Price it
-- with menu_trading_propose(p_line => lineId, ...).
create function public.menu_modifier_option_line(p_item uuid, p_option uuid, p_channel text, p_request_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_item public.menu_items;
  v_option public.menu_modifier_options;
  v_role text;
  v_channel text := coalesce(p_channel, 'all');
  v_today date;
  v_hash text;
  v_prior jsonb;
  v_line public.menu_trading_lines;
  v_created boolean := false;
begin
  select i.* into v_item from public.menu_items i where i.id = p_item;
  if not found then
    raise exception 'menu_item_not_found' using errcode = 'P0002';
  end if;
  v_role := private.menu_safety_open(v_item.venue_id, null);
  v_hash := private.menu_source_request_hash(jsonb_build_object('item', p_item, 'option', p_option,
    'channel', v_channel));
  v_prior := private.menu_trading_replay(p_request_key, v_uid, 'modifier_line', v_hash);
  perform private.menu_safety_reassert(v_item.venue_id, v_role, null);
  if v_prior is not null then
    return v_prior;
  end if;
  if v_channel not in ('all', 'dine_in', 'takeaway') then
    raise exception 'invalid_channel' using errcode = '22023';
  end if;
  select o.* into v_option from public.menu_modifier_options o
  where o.id = p_option and o.venue_id = v_item.venue_id for share;
  if not found then
    raise exception 'menu_modifier_not_found' using errcode = 'P0002';
  end if;
  v_today := private.menu_venue_date(v_item.venue_id, now());
  if v_option.retired_at is not null or not exists (
       select 1 from public.menu_item_modifier_groups a
       join public.menu_modifier_groups g on g.id = a.group_id
       where a.item_id = p_item and a.group_id = v_option.group_id and g.retired_at is null
         and a.effective_from <= v_today and (a.effective_to is null or a.effective_to >= v_today)) then
    raise exception 'menu_modifier_not_offered' using errcode = 'P0001';
  end if;
  if not private.menu_trading_item_active(p_item, null) then
    raise exception 'menu_item_not_on_active_menu' using errcode = 'P0001';
  end if;
  select l.* into v_line from public.menu_trading_lines l
  where l.item_id = p_item and l.variant_id is null and l.portion_label is null and l.channel = v_channel
    and l.modifier_option_id = p_option;
  if not found then
    insert into public.menu_trading_lines (venue_id, item_id, channel, modifier_option_id, created_by)
    values (v_item.venue_id, p_item, v_channel, p_option, v_uid)
    returning * into v_line;
    v_created := true;
  end if;
  return private.menu_trading_record(p_request_key, v_uid, 'modifier_line', v_hash, v_item.venue_id,
    jsonb_build_object('lineId', v_line.id, 'lineRevision', v_line.revision, 'itemId', p_item,
      'modifierOptionId', p_option, 'channel', v_channel, 'created', v_created, 'replayed', false));
end;
$$;

-- The modifier groups offered with an item today and their live options,
-- with each option's price-delta line ids. Admin and manager; staff of a
-- venue they may label, for an item on its active menu.
create function public.menu_item_modifiers(p_item uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_item public.menu_items;
  v_role text;
  v_today date;
begin
  if auth.uid() is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  select i.* into v_item from public.menu_items i where i.id = p_item;
  if not found then
    raise exception 'menu_item_not_found' using errcode = 'P0002';
  end if;
  v_role := private.menu_trading_role(v_item.venue_id, false);
  if v_role is null then
    raise exception 'menu_item_not_found' using errcode = 'P0002';
  end if;
  if v_role = 'staff' and not private.menu_trading_item_active(p_item, null) then
    raise exception 'menu_item_not_on_active_menu' using errcode = 'P0001';
  end if;
  v_today := private.menu_venue_date(v_item.venue_id, now());
  return jsonb_build_object('itemId', p_item, 'groups', coalesce((
    select jsonb_agg(jsonb_build_object(
        'groupId', g.id, 'name', g.name, 'selection', g.selection, 'minSelect', g.min_select,
        'maxSelect', g.max_select, 'effectiveFrom', a.effective_from, 'effectiveTo', a.effective_to,
        'options', coalesce((
          select jsonb_agg(jsonb_build_object('optionId', o.id, 'name', o.name, 'position', o.position,
              'lineIds', coalesce((select jsonb_agg(l.id order by l.channel, l.id) from public.menu_trading_lines l
                                   where l.item_id = p_item and l.modifier_option_id = o.id
                                     and l.retired_at is null), '[]'::jsonb))
            order by o.position, o.name, o.id)
          from public.menu_modifier_options o where o.group_id = g.id and o.retired_at is null), '[]'::jsonb))
      order by g.name, g.id)
    from public.menu_item_modifier_groups a
    join public.menu_modifier_groups g on g.id = a.group_id
    where a.item_id = p_item and g.retired_at is null
      and a.effective_from <= v_today and (a.effective_to is null or a.effective_to >= v_today)), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Dietary claims (B04-03b)
-- ---------------------------------------------------------------------------

-- Propose a dietary claim (manager or admin) for an item, or one of its
-- variants, on the active menu, bound to its current recipe anchor. Source
-- labels such as GF or veg never become a claim without this and a decision
-- (§6.2 #5).
create function public.menu_dietary_claim_propose(
  p_item uuid, p_variant uuid, p_claim text, p_value text, p_reason text, p_request_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_item public.menu_items;
  v_role text;
  v_reason text := nullif(btrim(p_reason), '');
  v_hash text;
  v_prior jsonb;
  v_row public.menu_dietary_claims;
begin
  select i.* into v_item from public.menu_items i where i.id = p_item;
  if not found then
    raise exception 'menu_item_not_found' using errcode = 'P0002';
  end if;
  v_role := private.menu_safety_open(v_item.venue_id, null);
  v_hash := private.menu_source_request_hash(jsonb_build_object('item', p_item, 'variant', p_variant,
    'claim', p_claim, 'value', p_value, 'reason', v_reason));
  v_prior := private.menu_trading_replay(p_request_key, v_uid, 'dietary_propose', v_hash);
  perform private.menu_safety_reassert(v_item.venue_id, v_role, null);
  if v_prior is not null then
    return v_prior;
  end if;
  if p_claim is null or not (p_claim = any (private.menu_dietary_claims_vocabulary()))
     or p_value is null or p_value not in ('yes', 'no')
     or (v_reason is not null and length(v_reason) > 500) then
    raise exception 'invalid_dietary_claim' using errcode = '22023';
  end if;
  if not private.menu_trading_item_active(p_item, p_variant) then
    raise exception 'menu_item_not_on_active_menu' using errcode = 'P0001';
  end if;
  insert into public.menu_dietary_claims (venue_id, item_id, variant_id, claim, value, recipe_declaration_id,
    reason, stated_by, command_key)
  values (v_item.venue_id, p_item, p_variant, p_claim, p_value, private.menu_recipe_anchor(p_item, p_variant),
    v_reason, v_uid, p_request_key)
  returning * into v_row;
  return private.menu_trading_record(p_request_key, v_uid, 'dietary_propose', v_hash, v_item.venue_id,
    jsonb_build_object('claimId', v_row.id, 'itemId', p_item, 'variantId', p_variant, 'claim', p_claim,
      'value', p_value, 'state', 'proposed', 'replayed', false));
end;
$$;

-- Decide a dietary claim: confirmed or revoked only by the venue's named
-- dietary authority (dietary_authority_missing until OD-B4-8 names one);
-- declined also by a manager or admin. confirmed and declined apply to a
-- proposed claim; revoked to a current one.
create function public.menu_dietary_claim_decide(p_claim uuid, p_decision text, p_reason text, p_request_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_claim public.menu_dietary_claims;
  v_role text;
  v_reason text := nullif(btrim(p_reason), '');
  v_hash text;
  v_prior jsonb;
  v_last text;
  v_id uuid;
begin
  select c.* into v_claim from public.menu_dietary_claims c where c.id = p_claim;
  if not found then
    raise exception 'menu_dietary_claim_not_found' using errcode = 'P0002';
  end if;
  v_role := private.menu_safety_open(v_claim.venue_id, 'dietary');
  if p_decision is null or p_decision not in ('confirmed', 'declined', 'revoked') then
    raise exception 'invalid_safety_decision' using errcode = '22023';
  end if;
  if p_decision in ('confirmed', 'revoked') then
    perform private.menu_assert_safety_authority(v_claim.venue_id, 'dietary');
  end if;
  v_hash := private.menu_source_request_hash(jsonb_build_object('claim', p_claim, 'decision', p_decision,
    'reason', v_reason));
  v_prior := private.menu_trading_replay(p_request_key, v_uid, 'dietary_decide', v_hash);
  perform private.menu_safety_reassert(v_claim.venue_id, v_role, 'dietary');
  if v_prior is not null then
    return v_prior;
  end if;
  if p_decision in ('confirmed', 'revoked') then
    perform private.menu_assert_safety_authority(v_claim.venue_id, 'dietary');
  end if;
  if v_reason is not null and length(v_reason) > 500 then
    raise exception 'invalid_dietary_claim' using errcode = '22023';
  end if;
  select d.decision into v_last from public.menu_dietary_decisions d
  where d.claim_id = v_claim.id order by d.seq desc limit 1;
  if p_decision in ('confirmed', 'declined') and v_last is not null then
    raise exception 'menu_safety_not_proposed' using errcode = 'P0001';
  end if;
  if p_decision = 'revoked' and v_last is distinct from 'confirmed' then
    raise exception 'menu_safety_not_confirmed' using errcode = 'P0001';
  end if;
  if p_decision = 'confirmed' then
    if not private.menu_trading_item_active(v_claim.item_id, v_claim.variant_id) then
      raise exception 'menu_item_not_on_active_menu' using errcode = 'P0001';
    end if;
    if v_claim.recipe_declaration_id is distinct from private.menu_recipe_anchor(v_claim.item_id, v_claim.variant_id) then
      raise exception 'menu_safety_stale_recipe' using errcode = 'P0001';
    end if;
  end if;
  insert into public.menu_dietary_decisions (claim_id, venue_id, decision, decided_by, reason, command_key)
  values (v_claim.id, v_claim.venue_id, p_decision, v_uid, v_reason, p_request_key)
  returning id into v_id;
  return private.menu_trading_record(p_request_key, v_uid, 'dietary_decide', v_hash, v_claim.venue_id,
    jsonb_build_object('decisionId', v_id, 'claimId', v_claim.id, 'decision', p_decision, 'replayed', false));
end;
$$;

-- ---------------------------------------------------------------------------
-- Allergen statements (B04-03c)
-- ---------------------------------------------------------------------------

-- Propose an allergen statement (manager or admin; staff cannot, §6.4) for an
-- item or one of its variants on the active menu: { code: contains |
-- may_contain } over the closed list, and whether every listed allergen was
-- assessed (complete). Bound to the current recipe anchor.
create function public.menu_allergen_statement_propose(
  p_item uuid, p_variant uuid, p_allergens jsonb, p_complete boolean, p_reason text, p_request_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_item public.menu_items;
  v_role text;
  v_reason text := nullif(btrim(p_reason), '');
  v_fields jsonb;
  v_hash text;
  v_prior jsonb;
  v_row public.menu_allergen_statements;
begin
  select i.* into v_item from public.menu_items i where i.id = p_item;
  if not found then
    raise exception 'menu_item_not_found' using errcode = 'P0002';
  end if;
  v_role := private.menu_safety_open(v_item.venue_id, null);
  v_hash := private.menu_source_request_hash(jsonb_build_object('item', p_item, 'variant', p_variant,
    'allergens', p_allergens, 'complete', p_complete, 'reason', v_reason));
  v_prior := private.menu_trading_replay(p_request_key, v_uid, 'allergen_propose', v_hash);
  perform private.menu_safety_reassert(v_item.venue_id, v_role, null);
  if v_prior is not null then
    return v_prior;
  end if;
  v_fields := private.menu_allergen_problems(p_allergens);
  if p_complete is null then
    v_fields := v_fields || jsonb_build_object('path', 'complete', 'problem', 'required');
  end if;
  if v_reason is not null and length(v_reason) > 500 then
    v_fields := v_fields || jsonb_build_object('path', 'reason', 'problem', 'too_long');
  end if;
  if jsonb_array_length(v_fields) > 0 then
    raise exception 'invalid_allergen_statement' using errcode = '22023',
      detail = jsonb_build_object('fields', v_fields)::text;
  end if;
  if not private.menu_trading_item_active(p_item, p_variant) then
    raise exception 'menu_item_not_on_active_menu' using errcode = 'P0001';
  end if;
  insert into public.menu_allergen_statements (venue_id, item_id, variant_id, recipe_declaration_id, allergens,
    complete, reason, stated_by, command_key)
  values (v_item.venue_id, p_item, p_variant, private.menu_recipe_anchor(p_item, p_variant), p_allergens,
    p_complete, v_reason, v_uid, p_request_key)
  returning * into v_row;
  return private.menu_trading_record(p_request_key, v_uid, 'allergen_propose', v_hash, v_item.venue_id,
    jsonb_build_object('statementId', v_row.id, 'itemId', p_item, 'variantId', p_variant,
      'state', 'proposed', 'replayed', false));
end;
$$;

-- Attach evidence to a statement that is not yet decided (manager, admin or
-- the venue's allergen authority). Checked in this order (§6.2 #4): an id
-- found in media_assets is photo_not_allergen_evidence whatever its labels;
-- any other document id is document_not_found (c1: evidence documents
-- arrive with c2); an authority_statement takes no document.
create function public.menu_allergen_evidence_attach(
  p_statement uuid, p_kind text, p_document uuid, p_note text, p_request_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_statement public.menu_allergen_statements;
  v_role text;
  v_note text := nullif(btrim(p_note), '');
  v_hash text;
  v_prior jsonb;
  v_id uuid;
begin
  select s.* into v_statement from public.menu_allergen_statements s where s.id = p_statement;
  if not found then
    raise exception 'menu_allergen_statement_not_found' using errcode = 'P0002';
  end if;
  v_role := private.menu_safety_open(v_statement.venue_id, 'allergens');
  v_hash := private.menu_source_request_hash(jsonb_build_object('statement', p_statement, 'kind', p_kind,
    'document', p_document, 'note', v_note));
  v_prior := private.menu_trading_replay(p_request_key, v_uid, 'allergen_evidence', v_hash);
  perform private.menu_safety_reassert(v_statement.venue_id, v_role, 'allergens');
  if v_prior is not null then
    return v_prior;
  end if;
  if p_document is not null and exists (select 1 from public.media_assets m where m.id = p_document) then
    raise exception 'photo_not_allergen_evidence' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('recipe_specification', 'supplier_specification', 'allergen_matrix',
       'authority_statement') or (v_note is not null and length(v_note) > 500) then
    raise exception 'invalid_evidence_kind' using errcode = '22023';
  end if;
  if p_kind <> 'authority_statement' then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if p_document is not null then
    raise exception 'invalid_evidence_kind' using errcode = '22023';
  end if;
  if exists (select 1 from public.menu_allergen_decisions d where d.statement_id = v_statement.id) then
    raise exception 'menu_safety_not_proposed' using errcode = 'P0001';
  end if;
  insert into public.menu_allergen_evidence (statement_id, venue_id, kind, document_id, note, attached_by, command_key)
  values (v_statement.id, v_statement.venue_id, p_kind, null, v_note, v_uid, p_request_key)
  returning id into v_id;
  return private.menu_trading_record(p_request_key, v_uid, 'allergen_evidence', v_hash, v_statement.venue_id,
    jsonb_build_object('evidenceId', v_id, 'statementId', v_statement.id, 'kind', p_kind, 'replayed', false));
end;
$$;

-- Decide an allergen statement: confirmed or revoked only by the venue's
-- named allergen authority, never an admin by role (allergen_authority_missing
-- until OD-B4-7 names one); declined also by a manager or admin. A
-- confirmation needs evidence, the active item and the current recipe anchor.
create function public.menu_allergen_statement_decide(
  p_statement uuid, p_decision text, p_reason text, p_request_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_statement public.menu_allergen_statements;
  v_role text;
  v_reason text := nullif(btrim(p_reason), '');
  v_hash text;
  v_prior jsonb;
  v_last text;
  v_id uuid;
begin
  select s.* into v_statement from public.menu_allergen_statements s where s.id = p_statement;
  if not found then
    raise exception 'menu_allergen_statement_not_found' using errcode = 'P0002';
  end if;
  v_role := private.menu_safety_open(v_statement.venue_id, 'allergens');
  if p_decision is null or p_decision not in ('confirmed', 'declined', 'revoked') then
    raise exception 'invalid_safety_decision' using errcode = '22023';
  end if;
  if p_decision in ('confirmed', 'revoked') then
    perform private.menu_assert_safety_authority(v_statement.venue_id, 'allergens');
  end if;
  v_hash := private.menu_source_request_hash(jsonb_build_object('statement', p_statement,
    'decision', p_decision, 'reason', v_reason));
  v_prior := private.menu_trading_replay(p_request_key, v_uid, 'allergen_decide', v_hash);
  perform private.menu_safety_reassert(v_statement.venue_id, v_role, 'allergens');
  if v_prior is not null then
    return v_prior;
  end if;
  if p_decision in ('confirmed', 'revoked') then
    perform private.menu_assert_safety_authority(v_statement.venue_id, 'allergens');
  end if;
  if v_reason is not null and length(v_reason) > 500 then
    raise exception 'invalid_allergen_statement' using errcode = '22023';
  end if;
  select d.decision into v_last from public.menu_allergen_decisions d
  where d.statement_id = v_statement.id order by d.seq desc limit 1;
  if p_decision in ('confirmed', 'declined') and v_last is not null then
    raise exception 'menu_safety_not_proposed' using errcode = 'P0001';
  end if;
  if p_decision = 'revoked' and v_last is distinct from 'confirmed' then
    raise exception 'menu_safety_not_confirmed' using errcode = 'P0001';
  end if;
  if p_decision = 'confirmed' then
    if not exists (select 1 from public.menu_allergen_evidence e where e.statement_id = v_statement.id) then
      raise exception 'allergen_evidence_missing' using errcode = 'P0001';
    end if;
    if not private.menu_trading_item_active(v_statement.item_id, v_statement.variant_id) then
      raise exception 'menu_item_not_on_active_menu' using errcode = 'P0001';
    end if;
    if v_statement.recipe_declaration_id is distinct from
       private.menu_recipe_anchor(v_statement.item_id, v_statement.variant_id) then
      raise exception 'menu_safety_stale_recipe' using errcode = 'P0001';
    end if;
  end if;
  insert into public.menu_allergen_decisions (statement_id, venue_id, decision, decided_by, reason, command_key)
  values (v_statement.id, v_statement.venue_id, p_decision, v_uid, v_reason, p_request_key)
  returning id into v_id;
  return private.menu_trading_record(p_request_key, v_uid, 'allergen_decide', v_hash, v_statement.venue_id,
    jsonb_build_object('decisionId', v_id, 'statementId', v_statement.id, 'decision', p_decision,
      'allergens', private.menu_allergen_outcome(v_statement.item_id, v_statement.variant_id),
      'replayed', false));
end;
$$;

-- ---------------------------------------------------------------------------
-- Read (§6.2 #2, #3; §6.4; V11)
-- ---------------------------------------------------------------------------

-- An item's allergen outcome and dietary claims, and each variant's on the
-- active entry. Everyone who may read the item: outcomes only. Managers,
-- admins and the venue's authorities also see the undecided statements and
-- claims (evidence kinds and counts only) and whether authorities are named.
-- No output carries a document id, filename or path.
create function public.menu_item_safety(p_item uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_item public.menu_items;
  v_role text;
  v_out jsonb;
begin
  if auth.uid() is null or not private.is_active_user() then
    raise exception 'not_active_user' using errcode = '42501';
  end if;
  select i.* into v_item from public.menu_items i where i.id = p_item;
  if not found then
    raise exception 'menu_item_not_found' using errcode = 'P0002';
  end if;
  v_role := private.menu_trading_role(v_item.venue_id, false);
  if v_role is null and (private.menu_is_safety_authority(v_item.venue_id, 'allergens')
                         or private.menu_is_safety_authority(v_item.venue_id, 'dietary')) then
    v_role := 'authority';
  end if;
  if v_role is null then
    raise exception 'menu_item_not_found' using errcode = 'P0002';
  end if;
  if v_role = 'staff' and not private.menu_trading_item_active(p_item, null) then
    raise exception 'menu_item_not_on_active_menu' using errcode = 'P0001';
  end if;
  v_out := jsonb_build_object(
    'itemId', p_item,
    'view', v_role,
    'allergens', private.menu_allergen_outcome(p_item, null),
    'dietary', private.menu_dietary_outcome(p_item, null),
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object('variantId', ev.variant_id, 'name', ev.name,
          'allergens', private.menu_allergen_outcome(p_item, ev.variant_id),
          'dietary', private.menu_dietary_outcome(p_item, ev.variant_id)) order by ev.position, ev.variant_id)
      from public.menu_entries e
      join public.menu_entry_variants ev on ev.entry_id = e.id
      where e.item_id = p_item and e.version_id = private.active_menu_version_id(v_item.venue_id)), '[]'::jsonb));
  if v_role in ('admin', 'manager', 'authority') then
    v_out := v_out || jsonb_build_object(
      'authorities', jsonb_build_object(
        'allergens', exists (select 1 from private.menu_safety_authorities a
                             where a.venue_id = v_item.venue_id and a.scope = 'allergens' and a.revoked_at is null),
        'dietary', exists (select 1 from private.menu_safety_authorities a
                           where a.venue_id = v_item.venue_id and a.scope = 'dietary' and a.revoked_at is null)),
      'pendingStatements', coalesce((
        select jsonb_agg(jsonb_build_object('statementId', s.id, 'variantId', s.variant_id,
            'allergens', s.allergens, 'complete', s.complete, 'statedAt', s.stated_at, 'reason', s.reason,
            'recipeCurrent', s.recipe_declaration_id is not distinct from
              private.menu_recipe_anchor(s.item_id, s.variant_id),
            'evidence', jsonb_build_object(
              'count', (select count(*) from public.menu_allergen_evidence x where x.statement_id = s.id),
              'kinds', coalesce((select jsonb_agg(distinct x.kind) from public.menu_allergen_evidence x
                                 where x.statement_id = s.id), '[]'::jsonb))) order by s.seq)
        from public.menu_allergen_statements s
        where s.item_id = p_item
          and not exists (select 1 from public.menu_allergen_decisions d where d.statement_id = s.id)), '[]'::jsonb),
      'pendingClaims', coalesce((
        select jsonb_agg(jsonb_build_object('claimId', c.id, 'variantId', c.variant_id, 'claim', c.claim,
            'value', c.value, 'statedAt', c.stated_at, 'reason', c.reason) order by c.seq)
        from public.menu_dietary_claims c
        where c.item_id = p_item
          and not exists (select 1 from public.menu_dietary_decisions d where d.claim_id = c.id)), '[]'::jsonb));
  end if;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- Revocation at activation (§6.2 #6, §7.2, A1-7)
-- ---------------------------------------------------------------------------

-- Under activate_menu_version's exclusive venue menu lock. For each current
-- statement or claim of the venue: recipe or portion declared for its item
-- (item-wide or its variant), variant_meaning declared for its variant, or
-- its variant no longer listed for an item the version lists -> one revoked
-- decision by the activating account, reason material_change:<kind>.
create function private.menu_versions_revoke_statements()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  if new.activated_by is null then
    return null;
  end if;
  for v_row in
    with affected as (
      select s.id, 'allergen' as subject, s.item_id, s.variant_id
      from public.menu_allergen_statements s
      where s.venue_id = new.venue_id
        and (select d.decision from public.menu_allergen_decisions d
             where d.statement_id = s.id order by d.seq desc limit 1) = 'confirmed'
      union all
      select c.id, 'dietary', c.item_id, c.variant_id
      from public.menu_dietary_claims c
      where c.venue_id = new.venue_id
        and (select d.decision from public.menu_dietary_decisions d
             where d.claim_id = c.id order by d.seq desc limit 1) = 'confirmed'
    )
    select a.id, a.subject, coalesce(
      (select 'material_change:' || d.kind from public.menu_change_declarations d
       where d.version_id = new.id and d.item_id = a.item_id
         and ((d.kind in ('recipe', 'portion') and (d.variant_id is null or d.variant_id is not distinct from a.variant_id))
              or (d.kind = 'variant_meaning' and d.variant_id = a.variant_id))
       order by array_position(array['variant_meaning', 'recipe', 'portion'], d.kind) limit 1),
      case when a.variant_id is not null
             and exists (select 1 from public.menu_entries e where e.version_id = new.id and e.item_id = a.item_id)
             and not exists (select 1 from public.menu_entries e
                             join public.menu_entry_variants ev on ev.entry_id = e.id
                             where e.version_id = new.id and e.item_id = a.item_id and ev.variant_id = a.variant_id)
           then 'material_change:variant_removed' end) as reason
    from affected a
    order by a.subject, a.id
  loop
    continue when v_row.reason is null;
    if v_row.subject = 'allergen' then
      insert into public.menu_allergen_decisions (statement_id, venue_id, decision, decided_by, reason)
      values (v_row.id, new.venue_id, 'revoked', new.activated_by, v_row.reason);
    else
      insert into public.menu_dietary_decisions (claim_id, venue_id, decision, decided_by, reason)
      values (v_row.id, new.venue_id, 'revoked', new.activated_by, v_row.reason);
    end if;
  end loop;
  return null;
end;
$$;

create trigger menu_versions_revoke_statements
  after update of status on public.menu_versions
  for each row
  when (old.status = 'draft' and new.status = 'active')
  execute function private.menu_versions_revoke_statements();

-- ---------------------------------------------------------------------------
-- Line read: B04-b2's body plus the modifier option
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
    'modifierOptionId', p_line.modifier_option_id,
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

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.menu_allergen_codes(),
  private.menu_dietary_claims_vocabulary(),
  private.menu_allergen_problems(jsonb),
  private.menu_modifier_guard(),
  private.menu_recipe_anchor(uuid, uuid),
  private.menu_is_safety_authority(uuid, text),
  private.menu_assert_safety_authority(uuid, text),
  private.menu_allergen_current(uuid, uuid),
  private.menu_dietary_current(uuid, uuid, text),
  private.menu_allergen_unconfirmed(text),
  private.menu_allergen_outcome(uuid, uuid),
  private.menu_dietary_outcome(uuid, uuid),
  private.menu_safety_open(uuid, text),
  private.menu_safety_reassert(uuid, text, text),
  private.menu_versions_revoke_statements()
from public, anon, authenticated;

revoke all on function
  public.menu_modifier_group_add(uuid, text, text, integer, integer, uuid),
  public.menu_modifier_option_add(uuid, text, integer, uuid),
  public.menu_item_modifier_group_attach(uuid, uuid, date, date, uuid),
  public.menu_modifier_retire(uuid, uuid, uuid),
  public.menu_modifier_option_line(uuid, uuid, text, uuid),
  public.menu_item_modifiers(uuid),
  public.menu_dietary_claim_propose(uuid, uuid, text, text, text, uuid),
  public.menu_dietary_claim_decide(uuid, text, text, uuid),
  public.menu_allergen_statement_propose(uuid, uuid, jsonb, boolean, text, uuid),
  public.menu_allergen_evidence_attach(uuid, text, uuid, text, uuid),
  public.menu_allergen_statement_decide(uuid, text, text, uuid),
  public.menu_item_safety(uuid)
from public, anon, service_role;

grant execute on function
  public.menu_modifier_group_add(uuid, text, text, integer, integer, uuid),
  public.menu_modifier_option_add(uuid, text, integer, uuid),
  public.menu_item_modifier_group_attach(uuid, uuid, date, date, uuid),
  public.menu_modifier_retire(uuid, uuid, uuid),
  public.menu_modifier_option_line(uuid, uuid, text, uuid),
  public.menu_item_modifiers(uuid),
  public.menu_dietary_claim_propose(uuid, uuid, text, text, text, uuid),
  public.menu_dietary_claim_decide(uuid, text, text, uuid),
  public.menu_allergen_statement_propose(uuid, uuid, jsonb, boolean, text, uuid),
  public.menu_allergen_evidence_attach(uuid, text, uuid, text, uuid),
  public.menu_allergen_statement_decide(uuid, text, text, uuid),
  public.menu_item_safety(uuid)
to authenticated;
