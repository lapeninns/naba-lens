-- B04-d (b04-design §7, §13.1/§13.2, §18 L5, §18.1, §19.1/§19.2 S4; task
-- B04-04): declared material changes on a draft catalogue version, the five
-- declared photo recheck kinds, and the re-created activation-time photo
-- reconciliation that applies them.
--
-- Declarations (§7.3). public.menu_change_declarations records, while a
-- version is a draft, that an item (or one of its variants) changes in a way
-- the catalogue cannot detect: variant_meaning (variant only), presentation,
-- recipe, portion or reviewer_flag. One per (version, item, variant, kind).
-- Rows are written and removed only while their version is a draft
-- (private.assert_menu_version_draft, like menu content) and never updated.
-- Admins write them (§11, "Admin, from the venue's information") through
-- public.menu_change_declaration_add / _remove; the note is internal.
--
-- Switch (§18 L5, §18.1). private.menu_switches holds menuChangeDeclarations,
-- seeded OFF. Until it is enabled (after WS2's §18.1 items 1 and 3 land and
-- the ledger records it), both commands refuse with declarations_disabled, so
-- no declared kind can be written through the product. Enabling is a reviewed
-- change of that row; clients have no access to it.
--
-- Photos (§7.2, §7.3). The menu_item_photos.recheck_kind check gains
-- variant_meaning_changed, presentation_changed, recipe_changed,
-- portion_changed and reviewer_flag (additive; rows keep their history).
-- private.reconcile_menu_item_photos is re-created from 20261106140000 with
-- one added step: when no automatic kind applies (variant removed, name
-- changed, section kind changed, in that order, unchanged), a declaration on
-- the activated version for the photo's item (item-wide) or for the photo's
-- own variant yields its declared kind. Several declarations on one photo
-- pick the first of variant_meaning, presentation, recipe, portion,
-- reviewer_flag (§7.1 order). Head bumps, lock order, events and primary
-- promotion are unchanged, so a declared recheck counts like a rename today
-- (§7.4; the credit function and its hash do not change).
--
-- Trading (§7.2 "Variant removed: line retired"). A separate trigger,
-- menu_versions_retire_trading_lines, retires at activation every live
-- trading line whose variant the activated version no longer lists for an
-- item it still lists (retired_by = the activating account). The photo
-- reconcile stays photo-only (§19.1). Variant-meaning and portion trading
-- review, dietary and allergen revocation belong to later steps (B04-c
-- statements, A1-6 material_change); a declaration writes no trading row.
--
-- Rollback (§13.1): re-create the 20261106140000 body of
-- private.reconcile_menu_item_photos, drop the retirement trigger and revoke
-- the commands; the added check values and the declarations stay.

-- ---------------------------------------------------------------------------
-- Switch
-- ---------------------------------------------------------------------------

create table private.menu_switches (
  name text primary key check (name in ('menuChangeDeclarations')),
  enabled boolean not null default false,
  changed_at timestamptz not null default now(),
  note text check (note is null or length(note) between 1 and 280)
);

insert into private.menu_switches (name, enabled, note)
values ('menuChangeDeclarations', false, 'Off until WS2 b04-design §18.1 items 1 and 3 are recorded (L5).');

revoke all on private.menu_switches from public, anon, authenticated, service_role;

create function private.menu_switch_enabled(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.enabled from private.menu_switches s where s.name = p_name), false);
$$;

-- ---------------------------------------------------------------------------
-- Declarations
-- ---------------------------------------------------------------------------

