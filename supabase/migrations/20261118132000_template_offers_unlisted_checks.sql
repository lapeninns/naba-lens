-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S3-R14 (round-2 review X3, D4 residual): the venue template
-- offers every check that is active at the venue and has never been on its
-- working list, whatever the source and whether the question is core.
--
-- Before: a question passed a first filter, (no source and core) or active
-- at the source venue, before the S3-R9 clause could let in an active check
-- with no list row. So a non-core check a manager added before the venue had
-- a list (pool table) was never offered by the group catalogue (no source).
-- The picker blocks re-adding an active check, so it never joined the list
-- and a staff Yes with a photo still made no Facilities slot.
--
-- Now the target venue's own active, never-listed checks are offered too.
-- admin_venue_apply_template (unchanged) puts them on the list without
-- touching the check or its answers. A question with any working-list row at
-- the venue (open, or closed by an admin) is still left out, so an admin's
-- choice to take it off stands.
--
-- Body from 20261118127000 (latest). Signature, security settings and grants
-- are unchanged (revoked from every API role in 20261118115000).
--
-- Rollback: a forward migration restoring the 20261118127000 body.

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
      -- S3-R14: an active check at this venue that has never been on its
      -- working list, core or not, whatever the source.
      or (exists (select 1 from public.venue_amenity_checks c
            where c.venue_id = p_venue_id and c.template_key = t.key and c.status = 'active')
        and not exists (select 1 from public.knowledge_working_list w
            where w.venue_id = p_venue_id and w.question_key = t.key))
    )
    -- S3-R9: an active check already on this venue's working list is not
    -- offered again.
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

revoke all on function private.venue_template_rows(uuid, uuid)
from public, anon, authenticated, service_role;
