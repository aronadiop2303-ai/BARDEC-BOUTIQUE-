-- =============================================================================
-- NE JAMAIS EXÉCUTER SUR LE PROJET RÉEL.
-- =============================================================================
-- Test de la migration 20261016005017_pos_sales_foundation.sql.
-- STATUT : NON TESTÉE (Docker indisponible : ce fichier n'a jamais été exécuté).
-- À exécuter UNIQUEMENT sur une base locale jetable (supabase start), en tant que postgres,
-- après application de toutes les migrations (fix_store_audit_trigger_columns compris) :
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/pos_sales_foundation.test.sql
-- Tout se passe dans une transaction terminée par ROLLBACK : aucune donnée ne reste.
--
-- Scénarios : vente comptoir sans client ; quantité fractionnaire ; stock insuffisant refusé ;
-- prix envoyé par le client ignoré ; palier appliqué ; viewer refusé ; numérotation continue
-- (y compris après un échec) ; annulation avec contre-passation ; isolation entre deux sites ;
-- remise hors limite refusée ; clôture Z.
-- =============================================================================

begin;

-- Identifiants fixes des données de test.
-- Utilisateurs : owner A, editor A, viewer A, owner B.
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'owner-a@test.local'),
  ('a0000000-0000-4000-8000-000000000002', 'editor-a@test.local'),
  ('a0000000-0000-4000-8000-000000000003', 'viewer-a@test.local'),
  ('b0000000-0000-4000-8000-000000000001', 'owner-b@test.local');

insert into public.workspaces (id, owner_id, name, slug) values
  ('a1000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000001', 'Espace A', 'espace-a-test'),
  ('b1000000-0000-4000-8000-000000000000', 'b0000000-0000-4000-8000-000000000001', 'Espace B', 'espace-b-test');

insert into public.workspace_memberships (workspace_id, user_id, role) values
  ('a1000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000002', 'editor'),
  ('a1000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000003', 'viewer');

insert into public.sites (id, workspace_id, name, slug, site_type) values
  ('a2000000-0000-4000-8000-000000000000', 'a1000000-0000-4000-8000-000000000000', 'Quincaillerie A', 'quincaillerie-a-test', 'store'),
  ('b2000000-0000-4000-8000-000000000000', 'b1000000-0000-4000-8000-000000000000', 'Quincaillerie B', 'quincaillerie-b-test', 'store');

insert into public.business_profiles (site_id, public_name, phone, city) values
  ('a2000000-0000-4000-8000-000000000000', 'Quincaillerie A', '770000000', 'Dakar');

insert into public.stock_locations (id, site_id, name, location_type) values
  ('a3000000-0000-4000-8000-000000000000', 'a2000000-0000-4000-8000-000000000000', 'Magasin', 'store'),
  ('b3000000-0000-4000-8000-000000000000', 'b2000000-0000-4000-8000-000000000000', 'Magasin', 'store');

insert into public.product_units (id, site_id, code, label, dimension, decimal_places) values
  ('a4000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000000', 'u', 'Pièce', 'count', 0),
  ('a4000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000000', 'm', 'Mètre', 'length', 2),
  ('a4000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000000', 'rouleau', 'Rouleau', 'count', 0),
  ('b4000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000000', 'u', 'Pièce', 'count', 0);

-- Produits : marteau (pièce, 5 000), câble (mètre, 350 ; rouleau de 100 m), produit du site B.
insert into public.products (id, site_id, name, slug, status, price) values
  ('a5000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000000', 'Marteau', 'marteau-test', 'active', 5000),
  ('a5000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000000', 'Câble 2,5 mm²', 'cable-test', 'active', 350),
  ('b5000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000000', 'Pince B', 'pince-b-test', 'active', 2000);

