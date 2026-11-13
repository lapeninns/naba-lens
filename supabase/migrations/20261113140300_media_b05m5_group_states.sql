-- B05-m5: per-member group states, replacement and the live cap
-- (contracts/b05-design.md §1, B05-01a to d; build scope
-- contracts/b05-01-grouping-scope.md, slice A, defaults OD-B5-01-1 to 9).
--
-- * S1 media_contribution_group_members.position: the check
--   media_contribution_group_members_position_check widens from 1..10 to
--   1..30, same name. The unique (group_id, position) constraint
--   media_contribution_group_members_position is unchanged. Existing rows
--   already satisfy it.
-- * S2 public.contribution_group_add (20261110095909 body): the 10-member cap
--   counts live members only (see "Cap live" below); positions stop at 30.
--   Same signature, same 1..10 batch, same refusals and manager-era rule, and
--   it still returns the group's total member count.
-- * S3 public.media_asset_links: new, append-only. One row per replacement
--   (kind replaces_failed_member, with its group). Written only by
--   contribution_group_replace; read only by the group functions. No client
--   policies.
-- * S4 public.contribution_group_replace(group, failed asset, new asset):
--   new. The creator swaps a failed, stopped or deleted member for a new own
--   upload, one for one, in one transaction (OD-B5-01-1 as revised on
--   12 Nov, OD-B5-01-4). The live cap is checked after the swap: it is
--   refused with contribution_group_full when the swap raises the live
--   count past 10, or the next position would pass 30. A stopped member is
--   live, so its swap is net zero and always passes the live check.
--   private.group_stopped_upload_window() names the stopped window, 1 hour
--   (OD-B5-01-3): a member is stopped while uploading with updated_at older
--   than it.
-- * S5 public.contribution_group (20261110095910 body): every member gains
--   replacesAssetId. The creator, the venue's effective manager and an active
--   admin also get, per member, technical, stopped (uploading for longer than
--   the stopped window, as S4 replaces it), stoppedAt (when an uploading
--   member becomes stopped), labels, review, use and
--   derivative, and the group gains summary (OD-B5-01-2). The creator also
--   sees removed (deleted) members, except a manager account's staff-era
--   uploads (OD-B5-01-7); the creator's summary counts exactly the members
--   the creator is shown, a manager's or admin's counts every member.
--   Colleagues get creatorFirstName and nothing else new; their
--   replacesAssetId is null unless they may see that asset (OD-B5-01-8). The existing keys, the subject rules and the not-found rule
--   are unchanged. private.media_asset_review_list is the per-asset review
--   list. derivative is read only through to_regprocedure and a dynamic call,
--   so it is null until B05-m2 adds private.media_asset_derivative_summary.
-- * S6 private.feed_photo_json (20261110095909 body): photo rows gain use,
--   private.media_asset_use_summary(asset, 'uploader'). menuUseAccepted,
--   menuDecisions and uploadState are unchanged.
-- * No failure reason is stored, so none is shown (OD-B5-01-9).
-- * Not touched: the group tables' columns and guards, contribution_group_start,
--   contribution_groups_for_assets, private.viewer_sees_asset, my_contributions_feed,
--   media_assets (no row is changed), media_use_grants and every use function,
--   the credit and completion functions and triggers, evidence documents.
--
-- Rollback: a forward migration restores the 20261110095909 bodies of
-- contribution_group_add and private.feed_photo_json and the 20261110095910
-- body of contribution_group, drops contribution_group_replace and the two new
-- private helpers, and narrows the position check back to 1..10 only if no
-- group has passed position 10. media_asset_links stays (no data loss).

-- ---------------------------------------------------------------------------
-- S1: room for replacements
-- ---------------------------------------------------------------------------

alter table public.media_contribution_group_members
  drop constraint media_contribution_group_members_position_check,
  add constraint media_contribution_group_members_position_check check (position between 1 and 30);

-- ---------------------------------------------------------------------------
-- S3: replacement links
-- ---------------------------------------------------------------------------

