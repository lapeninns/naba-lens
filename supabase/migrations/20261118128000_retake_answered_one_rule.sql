-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S3-R10 repair (S3-repair-review W7; G-3 decisions 4 and 14,
-- spec §6 S4, E8, V14). One rule for whether a retake asked on one of the
-- person's photos is answered, read by Home and Album's notes
-- (private.retake_note_rows, my_retake_notes) and by Me and the slot page
-- (private.my_retake_answered, my_uploads retakeAnswered).
--
-- Before this, Me's rule (20261118123000) counted any newer own photo of the
-- slot that had not failed: a video, a photo the manager had already decided
-- (asked again for, or withdrawn) and a photo set aside as Not used all
-- answered it. Home's rule did not. So Me dropped the photo out of Needs
-- attention while Home showed the note open, and the slot page lost the
-- reviewer's exact reason.
--
-- private.retake_answer(...) returns:
--   'cleared'  a photo of the slot was accepted after the retake was asked,
--              whoever took or reviewed it (decision 4). Dish: an 'accepted'
--              menu_item_photo_events row for the item at the venue. Place:
--              an 'accepted' area_photo_decisions row on a label of the
--              place. Facility: an 'accepted' amenity_photo_decisions row on
--              the check. Append-only, so a later withdrawal does not bring
--              the retake back.
--   'retaken'  the person sent another photo of the slot after it was asked
--              that is waiting for review: an image, uploaded and checked
--              (upload_state 'ready'), not deleted, not set aside (Not used
--              or Mark duplicate, private.asset_set_aside), with no decision
--              yet for this slot.
--   null       still open.
-- Cleared wins over retaken, as in 20261116120000.
--
-- Changes on Home: a replacement set aside as Not used no longer answers a
-- dish retake (Album already counted it as not waiting, so the slot read
-- Needs another photo while Home said Retaken). Nothing else on Home moves:
-- its dish rule is the 'retaken' and 'cleared' tests above, unchanged.
--
-- Rollback: re-apply private.retake_note_rows from 20261116120000 and
-- private.my_retake_answered from 20261118123000, then
-- drop function private.retake_answer(uuid, uuid, text, uuid, uuid, timestamptz).

