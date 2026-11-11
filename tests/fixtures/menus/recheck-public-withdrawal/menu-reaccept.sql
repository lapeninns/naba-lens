-- fx_menu_recheck_public_withdrawal, re-acceptance step (WS3; b05-design
-- §4.10 "Then"). Run after menu.sql (and after the after-activation
-- assertions) in the same session and transaction: the manager accepts item
-- E's photo again at the item's current head revision.

\set ON_ERROR_STOP on

select f.asset_id as fx_e_asset, f.item_id as fx_e_item,
  coalesce((select h.revision from public.menu_item_photo_heads h where h.item_id = f.item_id), 1) as fx_e_revision,
  json_build_object('sub', (select m.id from fx_menu_recheck m where m.key = 'manager'), 'role', 'authenticated')::text
    as fx_manager_claims
from fx_menu_recheck f where f.key = 'E' \gset

set role authenticated;
select set_config('request.jwt.claims', :'fx_manager_claims', false);
select * from public.review_menu_item_photo(:'fx_e_asset', :'fx_e_item', null, 'accepted', :fx_e_revision,
  null, false, null);
select set_config('request.jwt.claims', '', false);
reset role;
