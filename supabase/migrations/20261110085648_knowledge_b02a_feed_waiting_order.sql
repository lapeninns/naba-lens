-- B02-a follow-up: decided menu rows keep their B01-era order exactly
-- (review of 20261110085311). Re-creates private.feed_photo_json with the
-- decided rows ordered by decided_at desc, then photo id desc, as in
-- 20261110010123; waiting rows follow, by item name. Nothing else changes.
--
-- Rollback: a forward migration restores the 20261110085311 body.

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
    )
  )
  from public.media_assets a
  join public.venues v on v.id = a.venue_id
  left join public.media_labels l on l.asset_id = a.id
  where a.id = p_asset_id;
$$;

revoke all on function private.feed_photo_json(uuid) from public, anon, authenticated;