create table public.menu_change_declarations (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null,
  venue_id uuid not null,
  item_id uuid not null,
  variant_id uuid,
  kind text not null check (kind in ('variant_meaning', 'presentation', 'recipe', 'portion', 'reviewer_flag')),
  note text not null check (length(note) between 1 and 280 and note = btrim(note)),
  declared_by uuid not null references public.profiles (id) on delete restrict,
  declared_at timestamptz not null default now(),
  constraint menu_change_declarations_version_fkey foreign key (version_id, venue_id)
    references public.menu_versions (id, venue_id) on delete restrict,
  constraint menu_change_declarations_item_fkey foreign key (item_id, venue_id)
    references public.menu_items (id, venue_id) on delete restrict,
  constraint menu_change_declarations_variant_fkey foreign key (variant_id, item_id)
    references public.menu_variants (id, item_id) on delete restrict,
  constraint menu_change_declarations_once
    unique nulls not distinct (version_id, item_id, variant_id, kind),
  constraint menu_change_declarations_variant_meaning check (kind <> 'variant_meaning' or variant_id is not null)
);

create index menu_change_declarations_item_idx on public.menu_change_declarations (item_id);

comment on table public.menu_change_declarations is
  'Declared material changes of a draft catalogue version (B04-d): written and removed only while the version is a draft; applied to photos at activation.';

-- Written and removed only while the version is a draft; never updated.
create function private.menu_change_declarations_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'menu_change_declaration_immutable' using errcode = '42501';
  end if;
  perform private.assert_menu_version_draft(case when tg_op = 'DELETE' then old.version_id else new.version_id end);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger menu_change_declarations_guard
  before insert or update or delete on public.menu_change_declarations
  for each row execute function private.menu_change_declarations_guard();
create trigger menu_change_declarations_no_truncate
  before truncate on public.menu_change_declarations
  for each statement execute function private.append_only_guard();

revoke all on public.menu_change_declarations from public, anon, authenticated, service_role;
grant select on public.menu_change_declarations to service_role;
alter table public.menu_change_declarations enable row level security;

