-- fx_menu_recheck_public_withdrawal, activation step (WS3; b05-design §4.10).
-- Run after menu.sql (and after WS4's b05-overlay.sql, which publishes the v1
-- deliveries) in the same session and transaction: the admin activates v2,
-- and the activation-time photo reconciliation applies the v2 changes.

\set ON_ERROR_STOP on

select json_build_object('sub', (select f.id from fx_menu_recheck f where f.key = 'admin'), 'role', 'authenticated')::text
    as fx_admin_claims,
  (select f.id from fx_menu_recheck f where f.key = 'v2') as fx_v2 \gset

set role authenticated;
select set_config('request.jwt.claims', :'fx_admin_claims', false);
select public.activate_menu_version(:'fx_v2', 1);
select set_config('request.jwt.claims', '', false);
reset role;
