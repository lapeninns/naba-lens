-- B05 follow-up: answer freshness in asset search (contracts/b05-design.md
-- §6.1 B05-06b and §11.2 signal 3; deferred from B05-m4 because it needed
-- B03's K1 read, private.knowledge_evidence_for_assets, now on main).
--
-- * public.asset_search gains two optional filter keys:
--   - answerFreshness ('current'|'due_soon'|'expired'|'basis_missing'|
--     'unrated'): the asset is evidence for an answer in use at the searched
--     venue (K1 role current_answer) whose freshness for the asked use is in
--     that state;
--   - answerUse ('internal'|'public', default 'internal'), allowed only with
--     answerFreshness.
--   It runs only with a venue (§11.2): an admin without one is refused with
--   invalid_search_filter, detail answerFreshness. Candidates are the
--   venue's current-answer evidence assets; at most 500 admitted candidates
--   are rated per page, after which the page ends with hasMore true and a
--   resumeAfter {uploadedAt, id} the app uses as its next cursor.
--   Without these keys the body, its order of checks and its result are
--   those of 20261113140200 (the chunked-equals-base tests still hold);
--   the gate prefilter P and private.asset_search_admits are unchanged.
-- * public.asset_search_answers(p_asset_ids uuid[]): for up to 48 assets the
--   caller's search admits, the answers in use each one supports, with the
--   question text and K1's per-use freshness (labelled as the answer's,
--   never the photo's). Nothing is copied into B05 tables.
-- * Read only: no table, no row change, no new private helper (the private
--   asset_search_% count stays 5). Credit functions are untouched.
--
-- Rollback: re-create public.asset_search from 20261113140200 and drop
-- public.asset_search_answers.

create or replace function public.asset_search(
  p_filters jsonb default '{}'::jsonb,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 24
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set plan_cache_mode = force_custom_plan
set enable_seqscan = off
set enable_bitmapscan = off
as $$
declare
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_admin boolean;
  v_manager_venue uuid;
  v_venue uuid;
  v_type public.media_type;
  v_item uuid;
  v_variant uuid;
  v_check uuid;
  v_group uuid;
  v_submission_source text;
  v_submission_id uuid;
  v_rights text;
  v_destination text;
  v_from timestamptz;
  v_before timestamptz;
  v_menu_state text;
  v_limit integer := least(greatest(coalesce(p_limit, 24), 1), 48);
  v_now timestamptz := now();
  v_ids uuid[];
  v_more boolean;
  -- Evaluation state (B05 perf fix, OD-B5-PERF-5..7).
  v_uid uuid;
  v_is_manager boolean := false;
  v_can_review boolean := false;
  v_has_active_check boolean := false;
  v_check_ids uuid[];
  v_submission_ids uuid[];
  v_group_ids uuid[];
  v_menu_ids uuid[];
  v_in_venue boolean;
  v_row public.media_assets;
  v_scan_at timestamptz;
  v_scan_id uuid;
  v_chunk integer;
  v_seen integer;
  -- Answer freshness (B05 follow-up; contracts/b05-design.md §11.2).
  v_answer_state text;
  v_answer_use text;
  v_answer_ids uuid[];
  v_rated integer := 0;
  v_capped boolean := false;
begin
  perform private.amenity_assert_active_user();
  select c.is_admin, c.venue_id into v_admin, v_manager_venue from private.asset_search_caller() c;
  if not found then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;

  if jsonb_typeof(v_filters) <> 'object' then
    raise exception 'invalid_search_filter' using errcode = '22023', detail = 'filters';
  end if;
  if exists (
    select 1 from jsonb_object_keys(v_filters) k
    where k not in ('venue', 'mediaType', 'item', 'variant', 'check', 'group', 'submission',
      'rights', 'destination', 'uploadedFrom', 'uploadedBefore', 'menuState',
      'answerFreshness', 'answerUse')
  ) then
    raise exception 'invalid_search_filter' using errcode = '22023', detail = 'unknown';
  end if;
  if (p_after_created_at is null) <> (p_after_id is null) then
    raise exception 'invalid_search_cursor' using errcode = '22023';
  end if;

  v_venue := private.asset_search_filter_uuid(v_filters, 'venue');
  v_type := private.asset_search_filter_choice(v_filters, 'mediaType', array['image', 'video'])::public.media_type;
  v_item := private.asset_search_filter_uuid(v_filters, 'item');
  v_variant := private.asset_search_filter_uuid(v_filters, 'variant');
  v_check := private.asset_search_filter_uuid(v_filters, 'check');
  v_group := private.asset_search_filter_uuid(v_filters, 'group');
  if v_filters ? 'submission' then
    if jsonb_typeof(v_filters -> 'submission') <> 'object'
       or exists (select 1 from jsonb_object_keys(v_filters -> 'submission') k where k not in ('source', 'id'))
       or not (v_filters -> 'submission' ? 'source' and v_filters -> 'submission' ? 'id') then
      raise exception 'invalid_search_filter' using errcode = '22023', detail = 'submission';
    end if;
    v_submission_source := private.asset_search_filter_choice(
      v_filters -> 'submission', 'source', array['coverage', 'amenity', 'knowledge']);
    v_submission_id := private.asset_search_filter_uuid(v_filters -> 'submission', 'id');
  end if;
  v_rights := private.asset_search_filter_choice(v_filters, 'rights',
    array['legacy_unknown', 'not_granted', 'in_force', 'expired', 'withdrawn']);
  if v_filters ? 'destination' then
    if v_rights is distinct from 'in_force'
       or jsonb_typeof(v_filters -> 'destination') <> 'string'
       or (v_filters ->> 'destination') !~ '^[a-z0-9_]{3,64}$' then
      raise exception 'invalid_search_filter' using errcode = '22023', detail = 'destination';
    end if;
    v_destination := v_filters ->> 'destination';
  end if;
  v_from := private.asset_search_filter_instant(v_filters, 'uploadedFrom');
  v_before := private.asset_search_filter_instant(v_filters, 'uploadedBefore');
  v_menu_state := private.asset_search_filter_choice(v_filters, 'menuState',
    array['accepted', 'better_photo_requested', 'needs_recheck', 'withdrawn', 'invalidated']);
  v_answer_state := private.asset_search_filter_choice(v_filters, 'answerFreshness',
    array['current', 'due_soon', 'expired', 'basis_missing', 'unrated']);
  if v_filters ? 'answerUse' and v_answer_state is null then
    raise exception 'invalid_search_filter' using errcode = '22023', detail = 'answerUse';
  end if;
  v_answer_use := coalesce(private.asset_search_filter_choice(v_filters, 'answerUse',
    array['internal', 'public']), 'internal');

  if v_admin then
    if v_venue is not null and not exists (select 1 from public.venues v where v.id = v_venue) then
      raise exception 'venue_not_found' using errcode = 'P0002';
    end if;
  else
    if v_venue is not null and v_venue <> v_manager_venue then
      raise exception 'wrong_venue' using errcode = '42501';
    end if;
    v_venue := v_manager_venue;
  end if;
  -- Answer freshness runs only with a venue (§11.2): an admin must name one.
  if v_answer_state is not null and v_venue is null then
    raise exception 'invalid_search_filter' using errcode = '22023', detail = 'answerFreshness';
  end if;

  -- Caller constants for the gate prefilter below, read once under the same
  -- snapshot as every per-row call of the same functions in
  -- private.asset_search_admits.
  if not v_admin then
    v_uid := (select auth.uid());
    v_is_manager := private.is_active_manager();
    v_can_review := private.menu_photo_can_review_unlabelled();
    v_has_active_check := exists (
      select 1 from public.venue_amenity_checks c
      where c.venue_id = v_manager_venue and c.status = 'active');
  end if;

  -- Candidate ids of the selective filters: the same joins and predicates as
  -- the matching EXISTS in the scan (which stay too). Null when the filter is
  -- absent; an empty array means no row can match. With a venue (always, for
  -- a manager) only the searched venue is read: the check, requirement,
  -- submission or group must belong to it (one key lookup each) before its
  -- evidence is read, and the evidence rows are held to it too. Evidence and
  -- group rows share their venue with the asset, the submission and the
  -- check by composite FK, and the scan requires a.venue_id = v_venue, so no
  -- row the scan could return is lost; another venue's id costs the same as
  -- an unknown one.
  if v_check is not null then
    v_in_venue := v_venue is null or exists (
      select 1 from public.venue_amenity_checks c where c.id = v_check and c.venue_id = v_venue);
    select coalesce(array_agg(distinct x.asset_id), '{}') into v_check_ids
    from (
      select sa.asset_id from public.amenity_submission_assets sa
      join public.amenity_submissions s on s.id = sa.submission_id
      where v_in_venue and s.check_id = v_check
        and (v_venue is null or (s.venue_id = v_venue and sa.venue_id = v_venue))
      union all
      select ka.asset_id from public.knowledge_contribution_assets ka
      join public.knowledge_contributions kc on kc.id = ka.contribution_id
      where v_in_venue and kc.check_id = v_check
        and (v_venue is null or (kc.venue_id = v_venue and ka.venue_id = v_venue))
      union all
      select ci.asset_id from public.coverage_submission_items ci
      where (v_venue is null or exists (
          select 1 from public.coverage_requirements r where r.id = v_check and r.venue_id = v_venue))
        and ci.requirement_id = v_check
        and (v_venue is null or ci.venue_id = v_venue)
    ) x;
  end if;
  if v_submission_id is not null then
    v_in_venue := v_venue is null or case v_submission_source
      when 'coverage' then exists (select 1 from public.coverage_submissions cs
        where cs.id = v_submission_id and cs.venue_id = v_venue)
      when 'amenity' then exists (select 1 from public.amenity_submissions s
        where s.id = v_submission_id and s.venue_id = v_venue)
      when 'knowledge' then exists (select 1 from public.knowledge_contributions kc
        where kc.id = v_submission_id and kc.venue_id = v_venue)
    end;
    select coalesce(array_agg(distinct x.asset_id), '{}') into v_submission_ids
    from (
      select ci.asset_id from public.coverage_submission_items ci
      where v_in_venue and v_submission_source = 'coverage' and ci.submission_id = v_submission_id
        and (v_venue is null or ci.venue_id = v_venue)
      union all
      select sa.asset_id from public.amenity_submission_assets sa
      where v_in_venue and v_submission_source = 'amenity' and sa.submission_id = v_submission_id
        and (v_venue is null or sa.venue_id = v_venue)
      union all
      select ka.asset_id from public.knowledge_contribution_assets ka
      where v_in_venue and v_submission_source = 'knowledge' and ka.contribution_id = v_submission_id
        and (v_venue is null or ka.venue_id = v_venue)
    ) x;
  end if;
  if v_group is not null then
    v_in_venue := v_venue is null or exists (
      select 1 from public.media_contribution_groups g where g.id = v_group and g.venue_id = v_venue);
    select coalesce(array_agg(distinct gm.asset_id), '{}') into v_group_ids
    from public.media_contribution_group_members gm
    where v_in_venue and gm.group_id = v_group
      and (v_venue is null or gm.venue_id = v_venue);
  end if;
  -- menuState: the assets with a decision in that state (and on the item
  -- and/or variant asked); an item and/or variant without menuState: the
  -- assets labelled with them or with a decision on them. Without the list a
  -- rare (or unknown) state, item or variant reads the whole feed: the EXISTS
  -- terms below can only refuse rows, never stop the scan, and menu_item_photos
  -- has no variant index, so under this function's settings its EXISTS on
  -- variant alone could not be hashed and probed every row read. Decisions
  -- are read at the searched venue (a decision shares its venue with the
  -- asset by composite FK); labels are not (the scan holds the venue).
  if v_menu_state is not null or v_item is not null or v_variant is not null then
    select coalesce(array_agg(distinct x.asset_id), '{}') into v_menu_ids
    from (
      select mp.asset_id from public.menu_item_photos mp
      where (v_venue is null or mp.venue_id = v_venue)
        and (v_menu_state is null or mp.state = v_menu_state)
        and (v_item is null or mp.item_id = v_item)
        and (v_variant is null or mp.variant_id = v_variant)
      union all
      select li.asset_id from public.media_label_items li
      where v_menu_state is null
        and (v_item is null or li.item_id = v_item)
        and (v_variant is null or li.variant_id = v_variant)
    ) x;
  end if;

  -- answerFreshness: the assets that are evidence for an answer in use at
  -- the searched venue (B03 K1's current_answer role: the check's current
  -- submission). Each one admitted is then asked of K1 for that answer's
  -- freshness for the asked use.
  if v_answer_state is not null then
    select coalesce(array_agg(distinct sa.asset_id), '{}') into v_answer_ids
    from public.venue_amenity_checks c
    join public.amenity_submission_assets sa on sa.submission_id = c.current_submission_id
    where c.venue_id = v_venue and sa.venue_id = v_venue;
  end if;

  -- Keyset chunks in feed order (limit + 1 rows, then x4, at most 4000). The
  -- chunk query holds the original filters, conditions the rights filter
  -- implies and a necessary condition P of the gate; the exact use state and
  -- private.asset_search_admits run per consumed row, in order, until
  -- limit + 1 rows are admitted. Every chunk resumes after the last row read,
  -- admitted or not, under the one snapshot of this STABLE function.
  v_ids := '{}';
  v_scan_at := p_after_created_at;
  v_scan_id := p_after_id;
  if coalesce(cardinality(v_check_ids), 1) > 0
     and coalesce(cardinality(v_submission_ids), 1) > 0
     and coalesce(cardinality(v_group_ids), 1) > 0
     and coalesce(cardinality(v_menu_ids), 1) > 0
     and coalesce(cardinality(v_answer_ids), 1) > 0 then
    v_chunk := v_limit + 1;
    <<scan>>
    loop
      v_seen := 0;
      for v_row in
        select a.*
        from public.media_assets a
        where a.deleted_at is null
          and a.upload_state = 'ready'
          and (v_venue is null or a.venue_id = v_venue)
          and (v_type is null or a.media_type = v_type)
          and (v_from is null or a.created_at >= v_from)
          and (v_before is null or a.created_at < v_before)
          and (v_scan_at is null or (a.created_at, a.id) < (v_scan_at, v_scan_id))
          and (v_check_ids is null or a.id = any (v_check_ids))
          and (v_submission_ids is null or a.id = any (v_submission_ids))
          and (v_group_ids is null or a.id = any (v_group_ids))
          and (v_menu_ids is null or a.id = any (v_menu_ids))
          and (v_answer_ids is null or a.id = any (v_answer_ids))
          and (v_group is null or exists (
            select 1 from public.media_contribution_group_members gm
            where gm.asset_id = a.id and gm.group_id = v_group))
          -- menuState with item and/or variant needs ONE decision row matching
          -- all of them; labels never satisfy a menuState request.
          and (v_menu_state is null or exists (
            select 1 from public.menu_item_photos mp
            where mp.asset_id = a.id and mp.state = v_menu_state
              and (v_item is null or mp.item_id = v_item)
              and (v_variant is null or mp.variant_id = v_variant)))
          and (v_menu_state is not null
            or (v_item is null and v_variant is null)
            or exists (
              select 1 from public.media_label_items li
              where li.asset_id = a.id
                and (v_item is null or li.item_id = v_item)
                and (v_variant is null or li.variant_id = v_variant))
            or exists (
              select 1 from public.menu_item_photos mp
              where mp.asset_id = a.id
                and (v_item is null or mp.item_id = v_item)
                and (v_variant is null or mp.variant_id = v_variant)))
          and (v_check is null
            or exists (
              select 1 from public.amenity_submission_assets sa
              join public.amenity_submissions s on s.id = sa.submission_id
              where sa.asset_id = a.id and s.check_id = v_check)
            or exists (
              select 1 from public.knowledge_contribution_assets ka
              join public.knowledge_contributions kc on kc.id = ka.contribution_id
              where ka.asset_id = a.id and kc.check_id = v_check)
            or exists (
              select 1 from public.coverage_submission_items ci
              where ci.asset_id = a.id and ci.requirement_id = v_check))
          and (v_submission_id is null
            or (v_submission_source = 'coverage' and exists (
              select 1 from public.coverage_submission_items ci
              where ci.asset_id = a.id and ci.submission_id = v_submission_id))
            or (v_submission_source = 'amenity' and exists (
              select 1 from public.amenity_submission_assets sa
              where sa.asset_id = a.id and sa.submission_id = v_submission_id))
            or (v_submission_source = 'knowledge' and exists (
              select 1 from public.knowledge_contribution_assets ka
              where ka.asset_id = a.id and ka.contribution_id = v_submission_id)))
          -- Rights, part 1: the asked use state in SQL, exact, so rows a
          -- grant settles never reach the loop
          -- (private.media_asset_use_state: granted = a grant in force;
          -- withdrawn = a withdrawn grant and none in force; otherwise the
          -- baseline; use_baseline is NOT NULL, legacy_unknown or none). The
          -- grant probes spell out private.media_use_grant_state (withdrawn
          -- if a withdrawal exists, else expired once effective_until has
          -- passed, else scheduled before effective_from, else in force;
          -- pinned in tests/security/asset-search.test.ts): "settled" = in
          -- force or withdrawn; the base body's destination and expired
          -- EXISTS are spelled the same way. Scalar sublinks on the asset's
          -- grants, never hashed (a hashed EXISTS computes every grant's
          -- state). "No such grant" is written "is distinct from 1" (the
          -- probe yields 1 or null, so it equals "is null"): the planner
          -- counts "is null" on a sublink as 0.5% of rows, which made the
          -- not_granted chunk a full read of media_assets and a sort for the
          -- admin; "is distinct from" counts as 99.5%, like the "is not null"
          -- probes. Part 2, the use state itself, still runs per row below.
          and (v_rights is null
            or (v_rights = 'legacy_unknown' and a.use_baseline = 'legacy_unknown'
              and (select 1 from public.media_use_grants g where g.asset_id = a.id
                     and (exists (select 1 from public.media_use_grant_withdrawals w where w.grant_id = g.id)
                       or (g.effective_from <= v_now
                         and (g.effective_until is null or g.effective_until > v_now)))
                   limit 1) is distinct from 1)
            or (v_rights = 'not_granted' and a.use_baseline <> 'legacy_unknown'
              and (select 1 from public.media_use_grants g where g.asset_id = a.id
                     and (exists (select 1 from public.media_use_grant_withdrawals w where w.grant_id = g.id)
                       or (g.effective_from <= v_now
                         and (g.effective_until is null or g.effective_until > v_now)))
                   limit 1) is distinct from 1)
            or (v_rights = 'withdrawn'
              and (select 1 from public.media_use_grants g
                     join public.media_use_grant_withdrawals w on w.grant_id = g.id
                   where g.asset_id = a.id limit 1) is not null
              and (select 1 from public.media_use_grants g where g.asset_id = a.id
                     and g.effective_from <= v_now
                     and (g.effective_until is null or g.effective_until > v_now)
                     and not exists (select 1 from public.media_use_grant_withdrawals w where w.grant_id = g.id)
                   limit 1) is distinct from 1)
            or (v_rights = 'in_force'
              and (select 1 from public.media_use_grants g where g.asset_id = a.id
                     and g.effective_from <= v_now
                     and (g.effective_until is null or g.effective_until > v_now)
                     and not exists (select 1 from public.media_use_grant_withdrawals w where w.grant_id = g.id)
                   limit 1) is not null
              and (v_destination is null
                or (select 1 from public.media_use_grants g
                    where g.asset_id = a.id and g.destination_key = v_destination
                      and g.effective_from <= v_now
                      and (g.effective_until is null or g.effective_until > v_now)
                      and not exists (select 1 from public.media_use_grant_withdrawals w where w.grant_id = g.id)
                    limit 1) is not null))
            or (v_rights = 'expired'
              and (select 1 from public.media_use_grants g where g.asset_id = a.id
                     and (exists (select 1 from public.media_use_grant_withdrawals w where w.grant_id = g.id)
                       or (g.effective_from <= v_now
                         and (g.effective_until is null or g.effective_until > v_now)))
                   limit 1) is distinct from 1
              and (select 1 from public.media_use_grants g
                   where g.asset_id = a.id
                     and g.effective_until is not null and g.effective_until <= v_now
                     and not exists (select 1 from public.media_use_grant_withdrawals w where w.grant_id = g.id)
                   limit 1) is not null))
          -- Gate prefilter P: true for every row private.asset_search_admits
          -- admits for this manager (it may keep rows the gate then refuses,
          -- never the reverse). The veto is the gate's own; the rest is one
          -- probe per table an arm of menu_item_photo_asset,
          -- menu_photo_unlabelled_eligible, task_evidence_asset,
          -- amenity_evidence_asset or amenity_is_legacy_media needs. Scalar
          -- sublinks on purpose (never hashed). A new gate arm needs a term
          -- here: tests/security/asset-search.test.ts pins those helpers.
          and (v_admin or (
            not (v_is_manager and a.uploader_id = v_uid and a.uploader_role is distinct from 'manager')
            and (
              (a.uploader_id = v_uid
                and (a.uploader_role is not distinct from 'manager' or v_has_active_check))
              or (select 1 from public.media_label_items li where li.asset_id = a.id limit 1) is not null
              or (select 1 from public.menu_item_photos mp where mp.asset_id = a.id limit 1) is not null
              or (v_can_review and a.media_type = 'image'
                and (select 1 from public.media_labels ml where ml.asset_id = a.id
                       and ml.content_types && array['dish', 'preparation', 'plating', 'drinks']::text[]
                     limit 1) is not null)
              or (select 1 from public.coverage_submission_items ci where ci.asset_id = a.id limit 1) is not null
              or (select 1 from public.venue_amenity_fact_media fm where fm.asset_id = a.id limit 1) is not null
              or (select 1 from public.amenity_submission_assets sa where sa.asset_id = a.id limit 1) is not null
              or (select 1 from public.knowledge_contribution_assets ka where ka.asset_id = a.id limit 1) is not null
            )))
        order by a.created_at desc, a.id desc
        limit v_chunk
      loop
        v_seen := v_seen + 1;
        v_scan_at := v_row.created_at;
        v_scan_id := v_row.id;
        -- Rights, part 2, then the gate. A simple expression (no subquery),
        -- so its plan is cached across rows.
        if (v_rights is null
            or (v_rights in ('legacy_unknown', 'not_granted', 'withdrawn')
              and private.media_asset_use_state(v_row.id, v_now) = v_rights)
            or (v_rights = 'in_force'
              and private.media_asset_use_state(v_row.id, v_now) = 'granted')
            or (v_rights = 'expired'
              and private.media_asset_use_state(v_row.id, v_now) in ('legacy_unknown', 'not_granted')))
           and private.asset_search_admits(v_row, v_admin, v_manager_venue) then
          if v_answer_state is null then
            v_ids := v_ids || v_row.id;
            exit scan when cardinality(v_ids) > v_limit;
          else
            -- At most 500 admitted candidates are rated per page; then the
            -- page ends and resumeAfter says where the next one starts.
            v_rated := v_rated + 1;
            if exists (
              select 1
              from private.knowledge_evidence_for_assets(array[v_row.id], v_now) k
              cross join lateral jsonb_array_elements(coalesce(k.freshness, '[]'::jsonb)) f
              where k.role = 'current_answer' and k.venue_id = v_venue
                and f ->> 'use' = v_answer_use and f ->> 'state' = v_answer_state
            ) then
              v_ids := v_ids || v_row.id;
              exit scan when cardinality(v_ids) > v_limit;
            end if;
            if v_rated >= 500 then
              v_capped := true;
              exit scan;
            end if;
          end if;
        end if;
      end loop;
      exit scan when v_seen < v_chunk;
      v_chunk := least(v_chunk * 4, 4000);
    end loop scan;
  end if;

  v_ids := coalesce(v_ids, '{}');
  v_more := cardinality(v_ids) > v_limit;
  if v_more then
    v_ids := v_ids[1:v_limit];
  end if;

  return case when v_capped and not v_more then
    jsonb_build_object('resumeAfter', jsonb_build_object('uploadedAt', v_scan_at, 'id', v_scan_id))
  else '{}'::jsonb end
  || jsonb_build_object(
    'hasMore', v_more or v_capped,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', a.id,
          'mediaType', a.media_type,
          'hasThumbnail', a.thumbnail_path is not null,
          'venueName', v.name,
          'uploaderFirstName', nullif(split_part(btrim(p.display_name), ' ', 1), ''),
          'uploadedAt', a.created_at,
          'groupId', gm.group_id,
          'subjects', jsonb_build_object(
            'menuItems', coalesce((
              select jsonb_agg(jsonb_build_object(
                  'itemId', mi.item_id, 'variantId', mi.variant_id,
                  'itemName', mi.item_name, 'variantName', mi.variant_name)
                order by mi.item_name, mi.variant_name nulls first, mi.item_id, mi.variant_id)
              from (
                select distinct on (s.item_id, s.variant_id) s.item_id, s.variant_id, s.item_name, s.variant_name
                from (
                  select li.item_id, li.variant_id, li.item_name, li.variant_name, 1 as rank, li.added_at as at
                  from public.media_label_items li where li.asset_id = a.id
                  union all
                  select mp.item_id, mp.variant_id, mp.item_name, mp.variant_name, 2, mp.decided_at
                  from public.menu_item_photos mp where mp.asset_id = a.id
                ) s
                order by s.item_id, s.variant_id, s.rank, s.at desc
              ) mi), '[]'::jsonb),
            'checks', coalesce((
              select jsonb_agg(jsonb_build_object(
                  'checkId', ck.check_id, 'questionKey', ck.question_key, 'source', ck.source)
                order by ck.question_key, ck.source, ck.check_id)
              from (
                select distinct s.check_id, c.template_key as question_key, 'amenity' as source
                from public.amenity_submission_assets sa
                join public.amenity_submissions s on s.id = sa.submission_id
                join public.venue_amenity_checks c on c.id = s.check_id
                where sa.asset_id = a.id
                union
                select kc.check_id, kc.question_key, 'knowledge'
                from public.knowledge_contribution_assets ka
                join public.knowledge_contributions kc on kc.id = ka.contribution_id
                where ka.asset_id = a.id
              ) ck), '[]'::jsonb),
            'tasks', coalesce((
              select jsonb_agg(jsonb_build_object(
                  'requirementId', t.requirement_id, 'submissionId', t.submission_id)
                order by t.submission_id, t.requirement_id)
              from (
                select distinct ci.requirement_id, ci.submission_id
                from public.coverage_submission_items ci
                where ci.asset_id = a.id
              ) t), '[]'::jsonb),
            'group', case when g.id is not null
              then jsonb_build_object('kind', g.subject_kind, 'id', g.subject_id) end),
          'use', private.media_asset_use_summary(a.id, 'full') || jsonb_build_object(
            'destinations', coalesce((
              select jsonb_agg(jsonb_build_object(
                  'destinationKey', ug.destination_key, 'label', d.label,
                  'state', private.media_use_grant_state(ug, v_now), 'until', ug.effective_until)
                order by d.label, ug.created_at)
              from public.media_use_grants ug
              join public.media_use_destinations d on d.key = ug.destination_key
              where ug.asset_id = a.id), '[]'::jsonb)),
          'menuDecisions', coalesce((
            select jsonb_agg(jsonb_build_object(
                'itemId', mp.item_id, 'variantId', mp.variant_id,
                'itemName', mp.item_name, 'variantName', mp.variant_name,
                'state', mp.state, 'isPrimary', mp.is_primary, 'basis', mp.basis)
              order by mp.decided_at desc, mp.id)
            from public.menu_item_photos mp where mp.asset_id = a.id), '[]'::jsonb))
        order by o.ord)
      from unnest(v_ids) with ordinality as o(id, ord)
      join public.media_assets a on a.id = o.id
      join public.venues v on v.id = a.venue_id
      join public.profiles p on p.id = a.uploader_id
      left join public.media_contribution_group_members gm on gm.asset_id = a.id
      left join public.media_contribution_groups g on g.id = gm.group_id
    ), '[]'::jsonb));
