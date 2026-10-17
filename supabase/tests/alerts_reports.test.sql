-- =============================================================================
-- NE JAMAIS EXÉCUTER SUR LE PROJET RÉEL.
-- =============================================================================
-- Test de la migration 20261018040000_alerts_reports.sql.
-- STATUT : NON TESTÉ EN EXÉCUTION (ni Docker ni CLI Supabase disponibles : ce fichier n'a jamais été exécuté).
-- Base locale jetable uniquement, en tant que postgres, après TOUTES les migrations :
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/alerts_reports.test.sql
-- Transaction terminée par ROLLBACK : aucune donnée ne reste.
--
-- Scénarios : seuil défini par le magasinier ; liste à réapprovisionner sans coût ; rapport de ventes net des
-- retours ; top produits ; ventes par vendeur ; marge au coût moyen actuel, produit sans coût exclu ;
-- magasinier et vendeur sans accès aux rapports ; autre boutique refusée.
-- =============================================================================

begin;

insert into auth.users (id, email) values
  ('d0100000-0000-4000-8000-000000000001', 'owner-x@test.local'),
  ('d0100000-0000-4000-8000-000000000002', 'cashier-x@test.local'),
  ('d0100000-0000-4000-8000-000000000003', 'stock-x@test.local'),
  ('d0200000-0000-4000-8000-000000000001', 'owner-y@test.local');
insert into public.workspaces (id, owner_id, name, slug) values
  ('d1100000-0000-4000-8000-000000000000', 'd0100000-0000-4000-8000-000000000001', 'Espace X', 'espace-x-test'),
  ('d1200000-0000-4000-8000-000000000000', 'd0200000-0000-4000-8000-000000000001', 'Espace Y', 'espace-y-test');
insert into public.workspace_memberships (workspace_id, user_id, role) values
  ('d1100000-0000-4000-8000-000000000000', 'd0100000-0000-4000-8000-000000000002', 'editor'),
  ('d1100000-0000-4000-8000-000000000000', 'd0100000-0000-4000-8000-000000000003', 'viewer');
insert into public.sites (id, workspace_id, name, slug, site_type) values
  ('d2100000-0000-4000-8000-000000000000', 'd1100000-0000-4000-8000-000000000000', 'Quincaillerie X', 'quincaillerie-x-test', 'store');
insert into public.site_staff (site_id, user_id, staff_role) values
  ('d2100000-0000-4000-8000-000000000000', 'd0100000-0000-4000-8000-000000000003', 'stock_keeper');
insert into public.stock_locations (id, site_id, name, location_type) values
  ('d3100000-0000-4000-8000-000000000000', 'd2100000-0000-4000-8000-000000000000', 'Magasin', 'store');
insert into public.product_units (id, site_id, code, label, dimension, decimal_places) values
  ('d4100000-0000-4000-8000-000000000001', 'd2100000-0000-4000-8000-000000000000', 'u', 'Pièce', 'count', 0);
insert into public.products (id, site_id, name, slug, status, price) values
  ('d5100000-0000-4000-8000-000000000001', 'd2100000-0000-4000-8000-000000000000', 'Marteau', 'marteau-x-test', 'active', 5000),
  ('d5100000-0000-4000-8000-000000000002', 'd2100000-0000-4000-8000-000000000000', 'Scie', 'scie-x-test', 'active', 8000);
insert into public.product_sell_units (site_id, product_id, unit_id, conversion_to_base, is_default, min_sale_quantity, quantity_step) values
  ('d2100000-0000-4000-8000-000000000000', 'd5100000-0000-4000-8000-000000000001', 'd4100000-0000-4000-8000-000000000001', 1, true, 1, 1),
  ('d2100000-0000-4000-8000-000000000000', 'd5100000-0000-4000-8000-000000000002', 'd4100000-0000-4000-8000-000000000001', 1, true, 1, 1);
insert into public.inventory_movements (site_id, product_id, movement_type, quantity_delta, stock_location_id) values
  ('d2100000-0000-4000-8000-000000000000', 'd5100000-0000-4000-8000-000000000001', 'initial_stock', 12, 'd3100000-0000-4000-8000-000000000000'),
  ('d2100000-0000-4000-8000-000000000000', 'd5100000-0000-4000-8000-000000000002', 'initial_stock', 5, 'd3100000-0000-4000-8000-000000000000');
-- Coût connu pour le marteau seulement.
insert into public.product_costs (product_id, site_id, unit_cost) values
  ('d5100000-0000-4000-8000-000000000001', 'd2100000-0000-4000-8000-000000000000', 3000);
insert into public.cash_register_sessions (id, site_id, opened_by, opening_cash) values
  ('d6100000-0000-4000-8000-000000000001', 'd2100000-0000-4000-8000-000000000000', 'd0100000-0000-4000-8000-000000000002', 0);

create temporary table t (name text, payload jsonb) on commit drop;
grant all on t to authenticated;

-- Ventes du jour par le vendeur : 4 marteaux (20 000) et 1 scie (8 000).
select set_config('request.jwt.claims', '{"sub":"d0100000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
insert into t select 'sale', public.record_sale('d2100000-0000-4000-8000-000000000000', 'd6100000-0000-4000-8000-000000000001',
  '[{"product_id":"d5100000-0000-4000-8000-000000000001","quantity":4},{"product_id":"d5100000-0000-4000-8000-000000000002","quantity":1}]',
  '[{"method":"cash","amount":28000}]');
do $test$
begin
  perform public.sales_report('d2100000-0000-4000-8000-000000000000', current_date, current_date, 'day');
  raise exception 'ÉCHEC 0 : rapport accessible au vendeur';
exception when sqlstate '42501' then
  raise notice 'OK 0 : rapports refusés au vendeur';
end;
$test$;

-- Propriétaire : retour d'un marteau (5 000), restocké.
select set_config('request.jwt.claims', '{"sub":"d0100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public.record_return('d2100000-0000-4000-8000-000000000000', (select (payload ->> 'order_id')::uuid from t where name = 'sale'),
  jsonb_build_array(jsonb_build_object('order_item_id', (select id from public.order_items where order_id = (select (payload ->> 'order_id')::uuid from t where name = 'sale')
    and product_id = 'd5100000-0000-4000-8000-000000000001'), 'quantity', 1, 'disposition', 'restock')),
  'Retour test', 'wave', null);

-- -----------------------------------------------------------------------------
-- 1. Rapports (propriétaire)
-- -----------------------------------------------------------------------------
do $test$
declare
  v_today date := (now() at time zone 'Africa/Dakar')::date;
  v_row record;
  v_margin jsonb;
begin
  select * into v_row from public.sales_report('d2100000-0000-4000-8000-000000000000', v_today, v_today, 'day');
  if v_row.sales_count <> 1 or v_row.gross_total <> 28000 or v_row.returns_total <> 5000 or v_row.net_total <> 23000 then
    raise exception 'ÉCHEC 1a : %', v_row;
  end if;
  select * into v_row from public.top_products('d2100000-0000-4000-8000-000000000000', v_today, v_today) limit 1;
  if v_row.product_name <> 'Marteau' or v_row.quantity_sold <> 4 or v_row.quantity_returned <> 1 or v_row.revenue <> 15000 then
    raise exception 'ÉCHEC 1b : top %', v_row;
  end if;
  select * into v_row from public.sales_by_seller('d2100000-0000-4000-8000-000000000000', v_today, v_today);
  if v_row.cashier_id <> 'd0100000-0000-4000-8000-000000000002' or v_row.total <> 28000 then raise exception 'ÉCHEC 1c'; end if;
  v_margin := public.margin_report('d2100000-0000-4000-8000-000000000000', v_today, v_today);
  -- Marteau : CA net 15 000 ; coût 3 marteaux × 3 000 = 9 000 ; marge 6 000. Scie sans coût : exclue.
  if v_margin ->> 'cost_basis' <> 'current_average_cost' or (v_margin ->> 'margin')::numeric <> 6000
     or (v_margin ->> 'products_without_cost')::int <> 1 or (v_margin ->> 'revenue_without_cost')::numeric <> 8000 then
    raise exception 'ÉCHEC 1d : marge %', v_margin;
  end if;
  raise notice 'OK 1 : rapports et marge estimée';
end;
$test$;

-- -----------------------------------------------------------------------------
-- 2. Magasinier : seuil et liste, aucun rapport
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"d0100000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select public.set_stock_threshold('d5100000-0000-4000-8000-000000000002', 6, 10);
do $test$
declare
  v_row record;
begin
  -- Scie : 5 − 1 vendue = 4 ≤ 6 ; à commander max(10, 6 − 4) = 10.
  select * into v_row from public.restock_list('d2100000-0000-4000-8000-000000000000');
  if v_row.product_name <> 'Scie' or v_row.stock <> 4 or v_row.suggested_quantity <> 10 then raise exception 'ÉCHEC 2a : %', v_row; end if;
  begin
    perform public.margin_report('d2100000-0000-4000-8000-000000000000', current_date, current_date);
    raise exception 'ÉCHEC 2b : marge accessible au magasinier';
  exception when sqlstate '42501' then null;
  end;
  raise notice 'OK 2 : magasinier : seuils et liste, pas de rapport';
end;
$test$;

-- 3. Autre boutique.
select set_config('request.jwt.claims', '{"sub":"d0200000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $test$
begin
  perform public.restock_list('d2100000-0000-4000-8000-000000000000');
  raise exception 'ÉCHEC 3';
exception when sqlstate '42501' then
  raise notice 'OK 3 : isolation entre boutiques';
end;
$test$;

rollback;
