-- =============================================================================
-- NE JAMAIS EXÉCUTER SUR LE PROJET RÉEL.
-- =============================================================================
-- Test de la migration 20261018080000_data_security.sql.
-- STATUT : NON TESTÉ EN EXÉCUTION (ni Docker ni CLI Supabase disponibles : ce fichier n'a jamais été exécuté).
-- Base locale jetable uniquement, en tant que postgres, après TOUTES les migrations :
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/data_security.test.sql
-- Transaction terminée par ROLLBACK : aucune donnée ne reste.
--
-- Scénarios : export par le propriétaire (données de SA boutique seulement, réglages internes exclus) ; export
-- refusé au gérant et à une autre boutique ; journal d'audit pour le gérant, refusé au vendeur ;
-- sessions : chacun ne voit que les siennes.
-- =============================================================================

begin;

insert into auth.users (id, email) values
  ('f0100000-0000-4000-8000-000000000001', 'owner-ds@test.local'),
  ('f0100000-0000-4000-8000-000000000002', 'manager-ds@test.local'),
  ('f0100000-0000-4000-8000-000000000003', 'cashier-ds@test.local'),
  ('f0200000-0000-4000-8000-000000000001', 'owner-other-ds@test.local');
insert into public.workspaces (id, owner_id, name, slug) values
  ('f1100000-0000-4000-8000-000000000000', 'f0100000-0000-4000-8000-000000000001', 'Espace DS', 'espace-ds-test'),
  ('f1200000-0000-4000-8000-000000000000', 'f0200000-0000-4000-8000-000000000001', 'Espace DS2', 'espace-ds2-test');
insert into public.workspace_memberships (workspace_id, user_id, role) values
  ('f1100000-0000-4000-8000-000000000000', 'f0100000-0000-4000-8000-000000000002', 'admin'),
  ('f1100000-0000-4000-8000-000000000000', 'f0100000-0000-4000-8000-000000000003', 'editor');
insert into public.sites (id, workspace_id, name, slug, site_type, settings) values
  ('f2100000-0000-4000-8000-000000000000', 'f1100000-0000-4000-8000-000000000000', 'Boutique DS', 'boutique-ds-test', 'store', '{"secret_interne":true}'),
  ('f2200000-0000-4000-8000-000000000000', 'f1200000-0000-4000-8000-000000000000', 'Autre DS', 'autre-ds-test', 'store', '{}');
insert into public.products (site_id, name, slug, status, price) values
  ('f2100000-0000-4000-8000-000000000000', 'Marteau DS', 'marteau-ds', 'active', 5000),
  ('f2200000-0000-4000-8000-000000000000', 'Produit autre', 'produit-autre-ds', 'active', 1);
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('f9100000-0000-4000-8000-000000000001', 'f0100000-0000-4000-8000-000000000001', now(), now()),
  ('f9100000-0000-4000-8000-000000000002', 'f0100000-0000-4000-8000-000000000003', now(), now());

-- 1. Propriétaire : export de sa boutique uniquement.
select set_config('request.jwt.claims', '{"sub":"f0100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $test$
declare
  v jsonb := public.export_site_data('f2100000-0000-4000-8000-000000000000');
begin
  if jsonb_array_length(v -> 'tables' -> 'products') <> 1 or v::text like '%Produit autre%' then
    raise exception 'ÉCHEC 1a : export hors boutique ou incomplet';
  end if;
  if v::text like '%secret_interne%' then raise exception 'ÉCHEC 1b : réglages internes exportés'; end if;
  if v::text like '%owner-ds@test.local%' then raise exception 'ÉCHEC 1c : e-mail de compte exporté'; end if;
  if (select count(*) from public.my_auth_sessions()) <> 1 then raise exception 'ÉCHEC 1d : sessions'; end if;
  raise notice 'OK 1 : export du propriétaire, sessions personnelles';
end;
$test$;

-- 2. Gérant : pas d'export, journal d'audit lisible.
select set_config('request.jwt.claims', '{"sub":"f0100000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $test$
begin
  begin
    perform public.export_site_data('f2100000-0000-4000-8000-000000000000');
    raise exception 'ÉCHEC 2a : export par le gérant';
  exception when sqlstate '42501' then null;
  end;
  perform * from public.audit_log('f2100000-0000-4000-8000-000000000000');
  if exists (select 1 from public.my_auth_sessions()) then raise exception 'ÉCHEC 2b : sessions d''un autre utilisateur visibles'; end if;
  raise notice 'OK 2 : gérant';
end;
$test$;

-- 3. Vendeur : pas de journal ; autre propriétaire : pas d'export.
select set_config('request.jwt.claims', '{"sub":"f0100000-0000-4000-8000-000000000003","role":"authenticated"}', true);
do $test$
begin
  perform * from public.audit_log('f2100000-0000-4000-8000-000000000000');
  raise exception 'ÉCHEC 3a : journal lisible par un vendeur';
exception when sqlstate '42501' then
  raise notice 'OK 3a : journal refusé au vendeur';
end;
$test$;
select set_config('request.jwt.claims', '{"sub":"f0200000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $test$
begin
  perform public.export_site_data('f2100000-0000-4000-8000-000000000000');
  raise exception 'ÉCHEC 3b : export par une autre boutique';
exception when sqlstate '42501' then
  raise notice 'OK 3b : isolation entre boutiques';
end;
$test$;

rollback;
