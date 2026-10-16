-- =============================================================================
-- NE JAMAIS EXÉCUTER SUR LE PROJET RÉEL.
-- =============================================================================
-- Test de la migration 20261016065722_stock_entries_foundation.sql.
-- STATUT : NON TESTÉE (Docker indisponible : ce fichier n'a jamais été exécuté).
-- Base locale jetable uniquement, en tant que postgres, après TOUTES les migrations :
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/stock_entries_foundation.test.sql
-- Transaction terminée par ROLLBACK : aucune donnée ne reste.
--
-- Scénarios : entrée par le propriétaire ; refus editor ; quantité fractionnaire en kg ; conversion d'unité
-- (sac de 50 kg) ; refus de stock négatif ; motif obligatoire ; inventaire initial unique ; écriture directe
-- refusée ; isolation entre deux sites.
-- =============================================================================

begin;

insert into auth.users (id, email) values
  ('d0000000-0000-4000-8000-000000000001', 'owner-d@test.local'),
  ('d0000000-0000-4000-8000-000000000002', 'editor-d@test.local'),
  ('e0000000-0000-4000-8000-000000000001', 'owner-e@test.local');

insert into public.workspaces (id, owner_id, name, slug) values
  ('d1000000-0000-4000-8000-000000000000', 'd0000000-0000-4000-8000-000000000001', 'Espace D', 'espace-d-test'),
  ('e1000000-0000-4000-8000-000000000000', 'e0000000-0000-4000-8000-000000000001', 'Espace E', 'espace-e-test');
insert into public.workspace_memberships (workspace_id, user_id, role) values
  ('d1000000-0000-4000-8000-000000000000', 'd0000000-0000-4000-8000-000000000002', 'editor');

insert into public.sites (id, workspace_id, name, slug, site_type) values
  ('d2000000-0000-4000-8000-000000000000', 'd1000000-0000-4000-8000-000000000000', 'Quincaillerie D', 'quincaillerie-d-test', 'store'),
  ('e2000000-0000-4000-8000-000000000000', 'e1000000-0000-4000-8000-000000000000', 'Quincaillerie E', 'quincaillerie-e-test', 'store');

insert into public.stock_locations (id, site_id, name, location_type) values
  ('d3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000000', 'Magasin', 'store'),
  ('d3000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000000', 'Dépôt', 'warehouse'),
  ('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000000', 'Magasin', 'store');

insert into public.product_units (id, site_id, code, label, dimension, decimal_places) values
  ('d4000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000000', 'kg', 'Kilogramme', 'mass', 3),
  ('d4000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000000', 'sac', 'Sac', 'count', 0),
  ('e4000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000000', 'kg', 'Kilogramme', 'mass', 3);

insert into public.products (id, site_id, name, slug, status, price) values
  ('d5000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000000', 'Ciment', 'ciment-test', 'active', 100),
  ('e5000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000000', 'Ciment E', 'ciment-e-test', 'active', 100);

insert into public.product_sell_units (site_id, product_id, unit_id, conversion_to_base, is_default) values
  ('d2000000-0000-4000-8000-000000000000', 'd5000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001', 1, true),
  ('d2000000-0000-4000-8000-000000000000', 'd5000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000002', 50, false),
  ('e2000000-0000-4000-8000-000000000000', 'e5000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 1, true);

-- -----------------------------------------------------------------------------
-- Propriétaire D
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $test$
declare
  v_result jsonb;
begin
  -- 1. Inventaire initial : 2 sacs de 50 kg au magasin = 100 kg.
  v_result := public.record_stock_movement('d2000000-0000-4000-8000-000000000000', 'd5000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001', 'initial_stock', 2, 'd4000000-0000-4000-8000-000000000002', null);
  assert (v_result ->> 'quantity_delta')::numeric = 100, '1 : conversion sac → kg';
  assert (v_result ->> 'stock_after')::numeric = 100, '1 : stock après';

  -- 2. Réception fractionnaire : 12,5 kg.
  v_result := public.record_stock_movement('d2000000-0000-4000-8000-000000000000', 'd5000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001', 'restock', 12.5, 'd4000000-0000-4000-8000-000000000001', 'Livraison fournisseur');
  assert (v_result ->> 'stock_after')::numeric = 112.5, '2 : 100 + 12,5';

  -- 3. Ajustement négatif avec motif : −2,25 kg.
  v_result := public.record_stock_movement('d2000000-0000-4000-8000-000000000000', 'd5000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001', 'adjustment', -2.25, null, 'Comptage physique');
  assert (v_result ->> 'stock_after')::numeric = 110.25, '3 : ajustement';

  -- 4. Perte : 0,25 kg.
  v_result := public.record_stock_movement('d2000000-0000-4000-8000-000000000000', 'd5000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001', 'damage', 0.25, null, 'Sac percé');
  assert (v_result ->> 'quantity_delta')::numeric = -0.25 and (v_result ->> 'stock_after')::numeric = 110, '4 : perte';
  raise notice 'OK 1-4 : entrées, conversion, fraction, ajustement, perte';
end;
$test$;

do $test$
begin
  perform public.record_stock_movement('d2000000-0000-4000-8000-000000000000', 'd5000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001', 'damage', 500, null, 'Inondation');
  raise exception 'ÉCHEC 5 : stock négatif accepté';
exception when sqlstate '23514' then raise notice 'OK 5 : stock négatif refusé';
end;
$test$;

do $test$
begin
  perform public.record_stock_movement('d2000000-0000-4000-8000-000000000000', 'd5000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001', 'adjustment', 1, null, '  ');
  raise exception 'ÉCHEC 6 : ajustement sans motif accepté';
exception when sqlstate '22023' then raise notice 'OK 6 : motif obligatoire';
end;
$test$;

do $test$
begin
  perform public.record_stock_movement('d2000000-0000-4000-8000-000000000000', 'd5000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001', 'initial_stock', 5, null, null);
  raise exception 'ÉCHEC 7 : second inventaire initial accepté';
exception when sqlstate '22023' then raise notice 'OK 7 : inventaire initial unique par emplacement';
end;
$test$;

do $test$
begin
  perform public.record_stock_movement('d2000000-0000-4000-8000-000000000000', 'd5000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001', 'restock', 1.5, 'd4000000-0000-4000-8000-000000000002', null);
  raise exception 'ÉCHEC 8 : 1,5 sac accepté (unité entière)';
exception when sqlstate '22023' then raise notice 'OK 8 : décimales de l''unité respectées';
end;
$test$;

-- 9. Isolation : produit du site E, emplacement du site E, site E.
do $test$
begin
  perform public.record_stock_movement('d2000000-0000-4000-8000-000000000000', 'e5000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001', 'restock', 1, null, null);
  raise exception 'ÉCHEC 9a : produit d''un autre site accepté';
exception when sqlstate '22023' then raise notice 'OK 9a : produit d''un autre site refusé';
end;
$test$;

do $test$
begin
  perform public.record_stock_movement('d2000000-0000-4000-8000-000000000000', 'd5000000-0000-4000-8000-000000000001',
    'e3000000-0000-4000-8000-000000000001', 'restock', 1, null, null);
  raise exception 'ÉCHEC 9b : emplacement d''un autre site accepté';
exception when sqlstate '22023' then raise notice 'OK 9b : emplacement d''un autre site refusé';
end;
$test$;

do $test$
begin
  perform public.record_stock_movement('e2000000-0000-4000-8000-000000000000', 'e5000000-0000-4000-8000-000000000001',
    'e3000000-0000-4000-8000-000000000001', 'restock', 1, null, null);
  raise exception 'ÉCHEC 9c : mouvement sur un site non possédé accepté';
exception when sqlstate '42501' then raise notice 'OK 9c : site d''un autre propriétaire refusé';
end;
$test$;

-- 10. Écriture directe refusée (droits retirés).
do $test$
begin
  insert into public.inventory_movements (site_id, product_id, movement_type, quantity_delta, stock_location_id)
  values ('d2000000-0000-4000-8000-000000000000', 'd5000000-0000-4000-8000-000000000001', 'restock', 1000,
    'd3000000-0000-4000-8000-000000000001');
  raise exception 'ÉCHEC 10 : écriture directe acceptée';
exception when insufficient_privilege then raise notice 'OK 10 : écriture directe refusée';
end;
$test$;

reset role;

-- -----------------------------------------------------------------------------
-- Editor D : refusé
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;

do $test$
begin
  perform public.record_stock_movement('d2000000-0000-4000-8000-000000000000', 'd5000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001', 'restock', 1, null, null);
  raise exception 'ÉCHEC 11 : entrée acceptée pour un editor';
exception when sqlstate '42501' then raise notice 'OK 11 : editor refusé';
end;
$test$;

reset role;

-- -----------------------------------------------------------------------------
-- Vérifications (postgres)
-- -----------------------------------------------------------------------------
do $test$
begin
  assert (select sum(quantity_delta) from public.inventory_movements
          where product_id = 'd5000000-0000-4000-8000-000000000001'
            and stock_location_id = 'd3000000-0000-4000-8000-000000000001') = 110, 'stock final 110 kg';
  assert (select count(*) from public.inventory_movements where product_id = 'd5000000-0000-4000-8000-000000000001') = 4,
    '4 mouvements seulement';
  assert (select bool_and(reference_type = 'manual_entry' and actor_user_id = 'd0000000-0000-4000-8000-000000000001')
          from public.inventory_movements where product_id = 'd5000000-0000-4000-8000-000000000001'), 'traçabilité';
  assert (select count(*) from public.inventory_movements where site_id = 'e2000000-0000-4000-8000-000000000000') = 0,
    'isolation : aucun mouvement sur le site E';
  assert (select count(*) from public.store_audit_events
          where site_id = 'd2000000-0000-4000-8000-000000000000' and event_key = 'inventory_movements.insert') >= 4,
    'audit : événements attendus';
  raise notice 'OK : toutes les vérifications sont passées.';
end;
$test$;

rollback;
