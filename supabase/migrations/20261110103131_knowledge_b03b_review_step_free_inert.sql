-- B03-b review M1 (a883f784): the 19-argument knowledge_submit was not inert
-- for step_free_entrance on registry version 1. Its venue check,
-- private.knowledge_detail_venue_problems, applied the step-free rule to any
-- Yes or No on that key whatever the version's schema, so a plain Yes or No
-- with no detail was refused (entrances required / no_entrances_listed)
-- where the 16-argument overload accepts it.
--
-- * private.knowledge_detail_venue_problems_for (new): the B03-c checks with
--   the schema and the version's features passed in. Presence and Wi-Fi
--   (every version 1) get no check. Place checks run for facility,
--   accessibility and policy details; the step-free rule and the A33 feature
--   checks run for an accessibility answer only.
-- * private.knowledge_detail_venue_problems: same signature, now a wrapper that
--   passes the key's latest version (the one knowledge_submit validates
--   against). knowledge_submit is not re-created.
--
-- Rollback: a forward migration restores the 20261110102123 body.

create function private.knowledge_detail_venue_problems_for(
  p_venue_id uuid, p_key text, p_schema text, p_features jsonb, p_headline text, p_detail jsonb
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
  v_key text;
  v_i integer;
begin
  -- Presence and Wi-Fi carry no places or entrances: nothing to check.
  if p_schema is null or p_schema not in ('facility', 'accessibility', 'policy') then
    return v_out;
  end if;
  if p_detail is null or jsonb_typeof(p_detail) <> 'object' then
    p_detail := '{}'::jsonb;
  end if;
  v_listed := private.knowledge_json_array(p_detail -> 'entrances');
  if p_schema = 'accessibility' then
    if jsonb_typeof(p_detail -> 'features') = 'object' then
      for v_key in select k from jsonb_object_keys(p_detail -> 'features') k order by k collate "C" loop
        if not exists (select 1 from jsonb_array_elements(private.knowledge_json_array(p_features)) f where f ->> 'key' = v_key) then
          v_out := v_out || jsonb_build_object('path', 'detail.features.' || v_key, 'problem', 'not_allowed');
        end if;
      end loop;
    end if;
    for v_i in 0 .. jsonb_array_length(private.knowledge_json_array(p_detail -> 'measurements')) - 1 loop
      if jsonb_typeof(p_detail -> 'measurements' -> v_i -> 'feature') = 'string' and not exists (
        select 1 from jsonb_array_elements(private.knowledge_json_array(p_features)) f
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

  -- The step-free rule (§4.3, A18) applies only to an accessibility answer.
  if p_schema = 'accessibility' and p_key = 'step_free_entrance' and p_headline in ('yes', 'no') then
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

create or replace function private.knowledge_detail_venue_problems(
  p_venue_id uuid, p_key text, p_headline text, p_detail jsonb
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select private.knowledge_detail_venue_problems_for(p_venue_id, p_key, v.value_schema, v.features,
      p_headline, p_detail)
    from public.knowledge_question_versions v
    where v.key = p_key
    order by v.version desc
    limit 1
  ), '[]'::jsonb);
$$;

revoke all on function
  private.knowledge_detail_venue_problems_for(uuid, text, text, jsonb, text, jsonb),
  private.knowledge_detail_venue_problems(uuid, text, text, jsonb)
from public, anon, authenticated;
