-- B02-a follow-up: My contributions shows a labelled photo still waiting for
-- review (docs/knowledge/b02-design.md R5, UI §6.1 "{item}: Waiting").
--
-- * Re-created: private.feed_photo_json (B02-a, 20261110010123). Its
--   menuDecisions gain one row per labelled item and variant of the photo
--   still waiting for a first decision, with state 'waiting', photoId null,
--   reason null and decidedAt null. The waiting set is
--   private.menu_photo_pending_tuples with own_only, the same rule as the
--   overview's own_waiting_photos and my_menu_waiting_items, so it covers the
--   caller's own photos only (D3). A recheck already has a live decision
--   (needs_recheck) and is not repeated. Every other key and row is unchanged.
-- * Nothing else is re-created; my_contributions_feed calls this helper.
--
-- Rollback: a forward migration restores the 20261110010123 body of
-- private.feed_photo_json; the feed then shows decided rows only.

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
      select jsonb_agg(d.row order by d.waiting, d.decided_at desc, d.item_name, d.sort_id)
      from (
        select jsonb_build_object(
            'photoId', m.id, 'itemId', m.item_id, 'itemName', m.item_name,
            'variantName', m.variant_name, 'state', m.state, 'reason', m.reason,
            'decidedAt', m.decided_at) as row,
          false as waiting, m.decided_at, m.item_name, m.id::text as sort_id
        from public.menu_item_photos m
        where m.asset_id = a.id and m.state not in ('withdrawn', 'invalidated')
        union all
        select jsonb_build_object(
            'photoId', null, 'itemId', t.item_id, 'itemName', e.name,
            'variantName', coalesce(ev.name, li.variant_name), 'state', 'waiting',
            'reason', null, 'decidedAt', null),
          true, null::timestamptz, e.name, t.label_id::text
        from private.menu_photo_pending_tuples(a.venue_id, false, true) t
        join public.menu_entries e on e.id = t.entry_id
        join public.media_label_items li on li.id = t.label_id
        left join public.menu_entry_variants ev on ev.entry_id = t.entry_id and ev.variant_id = t.variant_id
        where t.asset_id = a.id and t.live_photo_id is null
      ) d
    ), '[]'::jsonb),
    'menuUseAccepted', exists (
      select 1 from public.menu_item_photos m where m.asset_id = a.id and m.state = 'accepted'
    )
  )
  from public.media_assets a
  join public.venues v on v.id = a.venue_id
  left join public.media_labels l on l.asset_id = a.id
  where a.id = p_asset_id;
$$;

revoke all on function private.feed_photo_json(uuid) from public, anon, authenticated;