-- Declare a change on a draft version (admin). The item must be an entry of
-- that version, and a variant one its entry lists. The version row is read
-- FOR SHARE, so activation (which updates it) waits for the insert, and a
-- declaration after activation reads menu_version_not_draft. The same
-- declaration with the same note replays; another note is
-- menu_change_declaration_exists.
-- Returns { declarationId, versionId, itemId, variantId, kind, replayed }.
create function public.menu_change_declaration_add(
  p_version uuid,
  p_item uuid,
  p_variant uuid,
  p_kind text,
  p_note text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_active_admin();
  v_version public.menu_versions;
  v_note text := nullif(btrim(p_note), '');
  v_row public.menu_change_declarations;
begin
  if not private.menu_switch_enabled('menuChangeDeclarations') then
    raise exception 'declarations_disabled' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('variant_meaning', 'presentation', 'recipe', 'portion', 'reviewer_flag') then
    raise exception 'invalid_change_kind' using errcode = '22023';
  end if;
  if p_kind = 'variant_meaning' and p_variant is null then
    raise exception 'invalid_change_kind' using errcode = '22023',
      detail = 'A variant meaning change names the variant.';
  end if;
  if v_note is null or length(v_note) > 280 then
    raise exception 'invalid_change_note' using errcode = '22023';
  end if;
  select v.* into v_version from public.menu_versions v where v.id = p_version for share;
  if not found then
    raise exception 'menu_version_not_found' using errcode = 'P0002';
  end if;
  perform private.assert_menu_version_draft(v_version.id);
  if not exists (
    select 1 from public.menu_entries e
    where e.version_id = v_version.id and e.item_id = p_item
      and (p_variant is null or exists (
        select 1 from public.menu_entry_variants ev where ev.entry_id = e.id and ev.variant_id = p_variant))) then
    raise exception 'menu_item_not_on_version' using errcode = 'P0001';
  end if;

  insert into public.menu_change_declarations (version_id, venue_id, item_id, variant_id, kind, note, declared_by)
  values (v_version.id, v_version.venue_id, p_item, p_variant, p_kind, v_note, v_uid)
  on conflict on constraint menu_change_declarations_once do nothing
  returning * into v_row;
  if v_row.id is null then
    select d.* into v_row from public.menu_change_declarations d
    where d.version_id = v_version.id and d.item_id = p_item and d.variant_id is not distinct from p_variant
      and d.kind = p_kind;
    if v_row.note is distinct from v_note then
      raise exception 'menu_change_declaration_exists' using errcode = 'P0001';
    end if;
    return jsonb_build_object('declarationId', v_row.id, 'versionId', v_row.version_id, 'itemId', v_row.item_id,
      'variantId', v_row.variant_id, 'kind', v_row.kind, 'replayed', true);
  end if;
  return jsonb_build_object('declarationId', v_row.id, 'versionId', v_row.version_id, 'itemId', v_row.item_id,
    'variantId', v_row.variant_id, 'kind', v_row.kind, 'replayed', false);
end;
$$;

-- Remove a declaration of a draft version (admin). Removing one already
-- removed changes nothing.
create function public.menu_change_declaration_remove(p_declaration uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.menu_change_declarations;
begin
  perform private.assert_active_admin();
  if not private.menu_switch_enabled('menuChangeDeclarations') then
    raise exception 'declarations_disabled' using errcode = 'P0001';
  end if;
  select d.* into v_row from public.menu_change_declarations d where d.id = p_declaration;
  if not found then
    return;
  end if;
  perform 1 from public.menu_versions v where v.id = v_row.version_id for share;
  perform private.assert_menu_version_draft(v_row.version_id);
  delete from public.menu_change_declarations d where d.id = v_row.id;
end;
$$;

-- The declarations of one version (admin), oldest first.
create function public.menu_change_declarations_for_version(p_version uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_active_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('declarationId', d.id, 'itemId', d.item_id, 'variantId', d.variant_id,
      'kind', d.kind, 'note', d.note, 'declaredBy', d.declared_by, 'declaredAt', d.declared_at)
      order by d.declared_at, d.id)
    from public.menu_change_declarations d where d.version_id = p_version), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Photos: the five declared kinds and the re-created reconciliation
-- ---------------------------------------------------------------------------

alter table public.menu_item_photos drop constraint menu_item_photos_recheck_kind_check;
alter table public.menu_item_photos add constraint menu_item_photos_recheck_kind_check
  check (recheck_kind in (
    'name_changed', 'section_changed', 'variant_removed',
    'variant_meaning_changed', 'presentation_changed', 'recipe_changed', 'portion_changed', 'reviewer_flag'
  ));

create or replace function private.reconcile_menu_item_photos(p_venue_id uuid, p_version_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_kind text;
  v_items uuid[];
  v_lost uuid[] := '{}'::uuid[];
begin
  -- Only an item someone could already be reviewing can hold a stale revision:
  -- one with a head row or a photo labelled with it. A brand-new item cannot.
  select array_agg(distinct e.item_id) into v_items
  from public.menu_entries e
  where e.version_id = p_version_id
    and (exists (select 1 from public.menu_item_photo_heads h where h.item_id = e.item_id)
      or exists (select 1 from public.media_label_items l
                 where l.item_id = e.item_id and l.venue_id = p_venue_id));
  if v_items is null then
    return;
  end if;
  perform private.bump_item_photo_heads(v_items, p_venue_id);

  for v_row in
    select p.id, p.item_id, p.variant_id, p.item_name, p.section_kind as old_kind, p.is_primary,
      e.name as entry_name, s.name as section_name, s.kind as new_kind,
      ev.variant_id as offered_variant, ev.name as variant_name
    from public.menu_item_photos p
    join public.menu_entries e on e.version_id = p_version_id and e.item_id = p.item_id
    join public.menu_sections s on s.id = e.section_id
    left join public.menu_entry_variants ev on ev.entry_id = e.id and ev.variant_id = p.variant_id
    where p.venue_id = p_venue_id and p.state = 'accepted'
    order by p.item_id, p.id
    for update of p
  loop
    v_kind := case
      when v_row.variant_id is not null and v_row.offered_variant is null then 'variant_removed'
      when private.menu_name_key(v_row.entry_name) <> private.menu_name_key(v_row.item_name) then 'name_changed'
      when v_row.new_kind <> v_row.old_kind then 'section_changed'
    end;
    -- B04-d: a declaration on this version for the item, or for the photo's
    -- own variant, when no automatic kind applies.
    if v_kind is null then
      select case d.kind
          when 'variant_meaning' then 'variant_meaning_changed'
          when 'presentation' then 'presentation_changed'
          when 'recipe' then 'recipe_changed'
          when 'portion' then 'portion_changed'
          when 'reviewer_flag' then 'reviewer_flag'
        end
      into v_kind
      from public.menu_change_declarations d
      where d.version_id = p_version_id and d.item_id = v_row.item_id
        and (d.variant_id is null or d.variant_id = v_row.variant_id)
      order by array_position(array['variant_meaning', 'presentation', 'recipe', 'portion', 'reviewer_flag'], d.kind)
      limit 1;
    end if;
    if v_kind is null then
      update public.menu_item_photos p
      set menu_version_id = p_version_id, item_name = v_row.entry_name,
          section_name = v_row.section_name, variant_name = v_row.variant_name,
          revision = p.revision + 1
      where p.id = v_row.id;
      perform private.record_item_photo_event(v_row.id, 'carried', 'accepted', null, false, null, 'system',
        jsonb_build_object('menuVersionId', p_version_id));
    else
      if v_row.is_primary then
        v_lost := v_lost || v_row.item_id;
      end if;
      update public.menu_item_photos p
      set state = 'needs_recheck', recheck_kind = v_kind, is_primary = false, revision = p.revision + 1
      where p.id = v_row.id;
      perform private.record_item_photo_event(v_row.id, 'needs_recheck', 'accepted', null, false, null, 'system',
        jsonb_build_object('kind', v_kind, 'menuVersionId', p_version_id));
    end if;
  end loop;

  for v_row in select distinct u.id from unnest(v_lost) as u(id) loop
    perform private.promote_item_primary(v_row.id, 'system');
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Trading: a removed variant's lines are retired at activation
-- ---------------------------------------------------------------------------

-- Under activate_menu_version's exclusive venue menu lock. Lines of items the
-- version no longer lists are left as they are (they leave the menu and keep
-- their history, as photos do).
create function private.menu_versions_retire_trading_lines()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.activated_by is null then
    return null;
  end if;
  update public.menu_trading_lines l
  set retired_at = now(), retired_by = new.activated_by, revision = l.revision + 1, updated_at = now()
  where l.id in (
    select x.id from public.menu_trading_lines x
    join public.menu_entries e on e.version_id = new.id and e.item_id = x.item_id
    where x.venue_id = new.venue_id and x.retired_at is null and x.variant_id is not null
      and not exists (
        select 1 from public.menu_entry_variants ev where ev.entry_id = e.id and ev.variant_id = x.variant_id)
    order by x.id
    for update of x);
  return null;
end;
$$;

create trigger menu_versions_retire_trading_lines
  after update of status on public.menu_versions
  for each row
  when (old.status = 'draft' and new.status = 'active')
  execute function private.menu_versions_retire_trading_lines();

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.menu_switch_enabled(text),
  private.menu_change_declarations_guard(),
  private.menu_versions_retire_trading_lines()
from public, anon, authenticated;

revoke all on function
  public.menu_change_declaration_add(uuid, uuid, uuid, text, text),
  public.menu_change_declaration_remove(uuid),
  public.menu_change_declarations_for_version(uuid)
from public, anon, service_role;

grant execute on function
  public.menu_change_declaration_add(uuid, uuid, uuid, text, text),
  public.menu_change_declaration_remove(uuid),
  public.menu_change_declarations_for_version(uuid)
to authenticated;
