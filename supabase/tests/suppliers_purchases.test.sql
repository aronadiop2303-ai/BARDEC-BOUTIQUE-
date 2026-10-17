-- =============================================================================
-- NE JAMAIS EXÉCUTER SUR LE PROJET RÉEL.
-- =============================================================================
-- Test de la migration 20261018020000_suppliers_purchases.sql (le scénario magasinier exige aussi
-- 20261017160100_team_roles_enforcement).
-- STATUT : NON TESTÉ EN EXÉCUTION (ni Docker ni CLI Supabase disponibles : ce fichier n'a jamais été exécuté).
-- Base locale jetable uniquement, en tant que postgres, après TOUTES les migrations :
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/suppliers_purchases.test.sql
-- Transaction terminée par ROLLBACK : aucune donnée ne reste.
--
-- Scénarios : fournisseur et bon BC-AAAA-NNNNNN par le gérant ; magasinier : réception sans voir aucun coût ;
-- entrée de stock restock ; coût moyen pondéré ; dette ; sur-réception refusée ; règlement en espèces (cash_out)
-- et dette soldée ; magasinier ne crée ni bon ni règlement ; autre boutique sans accès.
-- =============================================================================

begin;

insert into auth.users (id, email) values
  ('c0100000-0000-4000-8000-000000000001', 'owner-p@test.local'),
  ('c0100000-0000-4000-8000-000000000002', 'manager-p@test.local'),
  ('c0100000-0000-4000-8000-000000000003', 'stock-p@test.local'),
  ('c0200000-0000-4000-8000-000000000001', 'owner-q@test.local');
insert into public.workspaces (id, owner_id, name, slug) values
  ('c1100000-0000-4000-8000-000000000000', 'c0100000-0000-4000-8000-000000000001', 'Espace P', 'espace-p-test'),
  ('c1200000-0000-4000-8000-000000000000', 'c0200000-0000-4000-8000-000000000001', 'Espace Q', 'espace-q-test');
insert into public.workspace_memberships (workspace_id, user_id, role) values
  ('c1100000-0000-4000-8000-000000000000', 'c0100000-0000-4000-8000-000000000002', 'admin'),
  ('c1100000-0000-4000-8000-000000000000', 'c0100000-0000-4000-8000-000000000003', 'viewer');
insert into public.sites (id, workspace_id, name, slug, site_type) values
  ('c2100000-0000-4000-8000-000000000000', 'c1100000-0000-4000-8000-000000000000', 'Quincaillerie P', 'quincaillerie-p-test', 'store');
insert into public.site_staff (site_id, user_id, staff_role) values
  ('c2100000-0000-4000-8000-000000000000', 'c0100000-0000-4000-8000-000000000003', 'stock_keeper');
insert into public.stock_locations (id, site_id, name, location_type) values
  ('c3100000-0000-4000-8000-000000000000', 'c2100000-0000-4000-8000-000000000000', 'Magasin', 'store');
insert into public.product_units (id, site_id, code, label, dimension, decimal_places) values
  ('c4100000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000000', 'sac', 'Sac', 'count', 0);
insert into public.products (id, site_id, name, slug, status, price) values
  ('c5100000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000000', 'Ciment 50 kg', 'ciment-p-test', 'active', 5000);
insert into public.product_sell_units (site_id, product_id, unit_id, conversion_to_base, is_default, min_sale_quantity, quantity_step) values
  ('c2100000-0000-4000-8000-000000000000', 'c5100000-0000-4000-8000-000000000001', 'c4100000-0000-4000-8000-000000000001', 1, true, 1, 1);
-- Stock existant : 10 sacs à 4 000.
insert into public.inventory_movements (site_id, product_id, movement_type, quantity_delta, stock_location_id) values
  ('c2100000-0000-4000-8000-000000000000', 'c5100000-0000-4000-8000-000000000001', 'initial_stock', 10, 'c3100000-0000-4000-8000-000000000000');
insert into public.product_costs (product_id, site_id, unit_cost) values
  ('c5100000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000000', 4000);
insert into public.cash_register_sessions (id, site_id, opened_by, opening_cash) values
  ('c6100000-0000-4000-8000-000000000001', 'c2100000-0000-4000-8000-000000000000', 'c0100000-0000-4000-8000-000000000002', 200000);

create temporary table t (name text, payload jsonb) on commit drop;
grant all on t to authenticated;

-- 1. Gérant : fournisseur et bon de 40 sacs à 4 400.
select set_config('request.jwt.claims', '{"sub":"c0100000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
insert into t select 'supplier', to_jsonb(public.save_supplier('c2100000-0000-4000-8000-000000000000', null, 'Sococim', '338000000', 'Rufisque', null, true));
insert into t select 'po', public.create_purchase_order('c2100000-0000-4000-8000-000000000000', (select (payload #>> '{}')::uuid from t where name = 'supplier'),
  '[{"product_id":"c5100000-0000-4000-8000-000000000001","quantity":40,"unit_cost":4400}]', 'Commande test');
do $test$
begin
  if (select payload ->> 'number' from t where name = 'po') !~ '^BC-[0-9]{4}-[0-9]{6}$' then raise exception 'ÉCHEC 1a : numéro'; end if;
  if (select (payload ->> 'total_amount')::numeric from t where name = 'po') <> 176000 then raise exception 'ÉCHEC 1b : total'; end if;
  raise notice 'OK 1 : bon de commande';
end;
$test$;

-- 2. Magasinier : voit le bon sans coût, réceptionne 30 sacs.
select set_config('request.jwt.claims', '{"sub":"c0100000-0000-4000-8000-000000000003","role":"authenticated"}', true);
do $test$
begin
  if exists (select 1 from public.purchase_orders) or exists (select 1 from public.purchase_order_lines)
     or exists (select 1 from public.product_costs) or exists (select 1 from public.supplier_ledger) then
    raise exception 'ÉCHEC 2a : le magasinier lit des coûts';
  end if;
  if (select count(*) from public.receivable_purchase_orders('c2100000-0000-4000-8000-000000000000')) <> 1 then raise exception 'ÉCHEC 2b'; end if;
  begin
    perform public.create_purchase_order('c2100000-0000-4000-8000-000000000000', (select (payload #>> '{}')::uuid from t where name = 'supplier'),
      '[{"product_id":"c5100000-0000-4000-8000-000000000001","quantity":1,"unit_cost":1}]');
    raise exception 'ÉCHEC 2c : le magasinier crée un bon';
  exception when sqlstate '42501' then null;
  end;
  raise notice 'OK 2a : magasinier sans accès aux coûts';
end;
$test$;
insert into t select 'receipt1', public.receive_purchase((select (payload ->> 'purchase_order_id')::uuid from t where name = 'po'),
  jsonb_build_array(jsonb_build_object('line_id', (select line_id from public.receivable_purchase_lines((select (payload ->> 'purchase_order_id')::uuid from t where name = 'po'))),
    'quantity', 30, 'location_id', 'c3100000-0000-4000-8000-000000000000')), 'BL 123');
do $test$
declare
  v jsonb := (select payload from t where name = 'receipt1');
begin
  if v ? 'total_amount' or v::text like '%4400%' then raise exception 'ÉCHEC 2d : montant renvoyé au magasinier'; end if;
  if v ->> 'status' <> 'partially_received' then raise exception 'ÉCHEC 2e : statut %', v ->> 'status'; end if;
  begin
    perform public.receive_purchase((select (payload ->> 'purchase_order_id')::uuid from t where name = 'po'),
      jsonb_build_array(jsonb_build_object('line_id', (select line_id from public.receivable_purchase_lines((select (payload ->> 'purchase_order_id')::uuid from t where name = 'po'))),
        'quantity', 11, 'location_id', 'c3100000-0000-4000-8000-000000000000')));
    raise exception 'ÉCHEC 2f : sur-réception acceptée';
  exception when sqlstate '23514' then null;
  end;
  raise notice 'OK 2b : réception partielle par le magasinier';
end;
$test$;

-- 3. Propriétaire : stock, coût moyen, dette, règlements.
reset role;
select set_config('request.jwt.claims', '{"sub":"c0100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $test$
declare
  v_supplier uuid := (select (payload #>> '{}')::uuid from t where name = 'supplier');
begin
  if (select sum(quantity_delta) from public.inventory_movements where product_id = 'c5100000-0000-4000-8000-000000000001') <> 40 then
    raise exception 'ÉCHEC 3a : stock attendu 40';
  end if;
  if (select count(*) from public.inventory_movements where product_id = 'c5100000-0000-4000-8000-000000000001' and movement_type = 'restock') <> 1 then
    raise exception 'ÉCHEC 3b : mouvement restock absent';
  end if;
  -- (10 × 4 000 + 30 × 4 400) / 40 = 4 300
  if (select unit_cost from public.product_costs where product_id = 'c5100000-0000-4000-8000-000000000001') <> 4300 then
    raise exception 'ÉCHEC 3c : coût moyen';
  end if;
  if (select balance from public.supplier_balances('c2100000-0000-4000-8000-000000000000') where supplier_id = v_supplier) <> 132000 then
    raise exception 'ÉCHEC 3d : dette attendue 132 000';
  end if;
  perform public.record_supplier_payment('c2100000-0000-4000-8000-000000000000', v_supplier, 100000, 'cash', 'c6100000-0000-4000-8000-000000000001', 'REG-1', null);
  perform public.record_supplier_payment('c2100000-0000-4000-8000-000000000000', v_supplier, 32000, 'bank_transfer', null, 'VIR-1', null);
  if (select balance from public.supplier_balances('c2100000-0000-4000-8000-000000000000') where supplier_id = v_supplier) <> 0 then
    raise exception 'ÉCHEC 3e : dette non soldée';
  end if;
  if (public.cash_session_summary('c6100000-0000-4000-8000-000000000001') ->> 'expected_cash')::numeric <> 100000 then
    raise exception 'ÉCHEC 3f : règlement espèces absent de la caisse';
  end if;
  begin
    perform public.record_supplier_payment('c2100000-0000-4000-8000-000000000000', v_supplier, 1, 'wave', null, null, null);
    raise exception 'ÉCHEC 3g : règlement au-delà de la dette accepté';
  exception when sqlstate '22023' then null;
  end;
  raise notice 'OK 3 : stock, coût moyen, dette et règlements';
end;
$test$;

-- 4. Autre boutique : rien.
select set_config('request.jwt.claims', '{"sub":"c0200000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $test$
begin
  if exists (select 1 from public.suppliers) or exists (select 1 from public.purchase_orders) then raise exception 'ÉCHEC 4a'; end if;
  begin
    perform public.supplier_balances('c2100000-0000-4000-8000-000000000000');
    raise exception 'ÉCHEC 4b';
  exception when sqlstate '42501' then null;
  end;
  raise notice 'OK 4 : isolation entre boutiques';
end;
$test$;

rollback;
