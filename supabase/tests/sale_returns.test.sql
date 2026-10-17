-- =============================================================================
-- NE JAMAIS EXÉCUTER SUR LE PROJET RÉEL.
-- =============================================================================
-- Test des migrations 20261018000000_sale_returns.sql et 20261018000100_void_after_return_guard.sql (scénario 6).
-- STATUT : NON TESTÉ EN EXÉCUTION (ni Docker ni CLI Supabase disponibles : ce fichier n'a jamais été exécuté).
-- Base locale jetable uniquement, en tant que postgres, après TOUTES les migrations :
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/sale_returns.test.sql
-- Transaction terminée par ROLLBACK : aucune donnée ne reste.
--
-- Scénarios : retour partiel remis en stock + remboursement espèces (caisse) ; avoir AVOIR-AAAA-NNNNNN ; casse
-- sans remise en stock ; limite aux quantités vendues ; remise globale répartie ; plafond du vendeur ; vente
-- annulée refusée ; autre boutique refusée ; annulation après retour refusée (partie 2/2).
-- =============================================================================

begin;

insert into auth.users (id, email) values
  ('b0100000-0000-4000-8000-000000000001', 'owner-r@test.local'),
  ('b0100000-0000-4000-8000-000000000002', 'cashier-r@test.local'),
  ('b0200000-0000-4000-8000-000000000001', 'owner-s@test.local');
insert into public.workspaces (id, owner_id, name, slug) values
  ('b1100000-0000-4000-8000-000000000000', 'b0100000-0000-4000-8000-000000000001', 'Espace R', 'espace-r-test'),
  ('b1200000-0000-4000-8000-000000000000', 'b0200000-0000-4000-8000-000000000001', 'Espace S', 'espace-s-test');
insert into public.workspace_memberships (workspace_id, user_id, role) values
  ('b1100000-0000-4000-8000-000000000000', 'b0100000-0000-4000-8000-000000000002', 'editor');
insert into public.sites (id, workspace_id, name, slug, site_type, settings) values
  ('b2100000-0000-4000-8000-000000000000', 'b1100000-0000-4000-8000-000000000000', 'Quincaillerie R', 'quincaillerie-r-test', 'store',
   '{"pos":{"cashier_max_return_amount":3000}}');
insert into public.stock_locations (id, site_id, name, location_type) values
  ('b3100000-0000-4000-8000-000000000000', 'b2100000-0000-4000-8000-000000000000', 'Magasin', 'store');
insert into public.product_units (id, site_id, code, label, dimension, decimal_places) values
  ('b4100000-0000-4000-8000-000000000001', 'b2100000-0000-4000-8000-000000000000', 'u', 'Pièce', 'count', 0);
insert into public.products (id, site_id, name, slug, status, price) values
  ('b5100000-0000-4000-8000-000000000001', 'b2100000-0000-4000-8000-000000000000', 'Marteau', 'marteau-r-test', 'active', 5000);
insert into public.product_sell_units (site_id, product_id, unit_id, conversion_to_base, is_default, min_sale_quantity, quantity_step) values
  ('b2100000-0000-4000-8000-000000000000', 'b5100000-0000-4000-8000-000000000001', 'b4100000-0000-4000-8000-000000000001', 1, true, 1, 1);
insert into public.inventory_movements (site_id, product_id, movement_type, quantity_delta, stock_location_id) values
  ('b2100000-0000-4000-8000-000000000000', 'b5100000-0000-4000-8000-000000000001', 'initial_stock', 20, 'b3100000-0000-4000-8000-000000000000');
insert into public.cash_register_sessions (id, site_id, opened_by, opening_cash) values
  ('b6100000-0000-4000-8000-000000000001', 'b2100000-0000-4000-8000-000000000000', 'b0100000-0000-4000-8000-000000000001', 0);

create temporary table t (name text, payload jsonb) on commit drop;
grant all on t to authenticated;

-- Vente : 4 marteaux (20 000) avec remise globale de 2 000 → 18 000 payés en espèces.
select set_config('request.jwt.claims', '{"sub":"b0100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into t select 'sale', public.record_sale('b2100000-0000-4000-8000-000000000000', 'b6100000-0000-4000-8000-000000000001',
  '[{"product_id":"b5100000-0000-4000-8000-000000000001","quantity":4}]', '[{"method":"cash","amount":18000}]', '{}',
  '{"type":"amount","value":2000,"reason":"Client fidèle"}');

-- -----------------------------------------------------------------------------
-- 1. Propriétaire : retour d'un marteau remis en stock, remboursé en espèces
-- -----------------------------------------------------------------------------
insert into t select 'return1', public.record_return('b2100000-0000-4000-8000-000000000000', (select (payload ->> 'order_id')::uuid from t where name = 'sale'),
  jsonb_build_array(jsonb_build_object('order_item_id', (select id from public.order_items where order_id = (select (payload ->> 'order_id')::uuid from t where name = 'sale')),
    'quantity', 1, 'disposition', 'restock')),
  'Doublon d''achat', 'cash', 'b6100000-0000-4000-8000-000000000001');
do $test$
declare
  v jsonb := (select payload from t where name = 'return1');
begin
  -- 20 000 × 1/4 × (18 000 / 20 000) = 4 500 : la remise globale est répartie.
  if (v ->> 'refund_amount')::numeric <> 4500 then raise exception 'ÉCHEC 1a : remboursement %', v ->> 'refund_amount'; end if;
  if v ->> 'document_number' !~ '^AVOIR-[0-9]{4}-[0-9]{6}$' then raise exception 'ÉCHEC 1b : numéro %', v ->> 'document_number'; end if;
  if (select sum(quantity_delta) from public.inventory_movements where product_id = 'b5100000-0000-4000-8000-000000000001') <> 17 then
    raise exception 'ÉCHEC 1c : stock attendu 17 (20 − 4 + 1)';
  end if;
  if (select count(*) from public.cash_register_movements where session_id = 'b6100000-0000-4000-8000-000000000001' and movement_type = 'refund_cash' and amount = 4500) <> 1 then
    raise exception 'ÉCHEC 1d : remboursement absent de la caisse';
  end if;
  if (public.cash_session_summary('b6100000-0000-4000-8000-000000000001') ->> 'expected_cash')::numeric <> 13500 then
    raise exception 'ÉCHEC 1e : attendu X';
  end if;
  if (select document_type from public.store_documents where document_number = v ->> 'document_number') <> 'credit_note' then
    raise exception 'ÉCHEC 1f : avoir non enregistré';
  end if;
  raise notice 'OK 1 : retour partiel, avoir, stock et caisse';
end;
$test$;

-- 2. Casse : remboursé, pas de retour en stock.
insert into t select 'return2', public.record_return('b2100000-0000-4000-8000-000000000000', (select (payload ->> 'order_id')::uuid from t where name = 'sale'),
  jsonb_build_array(jsonb_build_object('order_item_id', (select id from public.order_items where order_id = (select (payload ->> 'order_id')::uuid from t where name = 'sale')),
    'quantity', 1, 'disposition', 'damage')),
  'Manche cassé', 'wave', null);
do $test$
begin
  if (select sum(quantity_delta) from public.inventory_movements where product_id = 'b5100000-0000-4000-8000-000000000001') <> 17 then
    raise exception 'ÉCHEC 2a : la casse ne doit pas revenir en stock';
  end if;
  if (select count(*) from public.cash_register_movements where movement_type = 'refund_cash') <> 1 then
    raise exception 'ÉCHEC 2b : remboursement Wave inscrit en caisse';
  end if;
  raise notice 'OK 2 : casse et remboursement manuel';
end;
$test$;

-- 3. Limite aux quantités vendues : 2 déjà retournés sur 4, retour de 3 refusé.
do $test$
begin
  perform public.record_return('b2100000-0000-4000-8000-000000000000', (select (payload ->> 'order_id')::uuid from t where name = 'sale'),
    jsonb_build_array(jsonb_build_object('order_item_id', (select id from public.order_items where order_id = (select (payload ->> 'order_id')::uuid from t where name = 'sale')),
      'quantity', 3, 'disposition', 'restock')),
    'Trop', 'wave', null);
  raise exception 'ÉCHEC 3 : retour supérieur au vendu accepté';
exception when sqlstate '23514' then
  raise notice 'OK 3 : quantités limitées au vendu';
end;
$test$;

-- -----------------------------------------------------------------------------
-- 4. Vendeur : au-dessus du plafond (3 000) refusé
-- -----------------------------------------------------------------------------
-- Le vendeur ne peut pas lire les lignes d'une vente du propriétaire (RLS voulue) : l'identifiant de la ligne
-- est lu ICI, encore en tant que propriétaire, et conservé dans la table temporaire t.
insert into t select 'item', to_jsonb(i.id) from public.order_items i
where i.order_id = (select (payload ->> 'order_id')::uuid from t where name = 'sale');
select set_config('request.jwt.claims', '{"sub":"b0100000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $test$
begin
  perform public.record_return('b2100000-0000-4000-8000-000000000000', (select (payload ->> 'order_id')::uuid from t where name = 'sale'),
    jsonb_build_array(jsonb_build_object('order_item_id', (select (payload #>> '{}')::uuid from t where name = 'item'),
      'quantity', 1, 'disposition', 'restock')),
    'Vendeur', 'wave', null);
  raise exception 'ÉCHEC 4 : plafond du vendeur dépassé';
exception when sqlstate '42501' then
  raise notice 'OK 4 : plafond du vendeur';
end;
$test$;

-- 5. Autre boutique refusée.
select set_config('request.jwt.claims', '{"sub":"b0200000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $test$
begin
  perform public.record_return('b2100000-0000-4000-8000-000000000000', (select (payload ->> 'order_id')::uuid from t where name = 'sale'),
    '[{"order_item_id":"00000000-0000-4000-8000-000000000000","quantity":1}]', 'Intrus', 'cash', null);
  raise exception 'ÉCHEC 5 : autre boutique acceptée';
exception when sqlstate '42501' then
  raise notice 'OK 5 : isolation entre boutiques';
end;
$test$;

-- -----------------------------------------------------------------------------
-- 6. (après 20261018000100_void_after_return_guard) annulation d'une vente retournée refusée
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"b0100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $test$
begin
  perform public.void_sale((select (payload ->> 'order_id')::uuid from t where name = 'sale'), 'Annulation après retour');
  raise notice 'INFO 6 : partie 2/2 non appliquée — void_sale a contre-passé une vente déjà retournée (double remise en stock)';
exception when sqlstate '22023' then
  raise notice 'OK 6 : annulation après retour refusée (%)', sqlerrm;
end;
$test$;

rollback;