insert into public.product_sell_units (site_id, product_id, unit_id, conversion_to_base, is_default, min_sale_quantity, quantity_step) values
  ('a2000000-0000-4000-8000-000000000000', 'a5000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 1, true, 1, 1),
  ('a2000000-0000-4000-8000-000000000000', 'a5000000-0000-4000-8000-000000000002', 'a4000000-0000-4000-8000-000000000002', 1, true, 0.5, 0.5),
  ('a2000000-0000-4000-8000-000000000000', 'a5000000-0000-4000-8000-000000000002', 'a4000000-0000-4000-8000-000000000003', 100, false, 1, 1),
  ('b2000000-0000-4000-8000-000000000000', 'b5000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000001', 1, true, 1, 1);

-- Palier : marteau à 4 500 à partir de 10 pièces.
insert into public.price_tiers (site_id, product_id, unit_id, min_quantity, unit_price) values
  ('a2000000-0000-4000-8000-000000000000', 'a5000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 10, 4500);

-- Stock initial : 20 marteaux, 300 m de câble, 5 pinces (site B).
insert into public.inventory_movements (site_id, product_id, movement_type, quantity_delta, stock_location_id) values
  ('a2000000-0000-4000-8000-000000000000', 'a5000000-0000-4000-8000-000000000001', 'initial_stock', 20, 'a3000000-0000-4000-8000-000000000000'),
  ('a2000000-0000-4000-8000-000000000000', 'a5000000-0000-4000-8000-000000000002', 'initial_stock', 300, 'a3000000-0000-4000-8000-000000000000'),
  ('b2000000-0000-4000-8000-000000000000', 'b5000000-0000-4000-8000-000000000001', 'initial_stock', 5, 'b3000000-0000-4000-8000-000000000000');

-- Sessions de caisse ouvertes : A (par l'editor), B (par owner B).
insert into public.cash_register_sessions (id, site_id, opened_by, opening_cash) values
  ('a6000000-0000-4000-8000-000000000000', 'a2000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000002', 10000),
  ('b6000000-0000-4000-8000-000000000000', 'b2000000-0000-4000-8000-000000000000', 'b0000000-0000-4000-8000-000000000001', 0);

create temporary table test_results (sale text, payload jsonb) on commit drop;
grant all on test_results to authenticated;

-- -----------------------------------------------------------------------------
-- En tant qu'editor A
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;

-- 1. Vente comptoir sans client + prix client ignoré : 2 marteaux, unit_price envoyé = 1.
insert into test_results select 'sale1', public.record_sale(
  'a2000000-0000-4000-8000-000000000000', 'a6000000-0000-4000-8000-000000000000',
  '[{"product_id":"a5000000-0000-4000-8000-000000000001","quantity":2,"unit_price":1}]',
  '[{"method":"cash","amount":15000}]');

-- 2. Quantité fractionnaire : 2,5 m de câble, payé par Wave (enregistrement manuel).
insert into test_results select 'sale2', public.record_sale(
  'a2000000-0000-4000-8000-000000000000', 'a6000000-0000-4000-8000-000000000000',
  '[{"product_id":"a5000000-0000-4000-8000-000000000002","unit_id":"a4000000-0000-4000-8000-000000000002","quantity":2.5}]',
  '[{"method":"wave","amount":875,"reference":"W-TEST"}]');

-- 3. Stock insuffisant : 4 rouleaux de 100 m (400 m) alors qu'il reste 297,5 m.
do $test$
begin
  perform public.record_sale(
    'a2000000-0000-4000-8000-000000000000', 'a6000000-0000-4000-8000-000000000000',
    '[{"product_id":"a5000000-0000-4000-8000-000000000002","unit_id":"a4000000-0000-4000-8000-000000000003","quantity":4}]',
    '[{"method":"cash","amount":140000}]');
  raise exception 'ÉCHEC 3 : vente acceptée malgré un stock insuffisant';
exception when sqlstate '23514' then
  raise notice 'OK 3 : stock insuffisant refusé (%)', sqlerrm;
end;
$test$;

-- 4. Palier : 10 marteaux à 4 500 = 45 000.
insert into test_results select 'sale4', public.record_sale(
  'a2000000-0000-4000-8000-000000000000', 'a6000000-0000-4000-8000-000000000000',
  '[{"product_id":"a5000000-0000-4000-8000-000000000001","quantity":10}]',
  '[{"method":"cash","amount":45000}]');

-- 5. Remise hors limite : editor sans droit de remise (limite 0 %).
do $test$
begin
  perform public.record_sale(
    'a2000000-0000-4000-8000-000000000000', 'a6000000-0000-4000-8000-000000000000',
    '[{"product_id":"a5000000-0000-4000-8000-000000000001","quantity":1}]',
    '[{"method":"cash","amount":5000}]', '{}',
    '{"type":"amount","value":500,"reason":"Client fidèle"}');
  raise exception 'ÉCHEC 5 : remise acceptée au-delà de la limite du rôle';
exception when sqlstate '42501' then
  raise notice 'OK 5 : remise refusée (%)', sqlerrm;
end;
$test$;

-- 6. Isolation : produit du site B vendu sur le site A, puis vente sur le site B.
do $test$
begin
  perform public.record_sale(
    'a2000000-0000-4000-8000-000000000000', 'a6000000-0000-4000-8000-000000000000',
    '[{"product_id":"b5000000-0000-4000-8000-000000000001","quantity":1}]',
    '[{"method":"cash","amount":2000}]');
  raise exception 'ÉCHEC 6a : produit d''un autre site accepté';
exception when sqlstate '22023' then
  raise notice 'OK 6a : produit d''un autre site refusé';
end;
$test$;

do $test$
begin
  perform public.record_sale(
    'b2000000-0000-4000-8000-000000000000', 'b6000000-0000-4000-8000-000000000000',
    '[{"product_id":"b5000000-0000-4000-8000-000000000001","quantity":1}]',
    '[{"method":"cash","amount":2000}]');
  raise exception 'ÉCHEC 6b : vente acceptée sur un site dont l''utilisateur n''est pas membre';
exception when sqlstate '42501' then
  raise notice 'OK 6b : vente sur un autre site refusée';
end;
$test$;

do $test$
begin
  perform public.record_sale(
    'a2000000-0000-4000-8000-000000000000', 'b6000000-0000-4000-8000-000000000000',
    '[{"product_id":"a5000000-0000-4000-8000-000000000001","quantity":1}]',
    '[{"method":"cash","amount":5000}]');
  raise exception 'ÉCHEC 6c : session de caisse d''un autre site acceptée';
exception when sqlstate '22023' then
  raise notice 'OK 6c : session d''un autre site refusée';
end;
$test$;

-- 7. Annulation refusée à un editor.
do $test$
begin
  perform public.void_sale((select (payload ->> 'order_id')::uuid from test_results where sale = 'sale1'), 'Erreur de saisie');
  raise exception 'ÉCHEC 7a : annulation acceptée pour un editor';
exception when sqlstate '42501' then
  raise notice 'OK 7a : annulation refusée à un editor';
end;
$test$;

reset role;

-- -----------------------------------------------------------------------------
-- En tant que viewer A
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;

do $test$
begin
  perform public.record_sale(
    'a2000000-0000-4000-8000-000000000000', 'a6000000-0000-4000-8000-000000000000',
    '[{"product_id":"a5000000-0000-4000-8000-000000000001","quantity":1}]',
    '[{"method":"cash","amount":5000}]');
  raise exception 'ÉCHEC 8 : vente acceptée pour un viewer';
exception when sqlstate '42501' then
  raise notice 'OK 8 : viewer refusé';
end;
$test$;

reset role;

-- -----------------------------------------------------------------------------
-- En tant que propriétaire A : annulation, puis clôture Z
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

insert into test_results select 'void1', public.void_sale(
  (select (payload ->> 'order_id')::uuid from test_results where sale = 'sale1'), 'Erreur de saisie');

do $test$
begin
  perform public.void_sale((select (payload ->> 'order_id')::uuid from test_results where sale = 'sale1'), 'Deuxième fois');
  raise exception 'ÉCHEC 9 : double annulation acceptée';
exception when sqlstate '22023' then
  raise notice 'OK 9 : double annulation refusée';
end;
$test$;

-- 10. Numérotation : après l'échec des tests 3, 5 et 6, la vente suivante prend le numéro suivant, sans trou.
insert into test_results select 'sale10', public.record_sale(
  'a2000000-0000-4000-8000-000000000000', 'a6000000-0000-4000-8000-000000000000',
  '[{"product_id":"a5000000-0000-4000-8000-000000000001","quantity":1}]',
  '[{"method":"cash","amount":5000}]');

insert into test_results select 'close', public.close_cash_session('a6000000-0000-4000-8000-000000000000', 60000, 'Test Z');

reset role;

-- -----------------------------------------------------------------------------
-- Vérifications (en tant que postgres)
-- -----------------------------------------------------------------------------
do $test$
declare
  v_year text := extract(year from (now() at time zone 'Africa/Dakar'))::text;
  v_sale1 jsonb := (select payload from test_results where sale = 'sale1');
  v_sale2 jsonb := (select payload from test_results where sale = 'sale2');
  v_sale4 jsonb := (select payload from test_results where sale = 'sale4');
  v_sale10 jsonb := (select payload from test_results where sale = 'sale10');
  v_void jsonb := (select payload from test_results where sale = 'void1');
  v_close jsonb := (select payload from test_results where sale = 'close');
  v_order public.orders%rowtype;
  v_qty numeric;
  v_stock numeric;
begin
  -- 1. Vente comptoir sans client, prix relu en base.
  select * into v_order from public.orders where id = (v_sale1 ->> 'order_id')::uuid;
  assert v_order.customer_id is null and v_order.customer_phone is null, 'vente 1 : client inattendu';
  assert v_order.sales_channel = 'pos', 'vente 1 : canal';
  assert v_order.subtotal = 10000 and v_order.grand_total = 10000, 'vente 1 : prix client non ignoré (' || v_order.grand_total || ')';
  assert v_order.amount_tendered = 15000 and v_order.change_given = 5000, 'vente 1 : monnaie rendue';
  assert (select unit_price from public.order_items where order_id = v_order.id) = 5000, 'vente 1 : prix unitaire';

  -- 2. Quantité fractionnaire.
  select quantity into v_qty from public.order_items where order_id = (v_sale2 ->> 'order_id')::uuid;
  assert v_qty = 2.5, 'vente 2 : quantité fractionnaire';
  assert (v_sale2 ->> 'grand_total')::numeric = 875, 'vente 2 : total 2,5 × 350';
  assert exists (select 1 from public.payment_transactions where order_id = (v_sale2 ->> 'order_id')::uuid
    and provider = 'manual_wave' and payment_method = 'wave' and status = 'succeeded'), 'vente 2 : paiement Wave manuel';
  assert (select quantity_delta from public.inventory_movements where reference_id = (v_sale2 ->> 'order_id')::uuid) = -2.5,
    'vente 2 : mouvement de stock';

  -- 4. Palier.
  assert (v_sale4 ->> 'grand_total')::numeric = 45000, 'vente 4 : palier non appliqué';

  -- 7. Annulation : stock rendu, document conservé et marqué annulé, remboursement en caisse.
  assert (v_void ->> 'stock_movements_reversed')::int = 1 and (v_void ->> 'documents_voided')::int = 1, 'annulation : compteurs';
  assert (v_void ->> 'cash_refund_recorded')::boolean, 'annulation : remboursement non inscrit en caisse';
  assert exists (select 1 from public.store_documents where order_id = (v_sale1 ->> 'order_id')::uuid
    and status = 'void' and voided_at is not null and void_reason = 'Erreur de saisie'), 'annulation : document';
  assert (select status from public.orders where id = (v_sale1 ->> 'order_id')::uuid) = 'cancelled', 'annulation : commande';

  -- Stock du marteau : 20 − 2 (annulée, rendue) − 10 − 1 = 9.
  select sum(quantity_delta) into v_stock from public.inventory_movements
  where product_id = 'a5000000-0000-4000-8000-000000000001';
  assert v_stock = 9, 'stock final du marteau : ' || v_stock;

  -- 10. Numérotation continue malgré les ventes refusées.
  assert v_sale1 ->> 'document_number' = 'TICKET-' || v_year || '-000001', 'numéro 1 : ' || (v_sale1 ->> 'document_number');
  assert v_sale2 ->> 'document_number' = 'TICKET-' || v_year || '-000002', 'numéro 2';
  assert v_sale4 ->> 'document_number' = 'TICKET-' || v_year || '-000003', 'numéro 3';
  assert v_sale10 ->> 'document_number' = 'TICKET-' || v_year || '-000004', 'numéro 4 : ' || (v_sale10 ->> 'document_number');
  assert (select count(*) from public.store_documents where site_id = 'b2000000-0000-4000-8000-000000000000') = 0,
    'isolation : document créé sur le site B';

  -- Clôture Z : 10 000 + 10 000 + 45 000 + 5 000 − 10 000 (remboursement) = 60 000 attendus.
  assert (v_close ->> 'expected_cash')::numeric = 60000, 'Z : espèces attendues ' || (v_close ->> 'expected_cash');
  assert (v_close ->> 'discrepancy')::numeric = 0, 'Z : écart';
  assert v_close ->> 'status' = 'closed', 'Z : statut';
  assert (v_close -> 'by_method' -> 'wave' ->> 'amount')::numeric = 875, 'Z : total Wave';

  raise notice 'OK : toutes les vérifications sont passées.';
end;
$test$;

rollback;
