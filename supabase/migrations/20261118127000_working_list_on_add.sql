-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S3-R9 (W5, D4 gap): a question added at a venue that is on the
-- knowledge layer joins the venue's working list, so its photo requirement
-- is a counted coverage slot (FA-32; private.coverage_slot_rows reads only
-- working-list checks).
--
-- Product rule (recorded for the coordinator in reports/S3-R9.md):
--
--   Add check   amenity_add_checks puts each key it adds, restores or finds
--               active on the venue's working list when the venue already
--               has an open working list (an admin brought the venue onto
--               the knowledge layer, normally through the venue template)
--               and the question has a knowledge rule (every catalogue
--               question has one since 20261118121200). A key an admin took
--               off this venue's list (a closed row) is left off: re-adding
--               the check does not override that choice. A venue with no
--               open working list keeps the legacy path unchanged, so the
--               access rule "an admin enables a venue's working list"
--               (docs/knowledge/access-and-rights.md) still holds: the
--               manager only extends a list the admin opened.
--   Template    private.venue_template_rows also offers a question whose
--               check is already active but has never been on the venue's
--               working list (a core check from amenity_enable_venue, or one
--               a manager added before the venue had a list).
--               admin_venue_apply_template then puts it on the list without
--               touching the check or its answers. A question with any
--               working-list row (open, or closed by an admin) is still left
--               out, as before for active checks.
--
-- Bodies: amenity_add_checks from 20261107150000 (latest); venue_template_rows
-- from 20261118115000 (only definition). Signatures, security settings and
-- grants are unchanged.
--
-- Rollback: a forward migration restores the two earlier bodies and drops
-- private.knowledge_working_list_join; rows already added stay (an admin can
-- disable them with knowledge_set_working_list).

-- The one place a non-admin command adds a key to an open working list.
-- Caller holds the check row lock (the same lock knowledge_set_working_list
-- takes), so a concurrent enable or disable is serialised.
create function private.knowledge_working_list_join(
  p_venue_id uuid,
  p_question_key text,
  p_check_id uuid,
  p_by uuid,
  p_reason text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if not exists (
      select 1 from public.knowledge_working_list w
      where w.venue_id = p_venue_id and w.disabled_at is null)
    or not exists (
      select 1 from public.knowledge_question_rules r where r.question_key = p_question_key)
    or exists (
      select 1 from public.knowledge_working_list w
      where w.venue_id = p_venue_id and w.question_key = p_question_key)
  then
    return false;
  end if;
  insert into public.knowledge_working_list (venue_id, question_key, enabled_by, reason)
  values (p_venue_id, p_question_key, p_by, p_reason)
  on conflict (venue_id, question_key) where disabled_at is null do nothing;
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    perform private.knowledge_event(p_venue_id, p_question_key, p_check_id,
      'working_list_enabled', null, null, null, '{}');
  end if;
  return v_rows > 0;
end;
$$;

revoke all on function private.knowledge_working_list_join(uuid, text, uuid, uuid, text)
from public, anon, authenticated, service_role;

create or replace function public.amenity_add_checks(p_venue_id uuid, p_keys text[])
returns uuid[]
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_key text;
  v_check public.venue_amenity_checks;
  v_ids uuid[] := '{}'::uuid[];
begin
  if p_keys is null or cardinality(p_keys) not between 1 and 39
     or array_position(p_keys, null) is not null
     or (select count(distinct k) from unnest(p_keys) k) <> cardinality(p_keys) then
    raise exception 'invalid_key_list' using errcode = 'P0001';
  end if;
  if p_venue_id is null or not exists (select 1 from public.venues v where v.id = p_venue_id) then
    if private.is_active_admin() then
      raise exception 'venue_not_found' using errcode = 'P0002';
    end if;
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  perform private.assert_can_manage_venue(p_venue_id);
  perform private.amenity_assert_venue_active(p_venue_id);
  if not exists (select 1 from public.venue_amenity_settings s where s.venue_id = p_venue_id) then
    raise exception 'amenities_not_enabled' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from unnest(p_keys) k
    where not exists (select 1 from public.amenity_catalogue t where t.key = k)
  ) then
    raise exception 'amenity_key_not_found' using errcode = 'P0002';
  end if;
  perform private.lock_amenity_venue(p_venue_id);

  foreach v_key in array p_keys loop
    select c.* into v_check
    from public.venue_amenity_checks c
    where c.venue_id = p_venue_id and c.template_key = v_key
    for update;
    if not found then
      insert into public.venue_amenity_checks (venue_id, template_key, created_by)
      values (p_venue_id, v_key, v_uid)
      returning * into v_check;
      perform private.amenity_event(v_check.id, p_venue_id, 'added', null, jsonb_build_object('source', 'manager'));
    elsif v_check.status = 'archived' then
      update public.venue_amenity_checks c
      set status = 'active', revision = c.revision + 1
      where c.id = v_check.id;
      perform private.amenity_event(v_check.id, p_venue_id, 'restored', null, '{}'::jsonb);
    end if;
    -- S3-R9: a venue on the knowledge layer counts the added question.
    perform private.knowledge_working_list_join(p_venue_id, v_key, v_check.id, v_uid,
      'Added as a check at this venue');
    v_ids := v_ids || v_check.id;
  end loop;

  return v_ids;
end;
$$;

revoke all on function public.amenity_add_checks(uuid, text[])
from public, anon, service_role;

grant execute on function public.amenity_add_checks(uuid, text[])
to authenticated;

create or replace function private.venue_template_rows(p_venue_id uuid, p_source_venue_id uuid)
returns table (kind text, key text, label text, place_kind text)
language sql
stable
security definer
set search_path = ''
as $$
  select 'question'::text, t.key, t.question, null::text
  from public.amenity_catalogue t
  where (
      (p_source_venue_id is null and t.is_core)
      or exists (select 1 from public.venue_amenity_checks c
        where c.venue_id = p_source_venue_id and c.template_key = t.key and c.status = 'active')
    )
    -- S3-R9: an active check that was never on this venue's working list is
    -- still offered, so the template brings it into coverage.
    and not exists (select 1 from public.venue_amenity_checks c
      where c.venue_id = p_venue_id and c.template_key = t.key and c.status = 'active'
        and exists (select 1 from public.knowledge_working_list w
          where w.venue_id = p_venue_id and w.question_key = t.key))
  union all
  select 'place', null, s.label, s.kind
  from public.knowledge_subjects s
  where p_source_venue_id is not null and s.venue_id = p_source_venue_id and s.retired_at is null
    and not exists (select 1 from public.knowledge_subjects x
      where x.venue_id = p_venue_id and x.kind = s.kind and lower(x.label) = lower(s.label)
        and x.retired_at is null);
$$;