create table public.media_asset_links (
  -- The new asset.
  asset_id uuid not null,
  venue_id uuid not null,
  -- The member it replaces.
  related_asset_id uuid not null,
  kind text not null check (kind in ('replaces_failed_member')),
  -- Set for replaces_failed_member.
  group_id uuid,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (asset_id, kind),
  constraint media_asset_links_asset_fkey foreign key (asset_id, venue_id)
    references public.media_assets (id, venue_id) on delete restrict,
  constraint media_asset_links_related_fkey foreign key (related_asset_id, venue_id)
    references public.media_assets (id, venue_id) on delete restrict,
  constraint media_asset_links_group_fkey foreign key (group_id, venue_id)
    references public.media_contribution_groups (id, venue_id) on delete restrict,
  -- A member is replaced at most once.
  constraint media_asset_links_related_once unique (related_asset_id, kind),
  constraint media_asset_links_group check ((kind = 'replaces_failed_member') = (group_id is not null)),
  constraint media_asset_links_distinct check (asset_id <> related_asset_id)
);

create index media_asset_links_group_idx on public.media_asset_links (group_id);

do $$
declare
  t text;
begin
  foreach t in array array['media_asset_links'] loop
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function private.append_only_guard()',
      t || '_append_only', t);
    execute format(
      'create trigger %I before truncate on public.%I for each statement execute function private.append_only_guard()',
      t || '_no_truncate', t);
  end loop;
end;
$$;

revoke all on public.media_asset_links from public, anon, authenticated, service_role;
grant select on public.media_asset_links to service_role;
alter table public.media_asset_links enable row level security;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- OD-B5-01-3: an uploading member whose row has not changed for this long is
-- stopped and may be replaced. The cleanup function's minimum window.
create function private.group_stopped_upload_window()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '1 hour';
$$;

-- What each review screen has decided for one asset: live menu-photo
-- decisions (withdrawn and invalidated are history), knowledge and legacy
-- amenity answers, and task sends that are not archived. Each entry is
-- {target: menu_item | question | task, id, state}. Empty: not reviewed for
-- anything. No notes or reasons.
create function private.media_asset_review_list(p_asset_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(r.entry order by r.ord, r.decided desc nulls last, r.id), '[]'::jsonb)
  from (
    select jsonb_build_object('target', 'menu_item', 'id', m.item_id, 'state', m.state) as entry,
      1 as ord, m.decided_at as decided, m.id
    from public.menu_item_photos m
    where m.asset_id = p_asset_id and m.state not in ('withdrawn', 'invalidated')
    union all
    select jsonb_build_object('target', 'question', 'id', x.check_id,
        'state', private.knowledge_contribution_view(x.id) ->> 'state'),
      2, x.created_at, x.id
    from public.knowledge_contribution_assets ka
    join public.knowledge_contributions x on x.id = ka.contribution_id
    where ka.asset_id = p_asset_id
    union all
    select jsonb_build_object('target', 'question', 'id', s.check_id,
        'state', case when c.current_submission_id = s.id and c.progress = 'complete' and c.status = 'active'
          then 'current' else 'no_longer_used' end),
      2, s.created_at, s.id
    from public.amenity_submission_assets sa
    join public.amenity_submissions s on s.id = sa.submission_id
    join public.venue_amenity_checks c on c.id = s.check_id
    where sa.asset_id = p_asset_id and s.source_contribution_id is null
    union all
    select jsonb_build_object('target', 'task', 'id', i.requirement_id, 'state', i.state),
      3, i.submitted_at, i.id
    from public.coverage_submission_items i
    where i.asset_id = p_asset_id and i.archived_at is null
  ) r;
$$;

-- ---------------------------------------------------------------------------
-- S6: the feed's photo rows
-- ---------------------------------------------------------------------------