create function private.retake_answer(
  p_uid uuid,
  p_venue_id uuid,
  p_kind text,
  p_slot_id uuid,
  p_asset_id uuid,
  p_asked_at timestamptz
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_asked_at is null then null
    when case p_kind
      when 'dish' then exists (
        select 1 from public.menu_item_photo_events e
        where e.item_id = p_slot_id and e.venue_id = p_venue_id
          and e.action = 'accepted' and e.created_at > p_asked_at)
      when 'area' then exists (
        select 1 from public.area_photo_decisions d
        join public.media_area_labels l on l.id = d.label_id
        where l.subject_id = p_slot_id and d.venue_id = p_venue_id
          and d.action = 'accepted' and d.decided_at > p_asked_at)
      when 'amenity' then exists (
        select 1 from public.amenity_photo_decisions d
        where d.check_id = p_slot_id and d.venue_id = p_venue_id
          and d.action = 'accepted' and d.decided_at > p_asked_at)
      else false
    end then 'cleared'
    when case p_kind
      when 'dish' then exists (
        select 1
        from public.media_label_items l
        join public.media_assets a on a.id = l.asset_id
        where l.item_id = p_slot_id and l.venue_id = p_venue_id
          and a.uploader_id = p_uid and a.id <> p_asset_id
          and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null
          and a.created_at > p_asked_at
          and not private.asset_set_aside(a.id)
          and not exists (
            select 1 from public.menu_item_photos d
            where d.asset_id = a.id and d.item_id = p_slot_id))
      when 'area' then exists (
        select 1
        from public.media_area_labels l
        join public.media_assets a on a.id = l.asset_id
        where l.subject_id = p_slot_id and l.venue_id = p_venue_id and l.removed_at is null
          and a.uploader_id = p_uid and a.id <> p_asset_id
          and a.media_type = 'image' and a.upload_state = 'ready' and a.deleted_at is null
          and a.created_at > p_asked_at
          and not private.asset_set_aside(a.id)
          and not exists (
            select 1 from public.area_photo_decisions d where d.label_id = l.id))
      when 'amenity' then exists (
        -- amenity_photo_rows keeps only ready, undeleted images.
        select 1 from private.amenity_photo_rows(p_venue_id) r
        where r.check_id = p_slot_id and r.asset_id <> p_asset_id and r.uploader_id = p_uid
          and r.state = 'pending' and r.uploaded_at > p_asked_at
          and not private.asset_set_aside(r.asset_id))
      else false
    end then 'retaken'
  end;
$$;

comment on function private.retake_answer(uuid, uuid, text, uuid, uuid, timestamptz) is
  'S3-R10 (W7): whether a retake asked at p_asked_at on p_uid''s photo p_asset_id of one dish, place or facility slot is cleared, retaken or still open (null). The one rule for Home, Album, Me and the slot page.';

revoke all on function private.retake_answer(uuid, uuid, text, uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;

-- Me and the slot page (my_uploads retakeAnswered). Same signature as
-- 20261118123000; the body now reads the shared rule.
create or replace function private.my_retake_answered(
  p_uid uuid,
  p_venue_id uuid,
  p_kind text,
  p_slot_id uuid,
  p_asset_id uuid,
  p_asked_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.retake_answer(p_uid, p_venue_id, p_kind, p_slot_id, p_asset_id, p_asked_at)
    is not null;
$$;

revoke all on function private.my_retake_answered(uuid, uuid, text, uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;

-- Home and Album's notes. Body as in 20261116120000, except that a menu
-- note's cleared and retaken come from private.retake_answer.
create or replace function private.retake_note_rows(p_staff_id uuid)
returns table (
  kind text,
  note_id uuid,
  note_revision integer,
  asset_id uuid,
  item_id uuid,
  variant_id uuid,
  item_name text,
  variant_name text,
  requirement_id uuid,
  requirement_title text,
  requirement_kind text,
  reason text,
  asked_by_name text,
  asked_at timestamptz,
  status text,
  can_retake boolean,
  set_aside_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select p.venue_id,
      (select v.id from public.venues v where v.id = p.venue_id and v.active) as active_venue_id
    from public.profiles p
    where p.id = p_staff_id
  ),
  menu_answered as (
    select m.*,
      private.retake_answer(p_staff_id, m.venue_id, 'dish', m.item_id, m.asset_id, m.decided_at)
        as answer
    from public.menu_item_photos m
    join public.media_assets a on a.id = m.asset_id and a.deleted_at is null
    where m.author_id = p_staff_id and m.state = 'better_photo_requested'
  ),
  menu_notes as (
    select m.*,
      coalesce(m.answer = 'cleared', false) as cleared,
      coalesce(m.answer = 'retaken', false) as retaken,
      (
        select s.set_aside_at from public.retake_note_set_asides s
        where s.photo_id = m.id and s.photo_revision = m.revision and s.staff_id = p_staff_id
      ) as aside_at,
      exists (
        select 1
        from me
        join public.menu_versions mv on mv.venue_id = me.active_venue_id and mv.status = 'active'
        join public.menu_entries me2 on me2.version_id = mv.id and me2.item_id = m.item_id
        join public.menu_sections ms on ms.id = me2.section_id and ms.kind in ('food', 'drinks')
        join public.menu_items mi on mi.id = me2.item_id and mi.archived_at is null
        where m.variant_id is null
          or exists (
            select 1 from public.menu_entry_variants ev
            where ev.entry_id = me2.id and ev.variant_id = m.variant_id
          )
      ) as on_menu
    from menu_answered m
  ),
  coverage_notes as (
    select i.*, r.title as r_title, r.kind as r_kind,
      exists (
        select 1 from public.coverage_submission_items n
        where n.replaces_item_id = i.id and n.state in ('accepted', 'needs_another_photo')
      ) as cleared,
      exists (
        select 1 from public.coverage_submission_items n
        where n.replaces_item_id = i.id and n.state = 'submitted' and n.archived_at is null
      ) as retaken,
      (
        select s.set_aside_at from public.retake_note_set_asides s
        where s.submission_item_id = i.id and s.staff_id = p_staff_id
      ) as aside_at,
      exists (
        select 1 from me
        where me.active_venue_id = i.venue_id
          and (
            i.requirement_id is null
            or (
              private.requirement_is_current(i.requirement_id)
              and exists (
                select 1 from public.coverage_requirement_assignees x
                where x.requirement_id = i.requirement_id and x.staff_id = p_staff_id
                  and x.ended_at is null
              )
            )
          )
      ) as open_to_me
    from public.coverage_submission_items i
    join public.media_assets a on a.id = i.asset_id and a.deleted_at is null
    left join public.coverage_requirements r on r.id = i.requirement_id
    where i.author_id = p_staff_id and i.state = 'needs_another_photo' and i.archived_at is null
  )
  select 'menu'::text, n.id, n.revision, n.asset_id, n.item_id, n.variant_id, n.item_name,
    n.variant_name, null::uuid, null::text, null::text, n.reason, pd.display_name, n.decided_at,
    case
      when n.cleared then 'cleared'
      when n.retaken then 'retaken'
      when n.aside_at is not null then 'set_aside'
      else 'open'
    end,
    n.on_menu and not n.cleared,
    n.aside_at
  from menu_notes n
  left join public.profiles pd on pd.id = n.decided_by
  union all
  select 'coverage'::text, c.id, c.revision, c.asset_id, null::uuid, null::uuid, null::text,
    null::text, c.requirement_id, c.r_title, c.r_kind, c.decision_reason, pd.display_name,
    c.decided_at,
    case
      when c.cleared then 'cleared'
      when c.retaken then 'retaken'
      when c.aside_at is not null then 'set_aside'
      else 'open'
    end,
    c.open_to_me and not c.cleared,
    c.aside_at
  from coverage_notes c
  left join public.profiles pd on pd.id = c.decided_by;
$$;

revoke all on function private.retake_note_rows(uuid) from public, anon, authenticated;
grant execute on function private.retake_note_rows(uuid) to service_role;
