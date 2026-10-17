-- =============================================================================
-- NE JAMAIS EXÉCUTER SUR LE PROJET RÉEL.
-- =============================================================================
-- Test des migrations 20261017160000_team_accounts.sql et 20261017160100_team_roles_enforcement.sql.
-- STATUT : NON TESTÉ EN EXÉCUTION (ni Docker ni CLI Supabase disponibles : ce fichier n'a jamais été exécuté).
-- Base locale jetable uniquement, en tant que postgres, après TOUTES les migrations (les deux parties comprises) :
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/team_accounts.test.sql
-- Transaction terminée par ROLLBACK : aucune donnée ne reste. Les comptes auth.users sont des données de test
-- de la base jetable (convention des autres fichiers de test), jamais créés ainsi en réel.
--
-- Scénarios : invitation par service_role (adhésion viewer créée) ; gérant ne nomme pas de gérant ; personne
-- ne s'invite ni ne se modifie ; propriétaire intouchable ; vendeur : encaisse, ne peut ni annuler ni importer,
-- ne voit que ses tickets, ne lit pas les prix d'achat ; magasinier : saisit le stock, ne peut pas encaisser ni
-- lire la caisse ; livreur : ni stock ni caisse ; vendeur désactivé : plus rien ; autre boutique : rien.
-- =============================================================================

begin;

insert into auth.users (id, email) values
  ('30000000-0000-4000-8000-000000000001', 'owner-t@test.local'),
  ('30000000-0000-4000-8000-000000000002', 'manager-t@test.local'),
  ('30000000-0000-4000-8000-000000000003', 'cashier1-t@test.local'),
  ('30000000-0000-4000-8000-000000000004', 'cashier2-t@test.local'),
  ('30000000-0000-4000-8000-000000000005', 'stock-t@test.local'),
  ('30000000-0000-4000-8000-000000000006', 'driver-t@test.local'),
  ('40000000-0000-4000-8000-000000000001', 'owner-u@test.local');

insert into public.workspaces (id, owner_id, name, slug) values
  ('31000000-0000-4000-8000-000000000000', '30000000-0000-4000-8000-000000000001', 'Espace T', 'espace-t-test'),
  ('41000000-0000-4000-8000-000000000000', '40000000-0000-4000-8000-000000000001', 'Espace U', 'espace-u-test');
insert into public.sites (id, workspace_id, name, slug, site_type) values
  ('32000000-0000-4000-8000-000000000000', '31000000-0000-4000-8000-000000000000', 'Quincaillerie T', 'quincaillerie-t-test', 'store'),
  ('42000000-0000-4000-8000-000000000000', '41000000-0000-4000-8000-000000000000', 'Quincaillerie U', 'quincaillerie-u-test', 'store');
insert into public.stock_locations (id, site_id, name, location_type) values
  ('33000000-0000-4000-8000-000000000000', '32000000-0000-4000-8000-000000000000', 'Magasin', 'store');
insert into public.product_units (id, site_id, code, label, dimension, decimal_places) values
  ('34000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000000', 'u', 'Pièce', 'count', 0);
insert into public.products (id, site_id, name, slug, status, price) values
  ('35000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000000', 'Marteau', 'marteau-t-test', 'active', 5000);
insert into public.product_sell_units (site_id, product_id, unit_id, conversion_to_base, is_default, min_sale_quantity, quantity_step) values
  ('32000000-0000-4000-8000-000000000000', '35000000-0000-4000-8000-000000000001', '34000000-0000-4000-8000-000000000001', 1, true, 1, 1);
insert into public.inventory_movements (site_id, product_id, movement_type, quantity_delta, stock_location_id) values
  ('32000000-0000-4000-8000-000000000000', '35000000-0000-4000-8000-000000000001', 'initial_stock', 50, '33000000-0000-4000-8000-000000000000');
insert into public.product_costs (product_id, site_id, unit_cost) values
  ('35000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000000', 3500);

create temporary table t (name text, payload jsonb) on commit drop;
grant all on t to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 1. Invitations (comme l'Edge Function : service_role, invité_par vérifié)
-- -----------------------------------------------------------------------------
set local role service_role;
select public.staff_register_invitation('32000000-0000-4000-8000-000000000000', '30000000-0000-4000-8000-000000000002', 'manager', '30000000-0000-4000-8000-000000000001');
select public.staff_register_invitation('32000000-0000-4000-8000-000000000000', '30000000-0000-4000-8000-000000000003', 'cashier', '30000000-0000-4000-8000-000000000002');
select public.staff_register_invitation('32000000-0000-4000-8000-000000000000', '30000000-0000-4000-8000-000000000004', 'cashier', '30000000-0000-4000-8000-000000000002');
select public.staff_register_invitation('32000000-0000-4000-8000-000000000000', '30000000-0000-4000-8000-000000000005', 'stock_keeper', '30000000-0000-4000-8000-000000000001');
select public.staff_register_invitation('32000000-0000-4000-8000-000000000000', '30000000-0000-4000-8000-000000000006', 'driver', '30000000-0000-4000-8000-000000000001');

do $test$
begin
  -- Un gérant ne nomme pas de gérant.
  begin
    perform public.staff_register_invitation('32000000-0000-4000-8000-000000000000', '40000000-0000-4000-8000-000000000001', 'manager', '30000000-0000-4000-8000-000000000002');
    raise exception 'ÉCHEC 1a : un gérant a nommé un gérant';
  exception when sqlstate '42501' then null;
  end;
  -- Un vendeur n'invite personne.
  begin
    perform public.staff_register_invitation('32000000-0000-4000-8000-000000000000', '40000000-0000-4000-8000-000000000001', 'driver', '30000000-0000-4000-8000-000000000003');
    raise exception 'ÉCHEC 1b : un vendeur a invité';
  exception when sqlstate '42501' then null;
  end;
  -- On ne s'invite pas soi-même.
  begin
    perform public.staff_register_invitation('32000000-0000-4000-8000-000000000000', '30000000-0000-4000-8000-000000000001', 'manager', '30000000-0000-4000-8000-000000000001');
    raise exception 'ÉCHEC 1c : auto-invitation acceptée';
  exception when sqlstate '42501' then null;
  end;
  if (select count(*) from public.workspace_memberships where workspace_id = '31000000-0000-4000-8000-000000000000' and role = 'viewer') <> 5 then
    raise exception 'ÉCHEC 1d : adhésions viewer attendues';
  end if;
  raise notice 'OK 1 : invitations et refus';
end;
$test$;

-- authenticated n'exécute pas les fonctions d'invitation.
reset role;
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $test$
begin
  perform public.staff_register_invitation('32000000-0000-4000-8000-000000000000', '40000000-0000-4000-8000-000000000001', 'cashier', '30000000-0000-4000-8000-000000000001');
  raise exception 'ÉCHEC 1e : staff_register_invitation exécutable par authenticated';
exception when insufficient_privilege then
  raise notice 'OK 1e : invitation réservée à service_role';
end;
$test$;

-- -----------------------------------------------------------------------------
-- 2. Rôles effectifs et protection du propriétaire (en tant que gérant)
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $test$
begin
  if public.current_staff_role('32000000-0000-4000-8000-000000000000') <> 'manager' then raise exception 'ÉCHEC 2a'; end if;
  begin
    perform public.set_staff_role('32000000-0000-4000-8000-000000000000', '30000000-0000-4000-8000-000000000002', 'cashier');
    raise exception 'ÉCHEC 2b : changement de son propre rôle';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.set_staff_active('32000000-0000-4000-8000-000000000000', '30000000-0000-4000-8000-000000000001', false);
    raise exception 'ÉCHEC 2c : propriétaire désactivé';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.set_staff_role('32000000-0000-4000-8000-000000000000', '30000000-0000-4000-8000-000000000003', 'manager');
    raise exception 'ÉCHEC 2d : un gérant a promu un gérant';
  exception when sqlstate '42501' then null;
  end;
  raise notice 'OK 2 : pas d''auto-élévation, propriétaire intouchable';
end;
$test$;

-- -----------------------------------------------------------------------------
-- 3. Vendeur 1 : ouvre la caisse, encaisse ; ni annulation, ni import, ni prix d'achat
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
insert into t select 'session', to_jsonb(public.open_cash_session('32000000-0000-4000-8000-000000000000', 0, 'Caisse principale', null));
insert into t select 'sale1', public.record_sale('32000000-0000-4000-8000-000000000000', (select (payload #>> '{}')::uuid from t where name = 'session'),
  '[{"product_id":"35000000-0000-4000-8000-000000000001","quantity":1}]', '[{"method":"cash","amount":5000}]');
do $test$
begin
  begin
    perform public.void_sale((select (payload ->> 'order_id')::uuid from t where name = 'sale1'), 'Essai vendeur');
    raise exception 'ÉCHEC 3a : un vendeur a annulé une vente';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.import_products('32000000-0000-4000-8000-000000000000',
      '[{"name":"X","price":1,"unit_id":"34000000-0000-4000-8000-000000000001"}]', 'create', 'csv');
    raise exception 'ÉCHEC 3b : un vendeur a importé';
  exception when sqlstate '42501' then null;
  end;
  if exists (select 1 from public.product_costs) then raise exception 'ÉCHEC 3c : le vendeur lit les prix d''achat'; end if;
  if (select count(*) from public.store_documents where site_id = '32000000-0000-4000-8000-000000000000') <> 1 then
    raise exception 'ÉCHEC 3d : le vendeur doit voir son ticket';
  end if;
  raise notice 'OK 3 : vendeur limité';
end;
$test$;

-- Vendeur 2 : ne voit pas le ticket du vendeur 1 ; encaisse dans la même caisse.
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
do $test$
begin
  if exists (select 1 from public.store_documents) or exists (select 1 from public.orders) then
    raise exception 'ÉCHEC 3e : un vendeur voit les tickets d''un autre vendeur';
  end if;
  raise notice 'OK 3e : chaque vendeur ne voit que ses tickets';
end;
$test$;

-- -----------------------------------------------------------------------------
-- 4. Magasinier : stock oui, caisse non
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000005","role":"authenticated"}', true);
select public.record_stock_movement('32000000-0000-4000-8000-000000000000', '35000000-0000-4000-8000-000000000001',
  '33000000-0000-4000-8000-000000000000', 'restock', 10, null, 'Réception test');
do $test$
begin
  begin
    perform public.record_sale('32000000-0000-4000-8000-000000000000', (select (payload #>> '{}')::uuid from t where name = 'session'),
      '[{"product_id":"35000000-0000-4000-8000-000000000001","quantity":1}]', '[{"method":"cash","amount":5000}]');
    raise exception 'ÉCHEC 4a : un magasinier a encaissé';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.open_cash_session('32000000-0000-4000-8000-000000000000', 0, 'Caisse 2', null);
    raise exception 'ÉCHEC 4b : un magasinier a ouvert une caisse';
  exception when sqlstate '42501' then null;
  end;
  if exists (select 1 from public.cash_register_sessions) or exists (select 1 from public.cash_register_movements) then
    raise exception 'ÉCHEC 4c : le magasinier lit la caisse';
  end if;
  if exists (select 1 from public.product_costs) then raise exception 'ÉCHEC 4d : le magasinier lit les prix d''achat'; end if;
  if (select count(*) from public.inventory_movements where site_id = '32000000-0000-4000-8000-000000000000') < 2 then
    raise exception 'ÉCHEC 4e : le magasinier doit voir le stock';
  end if;
  raise notice 'OK 4 : magasinier limité au stock';
end;
$test$;

-- -----------------------------------------------------------------------------
-- 5. Livreur : ni stock ni caisse
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000006","role":"authenticated"}', true);
do $test$
begin
  if exists (select 1 from public.inventory_movements) or exists (select 1 from public.cash_register_sessions)
     or exists (select 1 from public.store_documents) then
    raise exception 'ÉCHEC 5 : le livreur lit stock, caisse ou tickets';
  end if;
  raise notice 'OK 5 : livreur sans accès au stock ni à la caisse';
end;
$test$;

-- -----------------------------------------------------------------------------
-- 6. Vendeur 1 désactivé par le propriétaire : plus rien
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public.set_staff_active('32000000-0000-4000-8000-000000000000', '30000000-0000-4000-8000-000000000003', false, 'Départ');
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
do $test$
begin
  if public.current_staff_role('32000000-0000-4000-8000-000000000000') is not null then raise exception 'ÉCHEC 6a : rôle encore actif'; end if;
  begin
    perform public.record_sale('32000000-0000-4000-8000-000000000000', (select (payload #>> '{}')::uuid from t where name = 'session'),
      '[{"product_id":"35000000-0000-4000-8000-000000000001","quantity":1}]', '[{"method":"cash","amount":5000}]');
    raise exception 'ÉCHEC 6b : un vendeur désactivé a encaissé';
  exception when sqlstate '42501' then null;
  end;
  if exists (select 1 from public.products where site_id = '32000000-0000-4000-8000-000000000000') then
    raise exception 'ÉCHEC 6c : adhésion viewer non retirée à la désactivation';
  end if;
  raise notice 'OK 6 : vendeur désactivé sans accès';
end;
$test$;

-- -----------------------------------------------------------------------------
-- 7. Propriétaire d'une autre boutique : rien
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $test$
begin
  if public.current_staff_role('32000000-0000-4000-8000-000000000000') is not null then raise exception 'ÉCHEC 7a'; end if;
  if exists (select 1 from public.site_staff where site_id = '32000000-0000-4000-8000-000000000000')
     or exists (select 1 from public.team_audit_events where site_id = '32000000-0000-4000-8000-000000000000')
     or exists (select 1 from public.store_documents where site_id = '32000000-0000-4000-8000-000000000000')
     or exists (select 1 from public.product_costs where site_id = '32000000-0000-4000-8000-000000000000') then
    raise exception 'ÉCHEC 7b : une autre boutique voit les données de T';
  end if;
  begin
    perform public.list_site_staff('32000000-0000-4000-8000-000000000000');
    raise exception 'ÉCHEC 7c : liste d''équipe lisible par une autre boutique';
  exception when sqlstate '42501' then null;
  end;
  raise notice 'OK 7 : isolation entre boutiques';
end;
$test$;

rollback;
