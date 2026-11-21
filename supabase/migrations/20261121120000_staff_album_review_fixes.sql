-- Follow-up to 20261120130000_staff_album_posts (Codex review of PR #43).
--
-- 1. A photo staff label "Not for a slot" keeps its choice in
--    media_labels.content_types. It is labelled: it must not come back to
--    Label photos or stay under Unlabelled in My photos.
-- 2. A manager can review a post by a contributor who has since been
--    deactivated (staff_album_posts allows it), so the Album image check
--    allows the same, for that manager's own venue only.
-- Signatures and grants are unchanged.

create or replace function public.staff_album_own_states(p_asset_ids uuid[])
returns table(id uuid, removed boolean, needs_attention boolean, labelled boolean)
language sql stable security definer set search_path = '' as $$
  select a.id, private.staff_album_removed(a.id),
    exists (select from public.staff_album_feedback f where f.asset_id = a.id and f.action in ('feedback', 'retake')),
    exists (select from private.staff_album_labels(a.id))
      or exists (
        select from public.media_labels ml
        where ml.asset_id = a.id and cardinality(ml.content_types) > 0
      )
  from public.media_assets a
  where a.id = any(p_asset_ids) and cardinality(p_asset_ids) <= 100
    and a.uploader_id = (select auth.uid()) and (select private.is_active_user())
    and a.upload_state = 'ready' and a.deleted_at is null and a.purpose = 'general'
    and a.media_type = 'image' and a.preview_path is not null;
$$;

create or replace function public.staff_album_can_view(p_asset_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select from public.media_assets a
    join public.profiles p on p.id = a.uploader_id
    where a.id = p_asset_id
      and a.upload_state = 'ready' and a.deleted_at is null and a.media_type = 'image'
      and a.purpose = 'general'
      and (
        (p.active and a.venue_id = (select private.uploadable_venue_id())
          and not private.staff_album_removed(a.id))
        or a.venue_id = (select private.effective_manager_venue_id(auth.uid()))
      )
  );
$$;