end;
$$;

-- The answers in use each asset supports, for the result cards (§11.2 signal
-- 3). Only assets this caller's search admits are answered; others are left
-- out silently, as can_open is false for them.
create function public.asset_search_answers(p_asset_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin boolean;
  v_venue uuid;
  v_ids uuid[];
  v_now timestamptz := now();
begin
  perform private.amenity_assert_active_user();
  select c.is_admin, c.venue_id into v_admin, v_venue from private.asset_search_caller() c;
  if not found then
    raise exception 'not_venue_manager' using errcode = '42501';
  end if;
  if p_asset_ids is null or cardinality(p_asset_ids) > 48
     or array_position(p_asset_ids, null) is not null then
    raise exception 'invalid_asset_list' using errcode = '22023';
  end if;
  select coalesce(array_agg(a.id), '{}') into v_ids
  from public.media_assets a
  where a.id = any (p_asset_ids)
    and private.asset_search_admits(a, v_admin, v_venue);
  if cardinality(v_ids) = 0 then
    return jsonb_build_object('items', '[]'::jsonb);
  end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object('assetId', x.asset_id, 'answers', x.answers)
      order by x.asset_id)
    from (
      select k.asset_id,
        jsonb_agg(jsonb_build_object(
            'checkId', k.check_id,
            'questionKey', k.question_key,
            'question', ac.question,
            'freshness', coalesce(k.freshness, '[]'::jsonb))
          order by ac.position nulls last, k.question_key, k.check_id) as answers
      from private.knowledge_evidence_for_assets(v_ids, v_now) k
      left join public.amenity_catalogue ac on ac.key = k.question_key
      where k.role = 'current_answer'
      group by k.asset_id
    ) x), '[]'::jsonb));
end;
$$;

comment on function public.asset_search(jsonb, timestamptz, uuid, integer) is
  'B05-m4 asset search: one keyset page for an admin (every venue) or a venue''s effective manager (its venue, existing gates only). B05 follow-up: answerFreshness/answerUse filters. Read only.';
comment on function public.asset_search_answers(uuid[]) is
  'B05 follow-up: the answers in use (B03 K1 current_answer) each searched asset supports, with per-use freshness. Read only.';

revoke all on function public.asset_search_answers(uuid[]) from public, anon, service_role;
grant execute on function public.asset_search_answers(uuid[]) to authenticated;
