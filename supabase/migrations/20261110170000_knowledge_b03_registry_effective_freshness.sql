-- B03: each registry item names the check-date rules in force now. Runs after
-- A40 (20261110160000).
--
-- * public.knowledge_registry(p_lifecycle) (same signature, admins only,
--   stable definer): every item gains effectiveFreshness, the freshness of
--   private.knowledge_version_as_of(key, now()) (a version takes effect at
--   greatest(created_at, effective_from), never backdated), or JSON null when
--   no version is in force. The latest version's fields, catalogue order and
--   the lifecycle filter (on the latest version) are unchanged. The admin
--   check-dates page reads it once instead of one question read per earlier
--   version number; versions may be sparse up to 2147483647.
-- * private.knowledge_version_as_of stays private (no client grant).
-- * Not touched: private.knowledge_question_json, public.knowledge_question.
--
-- Rollback: a forward migration restores the B03-a body.

create or replace function public.knowledge_registry(p_lifecycle text[] default null)
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
    select jsonb_agg(
      x.j || jsonb_build_object('effectiveFreshness',
        (private.knowledge_version_as_of(c.key, now())).freshness)
      order by c.position, c.key)
    from public.amenity_catalogue c
    cross join lateral (select private.knowledge_question_json(c.key, null) as j) x
    where x.j is not null
      and (p_lifecycle is null or x.j ->> 'lifecycle' = any(p_lifecycle))
  ), '[]'::jsonb));
end;
$$;

revoke all on function public.knowledge_registry(text[])
from public, anon, service_role;

grant execute on function public.knowledge_registry(text[]) to authenticated;