create or replace function private.feed_photo_json(p_asset_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'assetId', a.id,
    'venueId', a.venue_id,
    'venueName', v.name,
    'mediaType', a.media_type,
    'uploadState', a.upload_state,
    'uploaderRole', a.uploader_role,
    'sentAt', a.created_at,
    'labels', jsonb_build_object(
      'hasLabels', coalesce(l.has_labels, false),
      'needsLabels', private.asset_needs_labels(a.id),
      'needsAttention', exists (
        select 1 from public.media_pending_labels pl
        where pl.asset_id = a.id and pl.status = 'needs_attention'
      )
    ),
    'menuDecisions', coalesce((
      select jsonb_agg(d.row order by d.waiting, d.decided_at desc, d.photo_id desc, d.item_name, d.label_id)
      from (
        select jsonb_build_object(
            'photoId', m.id, 'itemId', m.item_id, 'itemName', m.item_name,
            'variantName', m.variant_name, 'state', m.state, 'reason', m.reason,
            'decidedAt', m.decided_at) as row,
          false as waiting, m.decided_at, m.id as photo_id, null::text as item_name, null::uuid as label_id
        from public.menu_item_photos m
        where m.asset_id = a.id and m.state not in ('withdrawn', 'invalidated')
        union all
        select jsonb_build_object(
            'photoId', null, 'itemId', t.item_id, 'itemName', e.name,
            'variantName', coalesce(ev.name, li.variant_name), 'state', 'waiting',
            'reason', null, 'decidedAt', null),
          true, null::timestamptz, null::uuid, e.name, t.label_id
        from private.menu_photo_pending_tuples(a.venue_id, false, true) t
        join public.menu_entries e on e.id = t.entry_id
        join public.media_label_items li on li.id = t.label_id
        left join public.menu_entry_variants ev on ev.entry_id = t.entry_id and ev.variant_id = t.variant_id
        where t.asset_id = a.id and t.live_photo_id is null
      ) d
    ), '[]'::jsonb),
    'menuUseAccepted', exists (
      select 1 from public.menu_item_photos m where m.asset_id = a.id and m.state = 'accepted'
    ),
    -- B05-02e: the uploader's view (no granter, period or note).
    'use', private.media_asset_use_summary(a.id, 'uploader')
  )
  from public.media_assets a
  join public.venues v on v.id = a.venue_id
  left join public.media_labels l on l.asset_id = a.id
  where a.id = p_asset_id;
$$;

-- ---------------------------------------------------------------------------
-- S2: the live cap
-- ---------------------------------------------------------------------------

