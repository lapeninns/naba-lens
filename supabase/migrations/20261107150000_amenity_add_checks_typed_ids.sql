-- amenity_add_checks initialised its id list with an untyped '{}' literal,
-- which plpgsql_check reports ("target type is different type than source
-- type": text cast to uuid[], variable v_ids). 20261107120000_amenity_catalogue
-- is released, so this replaces the function with the same signature, security
-- settings, search_path and body, changing only that initialisation to a typed
-- '{}'::uuid[]. Behaviour is unchanged. CREATE OR REPLACE keeps the owner and
-- privileges; they are restated below as 20261107120000 set them.

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
    v_ids := v_ids || v_check.id;
  end loop;

  return v_ids;
end;
$$;

revoke all on function public.amenity_add_checks(uuid, text[])
from public, anon, service_role;

grant execute on function public.amenity_add_checks(uuid, text[])
to authenticated;
