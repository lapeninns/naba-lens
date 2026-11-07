-- Contributors with only unlabelled photos.
--
-- 20261107100500 admitted a contributor only with a ready image at the venue
-- that carries a label tuple or an item-photo decision. A staff member whose
-- only photos are unlabelled food or drink photos still appears in the
-- Review queue's Unlabelled set (for manager accounts and admins), whose card
-- links to the contributor page, and that page then found no contributor.
--
-- The contributor predicate now also admits a ready image that
-- private.menu_photo_unlabelled_eligible accepts: the same rule the queue
-- uses, so only manager accounts and admins see such contributors (legacy
-- staff grantees do not), and the reviewable-uploader, leaver and
-- never-the-caller rules are unchanged. Team-only tagged photos stay out.
-- labelled_photos still counts photos with a label tuple, so an
-- unlabelled-only contributor shows zero there.

create or replace function private.menu_photo_contributor_rows(p_venue_id uuid, p_contributor_id uuid)
returns table (
  contributor_id uuid,
  display_name text,
  status text,
  labelled_photos integer,
  accepted_items integer,
  open_follow_ups integer,
  last_upload_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select up.id, up.display_name,
    case
      when not up.active then 'left'
      when up.role = 'manager' then 'manager'
      when up.venue_id = p_venue_id then 'here'
      else 'moved'
    end,
    (select count(distinct a.id)::integer from public.media_assets a
     where a.uploader_id = up.id and a.venue_id = p_venue_id
       and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null
       and exists (select 1 from public.media_label_items li where li.asset_id = a.id)),
    (select count(distinct p.item_id)::integer from public.menu_item_photos p
     join public.media_assets a on a.id = p.asset_id
     where p.author_id = up.id and p.venue_id = p_venue_id and p.state = 'accepted'
       and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null),
    (select count(*)::integer from public.menu_item_photos p
     where p.author_id = up.id and p.venue_id = p_venue_id and p.state = 'better_photo_requested'),
    (select max(a.created_at) from public.media_assets a
     where a.uploader_id = up.id and a.venue_id = p_venue_id
       and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null)
  from public.profiles up
  where up.role in ('staff', 'manager')
    and up.id <> (select auth.uid())
    and (p_contributor_id is null or up.id = p_contributor_id)
    and private.menu_photo_reviewable_uploader(up.id, private.is_active_admin())
    and exists (
      select 1 from public.media_assets a
      where a.uploader_id = up.id and a.venue_id = p_venue_id
        and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null
        and (exists (select 1 from public.media_label_items li where li.asset_id = a.id)
          or exists (select 1 from public.menu_item_photos p where p.asset_id = a.id)
          -- Q1 unlabelled: manager accounts and admins only.
          or private.menu_photo_unlabelled_eligible(a.id, p_venue_id)))
  order by up.display_name, up.id;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function private.menu_photo_contributor_rows(uuid, uuid) from public, anon, authenticated;
grant execute on function private.menu_photo_contributor_rows(uuid, uuid) to service_role;