-- Adds the caller's own assets (any upload state, not deleted, at the group's
-- venue) in the order given. An asset already in this group is skipped; one
-- in another group is asset_in_other_group. Returns the group's member count.
--
-- Cap live (S2): a member counts towards the 10-member cap when its asset is
-- not deleted, its upload_state is not failed, and it is not the
-- related_asset_id of a replaces_failed_member link in this group. A failed
-- member that is retried to ready without a replacement counts again, so the
-- live count can pass 10 by such retries. Positions stop at 30. This is not
-- contribution_group's summary.live, which counts failed members.
create or replace function public.contribution_group_add(p_group_id uuid, p_asset_ids uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_group public.media_contribution_groups;
  v_asset public.media_assets;
  v_id uuid;
  v_next integer;
  v_live integer;
  v_member uuid;
begin
  if p_asset_ids is null or cardinality(p_asset_ids) not between 1 and 10
     or array_position(p_asset_ids, null) is not null
     or (select count(distinct a) from unnest(p_asset_ids) a) <> cardinality(p_asset_ids) then
    raise exception 'invalid_asset_list' using errcode = 'P0001';
  end if;
  -- Serialises adds to one group (positions). No column changes.
  select g.* into v_group from public.media_contribution_groups g
  where g.id = p_group_id and g.created_by = v_uid
  for update;
  if not found or private.uploadable_venue_id() is distinct from v_group.venue_id then
    raise exception 'contribution_group_not_found' using errcode = 'P0002';
  end if;
  perform 1 from public.media_assets a where a.id = any(p_asset_ids) order by a.id for share;
  select coalesce(max(m.position), 0) into v_next
  from public.media_contribution_group_members m where m.group_id = v_group.id;
  select count(*)::integer into v_live
  from public.media_contribution_group_members m
  join public.media_assets a on a.id = m.asset_id
  where m.group_id = v_group.id
    and a.deleted_at is null
    and a.upload_state <> 'failed'
    and not exists (
      select 1 from public.media_asset_links l
      where l.group_id = v_group.id and l.related_asset_id = m.asset_id
        and l.kind = 'replaces_failed_member'
    );
  foreach v_id in array p_asset_ids loop
    select a.* into v_asset from public.media_assets a where a.id = v_id;
    if not found or v_asset.venue_id <> v_group.venue_id then
      raise exception 'evidence_not_eligible' using errcode = 'P0001',
        detail = jsonb_build_object('assetId', v_id, 'reason', 'not_found')::text;
    end if;
    if v_asset.uploader_id <> v_uid
       or (private.is_active_manager() and v_asset.uploader_role is distinct from 'manager') then
      raise exception 'evidence_not_eligible' using errcode = 'P0001',
        detail = jsonb_build_object('assetId', v_id, 'reason', 'not_own')::text;
    end if;
    if v_asset.deleted_at is not null then
      raise exception 'evidence_not_eligible' using errcode = 'P0001',
        detail = jsonb_build_object('assetId', v_id, 'reason', 'deleted')::text;
    end if;
    select m.group_id into v_member from public.media_contribution_group_members m where m.asset_id = v_id;
    if found then
      if v_member <> v_group.id then
        raise exception 'asset_in_other_group' using errcode = 'P0001',
          detail = jsonb_build_object('assetId', v_id)::text;
      end if;
      continue;
    end if;
    v_next := v_next + 1;
    -- The new member is live by the same rule (it is not deleted, and no
    -- link in this group can name an asset that is not yet a member).
    if v_asset.upload_state <> 'failed' then
      v_live := v_live + 1;
    end if;
    if v_next > 30 or v_live > 10 then
      raise exception 'contribution_group_full' using errcode = 'P0001';
    end if;
    insert into public.media_contribution_group_members (group_id, venue_id, asset_id, position)
    values (v_group.id, v_group.venue_id, v_id, v_next);
  end loop;
  return (select count(*)::integer from public.media_contribution_group_members m where m.group_id = v_group.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- S4: replacing a member that didn't finish
-- ---------------------------------------------------------------------------

-- The creator replaces a member of their group that is failed, deleted or
-- stopped (uploading for longer than private.group_stopped_upload_window())
-- with a new upload of their own, one for one: the new asset becomes the next
-- member and a replaces_failed_member link names the old one, in one
-- transaction, so the old member stops counting at once and never counts
-- again. The old member stays in the group.
-- Cap (OD-B5-01-1, revised): the new position must not pass 30, and a swap
-- that raises the S2 live count (see contribution_group_add) past 10 is
-- refused; either refusal is contribution_group_full and writes nothing. A
-- stopped old member is live, so its swap is net zero and is accepted, even
-- when retried members have left the set above 10 (which S2 allows); a
-- failed or deleted one's adds one live member, so it is accepted while the
-- set has room (always for a set of 10 with one failed member, unless a
-- photo was added into the freed slot since).
-- Idempotent per (old, new): a repeat returns the first result before any
-- state check; another new asset for a replaced member is
-- idempotency_key_reused. Returns {groupId, assetId, replacesAssetId,
-- position}. Writes no media_assets row and no use grant.
create function public.contribution_group_replace(
  p_group_id uuid,
  p_failed_asset_id uuid,
  p_new_asset_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_group public.media_contribution_groups;
  v_link public.media_asset_links;
  v_old public.media_assets;
  v_new public.media_assets;
  v_member uuid;
  v_next integer;
  v_before integer;
  v_live integer;
begin
  -- Creator only, at their upload venue; serialises writes to the group.
  select g.* into v_group from public.media_contribution_groups g
  where g.id = p_group_id and g.created_by = v_uid
  for update;
  if not found or private.uploadable_venue_id() is distinct from v_group.venue_id then
    raise exception 'contribution_group_not_found' using errcode = 'P0002';
  end if;

  -- Replay: the same pair returns the first result, whatever has happened
  -- to either asset since.
  select l.* into v_link from public.media_asset_links l
  where l.related_asset_id = p_failed_asset_id and l.kind = 'replaces_failed_member';
  if found then
    if v_link.group_id is distinct from v_group.id then
      raise exception 'contribution_group_not_found' using errcode = 'P0002';
    end if;
    if v_link.asset_id is distinct from p_new_asset_id then
      raise exception 'idempotency_key_reused' using errcode = 'P0001';
    end if;
    return jsonb_build_object(
      'groupId', v_group.id,
      'assetId', v_link.asset_id,
      'replacesAssetId', v_link.related_asset_id,
      'position', (
        select m.position from public.media_contribution_group_members m
        where m.group_id = v_group.id and m.asset_id = v_link.asset_id));
  end if;

  -- Neither asset changes state while it is checked.
  perform 1 from public.media_assets a
  where a.id in (p_failed_asset_id, p_new_asset_id) order by a.id for share;

  -- The old member: in this group, and not a manager account's staff-era
  -- upload (the reads never show it one).
  select a.* into v_old
  from public.media_contribution_group_members m
  join public.media_assets a on a.id = m.asset_id
  where m.group_id = v_group.id and m.asset_id = p_failed_asset_id;
  if not found or (private.is_active_manager() and v_old.uploader_role is distinct from 'manager') then
    raise exception 'contribution_group_not_found' using errcode = 'P0002';
  end if;
  if not (
    v_old.deleted_at is not null
    or v_old.upload_state = 'failed'
    or (v_old.upload_state = 'uploading'
        and v_old.updated_at < now() - private.group_stopped_upload_window())
  ) then
    raise exception 'evidence_not_eligible' using errcode = 'P0001',
      detail = jsonb_build_object('assetId', p_failed_asset_id, 'reason', 'not_replaceable')::text;
  end if;

  -- The new asset: as contribution_group_add checks it (manager-era rule
  -- included), and in no group yet.
  select a.* into v_new from public.media_assets a where a.id = p_new_asset_id;
  if not found or v_new.venue_id <> v_group.venue_id then
    raise exception 'evidence_not_eligible' using errcode = 'P0001',
      detail = jsonb_build_object('assetId', p_new_asset_id, 'reason', 'not_found')::text;
  end if;
  if v_new.uploader_id <> v_uid
     or (private.is_active_manager() and v_new.uploader_role is distinct from 'manager') then
    raise exception 'evidence_not_eligible' using errcode = 'P0001',
      detail = jsonb_build_object('assetId', p_new_asset_id, 'reason', 'not_own')::text;
  end if;
  if v_new.deleted_at is not null then
    raise exception 'evidence_not_eligible' using errcode = 'P0001',
      detail = jsonb_build_object('assetId', p_new_asset_id, 'reason', 'deleted')::text;
  end if;
  select m.group_id into v_member from public.media_contribution_group_members m where m.asset_id = p_new_asset_id;
  if found then
    if v_member <> v_group.id then
      raise exception 'asset_in_other_group' using errcode = 'P0001',
        detail = jsonb_build_object('assetId', p_new_asset_id)::text;
    end if;
    raise exception 'evidence_not_eligible' using errcode = 'P0001',
      detail = jsonb_build_object('assetId', p_new_asset_id, 'reason', 'in_group')::text;
  end if;

  select coalesce(max(m.position), 0) + 1 into v_next
  from public.media_contribution_group_members m where m.group_id = v_group.id;
  if v_next > 30 then
    raise exception 'contribution_group_full' using errcode = 'P0001';
  end if;
  -- The S2 live count before the swap, in one statement. The count after
  -- follows from the two locked rows by the same predicate: the old member
  -- stops counting (it is not replaced yet), the new one starts unless it
  -- failed (it is not deleted and in no group).
  select count(*)::integer into v_before
  from public.media_contribution_group_members m
  join public.media_assets a on a.id = m.asset_id
  where m.group_id = v_group.id
    and a.deleted_at is null
    and a.upload_state <> 'failed'
    and not exists (
      select 1 from public.media_asset_links l
      where l.group_id = v_group.id and l.related_asset_id = m.asset_id
        and l.kind = 'replaces_failed_member'
    );
  v_live := v_before
    - (case when v_old.deleted_at is null and v_old.upload_state <> 'failed' then 1 else 0 end)
    + (case when v_new.upload_state <> 'failed' then 1 else 0 end);
  -- Refused only when the swap adds a live member past 10: a net-zero swap
  -- (a stopped member) is accepted even when retries left more than 10.
  if v_live > 10 and v_live > v_before then
    raise exception 'contribution_group_full' using errcode = 'P0001';
  end if;
  insert into public.media_contribution_group_members (group_id, venue_id, asset_id, position)
  values (v_group.id, v_group.venue_id, p_new_asset_id, v_next);
  insert into public.media_asset_links (asset_id, venue_id, related_asset_id, kind, group_id, created_by)
  values (p_new_asset_id, v_group.venue_id, p_failed_asset_id, 'replaces_failed_member', v_group.id, v_uid);
  return jsonb_build_object(
    'groupId', v_group.id,
    'assetId', p_new_asset_id,
    'replacesAssetId', p_failed_asset_id,
    'position', v_next);
end;
$$;

-- ---------------------------------------------------------------------------
-- S5: the group read
-- ---------------------------------------------------------------------------

-- One group: its subject and the members the viewer may see, each with its
-- own state. A group with no member visible to the viewer reads as not found,
-- except to its creator (a group just started has no members). A task subject
-- the viewer may not read reads as no subject.
--
-- Who sees what (OD-B5-01-7):
-- * The creator sees every member, removed ones included, except a manager
--   account's own staff-era uploads (the private.viewer_sees_asset veto).
-- * Anyone else sees the members private.viewer_sees_asset admits.
-- * Privileged viewers (the creator, the venue's effective manager, an active
--   admin) also get technical, stopped, stoppedAt, labels, review, use and
--   derivative
--   per member,
--   and the summary. The creator's summary counts exactly the members the
--   creator is shown; a manager's or admin's counts every member, seen or
--   not.
-- * replacesAssetId: a manager or admin who is not the creator always gets
--   it; the creator gets it for a member it is shown; a colleague only for
--   an asset it may see (OD-B5-01-8).
--
-- Summary live (OD-B5-01-2): each member that is not replaced is in one
-- bucket, removed (deleted), failed, inProgress (uploading or processing,
-- stopped included) or ready; live = ready + inProgress + failed; replaced
-- members count only in replaced; finished = live > 0 and ready = live. This
-- is not contribution_group_add's cap count, which leaves failed members out.
create or replace function public.contribution_group(p_group_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.amenity_assert_active_user();
  v_is_manager boolean := private.is_active_manager();
  v_derivative_fn regprocedure := to_regprocedure('private.media_asset_derivative_summary(uuid)');
  v_group public.media_contribution_groups;
  v_creator boolean := false;
  v_privileged boolean := false;
  v_use_view text;
  v_list jsonb := '[]'::jsonb;
  v_member jsonb;
  v_derivative text;
  v_members jsonb;
  v_summary jsonb;
  v_subject jsonb;
  r record;
begin
  select g.* into v_group from public.media_contribution_groups g where g.id = p_group_id;
  if found then
    v_creator := v_group.created_by = v_uid;
    -- can_manage_venue: the venue's effective manager, or an active admin.
    v_use_view := case when private.can_manage_venue(v_group.venue_id) then 'full' else 'uploader' end;
    v_privileged := v_creator or v_use_view = 'full';
    for r in
      select m.position, a.id, a.media_type, a.upload_state, a.uploader_id, a.deleted_at, a.updated_at,
        coalesce(lb.has_labels, false) as has_labels,
        l.related_asset_id,
        (l.related_asset_id is not null and (
          (v_privileged and not v_creator)
          or (v_creator and ra.uploader_id = v_uid and (ra.uploader_role = 'manager' or not v_is_manager))
          or private.viewer_sees_asset(l.related_asset_id))) as related_visible
      from public.media_contribution_group_members m
      join public.media_assets a on a.id = m.asset_id
      left join public.media_labels lb on lb.asset_id = a.id
      left join public.media_asset_links l
        on l.asset_id = a.id and l.kind = 'replaces_failed_member' and l.group_id = m.group_id
      left join public.media_assets ra on ra.id = l.related_asset_id
      where m.group_id = v_group.id
        and (
          (v_creator and a.uploader_id = v_uid and (a.uploader_role = 'manager' or not v_is_manager))
          or private.viewer_sees_asset(a.id)
        )
      order by m.position
    loop
      v_member := jsonb_build_object(
        'assetId', r.id, 'position', r.position, 'mediaType', r.media_type,
        'uploadState', r.upload_state, 'mine', r.uploader_id = v_uid,
        'replacesAssetId', case when r.related_visible then r.related_asset_id end);
      if v_privileged then
        v_derivative := null;
        if v_derivative_fn is not null then
          execute format('select %s($1)', v_derivative_fn::oid::regproc) into v_derivative using r.id;
        end if;
        v_member := v_member || jsonb_build_object(
          'technical', case when r.deleted_at is not null then 'removed' else r.upload_state::text end,
          -- S4's stopped rule, so a screen offers Replace where it is taken.
          'stopped', r.deleted_at is null and r.upload_state = 'uploading'
            and r.updated_at < now() - private.group_stopped_upload_window(),
          -- When an uploading member becomes stopped (null otherwise), so a
          -- screen can read the set again then.
          'stoppedAt', case when r.deleted_at is null and r.upload_state = 'uploading'
            then r.updated_at + private.group_stopped_upload_window() end,
          'labels', case
            when exists (
                select 1 from public.media_pending_labels pl
                where pl.asset_id = r.id and pl.status = 'needs_attention')
              or private.asset_needs_labels(r.id) then 'needs_attention'
            when r.has_labels
              or exists (
                select 1 from public.media_pending_labels pl
                where pl.asset_id = r.id and pl.status = 'pending') then 'labelled'
            else 'none'
          end,
          'review', private.media_asset_review_list(r.id),
          'use', private.media_asset_use_summary(r.id, v_use_view),
          'derivative', v_derivative);
      end if;
      v_list := v_list || jsonb_build_array(v_member);
    end loop;
    if jsonb_array_length(v_list) > 0 then
      v_members := v_list;
    end if;
  end if;
  if v_group.id is null or (v_members is null and v_group.created_by is distinct from v_uid) then
    raise exception 'contribution_group_not_found' using errcode = 'P0002';
  end if;
  if v_privileged then
    select jsonb_build_object(
        'live', c.ready + c.in_progress + c.failed,
        'ready', c.ready,
        'inProgress', c.in_progress,
        'failed', c.failed,
        'removed', c.removed,
        'replaced', c.replaced,
        'finished', c.ready + c.in_progress + c.failed > 0 and c.ready = c.ready + c.in_progress + c.failed)
    into v_summary
    from (
      select
        count(*) filter (where s.bucket = 'ready') as ready,
        count(*) filter (where s.bucket = 'in_progress') as in_progress,
        count(*) filter (where s.bucket = 'failed') as failed,
        count(*) filter (where s.bucket = 'removed') as removed,
        count(*) filter (where s.bucket = 'replaced') as replaced
      from (
        select case
          when exists (
            select 1 from public.media_asset_links l
            where l.group_id = v_group.id and l.related_asset_id = m.asset_id
              and l.kind = 'replaces_failed_member') then 'replaced'
          when a.deleted_at is not null then 'removed'
          when a.upload_state = 'failed' then 'failed'
          when a.upload_state = 'ready' then 'ready'
          else 'in_progress'
        end as bucket
        from public.media_contribution_group_members m
        join public.media_assets a on a.id = m.asset_id
        where m.group_id = v_group.id
          -- The creator: the members it is shown (the loop's rule).
          and (
            not v_creator
            or (a.uploader_id = v_uid and (a.uploader_role = 'manager' or not v_is_manager))
            or private.viewer_sees_asset(a.id)
          )
      ) s
    ) c;
  end if;
  if v_group.subject_kind = 'task' then
    -- This task row only, at the group's venue, under the task read rules.
    select jsonb_build_object('kind', 'task', 'id', r2.id, 'name', r2.title)
    into v_subject
    from public.coverage_requirements r2
    where r2.id = v_group.subject_id and r2.venue_id = v_group.venue_id
      and (
        private.can_manage_venue(r2.venue_id)
        or coalesce(private.active_staff_venue_id() = r2.venue_id, false)
        or r2.id in (select private.own_item_requirement_ids())
      );
    v_subject := coalesce(v_subject, jsonb_build_object('kind', 'none', 'id', null, 'name', null));
  else
    v_subject := jsonb_build_object(
      'kind', v_group.subject_kind,
      'id', v_group.subject_id,
      'name', case v_group.subject_kind
        when 'menu_item' then (
          select e.name from public.menu_entries e
          join public.menu_versions v on v.id = e.version_id
          where v.venue_id = v_group.venue_id and v.status = 'active' and e.item_id = v_group.subject_id
          limit 1)
        when 'question' then (
          select t.question from public.venue_amenity_checks c
          join public.amenity_catalogue t on t.key = c.template_key
          where c.id = v_group.subject_id)
      end
    );
  end if;
  return jsonb_build_object(
    'groupId', v_group.id,
    'venueId', v_group.venue_id,
    'createdAt', v_group.created_at,
    'mine', v_group.created_by = v_uid,
    'subject', v_subject,
    'members', coalesce(v_members, '[]'::jsonb)
  ) || case
    when v_privileged then jsonb_build_object('summary', v_summary)
    else jsonb_build_object('creatorFirstName', (
      select nullif(split_part(btrim(p.display_name), ' ', 1), '')
      from public.profiles p where p.id = v_group.created_by))
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges (create or replace keeps them; restated)
-- ---------------------------------------------------------------------------

revoke all on function
  private.group_stopped_upload_window(),
  private.media_asset_review_list(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.feed_photo_json(uuid) from public, anon, authenticated;
revoke all on function
  public.contribution_group_add(uuid, uuid[]),
  public.contribution_group_replace(uuid, uuid, uuid),
  public.contribution_group(uuid)
from public, anon, service_role;
grant execute on function
  public.contribution_group_add(uuid, uuid[]),
  public.contribution_group_replace(uuid, uuid, uuid),
  public.contribution_group(uuid)
to authenticated;
