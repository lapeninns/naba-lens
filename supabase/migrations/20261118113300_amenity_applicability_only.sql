-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S2-MGR: an amenity check is archived (not applicable here) or
-- restored only with a reason (spec §4.4, AC29; S1-MENUS hand-off). The
-- screens now call public.amenity_check_set_applicability, which records the
-- reason in amenity_scope_events and wraps the keyed archive and restore. The
-- reasonless commands are no longer callable by signed-in users; the wrapper
-- (security definer) still runs them, so their idempotency and events stay.
--
-- Rollback: grant execute on the four functions below to authenticated.

revoke execute on function
  public.amenity_archive_check(uuid, integer),
  public.amenity_archive_check(uuid, integer, uuid),
  public.amenity_restore_check(uuid, integer),
  public.amenity_restore_check(uuid, integer, uuid)
from public, anon, authenticated;
